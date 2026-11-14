import type {
	IBinaryKeyData,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { jsonParse, NodeOperationError } from 'n8n-workflow';

import {
	buildModifications,
	fileNameFromUrl,
	mimeTypeFor,
	parseList,
	parsePages,
	shapeRenderItem,
	shapeRenderResult,
	toAnalyticsDay,
	type MapperValue,
	type ModificationRow,
} from '../../shared/helpers';
import {
	apiRequest,
	apiRequestAllItems,
	apiRequestFull,
	getBaseUrl,
	waitForDesignGeneration,
	waitForRenderJob,
	waitForWorkflowRun,
	type DesignGenerateJob,
	type RenderJob,
} from '../../shared/transport';

type Output = INodeExecutionData | INodeExecutionData[];

/** Run one resource/operation for item `i`. */
export async function runOperation(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<Output> {
	const key = `${resource}.${operation}`;
	switch (key) {
		case 'render.render':
			return await renderTemplate.call(this, i);
		case 'render.get':
			return await getRender.call(this, i);
		case 'render.getAll':
			return await getManyRenders.call(this, i);
		case 'renderJob.get':
			return await getRenderJob.call(this, i);
		case 'renderJob.wait':
			return await waitRenderJob.call(this, i);
		case 'design.get':
			return await getDesign.call(this, i);
		case 'design.getAll':
			return await getManyDesigns.call(this, i);
		case 'design.generate':
			return await generateDesign.call(this, i);
		case 'image.removeBackground':
			return await removeBackground.call(this, i);
		case 'audio.transcribe':
			return await transcribe.call(this, i);
		case 'workflow.get':
			return await getWorkflow.call(this, i);
		case 'workflow.getAll':
			return await getManyWorkflows.call(this, i);
		case 'workflow.run':
			return await runWorkflow.call(this, i);
		case 'workflowRun.get':
			return await workflowRunAction.call(this, i, 'GET', '');
		case 'workflowRun.cancel':
			return await workflowRunAction.call(this, i, 'POST', '/cancel');
		case 'workflowRun.getAll':
			return await getManyWorkflowRuns.call(this, i);
		case 'socialAnalytics.getOverview':
			return await getSocialAnalytics.call(this, i, 'overview');
		case 'socialAnalytics.getDaily':
			return await getSocialAnalytics.call(this, i, 'daily');
		case 'socialAnalytics.getInsights':
			return await getSocialAnalytics.call(this, i, 'insights');
		case 'socialAccount.getAll':
			return await getManySocialAccounts.call(this, i);
		case 'socialPost.create':
			return await createSocialPost.call(this, i);
		case 'socialPost.get':
			return await socialPostAction.call(this, i, 'GET', '');
		case 'socialPost.cancel':
			return await socialPostAction.call(this, i, 'POST', '/cancel');
		case 'socialPost.retry':
			return await socialPostAction.call(this, i, 'POST', '/retry');
		case 'socialPost.getAll':
			return await getManySocialPosts.call(this, i);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`Unsupported operation "${operation}" for "${resource}"`,
				{
					itemIndex: i,
				},
			);
	}
}

// ---------- shared ----------

function templateIdParam(context: IExecuteFunctions, i: number): string {
	const id = String(
		context.getNodeParameter('templateId', i, '', { extractValue: true }) ?? '',
	).trim();
	if (!id) throw new NodeOperationError(context.getNode(), 'Pick a template', { itemIndex: i });
	return id;
}

function workflowIdParam(context: IExecuteFunctions, i: number): string {
	const id = String(
		context.getNodeParameter('workflowId', i, '', { extractValue: true }) ?? '',
	).trim();
	if (!id) throw new NodeOperationError(context.getNode(), 'Pick a workflow', { itemIndex: i });
	return id;
}

function limitParam(context: IExecuteFunctions, i: number): number | undefined {
	const returnAll = context.getNodeParameter('returnAll', i, false) as boolean;
	return returnAll ? undefined : (context.getNodeParameter('limit', i, 50) as number);
}

function modificationsParam(context: IExecuteFunctions, i: number): IDataObject {
	const mapper = context.getNodeParameter('parameters', i, null) as MapperValue | null;
	const rows = context.getNodeParameter(
		'extraModifications.modification',
		i,
		[],
	) as ModificationRow[];
	return buildModifications(mapper, context.getInputData()[i]?.json ?? {}, rows) as IDataObject;
}

function pagesParam(context: IExecuteFunctions, raw: unknown, i: number): number[] | undefined {
	try {
		return parsePages(raw);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), (error as Error).message, { itemIndex: i });
	}
}

