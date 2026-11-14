/**
 * HTTP calls to the `/v1` API with the node's credential. Errors come
 * back as `NodeApiError` carrying the API's `{ error, message, detail }`.
 */
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import { CREDENTIAL_NAME } from './brand';
import {
	errorEnvelope,
	isFinishedRun,
	nextPollDelay,
	normalizeBaseUrl,
	retryAfterMs,
} from './helpers';

export type ApiContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

/** A 429 means the API refused the request before doing anything, so any request can be retried. */
const MAX_RATE_LIMIT_RETRIES = 2;

export async function getBaseUrl(this: ApiContext): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	return normalizeBaseUrl(credentials.baseUrl);
}

export interface ApiResponse<T> {
	statusCode: number;
	headers: Record<string, unknown>;
	body: T;
}

export interface RequestOptions {
	/** JSON, or `FormData` for a file upload (multipart; the runtime sets the boundary). */
	body?: IDataObject | FormData;
	qs?: IDataObject;
	itemIndex?: number;
	timeout?: number;
}

/** One API call. Returns status, headers and the parsed body; throws `NodeApiError` on 4xx/5xx. */
export async function apiRequestFull<T = IDataObject>(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<ApiResponse<T>> {
	const baseUrl = await getBaseUrl.call(this);
	const request: IHttpRequestOptions = {
		method,
		url: `${baseUrl}/v1${path}`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: options.timeout ?? 120_000,
		headers: { Accept: 'application/json' },
	};
	// The type names the form-data package's FormData; the runtime's HTTP client (axios) also streams the built-in one.
	if (options.body !== undefined) request.body = options.body as IHttpRequestOptions['body'];
	if (options.qs !== undefined) request.qs = dropEmpty(options.qs);

	for (let attempt = 0; ; attempt++) {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			request,
		)) as { statusCode: number; headers: Record<string, unknown>; body: unknown };
		const status = response.statusCode;
		if (status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
			const envelope = errorEnvelope(response.body, status);
			await sleep(retryAfterMs(response.headers?.['retry-after'], envelope.detail));
			continue;
		}
		if (status >= 400) {
			const envelope = errorEnvelope(response.body, status);
			throw new NodeApiError(this.getNode(), envelope as unknown as JsonObject, {
				message: envelope.message,
				description: describeError(envelope),
				httpCode: String(status),
				...(options.itemIndex !== undefined ? { itemIndex: options.itemIndex } : {}),
			});
		}
		return { statusCode: status, headers: response.headers ?? {}, body: response.body as T };
	}
}

/** One API call; the parsed body. */
export async function apiRequest<T = IDataObject>(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	const response = await apiRequestFull.call(this, method, path, options);
	return response.body as T;
}

/**
 * Every item of a cursor-paginated list (`{ <key>: [...], pagination: { nextCursor, hasMore } }`),
 * up to `limit` when given.
 */
export async function apiRequestAllItems(
	this: ApiContext,
	path: string,
	key: string,
	qs: IDataObject = {},
	limit?: number,
	itemIndex?: number,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const pageSize = limit === undefined ? 100 : Math.min(100, Math.max(1, limit - items.length));
		const page = (await apiRequest.call(this, 'GET', path, {
			qs: { ...qs, limit: pageSize, cursor },
			itemIndex,
		})) as IDataObject;
		const batch = (page[key] as IDataObject[] | undefined) ?? [];
		items.push(...batch);
		const pagination = page.pagination as
			| { nextCursor?: string | null; hasMore?: boolean }
			| undefined;
		cursor = pagination?.hasMore && pagination.nextCursor ? pagination.nextCursor : undefined;
	} while (cursor && (limit === undefined || items.length < limit));
	return limit === undefined ? items : items.slice(0, limit);
}

/** A render job, as `GET /render-jobs/{id}` answers it. */
export interface RenderJob extends IDataObject {
	id: string;
	status: 'queued' | 'running' | 'succeeded' | 'failed';
	progress: number;
	result: IDataObject | null;
	error: IDataObject | null;
}

/**
 * Read something until `isDone` says it finished (returns it). Reads after
 * 1 s, then every ×1.5 up to 5 s; gives up after `timeoutSeconds` with
 * `stillRunning` (the work keeps going on the server).
 */
async function pollUntilDone<T>(
	context: IExecuteFunctions,
	args: {
		read: () => Promise<T>;
		isDone: (value: T) => boolean;
		timeoutSeconds: number;
		itemIndex: number;
		stillRunning: { message: string; description: string };
	},
): Promise<T> {
	const deadline = Date.now() + Math.max(1, args.timeoutSeconds) * 1000;
	let delay: number | undefined;
	for (;;) {
		delay = nextPollDelay(delay);
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new NodeOperationError(context.getNode(), args.stillRunning.message, {
				itemIndex: args.itemIndex,
				description: args.stillRunning.description,
			});
		}
		await sleep(Math.min(delay, remaining));
		const value = await args.read();
		if (args.isDone(value)) return value;
	}
}

