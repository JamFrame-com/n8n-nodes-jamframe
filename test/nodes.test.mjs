// The built nodes, driven with a fake n8n context whose HTTP helper answers
// from a script. Checks the requests the nodes send and how they read the
// answers; no n8n runtime and no network.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { JamFrame } = require('../dist/nodes/JamFrame/JamFrame.node.js');
const { JamFrameTrigger } = require('../dist/nodes/JamFrameTrigger/JamFrameTrigger.node.js');
const { JamFrameApi } = require('../dist/credentials/JamFrameApi.credentials.js');

const NODE = { id: '1', name: 'JamFrame', type: 'n8n-nodes-jamframe.jamFrame', typeVersion: 1, position: [0, 0], parameters: {} };

/** A fake execute/load-options/hook context. `replies` answer the API calls in order. */
function fakeContext({ params = {}, replies = [], items = [{ json: {} }], continueOnFail = false, staticData = {} }) {
	const calls = [];
	const get = (name) => name.split('.').reduce((value, key) => (value == null ? undefined : value[key]), params);
	const context = {
		calls,
		staticData,
		getInputData: () => items,
		getNode: () => NODE,
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({ apiKey: 'jf_live_test', baseUrl: 'https://app.test/' }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
		getNodeParameter(name, a, b, c) {
			// Execute: (name, itemIndex, fallback, options); load options/hooks: (name, fallback, options).
			const [fallback, options] = typeof a === 'number' ? [b, c] : [a, b];
			let value = get(name);
			if (value === undefined) return fallback;
			if (options?.extractValue && value && typeof value === 'object' && 'mode' in value) value = value.value;
			return value;
		},
		helpers: {
			async httpRequestWithAuthentication(credentialName, request) {
				assert.equal(credentialName, 'jamFrameApi');
				calls.push(request);
				const reply = replies.shift();
				assert.ok(reply, `unexpected request ${request.method} ${request.url}`);
				return typeof reply === 'function' ? reply(request) : { headers: {}, ...reply };
			},
			returnJsonArray: (value) => (Array.isArray(value) ? value : [value]).map((json) => ({ json })),
			// Binary input: `items[i].binary[name]` holds `{ fileName, mimeType, bytes }`.
			assertBinaryData(itemIndex, name) {
				const binary = items[itemIndex]?.binary?.[name];
				if (!binary) throw new Error(`This operation expects the node's input data to contain a binary file '${name}'`);
				return binary;
			},
			getBinaryDataBuffer: async (itemIndex, name) => Buffer.from(items[itemIndex].binary[name].bytes),
			// File downloads (no credential): answered with the URL's bytes.
			async httpRequest(request) {
				calls.push(request);
				return new TextEncoder().encode(`bytes of ${request.url}`).buffer;
			},
			prepareBinaryData: async (buffer, fileName, mimeType) => ({ fileName, mimeType, data: buffer.toString('base64') }),
		},
	};
	return context;
}

/** A multipart body as `{ field: value }`, with the file as `{ name, type, text }`. */
async function formFields(form) {
	assert.ok(form instanceof FormData, 'the body is a FormData upload');
	const fields = {};
	for (const [key, value] of form.entries()) {
		fields[key] = typeof value === 'string' ? value : { name: value.name, type: value.type, text: await value.text() };
	}
	return fields;
}

const node = new JamFrame();
const run = (context) => node.execute.call(context);

test('the package registers what package.json lists', () => {
	const pkg = require('../package.json');
	assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/JamFrame/JamFrame.node.js', 'dist/nodes/JamFrameTrigger/JamFrameTrigger.node.js']);
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/JamFrameApi.credentials.js']);
	assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	const credential = new JamFrameApi();
	assert.equal(credential.name, node.description.credentials[0].name);
	assert.equal(credential.test.request.url, '/v1/auth');
	assert.equal(credential.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
});

test('Render Template sends the template, the parameters and the options', async () => {
	const context = fakeContext({
		params: {
			resource: 'render',
			operation: 'render',
			templateId: { mode: 'list', value: 'tpl_1' },
			parameters: { mappingMode: 'defineBelow', value: { title: 'Hello', subtitle: '' } },
			extraModifications: { modification: [{ key: 'title.color', value: '#ff0000' }] },
			format: 'jpeg',
			resizeMode: 'size',
			size: { mode: 'id', value: 'story' },
			runAsJob: false,
			waitForCompletion: true,
			options: { scale: 2, quality: 80, includePages: '1-2' },
		},
		replies: [
			{
				statusCode: 200,
				body: {
					data: { content: ['https://cdn/a-p1.jpg', 'https://cdn/a-p2.jpg'], type: 'url', format: 'jpeg', pages: [1, 2], credits: 2, renderId: 'r1', responseTime: 900 },
					warnings: ['Unknown modification keys: subtitle'],
				},
			},
		],
	});
	const [[out]] = await run(context);
	const [request] = context.calls;
	assert.equal(request.method, 'POST');
	assert.equal(request.url, 'https://app.test/v1/render');
	assert.deepEqual(request.body, {
		templateId: 'tpl_1',
		modifications: { title: 'Hello', 'title.color': '#ff0000' },
		response: { type: 'url', format: 'jpeg', scale: 2, quality: 80, includePages: [1, 2], size: 'story' },
	});
	assert.equal(out.json.url, 'https://cdn/a-p1.jpg');
	assert.deepEqual(out.json.urls, ['https://cdn/a-p1.jpg', 'https://cdn/a-p2.jpg']);
	assert.equal(out.json.renderId, 'r1');
	assert.deepEqual(out.json.warnings, ['Unknown modification keys: subtitle']);
	assert.deepEqual(out.pairedItem, { item: 0 });
});

test('a job render polls GET /render-jobs/{id} until it succeeds', async () => {
	const context = fakeContext({
		params: {
			resource: 'render',
			operation: 'render',
			templateId: { mode: 'id', value: 'tpl_v' },
			format: 'mp4',
			resizeMode: 'none',
			runAsJob: true,
			waitForCompletion: true,
			options: { subtitles: 'vtt', webhookUrl: 'https://hooks.example.com/done' },
		},
		replies: [
			{ statusCode: 202, body: { data: { jobId: 'job_1', status: 'queued' } } },
			{
				statusCode: 200,
				body: {
					job: {
						id: 'job_1',
						status: 'succeeded',
						progress: 1,
						result: { content: 'https://cdn/v.mp4', format: 'mp4', duration: 7.5, credits: 8, subtitles: 'https://cdn/v.vtt', renderId: 'r2' },
						error: null,
					},
				},
			},
		],
	});
	const [[out]] = await run(context);
	assert.deepEqual(context.calls[0].body, {
		templateId: 'tpl_v',
		modifications: {},
		response: { type: 'url', format: 'mp4', subtitles: 'vtt' },
		async: true,
		webhookUrl: 'https://hooks.example.com/done',
	});
	assert.equal(context.calls[1].method, 'GET');
	assert.equal(context.calls[1].url, 'https://app.test/v1/render-jobs/job_1');
	assert.equal(out.json.jobId, 'job_1');
	assert.equal(out.json.url, 'https://cdn/v.mp4');
	assert.equal(out.json.duration, 7.5);
});

test('without Wait for Completion a job render outputs the job id', async () => {
	const context = fakeContext({
		params: { resource: 'render', operation: 'render', templateId: { mode: 'id', value: 't' }, format: 'png', runAsJob: true, waitForCompletion: false },
		replies: [{ statusCode: 202, body: { data: { jobId: 'job_2', status: 'queued' } } }],
	});
	const [[out]] = await run(context);
	assert.deepEqual(out.json, { jobId: 'job_2', status: 'queued', url: null, urls: [] });
});

test('several sizes go in response.sizes, and are refused for jobs', async () => {
	const ok = fakeContext({
		params: { resource: 'render', operation: 'render', templateId: { mode: 'id', value: 't' }, format: 'png', resizeMode: 'sizes', sizes: ['original', 'story'] },
		replies: [
			{
				statusCode: 200,
				body: { data: { content: [{ size: 'original', url: 'https://cdn/o.png' }, { size: 'story', url: 'https://cdn/s.png' }], format: 'png' } },
			},
		],
	});
	const [[out]] = await run(ok);
	assert.deepEqual(ok.calls[0].body.response.sizes, ['original', 'story']);
	assert.deepEqual(out.json.urls, ['https://cdn/o.png', 'https://cdn/s.png']);

	const refused = fakeContext({
		params: { resource: 'render', operation: 'render', templateId: { mode: 'id', value: 't' }, format: 'mp4', resizeMode: 'sizes', sizes: ['story'] },
	});
	await assert.rejects(run(refused), /can’t be rendered as a job or as an MP4/);
	assert.equal(refused.calls.length, 0);
});

test('API errors become NodeApiError with the envelope message; continueOnFail turns them into items', async () => {
	const envelope = { error: 'QUOTA_EXCEEDED', message: 'Quota exceeded: requested 3, remaining 1 of 100', detail: { remaining: 1 } };
	const failing = fakeContext({
		params: { resource: 'design', operation: 'get', templateId: { mode: 'id', value: 'nope' } },
		replies: [{ statusCode: 402, body: envelope }],
	});
	await assert.rejects(run(failing), (error) => {
		assert.equal(error.constructor.name, 'NodeApiError');
		assert.equal(error.message, envelope.message);
		assert.equal(error.httpCode, '402');
		assert.match(error.description, /QUOTA_EXCEEDED/);
		return true;
	});
	const tolerant = fakeContext({
		continueOnFail: true,
		params: { resource: 'design', operation: 'get', templateId: { mode: 'id', value: 'nope' } },
		replies: [{ statusCode: 404, body: { error: 'NOT_FOUND', message: 'Design nope not found' } }],
	});
	const [[out]] = await run(tolerant);
	assert.equal(out.json.error, 'Design nope not found');
});

test('a 429 is retried after Retry-After', async () => {
	const context = fakeContext({
		params: { resource: 'socialAccount', operation: 'getAll' },
		replies: [
			{ statusCode: 429, headers: { 'retry-after': '0' }, body: { error: 'RATE_LIMITED', message: 'Slow down', detail: { retryAfter: 0 } } },
			{ statusCode: 200, body: { accounts: [{ id: 'a1', platform: 'x' }, { id: 'a2', platform: 'linkedin' }] } },
		],
	});
	const [out] = await run(context);
	assert.equal(context.calls.length, 2);
	assert.deepEqual(out.map((item) => item.json.id), ['a1', 'a2']);
});

test('Get Many templates follows the cursor up to the limit', async () => {
	const context = fakeContext({
		params: { resource: 'design', operation: 'getAll', source: 'library', returnAll: false, limit: 3 },
		replies: [
			{ statusCode: 200, body: { designs: [{ id: 'd1' }, { id: 'd2' }], pagination: { nextCursor: 'd2', hasMore: true } } },
			{ statusCode: 200, body: { designs: [{ id: 'd3' }], pagination: { nextCursor: 'd3', hasMore: true } } },
		],
	});
	const [out] = await run(context);
	assert.deepEqual(out.map((item) => item.json.id), ['d1', 'd2', 'd3']);
	assert.deepEqual(context.calls[0].qs, { source: 'library', limit: 3 });
	assert.deepEqual(context.calls[1].qs, { source: 'library', limit: 1, cursor: 'd2' });
});

test('Create Social Post: template media, captions, options, schedule', async () => {
	const context = fakeContext({
		params: {
			resource: 'socialPost',
			operation: 'create',
			accounts: ['acc_1', 'acc_2'],
			caption: 'Spring sale',
			mediaSource: 'template',
			templateId: { mode: 'list', value: 'tpl_1' },
			parameters: { mappingMode: 'defineBelow', value: { title: 'Sale' } },
			postFormat: 'jpeg',
			additionalFields: {
				captions: { caption: [{ platform: 'x', text: 'Sale today' }] },
				platformOptions: '{"tiktok": {"privacyLevel": "SELF_ONLY"}}',
				includePages: '1-3',
				scheduledAt: '2026-11-10T09:00:00',
				timezone: 'Europe/Paris',
			},
		},
		replies: [{ statusCode: 201, body: { post: { id: 'post_1', status: 'scheduled', targets: [] }, checks: [] } }],
	});
	const [[out]] = await run(context);
	assert.deepEqual(context.calls[0].body, {
		accounts: ['acc_1', 'acc_2'],
		caption: 'Spring sale',
		templateId: 'tpl_1',
		modifications: { title: 'Sale' },
		response: { format: 'jpeg', includePages: [1, 2, 3] },
		captions: { x: 'Sale today' },
		options: { tiktok: { privacyLevel: 'SELF_ONLY' } },
		scheduledAt: '2026-11-10T09:00:00',
		timezone: 'Europe/Paris',
	});
	assert.equal(out.json.id, 'post_1');
	assert.deepEqual(out.json.checks, []);
});

test('Retry a social post sends the one target', async () => {
	const context = fakeContext({
		params: { resource: 'socialPost', operation: 'retry', postId: 'post_1', targetId: 'tgt_9' },
		replies: [{ statusCode: 200, body: { post: { id: 'post_1', status: 'queued' } } }],
	});
	await run(context);
	assert.equal(context.calls[0].url, 'https://app.test/v1/social/posts/post_1/retry');
	assert.deepEqual(context.calls[0].body, { targetId: 'tgt_9' });
});

test('the template picker lists the workspace, then the library, filtered by name', async () => {
	const context = fakeContext({
		replies: [
			{ statusCode: 200, body: { designs: [{ id: 'w1', name: 'Coffee tips', orientation: 'square' }, { id: 'w2', name: 'Menu' }], pagination: { nextCursor: null, hasMore: false } } },
			{ statusCode: 200, body: { designs: [{ id: 'l1', name: 'Coffee promo reel', orientation: 'portrait', pages: 2, animated: true }], pagination: { nextCursor: null, hasMore: false } } },
		],
	});
	const result = await node.methods.listSearch.searchTemplates.call(context, ' coffee ');
	assert.deepEqual(result.results.map((r) => [r.name, r.value, r.description]), [
		['Coffee tips', 'w1', 'square · w1'],
		['Library: Coffee promo reel', 'l1', 'portrait · video · l1'],
	]);
	assert.equal(result.paginationToken, undefined);
	// The API filters by name (`q`); with no filter, no `q`.
	assert.deepEqual(context.calls[0].qs, { source: 'workspace', limit: 100, q: 'coffee' });
	assert.deepEqual(context.calls[1].qs, { source: 'library', limit: 100, q: 'coffee' });
	const empty = { statusCode: 200, body: { designs: [], pagination: { nextCursor: null, hasMore: false } } };
	const all = fakeContext({ replies: [empty, empty] });
	await node.methods.listSearch.searchTemplates.call(all);
	assert.deepEqual(all.calls[0].qs, { source: 'workspace', limit: 100 });
});

test('the parameter mapper and size list come from GET /designs/{id}', async () => {
	const design = {
		design: {
			id: 'tpl_1',
			name: 'Coffee',
			pages: 3,
			parameters: [
				{ key: 'title', type: 'text', pages: [1, 2, 3], example: 'Five ways' },
				{ key: 'photo', type: 'image', pages: [1], example: 'https://x/p.jpg' },
			],
			sizes: [{ id: 'story', name: 'Story', width: 1080, height: 1920 }],
		},
	};
	const context = fakeContext({ params: { templateId: { mode: 'list', value: 'tpl_1' } }, replies: [{ statusCode: 200, body: design }, { statusCode: 200, body: design }] });
	const mapped = await node.methods.resourceMapping.getTemplateParameters.call(context);
	assert.deepEqual(mapped.fields.map((f) => [f.id, f.displayName, f.required, f.type]), [
		['title', 'title (text, pages 1, 2, 3)', false, 'string'],
		['photo', 'photo (image URL, page 1)', false, 'string'],
	]);
	const sizes = await node.methods.listSearch.searchSizes.call(context);
	assert.equal(sizes.results[0].value, 'story');
	const empty = await node.methods.resourceMapping.getTemplateParameters.call(fakeContext({}));
	assert.deepEqual(empty.fields, []);
});

test('the trigger subscribes, keeps the secret, and only lets signed deliveries through', async () => {
	const trigger = new JamFrameTrigger();
	const staticData = {};
	const hook = fakeContext({
		staticData,
		params: { events: ['render.completed', 'social.post.published'] },
		replies: [{ statusCode: 201, body: { subscription: { id: 'sub_1' }, signingSecret: 'wh_sec_abc' } }],
	});
	assert.equal(await trigger.webhookMethods.default.create.call(hook), true);
	assert.deepEqual(hook.calls[0].body, { url: 'https://n8n.example.com/webhook/abc/webhook', events: ['render.completed', 'social.post.published'] });
	assert.deepEqual(staticData, { subscriptionId: 'sub_1', signingSecret: 'wh_sec_abc' });

	const exists = fakeContext({
		staticData,
		params: { events: ['social.post.published', 'render.completed'] },
		replies: [{ statusCode: 200, body: { subscription: { id: 'sub_1', url: 'https://n8n.example.com/webhook/abc/webhook', events: ['render.completed', 'social.post.published'] } } }],
	});
	assert.equal(await trigger.webhookMethods.default.checkExists.call(exists), true);

	const body = JSON.stringify({ id: 'whe_1', type: 'render.completed', createdAt: '2026-11-10T00:00:00.000Z', data: { id: 'job_1' } });
	const deliver = (signature) => {
		const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
		const context = fakeContext({ staticData, params: {} });
		Object.assign(context, {
			getRequestObject: () => ({ rawBody: Buffer.from(body) }),
			getHeaderData: () => ({ 'x-webhook-signature': signature, 'x-webhook-delivery': 'dlv_1' }),
			getBodyData: () => JSON.parse(body),
			getResponseObject: () => response,
		});
		return { response, result: trigger.webhook.call(context) };
	};
	const t = Math.floor(Date.now() / 1000);
	const good = `t=${t},v1=${createHmac('sha256', 'wh_sec_abc').update(`${t}.${body}`).digest('hex')}`;
	const accepted = deliver(good);
	const data = await accepted.result;
	assert.equal(data.workflowData[0][0].json.type, 'render.completed');
	assert.equal(data.workflowData[0][0].json.deliveryId, 'dlv_1');

	// Flip the first hex digit (always a change: replacing it with '0' wasn't when it was already '0').
	const refused = deliver(good.replace(/v1=(.)/, (_, c) => `v1=${c === '0' ? '1' : '0'}`));
	assert.deepEqual(await refused.result, { noWebhookResponse: true });
	assert.equal(refused.response.statusCode, 401);

	const gone = fakeContext({ staticData, replies: [{ statusCode: 404, body: { error: 'NOT_FOUND', message: 'Subscription not found' } }] });
	assert.equal(await trigger.webhookMethods.default.delete.call(gone), true);
	assert.deepEqual(staticData, {});
});

test('Render → Get reads the render log and can download its files', async () => {
	const context = fakeContext({
		params: { resource: 'render', operation: 'get', renderId: ' r1 ', download: true },
		replies: [
			{
				statusCode: 200,
				body: { render: { id: 'r1', status: 'succeeded', format: 'jpeg', outputs: [{ url: 'https://cdn/r1-p1.jpg', page: 1 }, { url: 'https://cdn/r1-p2.jpg', page: 2 }] } },
			},
		],
	});
	const [[out]] = await run(context);
	assert.equal(context.calls[0].url, 'https://app.test/v1/renders/r1');
	assert.equal(out.json.url, 'https://cdn/r1-p1.jpg');
	assert.deepEqual(out.json.urls, ['https://cdn/r1-p1.jpg', 'https://cdn/r1-p2.jpg']);
	assert.deepEqual(Object.keys(out.binary), ['data', 'data_1']);
	assert.equal(out.binary.data_1.fileName, 'r1-p2.jpg');
	assert.equal(out.binary.data_1.mimeType, 'image/jpeg');
});

test('Render → Get Many sends the filters and pages to the limit', async () => {
	const context = fakeContext({
		params: { resource: 'render', operation: 'getAll', returnAll: false, limit: 2, filters: { status: 'failed', designId: ' tpl_1 ' } },
		replies: [
			{
				statusCode: 200,
				body: { renders: [{ id: 'r1', outputs: [] }, { id: 'r2', outputs: [] }], pagination: { nextCursor: 'r2', hasMore: true }, totals: {} },
			},
		],
	});
	const [out] = await run(context);
	assert.deepEqual(context.calls[0].qs, { status: 'failed', designId: 'tpl_1', limit: 2 });
	assert.deepEqual(out.map((item) => [item.json.id, item.json.url]), [['r1', null], ['r2', null]]);
});

test('Template → Generate with AI sends the prompt, size and custom brand', async () => {
	const design = { id: 'tpl_new', name: 'Summer sale', pages: 1, parameters: [], sizes: [], editorUrl: 'https://app/designs/tpl_new/edit' };
	const context = fakeContext({
		params: {
			resource: 'design',
			operation: 'generate',
			prompt: ' Announce our summer sale ',
			designSize: 'instagram-portrait',
			brand: 'custom',
			brandColors: { colour: [{ value: '#0b1f4d' }, { value: '#ff6b5b' }] },
			brandFonts: 'Poppins, Inter',
			brandLogo: '',
			waitForCompletion: true,
			options: { pages: 3, name: 'Sale', video: true },
		},
		replies: [{ statusCode: 201, body: { data: { jobId: 'job_g', status: 'succeeded', creditsCharged: 5, design } } }],
	});
	const [[out]] = await run(context);
	assert.equal(context.calls[0].url, 'https://app.test/v1/designs/generate');
	assert.deepEqual(context.calls[0].body, {
		prompt: 'Announce our summer sale',
		size: 'instagram-portrait',
		brand: { colors: ['#0b1f4d', '#ff6b5b'], fonts: ['Poppins', 'Inter'] },
		name: 'Sale',
		pages: 3,
		video: true,
	});
	assert.equal(out.json.templateId, 'tpl_new');
	assert.equal(out.json.design.editorUrl, 'https://app/designs/tpl_new/edit');

	const noBrand = fakeContext({
		params: { resource: 'design', operation: 'generate', prompt: 'x', brand: 'custom', brandColors: {}, brandFonts: '' },
	});
	await assert.rejects(run(noBrand), /at least one brand colour, font or logo/);
	assert.equal(noBrand.calls.length, 0);
});

test('Template → Generate with AI polls the job when the API answers 202, and fails with its error', async () => {
	const waiting = fakeContext({
		params: { resource: 'design', operation: 'generate', prompt: 'A teaser', brand: 'none', waitForCompletion: true },
		replies: [
			{ statusCode: 202, body: { data: { jobId: 'job_g', status: 'running' } } },
			{ statusCode: 200, body: { data: { jobId: 'job_g', status: 'succeeded', design: { id: 'tpl_9' } } } },
		],
	});
	const [[out]] = await run(waiting);
	assert.deepEqual(waiting.calls[0].body, { prompt: 'A teaser', brand: false });
	assert.equal(waiting.calls[1].url, 'https://app.test/v1/designs/generate/job_g');
	assert.equal(out.json.templateId, 'tpl_9');

	const failing = fakeContext({
		params: { resource: 'design', operation: 'generate', prompt: 'A teaser', waitForCompletion: true },
		replies: [
			{ statusCode: 202, body: { data: { jobId: 'job_f', status: 'running' } } },
			{ statusCode: 200, body: { data: { jobId: 'job_f', status: 'failed', error: { error: 'AI_CREDITS_EXCEEDED', message: 'Your AI credits for this period are used up' } } } },
		],
	});
	await assert.rejects(run(failing), (error) => {
		assert.equal(error.message, 'Your AI credits for this period are used up');
		assert.match(error.description, /AI_CREDITS_EXCEEDED.*refunded/);
		return true;
	});

	const queued = fakeContext({
		params: { resource: 'design', operation: 'generate', prompt: 'A teaser', waitForCompletion: false },
		replies: [{ statusCode: 202, body: { data: { jobId: 'job_q', status: 'running' } } }],
	});
	const [[job]] = await run(queued);
	assert.equal(queued.calls[0].body.async, true);
	assert.deepEqual(job.json, { jobId: 'job_q', status: 'running', templateId: null });
});

test('Image → Remove Background sends a URL as JSON, or the binary file as a multipart upload', async () => {
	const cutout = { url: 'https://cdn/ws/images/as_1.png', width: 800, height: 600, method: 'local', model: 'u2net', scaled: false, creditsCharged: 1, asset: { id: 'as_1' } };
	const byUrl = fakeContext({
		params: { resource: 'image', operation: 'removeBackground', inputType: 'url', fileUrl: 'https://example.com/p.jpg', options: { name: 'Product', download: true } },
		replies: [{ statusCode: 200, body: cutout }],
	});
	const [[out]] = await run(byUrl);
	assert.equal(byUrl.calls[0].url, 'https://app.test/v1/images/remove-background');
	assert.deepEqual(byUrl.calls[0].body, { url: 'https://example.com/p.jpg', name: 'Product' });
	assert.equal(out.json.url, cutout.url);
	assert.equal(out.binary.data.fileName, 'as_1.png');
	assert.equal(out.binary.data.mimeType, 'image/png');

	const byFile = fakeContext({
		params: { resource: 'image', operation: 'removeBackground', inputType: 'binary', binaryPropertyName: 'photo' },
		items: [{ json: {}, binary: { photo: { fileName: 'shoe.jpg', mimeType: 'image/jpeg', bytes: 'JPEGBYTES' } } }],
		replies: [{ statusCode: 200, body: cutout }],
	});
	await run(byFile);
	assert.deepEqual(await formFields(byFile.calls[0].body), { file: { name: 'shoe.jpg', type: 'image/jpeg', text: 'JPEGBYTES' } });

	const missing = fakeContext({ params: { resource: 'image', operation: 'removeBackground', inputType: 'binary', binaryPropertyName: 'data' } });
	await assert.rejects(run(missing), /binary file 'data'/);
	assert.equal(missing.calls.length, 0);
});

test('Audio → Transcribe sends the options with the URL, or as form fields with the file', async () => {
	const transcript = { language: 'en', duration: 6.4, text: 'Hello.', cues: [{ start: 0.4, end: 1.2, text: 'Hello.' }], srt: '1\n…', vtt: 'WEBVTT\n…', creditsCharged: 1 };
	const options = { language: 'en', style: 'short', start: 5, duration: 30, offset: 2.5, words: true, maxLines: 1 };
	const byUrl = fakeContext({
		params: { resource: 'audio', operation: 'transcribe', inputType: 'url', fileUrl: 'https://example.com/v.mp3', options },
		replies: [{ statusCode: 200, body: transcript }],
	});
	const [[out]] = await run(byUrl);
	assert.equal(byUrl.calls[0].url, 'https://app.test/v1/ai/transcribe');
	assert.deepEqual(byUrl.calls[0].body, { url: 'https://example.com/v.mp3', language: 'en', style: 'short', maxLines: 1, start: 5, duration: 30, offset: 2.5, words: true });
	assert.equal(byUrl.calls[0].timeout, 600_000);
	assert.deepEqual(out.json.cues, transcript.cues);

	const byFile = fakeContext({
		params: { resource: 'audio', operation: 'transcribe', inputType: 'binary', binaryPropertyName: 'data', options: { language: 'fr', start: 0 } },
		items: [{ json: {}, binary: { data: { fileName: 'voice.m4a', mimeType: 'audio/mp4', bytes: 'AUDIO' } } }],
		replies: [{ statusCode: 200, body: transcript }],
	});
	await run(byFile);
	assert.deepEqual(await formFields(byFile.calls[0].body), {
		file: { name: 'voice.m4a', type: 'audio/mp4', text: 'AUDIO' },
		language: 'fr',
		start: '0',
	});
});

test('Workflow → Run sends the rows, waits for the run and outputs each row', async () => {
	const context = fakeContext({
		params: {
			resource: 'workflow',
			operation: 'run',
			workflowId: { mode: 'list', value: 'wf_1' },
			waitForCompletion: true,
			options: { maxRows: 2, payload: '[{"title": "A"}, {"title": "B"}]' },
		},
		replies: [
			{ statusCode: 202, body: { run: { id: 'run_1', workflowId: 'wf_1', status: 'queued' } } },
			{
				statusCode: 200,
				body: { run: { id: 'run_1', status: 'partial', rowsSucceeded: 1, rowsFailed: 1, rows: [{ index: 0, status: 'succeeded', urls: ['https://cdn/a.png'] }, { index: 1, status: 'failed', urls: [] }] } },
			},
		],
	});
	const [[out]] = await run(context);
	assert.equal(context.calls[0].url, 'https://app.test/v1/workflows/wf_1/run');
	assert.deepEqual(context.calls[0].body, { maxRows: 2, payload: [{ title: 'A' }, { title: 'B' }] });
	assert.equal(context.calls[1].url, 'https://app.test/v1/workflows/wf_1/runs/run_1');
	assert.equal(out.json.status, 'partial');
	assert.equal(out.json.rows.length, 2);

	const failed = fakeContext({
		params: { resource: 'workflow', operation: 'run', workflowId: { mode: 'id', value: 'wf_1' }, waitForCompletion: true, options: { payload: '[]' } },
		replies: [
			{ statusCode: 202, body: { run: { id: 'run_2', status: 'queued' } } },
			{ statusCode: 200, body: { run: { id: 'run_2', status: 'failed', error: { code: 'SOURCE_UNREADABLE', message: 'The sheet could not be read' }, rows: [] } } },
		],
	});
	await assert.rejects(run(failed), (error) => {
		assert.equal(error.message, 'The sheet could not be read');
		assert.match(error.description, /SOURCE_UNREADABLE/);
		return true;
	});
	// An empty rows array isn't sent.
	assert.deepEqual(failed.calls[0].body, {});

	const badRows = fakeContext({ params: { resource: 'workflow', operation: 'run', workflowId: { mode: 'id', value: 'wf_1' }, options: { payload: '42' } } });
	await assert.rejects(run(badRows), /array of objects, or one object/);

	const queued = fakeContext({
		params: { resource: 'workflow', operation: 'run', workflowId: { mode: 'id', value: 'wf_1' }, waitForCompletion: false },
		replies: [{ statusCode: 202, body: { run: { id: 'run_3', status: 'queued' } } }],
	});
	const [[started]] = await run(queued);
	assert.equal(queued.calls.length, 1);
	assert.equal(started.json.id, 'run_3');
});

test('Workflow → Get Many and the workflow picker; Workflow Run → Cancel and Get Many', async () => {
	const workflows = [
		{ id: 'wf_1', name: 'Quote cards', status: 'active', trigger: { kind: 'schedule', summary: 'Every day at 09:00 (UTC)' } },
		{ id: 'wf_2', name: 'Product posts', status: 'draft', trigger: { kind: 'manual', summary: 'Run now' } },
	];
	const many = fakeContext({ params: { resource: 'workflow', operation: 'getAll', returnAll: false, limit: 1 }, replies: [{ statusCode: 200, body: { workflows } }] });
	const [out] = await run(many);
	assert.deepEqual(out.map((item) => item.json.id), ['wf_1']);

	const picker = fakeContext({ replies: [{ statusCode: 200, body: { workflows } }] });
	const found = await node.methods.listSearch.searchWorkflows.call(picker, 'product');
	assert.deepEqual(found.results, [{ name: 'Product posts', value: 'wf_2', description: 'draft · Run now · wf_2' }]);

	const cancel = fakeContext({
		params: { resource: 'workflowRun', operation: 'cancel', workflowId: { mode: 'id', value: 'wf_1' }, runId: 'run_1' },
		replies: [{ statusCode: 200, body: { run: { id: 'run_1', status: 'canceled' } } }],
	});
	const [[canceled]] = await run(cancel);
	assert.equal(cancel.calls[0].method, 'POST');
	assert.equal(cancel.calls[0].url, 'https://app.test/v1/workflows/wf_1/runs/run_1/cancel');
	assert.equal(canceled.json.status, 'canceled');

	const runs = fakeContext({
		params: { resource: 'workflowRun', operation: 'getAll', workflowId: { mode: 'id', value: 'wf_1' }, returnAll: true },
		replies: [
			{ statusCode: 200, body: { runs: [{ id: 'run_2' }], pagination: { nextCursor: 'run_2', hasMore: true } } },
			{ statusCode: 200, body: { runs: [{ id: 'run_1' }], pagination: { nextCursor: null, hasMore: false } } },
		],
	});
	const [listed] = await run(runs);
	assert.deepEqual(listed.map((item) => item.json.id), ['run_2', 'run_1']);
	assert.deepEqual(runs.calls[1].qs, { limit: 100, cursor: 'run_2' });
});

test('Social Analytics: dates as YYYY-MM-DD, filters comma-joined, the daily report one item per day', async () => {
	const context = fakeContext({
		params: {
			resource: 'socialAnalytics',
			operation: 'getDaily',
			from: '2026-11-01T00:00:00',
			to: '2026-11-02T00:00:00',
			filters: { platforms: ['instagram', 'x'], accountIds: ['acc_1', 'acc_2'] },
		},
		replies: [
			{
				statusCode: 200,
				body: {
					range: { from: '2026-11-01', to: '2026-11-02', days: 2, timezone: 'Europe/Paris' },
					days: [{ day: '2026-11-01', impressions: 10 }, { day: '2026-11-02', impressions: 20 }],
				},
			},
		],
	});
	const [out] = await run(context);
	assert.equal(context.calls[0].url, 'https://app.test/v1/social/analytics/daily');
	assert.deepEqual(context.calls[0].qs, { from: '2026-11-01', to: '2026-11-02', platform: 'instagram,x', accountId: 'acc_1,acc_2' });
	assert.deepEqual(out.map((item) => item.json), [
		{ day: '2026-11-01', impressions: 10, timezone: 'Europe/Paris' },
		{ day: '2026-11-02', impressions: 20, timezone: 'Europe/Paris' },
	]);

	const overview = fakeContext({
		params: { resource: 'socialAnalytics', operation: 'getOverview' },
		replies: [{ statusCode: 200, body: { totals: { impressions: 5 }, engagementRate: 1.2 } }],
	});
	const [[summary]] = await run(overview);
	assert.deepEqual(overview.calls[0].qs, {});
	assert.equal(summary.json.engagementRate, 1.2);
});

test('every resource and operation in the UI is handled', async () => {
	const resource = node.description.properties.find((p) => p.name === 'resource');
	for (const { value: res } of resource.options) {
		const operations = node.description.properties.find((p) => p.name === 'operation' && p.displayOptions.show.resource.includes(res));
		assert.ok(operations, `${res} has operations`);
		for (const { value: op } of operations.options) {
			// No API replies are scripted: a handled operation fails on its first request or a missing
			// parameter, never with "Unsupported operation".
			const context = fakeContext({ params: { resource: res, operation: op } });
			await assert.rejects(run(context), (error) => {
				assert.doesNotMatch(error.message, /Unsupported operation/, `${res}.${op}`);
				return true;
			});
		}
	}
});