function item(json: IDataObject, i: number, binary?: IBinaryKeyData): INodeExecutionData {
	return binary ? { json, binary, pairedItem: { item: i } } : { json, pairedItem: { item: i } };
}

// ---------- render ----------

async function renderTemplate(this: IExecuteFunctions, i: number): Promise<Output> {
	const format = this.getNodeParameter('format', i) as string;
	const resizeMode = this.getNodeParameter('resizeMode', i, 'none') as string;
	const runAsJob = this.getNodeParameter('runAsJob', i, false) as boolean;
	const waitForCompletion = this.getNodeParameter('waitForCompletion', i, true) as boolean;
	const options = this.getNodeParameter('options', i, {}) as {
		download?: boolean;
		includePages?: string;
		quality?: number;
		scale?: number;
		subtitles?: string;
		timeout?: number;
		webhookUrl?: string;
	};
	const isJob = runAsJob || format === 'mp4';

	const response: IDataObject = { type: 'url', format };
	if (options.scale !== undefined) response.scale = options.scale;
	if (options.quality !== undefined && (format === 'jpeg' || format === 'webp'))
		response.quality = options.quality;
	const pages = pagesParam(this, options.includePages, i);
	if (pages) response.includePages = pages;
	if (resizeMode === 'size') {
		const size = String(this.getNodeParameter('size', i, '', { extractValue: true }) ?? '').trim();
		if (!size)
			throw new NodeOperationError(
				this.getNode(),
				'Choose a size, or set Resize to Template Size',
				{ itemIndex: i },
			);
		response.size = size;
	} else if (resizeMode === 'sizes') {
		const sizes = parseList(this.getNodeParameter('sizes', i, []));
		if (sizes.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Choose at least one size', { itemIndex: i });
		}
		if (isJob) {
			throw new NodeOperationError(
				this.getNode(),
				'Several sizes can’t be rendered as a job or as an MP4: render one size per call instead',
				{ itemIndex: i },
			);
		}
		response.sizes = sizes;
	}
	if (options.subtitles) {
		if (format !== 'mp4') {
			throw new NodeOperationError(this.getNode(), 'Subtitles File needs the MP4 format', {
				itemIndex: i,
			});
		}
		response.subtitles = options.subtitles;
	}

	const body: IDataObject = {
		templateId: templateIdParam(this, i),
		modifications: modificationsParam(this, i),
		response,
	};
	if (runAsJob) body.async = true;
	if (options.webhookUrl) {
		if (!isJob) {
			throw new NodeOperationError(
				this.getNode(),
				'Webhook URL only works for jobs: turn on Run as Job, or render an MP4',
				{ itemIndex: i },
			);
		}
		body.webhookUrl = options.webhookUrl;
	}

	const answer = await apiRequestFull.call(this, 'POST', '/render', { body, itemIndex: i });
	let json: IDataObject;
	if (answer.statusCode === 202) {
		const accepted = (answer.body as { data: { jobId: string; status: string } }).data;
		if (!waitForCompletion) {
			return item({ jobId: accepted.jobId, status: accepted.status, url: null, urls: [] }, i);
		}
		const job = await waitForRenderJob.call(this, accepted.jobId, options.timeout ?? 600, i);
		json = shapeRenderResult(job.result ?? {}, job.warnings, { jobId: job.id }) as IDataObject;
	} else {
		const rendered = answer.body as { data: IDataObject; warnings?: string[] };
		json = shapeRenderResult(rendered.data, rendered.warnings) as IDataObject;
	}
	if (!options.download) return item(json, i);
	return item(json, i, await downloadFiles.call(this, json.urls as string[]));
}

