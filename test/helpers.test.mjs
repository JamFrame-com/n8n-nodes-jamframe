// Unit tests for the pure helpers, run from the built output (`npm test` builds first).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const h = require('../dist/shared/helpers.js');

/** Sign like the API's webhook worker: `t=<ts>,v1=<hex HMAC-SHA256 of "<ts>.<raw body>">`. */
function sign(body, secret, ts) {
	return `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
}

test('verifyWebhookSignature accepts a delivery signed like the API signs it', () => {
	const body = JSON.stringify({ id: 'whe_1', type: 'render.completed', createdAt: '2026-11-10T00:00:00Z', data: { id: 'job' } });
	const now = 1_700_000_000;
	const header = sign(body, 'wh_sec_test', now);
	assert.deepEqual(h.verifyWebhookSignature({ payload: body, header, secret: 'wh_sec_test', nowSeconds: now }), { ok: true });
	assert.deepEqual(
		h.verifyWebhookSignature({ payload: Buffer.from(body), header, secret: 'wh_sec_test', nowSeconds: now + 299 }),
		{ ok: true },
	);
});

test('verifyWebhookSignature refuses tampering, other secrets, stale and malformed headers', () => {
	const body = '{"id":"whe_1"}';
	const now = 1_700_000_000;
	const header = sign(body, 'secret-a', now);
	const check = (args) => h.verifyWebhookSignature({ payload: body, header, secret: 'secret-a', nowSeconds: now, ...args });
	assert.equal(check({ payload: '{"id":"whe_2"}' }).reason, 'mismatch');
	assert.equal(check({ payload: '{ "id": "whe_1" }' }).reason, 'mismatch', 're-serialised JSON must not verify');
	assert.equal(check({ secret: 'secret-b' }).reason, 'mismatch');
	assert.equal(check({ nowSeconds: now + 301 }).reason, 'expired');
	assert.equal(check({ nowSeconds: now - 301 }).reason, 'expired');
	assert.equal(check({ header: undefined }).reason, 'missing');
	assert.equal(check({ header: 'garbage' }).reason, 'malformed');
	assert.equal(check({ header: `t=${now},v1=zz` }).reason, 'malformed');
	assert.equal(check({ header: `t=${now},v1=abcd` }).reason, 'mismatch', 'a short signature never matches');
});

test('verifyWebhookSignature accepts any of several v1 signatures', () => {
	const body = '{}';
	const now = 1_700_000_000;
	const good = sign(body, 's', now).split(',v1=')[1];
	const header = `t=${now},v1=${'0'.repeat(64)},v1=${good}`;
	assert.equal(h.verifyWebhookSignature({ payload: body, header, secret: 's', nowSeconds: now }).ok, true);
	assert.deepEqual(h.parseSignatureHeader(['t=5,v1=AB']), { timestamp: 5, signatures: ['ab'] });
});

test('buildModifications: mapper values (blank keeps the template), then rows that win', () => {
	const mods = h.buildModifications(
		{ mappingMode: 'defineBelow', value: { title: 'Hello', subtitle: '', photo: null, count: 3, on: false } },
		{},
		[
			{ key: ' page2@title ', value: 'Second' },
			{ key: 'title', value: 'Overridden' },
			{ key: '', value: 'ignored' },
			{ key: 'title.color', value: undefined },
		],
	);
	assert.deepEqual(mods, { title: 'Overridden', count: 3, on: false, 'page2@title': 'Second', 'title.color': '' });
});

test('buildModifications: automatic mapping reads the input item by parameter key', () => {
	const mods = h.buildModifications(
		{ mappingMode: 'autoMapInputData', value: null, schema: [{ id: 'title' }, { id: 'photo' }, { id: 'gone', removed: true }] },
		{ title: 'From input', photo: '', gone: 'x', unrelated: 'y', cues: 1 },
		undefined,
	);
	assert.deepEqual(mods, { title: 'From input' });
	assert.deepEqual(h.buildModifications(null, {}, [{ key: 'subtitles', value: [{ start: 0, end: 1, text: 'Hi' }] }]), {
		subtitles: [{ start: 0, end: 1, text: 'Hi' }],
	});
});

test('toFileList and shapeRenderResult flatten every content shape', () => {
	assert.deepEqual(h.toFileList('https://x/a.png'), ['https://x/a.png']);
	assert.deepEqual(h.toFileList(['https://x/1.jpg', 'https://x/2.jpg']), ['https://x/1.jpg', 'https://x/2.jpg']);
	assert.deepEqual(
		h.toFileList([
			{ size: 'original', url: 'https://x/o.png' },
			{ size: 'story', urls: ['https://x/s1.png', 'https://x/s2.png'] },
		]),
		['https://x/o.png', 'https://x/s1.png', 'https://x/s2.png'],
	);
	assert.deepEqual(h.toFileList(undefined), []);
	const shaped = h.shapeRenderResult({ content: ['a', 'b'], format: 'png', renderId: 'r1' }, ['warn'], { jobId: 'j1' });
	assert.equal(shaped.url, 'a');
	assert.deepEqual(shaped.urls, ['a', 'b']);
	assert.deepEqual(shaped.warnings, ['warn']);
	assert.equal(shaped.jobId, 'j1');
	assert.deepEqual(h.shapeRenderResult({ content: 'x' }, undefined).warnings, []);
});

test('parsePages and parseList', () => {
	assert.deepEqual(h.parsePages('1, 3-4, 3'), [1, 3, 4]);
	assert.equal(h.parsePages(''), undefined);
	assert.equal(h.parsePages(undefined), undefined);
	assert.deepEqual(h.parsePages([2, 1]), [1, 2]);
	assert.throws(() => h.parsePages('0'), /not a page number/);
	assert.throws(() => h.parsePages('4-2'), /not a valid range/);
	assert.throws(() => h.parsePages('a'), /not a page number/);
	assert.deepEqual(h.parseList('a, b\n c,,'), ['a', 'b', 'c']);
	assert.deepEqual(h.parseList(['x', ' y ']), ['x', 'y']);
	assert.deepEqual(h.parseList(undefined), []);
});

test('the template picker pages through the workspace, then the library', () => {
	let position = h.decodeDesignToken(undefined);
	assert.deepEqual(position, { source: 'workspace', cursor: null });
	position = h.nextDesignPosition(position, { hasMore: true, nextCursor: 'c1' });
	assert.equal(h.encodeDesignToken(position), 'ws:c1');
	assert.deepEqual(h.decodeDesignToken('ws:c1'), { source: 'workspace', cursor: 'c1' });
	position = h.nextDesignPosition(position, { hasMore: false, nextCursor: null });
	assert.deepEqual(position, { source: 'library', cursor: null });
	assert.equal(h.encodeDesignToken(position), 'lib:');
	assert.deepEqual(h.decodeDesignToken('lib:'), { source: 'library', cursor: null });
	assert.equal(h.nextDesignPosition(position, { hasMore: false, nextCursor: null }), null);
	assert.equal(h.matchesFilter('Coffee Tips', ' tips'), true);
	assert.equal(h.matchesFilter('Coffee Tips', 'tea'), false);
});

test('polling backoff, Retry-After and the error envelope', () => {
	const delays = [];
	let delay;
	for (let i = 0; i < 6; i++) delays.push((delay = h.nextPollDelay(delay)));
	assert.deepEqual(delays, [1000, 1500, 2250, 3375, 5000, 5000]);
	assert.equal(h.retryAfterMs('3', undefined), 3000);
	assert.equal(h.retryAfterMs(undefined, { retryAfter: 7 }), 7000);
	assert.equal(h.retryAfterMs('600', undefined), 60_000, 'capped');
	assert.equal(h.retryAfterMs(new Date(10_000).toUTCString(), undefined, 5_000), 5000);
	assert.equal(h.retryAfterMs(undefined, undefined), 1000);
	assert.deepEqual(h.errorEnvelope({ error: 'NOT_FOUND', message: 'Nope', detail: { a: 1 } }, 404), {
		error: 'NOT_FOUND',
		message: 'Nope',
		detail: { a: 1 },
	});
	assert.equal(h.errorEnvelope('<html>bad gateway</html>', 502).error, 'HTTP_502');
	assert.match(h.errorEnvelope(undefined, 500).message, /HTTP 500/);
});

test('base URL, sizes, accounts, events and file names', () => {
	assert.equal(h.normalizeBaseUrl(' https://api.example.com/v1/ '), 'https://api.example.com');
	assert.equal(h.normalizeBaseUrl('https://app.example.com/api/v1'), 'https://app.example.com');
	assert.equal(h.normalizeBaseUrl('http://localhost:3100'), 'http://localhost:3100');
	assert.equal(h.normalizeBaseUrl(''), 'https://api.jamframe.com');
	const choices = h.sizeChoices([{ id: 'story', name: 'My story', width: 1080, height: 1920 }]);
	assert.equal(choices[0].value, 'story');
	assert.match(choices[0].name, /^Saved: My story 1080×1920/);
	assert.equal(choices.filter((c) => c.value === 'story').length, 1);
	assert.ok(choices.some((c) => c.value === 'original'));
	assert.equal(
		h.socialAccountLabel({ name: 'Acme', username: 'acme', platformName: 'X', sandbox: true, status: 'needs_reconnect' }),
		'Acme @acme (X) [sandbox, needs reconnecting]',
	);
	assert.equal(h.sameEvents(['a', 'b', 'a'], ['b', 'a']), true);
	assert.equal(h.sameEvents(['a'], ['a', 'b']), false);
	assert.deepEqual(
		h.WEBHOOK_EVENTS.map((e) => e.value).sort(),
		[
			'design.created',
			'design.deleted',
			'design.updated',
			'render.completed',
			'render.failed',
			'social.post.failed',
			'social.post.published',
			'workflow.run.completed',
			'workflow.run.failed',
		],
	);
	assert.equal(h.fileNameFromUrl('https://cdn.x/renders/ws/abc-p1.png?x=1', 'f'), 'abc-p1.png');
	assert.equal(h.fileNameFromUrl('/files/renders/ws/v.mp4', 'f'), 'v.mp4');
	assert.equal(h.fileNameFromUrl('https://cdn.x/noext', 'fallback'), 'fallback');
	assert.equal(h.mimeTypeFor('a.jpg'), 'image/jpeg');
	assert.equal(h.mimeTypeFor('a.mp4'), 'video/mp4');
});

test('render log items, finished workflow runs and analytics days', () => {
	assert.deepEqual(
		h.shapeRenderItem({ id: 'r1', outputs: [{ url: 'https://cdn/p1.jpg', page: 1 }, { url: 'https://cdn/p2.jpg', page: 2 }] }),
		{ id: 'r1', outputs: [{ url: 'https://cdn/p1.jpg', page: 1 }, { url: 'https://cdn/p2.jpg', page: 2 }], url: 'https://cdn/p1.jpg', urls: ['https://cdn/p1.jpg', 'https://cdn/p2.jpg'] },
	);
	assert.deepEqual(h.shapeRenderItem({ id: 'r2', status: 'failed', outputs: [] }), { id: 'r2', status: 'failed', outputs: [], url: null, urls: [] });
	for (const status of ['succeeded', 'partial', 'failed', 'canceled']) assert.equal(h.isFinishedRun(status), true, status);
	for (const status of ['queued', 'running', undefined]) assert.equal(h.isFinishedRun(status), false, String(status));
	assert.equal(h.toAnalyticsDay('2026-11-14T00:00:00'), '2026-11-14');
	assert.equal(h.toAnalyticsDay('2026-11-14T23:30:00.000+08:00'), '2026-11-14');
	assert.equal(h.toAnalyticsDay('2026-11-14'), '2026-11-14');
	assert.equal(h.toAnalyticsDay(' '), undefined);
	assert.equal(h.toAnalyticsDay(undefined), undefined);
	// Anything else goes to the API as it is, which answers 400 with the reason.
	assert.equal(h.toAnalyticsDay('last week'), 'last week');
});