/**
 * Poll a render job until it succeeds (returns it) or fails (throws with the
 * job's error); gives up after `timeoutSeconds` (the job keeps running on the server).
 */
export async function waitForRenderJob(
	this: IExecuteFunctions,
	jobId: string,
	timeoutSeconds: number,
	itemIndex: number,
): Promise<RenderJob> {
	const job = await pollUntilDone(this, {
		read: async () =>
			(
				(await apiRequest.call(this, 'GET', `/render-jobs/${encodeURIComponent(jobId)}`, {
					itemIndex,
				})) as unknown as { job: RenderJob }
			).job,
		isDone: (current: RenderJob) => current.status === 'succeeded' || current.status === 'failed',
		timeoutSeconds,
		itemIndex,
		stillRunning: {
			message: `Render job ${jobId} is still running after ${timeoutSeconds} seconds`,
			description:
				'The job keeps running on the server and is charged only if it succeeds. Raise the timeout, or read it later with Render Job → Get.',
		},
	});
	if (job.status === 'failed') {
		const error = (job.error ?? {}) as { error?: string; message?: string };
		throw new NodeApiError(
			this.getNode(),
			(job.error ?? { error: 'RENDER_FAILED' }) as JsonObject,
			{
				message: error.message ?? `Render job ${jobId} failed`,
				description: `Render job ${jobId} failed (${error.error ?? 'unknown error'}). No credits were charged.`,
				itemIndex,
			},
		);
	}
	return job;
}

/** A design generation job, as `GET /designs/generate/{jobId}` answers it (in `data`). */
export interface DesignGenerateJob extends IDataObject {
	jobId: string;
	status: 'running' | 'succeeded' | 'failed';
}

/**
 * Poll a design generation job until the design is saved (returns the job)
 * or it fails (throws with its error; failed generations are refunded).
 */
export async function waitForDesignGeneration(
	this: IExecuteFunctions,
	jobId: string,
	timeoutSeconds: number,
	itemIndex: number,
): Promise<DesignGenerateJob> {
	const job = await pollUntilDone(this, {
		read: async () =>
			(
				(await apiRequest.call(this, 'GET', `/designs/generate/${encodeURIComponent(jobId)}`, {
					itemIndex,
				})) as unknown as { data: DesignGenerateJob }
			).data,
		isDone: (current: DesignGenerateJob) => current.status !== 'running',
		timeoutSeconds,
		itemIndex,
		stillRunning: {
			message: `The template is still being designed after ${timeoutSeconds} seconds`,
			description: `Job ${jobId} keeps running on the server and the template is saved in the workspace when it is done. Raise the timeout, or look for it with Template → Get Many.`,
		},
	});
	if (job.status === 'failed') {
		const error = (job.error ?? {}) as { error?: string; message?: string };
		throw new NodeApiError(this.getNode(), (job.error ?? { error: 'AI_FAILED' }) as JsonObject, {
			message: error.message ?? 'The template couldn’t be designed',
			description: `Design job ${jobId} failed (${error.error ?? 'unknown error'}). The AI credits were refunded.`,
			itemIndex,
		});
	}
	return job;
}

/**
 * Poll a workflow run until it ends. Returns the run with each row's result;
 * a `failed` run (no row went through) throws with the run's error.
 */
export async function waitForWorkflowRun(
	this: IExecuteFunctions,
	workflowId: string,
	runId: string,
	timeoutSeconds: number,
	itemIndex: number,
): Promise<IDataObject> {
	const run = await pollUntilDone(this, {
		read: async () =>
			(
				(await apiRequest.call(
					this,
					'GET',
					`/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}`,
					{ itemIndex },
				)) as unknown as { run: IDataObject }
			).run,
		isDone: (current: IDataObject) => isFinishedRun(current.status),
		timeoutSeconds,
		itemIndex,
		stillRunning: {
			message: `Workflow run ${runId} is still running after ${timeoutSeconds} seconds`,
			description:
				'The run keeps going on the server. Raise the timeout, read it later with Workflow Run → Get, or start a workflow on the trigger’s Workflow Run events.',
		},
	});
	if (run.status === 'failed') {
		const error = (run.error ?? {}) as { code?: string; message?: string };
		throw new NodeApiError(this.getNode(), (run.error ?? { code: 'RUN_FAILED' }) as JsonObject, {
			message: error.message ?? `Workflow run ${runId} failed`,
			description: `Workflow run ${runId} failed (${error.code ?? 'no row went through'}).`,
			itemIndex,
		});
	}
	return run;
}

function describeError(envelope: { error: string; detail?: unknown }): string {
	const detail =
		envelope.detail === undefined ? '' : ` ${JSON.stringify(envelope.detail).slice(0, 800)}`;
	return `${envelope.error}${detail}`;
}

function dropEmpty(qs: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(qs)) {
		if (value !== undefined && value !== null && value !== '') out[key] = value;
	}
	return out;
}