/** Each file as binary data: `data`, `data_1`, `data_2`, … */
async function downloadFiles(this: IExecuteFunctions, urls: string[]): Promise<IBinaryKeyData> {
	const baseUrl = await getBaseUrl.call(this);
	const binary: IBinaryKeyData = {};
	for (const [index, url] of urls.entries()) {
		const absolute = new URL(url, `${baseUrl}/`).toString();
		const data = (await this.helpers.httpRequest({
			method: 'GET',
			url: absolute,
			encoding: 'arraybuffer',
			json: false,
		})) as ArrayBuffer;
		const fileName = fileNameFromUrl(absolute, `render-${index + 1}`);
		binary[index === 0 ? 'data' : `data_${index}`] = await this.helpers.prepareBinaryData(
			Buffer.from(data),
			fileName,
			mimeTypeFor(fileName),
		);
	}
	return binary;
}

function shapeJob(job: RenderJob): IDataObject {
	if (job.status === 'succeeded' && job.result) {
		return {
			...job,
			...shapeRenderResult(job.result, job.warnings, {}),
			result: job.result,
			id: job.id,
			status: job.status,
		};
	}
	return { ...job, url: null, urls: [] };
}

async function getRenderJob(this: IExecuteFunctions, i: number): Promise<Output> {
	const jobId = String(this.getNodeParameter('jobId', i)).trim();
	const { job } = (await apiRequest.call(this, 'GET', `/render-jobs/${encodeURIComponent(jobId)}`, {
		itemIndex: i,
	})) as unknown as { job: RenderJob };
	return item(shapeJob(job), i);
}

async function waitRenderJob(this: IExecuteFunctions, i: number): Promise<Output> {
	const jobId = String(this.getNodeParameter('jobId', i)).trim();
	const timeout = this.getNodeParameter('timeout', i, 600) as number;
	return item(shapeJob(await waitForRenderJob.call(this, jobId, timeout, i)), i);
}

// ---------- render log ----------

async function getRender(this: IExecuteFunctions, i: number): Promise<Output> {
	const renderId = String(this.getNodeParameter('renderId', i)).trim();
	const { render } = (await apiRequest.call(
		this,
		'GET',
		`/renders/${encodeURIComponent(renderId)}`,
		{
			itemIndex: i,
		},
	)) as unknown as { render: IDataObject };
	const json = shapeRenderItem(render) as IDataObject;
	if (!this.getNodeParameter('download', i, false)) return item(json, i);
	return item(json, i, await downloadFiles.call(this, json.urls as string[]));
}

async function getManyRenders(this: IExecuteFunctions, i: number): Promise<Output> {
	const filters = this.getNodeParameter('filters', i, {}) as { status?: string; designId?: string };
	const renders = await apiRequestAllItems.call(
		this,
		'/renders',
		'renders',
		{ status: filters.status, designId: filters.designId?.trim() },
		limitParam(this, i),
		i,
	);
	return renders.map((render) => item(shapeRenderItem(render) as IDataObject, i));
}

// ---------- designs ----------

async function getDesign(this: IExecuteFunctions, i: number): Promise<Output> {
	const id = templateIdParam(this, i);
	const { design } = (await apiRequest.call(this, 'GET', `/designs/${encodeURIComponent(id)}`, {
		itemIndex: i,
	})) as unknown as { design: IDataObject };
	return item(design, i);
}

async function getManyDesigns(this: IExecuteFunctions, i: number): Promise<Output> {
	const source = this.getNodeParameter('source', i, 'workspace') as string;
	const designs = await apiRequestAllItems.call(
		this,
		'/designs',
		'designs',
		{ source },
		limitParam(this, i),
		i,
	);
	return designs.map((design) => item({ ...design, source }, i));
}

