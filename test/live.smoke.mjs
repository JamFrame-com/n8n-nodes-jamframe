// Live smoke test of the built node against a running API. Skipped unless
// JAMFRAME_SMOKE_API_KEY is set; JAMFRAME_SMOKE_BASE_URL defaults to the local
// dev API. Spends 1 credit (a one-page PNG of a library template); with
// JAMFRAME_SMOKE_AI=1 also 1 AI credit (removes the background of that PNG,
// uploaded as a binary file). Run:
//   JAMFRAME_SMOKE_API_KEY=jf_live_… npm run test:smoke
//
// The node runs with a small fetch-based stand-in for n8n's HTTP helpers, so
// this checks the API contract (paths, bodies, answers), not n8n itself.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { JamFrame } = require('../dist/nodes/JamFrame/JamFrame.node.js');

const apiKey = process.env.JAMFRAME_SMOKE_API_KEY;
const baseUrl = (process.env.JAMFRAME_SMOKE_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
const withAi = process.env.JAMFRAME_SMOKE_AI === '1';

/** n8n's `httpRequest` options, done with fetch: json, qs, FormData, full response, status errors. */
async function request(options, auth) {
	const url = new URL(options.url);
	for (const [key, value] of Object.entries(options.qs ?? {})) url.searchParams.set(key, String(value));
	const headers = { ...(options.headers ?? {}), ...(auth ? { Authorization: `Bearer ${apiKey}` } : {}) };
	let body;
	if (options.body instanceof FormData) body = options.body;
	else if (options.body !== undefined && Object.keys(options.body).length) {
		body = JSON.stringify(options.body);
		headers['Content-Type'] = 'application/json';
	}
	const response = await fetch(url, {
		method: options.method ?? 'GET',
		headers,
		body,
		signal: AbortSignal.timeout(options.timeout ?? 120_000),
	});
	if (options.encoding === 'arraybuffer') return await response.arrayBuffer();
	const text = await response.text();
	const parsed = text && options.json ? JSON.parse(text) : text;
	if (!options.ignoreHttpStatusErrors && response.status >= 400) throw new Error(`HTTP ${response.status}: ${text}`);
	return options.returnFullResponse
		? { statusCode: response.status, headers: Object.fromEntries(response.headers), body: parsed }
		: parsed;
}

function context(params, items = [{ json: {} }]) {
	const get = (name) => name.split('.').reduce((v, k) => (v == null ? undefined : v[k]), params);
	return {
		getInputData: () => items,
		getNode: () => ({ name: 'JamFrame', type: 'n8n-nodes-jamframe.jamFrame', typeVersion: 1, parameters: {} }),
		continueOnFail: () => false,
		getCredentials: async () => ({ apiKey, baseUrl }),
		getNodeParameter(name, a, b, c) {
			const [fallback, options] = typeof a === 'number' ? [b, c] : [a, b];
			let value = get(name);
			if (value === undefined) return fallback;
			if (options?.extractValue && value && typeof value === 'object' && 'mode' in value) value = value.value;
			return value;
		},
		helpers: {
			httpRequestWithAuthentication: (credential, options) => request(options, true),
			httpRequest: (options) => request(options, false),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({ fileName, mimeType, buffer }),
			assertBinaryData: (i, name) => items[i].binary[name],
			getBinaryDataBuffer: async (i, name) => items[i].binary[name].buffer,
			returnJsonArray: (value) => (Array.isArray(value) ? value : [value]).map((json) => ({ json })),
		},
	};
}

const node = new JamFrame();
const run = async (params, items) => (await node.execute.call(context(params, items)))[0];

describe('live smoke', { skip: apiKey ? false : 'set JAMFRAME_SMOKE_API_KEY to run' }, () => {
	let template;
	let render;

	it('the credential test request answers 200', async () => {
		const answer = await request({ method: 'POST', url: `${baseUrl}/v1/auth`, json: true, returnFullResponse: true, ignoreHttpStatusErrors: true }, true);
		assert.equal(answer.statusCode, 200, JSON.stringify(answer.body));
	});

	it('the template picker and Template → Get find a one-page still library template', async () => {
		const picked = await node.methods.listSearch.searchTemplates.call(context({}));
		assert.ok(picked.results.some((r) => r.name.startsWith('Library: ')), 'no library templates in the picker');
		const library = await run({ resource: 'design', operation: 'getAll', source: 'library', returnAll: false, limit: 30 });
		for (const { json } of library) {
			if (json.animated || json.pages !== 1) continue;
			const [detail] = await run({ resource: 'design', operation: 'get', templateId: { mode: 'id', value: json.id } });
			if (!detail.json.parameters.some((p) => ['video', 'audio', 'subtitles'].includes(p.type))) {
				template = detail.json;
				break;
			}
		}
		assert.ok(template, 'no one-page still template in the library');
	});

	it('Render → Render Template makes a PNG (1 credit), with the parameter mapper', async () => {
		assert.ok(template);
		const text = template.parameters.find((p) => p.type === 'text' || p.type === 'variable');
		const [out] = await run({
			resource: 'render',
			operation: 'render',
			templateId: { mode: 'list', value: template.id },
			parameters: { mappingMode: 'defineBelow', value: text ? { [text.key]: 'n8n smoke test' } : {} },
			format: 'png',
			resizeMode: 'none',
			waitForCompletion: true,
			options: { download: withAi },
		});
		assert.equal(out.json.format, 'png');
		assert.equal(out.json.credits, 1);
		assert.match(out.json.url ?? '', /^https?:\/\/.+\.png/);
		render = out;
	});

	it('Render → Get and Get Many find it in the render log', async () => {
		assert.ok(render);
		const [one] = await run({ resource: 'render', operation: 'get', renderId: render.json.renderId });
		assert.equal(one.json.status, 'succeeded');
		assert.equal(one.json.urls.length, 1);
		const log = await run({ resource: 'render', operation: 'getAll', returnAll: false, limit: 10, filters: { designId: template.id } });
		assert.ok(log.some((item) => item.json.id === render.json.renderId), 'render not in the log');
	});

	it('Workflow → Get Many, the workflow picker, and Social Analytics answer', async () => {
		const workflows = await run({ resource: 'workflow', operation: 'getAll', returnAll: true });
		const picked = await node.methods.listSearch.searchWorkflows.call(context({}));
		assert.equal(picked.results.length, workflows.length);
		const [overview] = await run({ resource: 'socialAnalytics', operation: 'getOverview' });
		assert.ok(overview.json.totals && overview.json.range, JSON.stringify(overview.json));
		const days = await run({ resource: 'socialAnalytics', operation: 'getDaily', from: '2026-11-01T00:00:00', to: '2026-11-03T00:00:00' });
		assert.ok(days.length >= 1 && days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.json.day)), JSON.stringify(days));
	});

	it('Image → Remove Background takes the render as a binary upload (1 AI credit)', { skip: withAi ? false : 'set JAMFRAME_SMOKE_AI=1 to run' }, async () => {
		assert.ok(render?.binary?.data, 'the render was not downloaded');
		const [out] = await run(
			{ resource: 'image', operation: 'removeBackground', inputType: 'binary', binaryPropertyName: 'data', options: { name: 'n8n smoke test' } },
			[{ json: {}, binary: { data: render.binary.data } }],
		);
		assert.match(out.json.url ?? '', /\.png/);
		assert.ok(out.json.creditsCharged >= 1);
	});
});
