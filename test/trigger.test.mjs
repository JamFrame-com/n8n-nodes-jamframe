// The trigger's signature gate and subscription upkeep, driven from the built
// node with a minimal fake n8n context. No n8n runtime and no network.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { JamFrameTrigger } = require('../dist/nodes/JamFrameTrigger/JamFrameTrigger.node.js');
const h = require('../dist/shared/helpers.js');

const SECRET = 'wh_sec_trigger_test';
const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';
const body = JSON.stringify({ id: 'whe_1', type: 'render.completed', createdAt: '2026-11-10T00:00:00.000Z', data: { id: 'job_1' } });
const sign = (payload, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
	`t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

/** A delivery to the trigger's webhook(). `noRawBody` leaves `rawBody` off the request. */
async function deliver({ signature, noRawBody = false, staticData = { subscriptionId: 'sub_1', signingSecret: SECRET }, options = {} }) {
	const response = {
		statusCode: 200,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(payload) {
			this.payload = payload;
			return this;
		},
	};
	const headers = { 'x-webhook-delivery': 'dlv_1' };
	if (signature !== undefined) headers['x-webhook-signature'] = signature;
	const context = {
		getNode: () => ({ name: 'JamFrame Trigger' }),
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name, fallback) => (name === 'options' ? options : fallback),
		getRequestObject: () => (noRawBody ? {} : { rawBody: Buffer.from(body) }),
		getHeaderData: () => headers,
		getBodyData: () => JSON.parse(body),
		getResponseObject: () => response,
		helpers: { returnJsonArray: (value) => (Array.isArray(value) ? value : [value]).map((json) => ({ json })) },
	};
	const result = await new JamFrameTrigger().webhook.call(context);
	return { result, response };
}

test('a correctly signed delivery runs the workflow', async () => {
	const { result } = await deliver({ signature: sign(body) });
	assert.equal(result.workflowData[0][0].json.type, 'render.completed');
	assert.equal(result.workflowData[0][0].json.deliveryId, 'dlv_1');
});

test('unsigned, mis-signed and secret-less deliveries get a 401 and no workflow run', async () => {
	for (const [signature, staticData, reason] of [
		[undefined, undefined, 'missing'],
		['', undefined, 'missing'],
		[sign(body, undefined, 'wh_sec_other'), undefined, 'mismatch'],
		[sign(body, Math.floor(Date.now() / 1000) - 3600), undefined, 'expired'],
		['t=,v1=' + 'a'.repeat(64), undefined, 'malformed'],
		[sign(body), {}, 'missing'],
	]) {
		const { result, response } = await deliver({ signature, ...(staticData ? { staticData } : {}) });
		assert.deepEqual(result, { noWebhookResponse: true }, String(signature));
		assert.equal(response.statusCode, 401);
		assert.equal(response.payload.reason, reason, String(signature));
	}
});

test('without the raw body the delivery is refused, not checked against re-serialised JSON', async () => {
	// This signature matches JSON.stringify(getBodyData()) byte for byte: the
	// old fallback accepted it. Only the bytes as received may be verified.
	assert.equal(JSON.stringify(JSON.parse(body)), body);
	const { result, response } = await deliver({ signature: sign(body), noRawBody: true });
	assert.deepEqual(result, { noWebhookResponse: true });
	assert.equal(response.statusCode, 401);
	assert.equal(response.payload.reason, 'unreadable');
});

test('turning Verify Signature off lets deliveries through unchecked', async () => {
	const { result } = await deliver({ signature: undefined, options: { verifySignature: false } });
	assert.equal(result.workflowData[0][0].json.id, 'whe_1');
});

test('checkExists replaces a subscription the API suspended', async () => {
	const staticData = { subscriptionId: 'sub_1', signingSecret: SECRET };
	const calls = [];
	const replies = [
		{ statusCode: 200, body: { subscription: { id: 'sub_1', url: WEBHOOK_URL, events: ['render.completed'], status: 'suspended' } } },
		{ statusCode: 204, body: '' },
	];
	const context = {
		getNode: () => ({ name: 'JamFrame Trigger' }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => WEBHOOK_URL,
		getNodeParameter: (name) => (name === 'events' ? ['render.completed'] : undefined),
		getCredentials: async () => ({ apiKey: 'jf_live_test', baseUrl: 'https://app.test' }),
		helpers: {
			async httpRequestWithAuthentication(_name, request) {
				calls.push(request);
				return { headers: {}, ...replies.shift() };
			},
		},
	};
	const trigger = new JamFrameTrigger();
	assert.equal(await trigger.webhookMethods.default.checkExists.call(context), false);
	assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
		'GET https://app.test/v1/webhooks/subscriptions/sub_1',
		'DELETE https://app.test/v1/webhooks/subscriptions/sub_1',
	]);
	assert.deepEqual(staticData, {});

	// An active one with the same URL and events is kept.
	const kept = { subscriptionId: 'sub_2', signingSecret: SECRET };
	replies.push({ statusCode: 200, body: { subscription: { id: 'sub_2', url: WEBHOOK_URL, events: ['render.completed'], status: 'active' } } });
	context.getWorkflowStaticData = () => kept;
	assert.equal(await trigger.webhookMethods.default.checkExists.call(context), true);
	assert.deepEqual(kept, { subscriptionId: 'sub_2', signingSecret: SECRET });
});

test('verifyWebhookSignature fails closed on odd inputs', () => {
	const now = 1_762_700_000;
	const good = sign(body, now);
	const check = (args) => h.verifyWebhookSignature({ payload: body, header: good, secret: SECRET, nowSeconds: now, ...args });
	assert.equal(check({}).ok, true);
	// A NaN tolerance used to skip the freshness check.
	assert.deepEqual(check({ nowSeconds: now + 3600, toleranceSeconds: NaN }), { ok: false, reason: 'expired' });
	assert.deepEqual(check({ nowSeconds: NaN }), { ok: false, reason: 'expired' });
	// An empty secret would make the HMAC key public.
	assert.deepEqual(check({ secret: '', header: sign(body, now, '') }), { ok: false, reason: 'missing' });
	assert.deepEqual(check({ secret: undefined }), { ok: false, reason: 'missing' });
	assert.deepEqual(check({ payload: undefined }), { ok: false, reason: 'unreadable' });
	assert.deepEqual(check({ payload: JSON.parse(body) }), { ok: false, reason: 'unreadable' });
	// Number() would read these as timestamps.
	for (const t of ['', '0x10', '1e9', ' ', '-5', '9'.repeat(400)]) {
		assert.deepEqual(check({ header: `t=${t},v1=${'a'.repeat(64)}` }), { ok: false, reason: 'malformed' }, t);
	}
});