async function generateDesign(this: IExecuteFunctions, i: number): Promise<Output> {
	const prompt = String(this.getNodeParameter('prompt', i, '') ?? '').trim();
	if (!prompt) {
		throw new NodeOperationError(this.getNode(), 'Describe the template to design', {
			itemIndex: i,
		});
	}
	const options = this.getNodeParameter('options', i, {}) as {
		name?: string;
		pages?: number;
		referenceImageUrl?: string;
		timeout?: number;
		video?: boolean;
	};
	const body: IDataObject = { prompt };
	const size = String(this.getNodeParameter('designSize', i, '') ?? '').trim();
	if (size) body.size = size;
	const brand = this.getNodeParameter('brand', i, 'workspace') as string;
	if (brand === 'none') body.brand = false;
	else if (brand === 'custom') {
		const custom: IDataObject = {};
		const colors = parseList(
			(this.getNodeParameter('brandColors.colour', i, []) as Array<{ value?: string }>).map(
				(colour) => colour.value ?? '',
			),
		);
		const fonts = parseList(this.getNodeParameter('brandFonts', i, ''));
		const logo = String(this.getNodeParameter('brandLogo', i, '') ?? '').trim();
		if (colors.length) custom.colors = colors;
		if (fonts.length) custom.fonts = fonts;
		if (logo) custom.logo = logo;
		if (!Object.keys(custom).length) {
			throw new NodeOperationError(
				this.getNode(),
				'Give at least one brand colour, font or logo, or choose another Brand',
				{ itemIndex: i },
			);
		}
		body.brand = custom;
	}
	if (options.name?.trim()) body.name = options.name.trim();
	if (options.pages !== undefined) body.pages = options.pages;
	if (options.video) body.video = true;
	if (options.referenceImageUrl?.trim()) body.referenceImageUrl = options.referenceImageUrl.trim();
	const waitForCompletion = this.getNodeParameter('waitForCompletion', i, true) as boolean;
	if (!waitForCompletion) body.async = true;

	// The API waits up to about 25 seconds for the design, then answers 202 with the job.
	const answer = await apiRequestFull.call(this, 'POST', '/designs/generate', {
		body,
		itemIndex: i,
	});
	let job = (answer.body as { data: DesignGenerateJob }).data;
	if (answer.statusCode === 202 && waitForCompletion) {
		job = await waitForDesignGeneration.call(this, job.jobId, options.timeout ?? 300, i);
	}
	const design = job.design as IDataObject | undefined;
	return item({ ...job, templateId: design?.id ?? null }, i);
}

// ---------- AI media ----------

/**
 * The request body for an endpoint that takes a file: `{ url, ...fields }`
 * as JSON, or the input item's binary file as a multipart upload in `file`.
 */
async function fileBody(
	this: IExecuteFunctions,
	i: number,
	fields: IDataObject,
): Promise<IDataObject | FormData> {
	const inputType = this.getNodeParameter('inputType', i, 'url') as string;
	if (inputType === 'url') {
		const url = String(this.getNodeParameter('fileUrl', i, '') ?? '').trim();
		if (!url)
			throw new NodeOperationError(this.getNode(), 'Enter the file’s URL', { itemIndex: i });
		return { url, ...fields };
	}
	const property = String(this.getNodeParameter('binaryPropertyName', i, 'data') ?? '').trim();
	const binary = this.helpers.assertBinaryData(i, property);
	const buffer = await this.helpers.getBinaryDataBuffer(i, property);
	const form = new FormData();
	// Fields first: multipart parsers fill in the text fields as they come, before the file.
	for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
	form.append(
		'file',
		new Blob([buffer], { type: binary.mimeType || 'application/octet-stream' }),
		binary.fileName || 'file',
	);
	return form;
}

async function removeBackground(this: IExecuteFunctions, i: number): Promise<Output> {
	const options = this.getNodeParameter('options', i, {}) as { name?: string; download?: boolean };
	const body = await fileBody.call(
		this,
		i,
		options.name?.trim() ? { name: options.name.trim() } : {},
	);
	const result = (await apiRequest.call(this, 'POST', '/images/remove-background', {
		body,
		itemIndex: i,
		timeout: 180_000,
	})) as IDataObject;
	if (!options.download || typeof result.url !== 'string') return item(result, i);
	return item(result, i, await downloadFiles.call(this, [result.url]));
}

async function transcribe(this: IExecuteFunctions, i: number): Promise<Output> {
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const fields: IDataObject = {};
	for (const key of [
		'language',
		'style',
		'maxCharsPerLine',
		'maxLines',
		'start',
		'duration',
		'offset',
	]) {
		const value = typeof options[key] === 'string' ? (options[key] as string).trim() : options[key];
		if (value !== undefined && value !== null && value !== '') fields[key] = value;
	}
	if (options.words) fields.words = true;
	const body = await fileBody.call(this, i, fields);
	// Up to 2 hours of audio: give the transcription time.
	const result = (await apiRequest.call(this, 'POST', '/ai/transcribe', {
		body,
		itemIndex: i,
		timeout: 600_000,
	})) as IDataObject;
	return item(result, i);
}

// ---------- social ----------

async function getManySocialAccounts(this: IExecuteFunctions, i: number): Promise<Output> {
	const { accounts } = (await apiRequest.call(this, 'GET', '/social/accounts', {
		itemIndex: i,
	})) as unknown as { accounts: IDataObject[] };
	return accounts.map((account) => item(account, i));
}

async function createSocialPost(this: IExecuteFunctions, i: number): Promise<Output> {
	const accounts = parseList(this.getNodeParameter('accounts', i, []));
	if (accounts.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Choose at least one account', { itemIndex: i });
	}
	const mediaSource = this.getNodeParameter('mediaSource', i, 'template') as string;
	const extra = this.getNodeParameter('additionalFields', i, {}) as {
		captions?: { caption?: Array<{ platform: string; text: string }> };
		draft?: boolean;
		includePages?: string;
		platformOptions?: string | IDataObject;
		quality?: number;
		scale?: number;
		scheduledAt?: string;
		timezone?: string;
	};

	const body: IDataObject = {
		accounts,
		caption: this.getNodeParameter('caption', i, '') as string,
	};
	if (mediaSource === 'template') {
		body.templateId = templateIdParam(this, i);
		body.modifications = modificationsParam(this, i);
		const response: IDataObject = {};
		const format = this.getNodeParameter('postFormat', i, 'auto') as string;
		if (format !== 'auto') response.format = format;
		if (extra.scale !== undefined) response.scale = extra.scale;
		if (extra.quality !== undefined) response.quality = extra.quality;
		const pages = pagesParam(this, extra.includePages, i);
		if (pages) response.includePages = pages;
		if (Object.keys(response).length) body.response = response;
	} else if (mediaSource === 'render') {
		body.renderId = String(this.getNodeParameter('renderId', i)).trim();
	} else if (mediaSource === 'urls') {
		body.mediaUrls = parseList(this.getNodeParameter('mediaUrls', i));
	}

	const captions: IDataObject = {};
	for (const entry of extra.captions?.caption ?? []) {
		if (entry.platform && entry.text) captions[entry.platform] = entry.text;
	}
	if (Object.keys(captions).length) body.captions = captions;
	if (extra.platformOptions) {
		const parsed =
			typeof extra.platformOptions === 'string'
				? jsonParse<IDataObject>(extra.platformOptions, {
						errorMessage: 'Platform Options must be a JSON object',
					})
				: extra.platformOptions;
		if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) body.options = parsed;
	}
	if (extra.scheduledAt) body.scheduledAt = extra.scheduledAt;
	if (extra.timezone) body.timezone = extra.timezone;
	if (extra.draft) body.draft = true;

	const created = (await apiRequest.call(this, 'POST', '/social/posts', {
		body,
		itemIndex: i,
	})) as unknown as {
		post: IDataObject;
		checks: IDataObject[];
	};
	return item({ ...created.post, checks: created.checks }, i);
}

async function socialPostAction(
	this: IExecuteFunctions,
	i: number,
	method: 'GET' | 'POST',
	suffix: '' | '/cancel' | '/retry',
): Promise<Output> {
	const postId = String(this.getNodeParameter('postId', i)).trim();
	const body: IDataObject | undefined =
		suffix === '/retry'
			? (() => {
					const targetId = String(this.getNodeParameter('targetId', i, '') ?? '').trim();
					return targetId ? { targetId } : {};
				})()
			: suffix === '/cancel'
				? {}
				: undefined;
	const { post } = (await apiRequest.call(
		this,
		method,
		`/social/posts/${encodeURIComponent(postId)}${suffix}`,
		{
			body,
			itemIndex: i,
		},
	)) as unknown as { post: IDataObject };
	return item(post, i);
}

async function getManySocialPosts(this: IExecuteFunctions, i: number): Promise<Output> {
	const status = this.getNodeParameter('status', i, '') as string;
	const posts = await apiRequestAllItems.call(
		this,
		'/social/posts',
		'posts',
		{ status },
		limitParam(this, i),
		i,
	);
	return posts.map((post) => item(post, i));
}

/** Overview and insights as one item; the daily report as one item per day. */
async function getSocialAnalytics(
	this: IExecuteFunctions,
	i: number,
	report: 'overview' | 'daily' | 'insights',
): Promise<Output> {
	const filters = this.getNodeParameter('filters', i, {}) as {
		accountIds?: string[];
		platforms?: string[];
	};
	const answer = (await apiRequest.call(this, 'GET', `/social/analytics/${report}`, {
		qs: {
			from: toAnalyticsDay(this.getNodeParameter('from', i, '')),
			to: toAnalyticsDay(this.getNodeParameter('to', i, '')),
			platform: parseList(filters.platforms).join(','),
			accountId: parseList(filters.accountIds).join(','),
		},
		itemIndex: i,
	})) as IDataObject;
	if (report !== 'daily') return item(answer, i);
	const timezone = (answer.range as IDataObject | undefined)?.timezone;
	return ((answer.days as IDataObject[] | undefined) ?? []).map((day) =>
		item({ ...day, timezone }, i),
	);
}

// ---------- workflows ----------

async function getWorkflow(this: IExecuteFunctions, i: number): Promise<Output> {
	const id = workflowIdParam(this, i);
	const { workflow } = (await apiRequest.call(this, 'GET', `/workflows/${encodeURIComponent(id)}`, {
		itemIndex: i,
	})) as unknown as { workflow: IDataObject };
	return item(workflow, i);
}

/** The API answers every workflow at once (at most 200). */
async function getManyWorkflows(this: IExecuteFunctions, i: number): Promise<Output> {
	const { workflows } = (await apiRequest.call(this, 'GET', '/workflows', {
		itemIndex: i,
	})) as unknown as { workflows: IDataObject[] };
	const limit = limitParam(this, i);
	return (limit === undefined ? workflows : workflows.slice(0, limit)).map((workflow) =>
		item(workflow, i),
	);
}

async function runWorkflow(this: IExecuteFunctions, i: number): Promise<Output> {
	const workflowId = workflowIdParam(this, i);
	const options = this.getNodeParameter('options', i, {}) as {
		maxRows?: number;
		payload?: string | IDataObject | IDataObject[];
		timeout?: number;
	};
	const body: IDataObject = {};
	if (options.maxRows !== undefined) body.maxRows = options.maxRows;
	if (options.payload !== undefined && options.payload !== '') {
		const payload =
			typeof options.payload === 'string'
				? jsonParse<unknown>(options.payload, {
						errorMessage: 'Rows must be JSON: an array of objects, or one object',
					})
				: options.payload;
		if (!payload || typeof payload !== 'object') {
			throw new NodeOperationError(
				this.getNode(),
				'Rows must be an array of objects, or one object',
				{ itemIndex: i },
			);
		}
		if (!Array.isArray(payload) || payload.length > 0) body.payload = payload as IDataObject;
	}
	const { run } = (await apiRequest.call(
		this,
		'POST',
		`/workflows/${encodeURIComponent(workflowId)}/run`,
		{ body, itemIndex: i },
	)) as unknown as { run: IDataObject };
	if (!this.getNodeParameter('waitForCompletion', i, true)) return item(run, i);
	return item(
		await waitForWorkflowRun.call(this, workflowId, String(run.id), options.timeout ?? 600, i),
		i,
	);
}

async function workflowRunAction(
	this: IExecuteFunctions,
	i: number,
	method: 'GET' | 'POST',
	suffix: '' | '/cancel',
): Promise<Output> {
	const workflowId = workflowIdParam(this, i);
	const runId = String(this.getNodeParameter('runId', i)).trim();
	const { run } = (await apiRequest.call(
		this,
		method,
		`/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}${suffix}`,
		{ body: method === 'POST' ? {} : undefined, itemIndex: i },
	)) as unknown as { run: IDataObject };
	return item(run, i);
}

async function getManyWorkflowRuns(this: IExecuteFunctions, i: number): Promise<Output> {
	const workflowId = workflowIdParam(this, i);
	const runs = await apiRequestAllItems.call(
		this,
		`/workflows/${encodeURIComponent(workflowId)}/runs`,
		'runs',
		{},
		limitParam(this, i),
		i,
	);
	return runs.map((run) => item(run, i));
}
