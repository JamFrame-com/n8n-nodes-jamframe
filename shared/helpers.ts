/**
 * Pure helpers shared by the nodes. Nothing here imports n8n, so the unit
 * tests (test/*.test.mjs) can run them from `dist/` without an n8n runtime.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { BRAND } from './brand';

/** The API origin from the credential: no trailing slash, no `/v1` (or the older `/api/v1`). */
export function normalizeBaseUrl(raw: unknown): string {
	const text = typeof raw === 'string' && raw.trim() ? raw.trim() : BRAND.defaultBaseUrl;
	return text.replace(/\/+$/, '').replace(/(?:\/api)?\/v1$/, '');
}

/** "1, 3-4" → [1, 3, 4]; blank → undefined. Throws on anything else. */
export function parsePages(raw: unknown): number[] | undefined {
	const text = Array.isArray(raw) ? raw.join(',') : raw == null ? '' : String(raw);
	if (!text.trim()) return undefined;
	const pages = new Set<number>();
	for (const part of text.split(',')) {
		const token = part.trim();
		if (!token) continue;
		const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
		if (range) {
			const from = Number(range[1]);
			const to = Number(range[2]);
			if (from < 1 || to < from || to - from > 100) {
				throw new Error(`Pages: "${token}" is not a valid range`);
			}
			for (let n = from; n <= to; n++) pages.add(n);
		} else if (/^\d+$/.test(token) && Number(token) >= 1) {
			pages.add(Number(token));
		} else {
			throw new Error(`Pages: "${token}" is not a page number. Use e.g. "1, 3-4"`);
		}
	}
	return [...pages].sort((a, b) => a - b);
}

/** Comma- or newline-separated text (or an array) → trimmed, non-empty strings. */
export function parseList(raw: unknown): string[] {
	const parts = Array.isArray(raw)
		? raw.map(String)
		: raw == null
			? []
			: String(raw).split(/[\n,]/);
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** The resource mapper's stored value (a subset of n8n's `ResourceMapperValue`). */
export interface MapperValue {
	mappingMode?: string;
	value?: Record<string, unknown> | null;
	schema?: Array<{ id: string; removed?: boolean }>;
}

export interface ModificationRow {
	key?: string;
	value?: unknown;
}

/**
 * The `modifications` object of a render or post: the template parameters
 * from the resource mapper (blank ones keep the template's value), then the
 * free-form rows (`page2@title`, `title.color`), which win.
 *
 * In "map automatically" mode the parameters come from the input item's
 * fields of the same name.
 */
export function buildModifications(
	mapper: MapperValue | undefined | null,
	inputJson: Record<string, unknown>,
	rows: ModificationRow[] | undefined,
): Record<string, unknown> {
	const modifications: Record<string, unknown> = {};
	const keep = (value: unknown) => value !== undefined && value !== null && value !== '';
	if (mapper) {
		if (mapper.mappingMode === 'autoMapInputData') {
			for (const field of mapper.schema ?? []) {
				if (field.removed) continue;
				const value = inputJson[field.id];
				if (keep(value)) modifications[field.id] = toModificationValue(value);
			}
		} else {
			for (const [key, value] of Object.entries(mapper.value ?? {})) {
				if (keep(value)) modifications[key] = toModificationValue(value);
			}
		}
	}
	for (const row of rows ?? []) {
		const key = typeof row.key === 'string' ? row.key.trim() : '';
		if (!key) continue;
		modifications[key] =
			row.value === undefined || row.value === null ? '' : toModificationValue(row.value);
	}
	return modifications;
}

/** Strings, numbers, booleans and cue arrays go as they are; other objects as JSON text. */
function toModificationValue(value: unknown): unknown {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
		return value;
	if (Array.isArray(value)) return value; // `subtitles` cues
	return JSON.stringify(value);
}

/** One size of a `response.sizes` render. */
export interface SizedContent {
	size: string;
	name?: string;
	width?: number;
	height?: number;
	pages?: number[];
	url?: string;
	urls?: string[];
}

/**
 * Every file URL of a render result, in order: `content` is a string (one
 * file), an array of strings (a carousel), or one `SizedContent` per size.
 */
export function toFileList(content: unknown): string[] {
	if (typeof content === 'string') return content ? [content] : [];
	if (!Array.isArray(content)) return [];
	const urls: string[] = [];
	for (const entry of content) {
		if (typeof entry === 'string') urls.push(entry);
		else if (entry && typeof entry === 'object') {
			const sized = entry as SizedContent;
			if (typeof sized.url === 'string') urls.push(sized.url);
			if (Array.isArray(sized.urls)) urls.push(...sized.urls.filter((u) => typeof u === 'string'));
		}
	}
	return urls;
}

/** A render's output item: the API's `data`, plus `url` (first file), `urls` and `warnings`. */
export function shapeRenderResult(
	data: Record<string, unknown>,
	warnings: unknown,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const urls = toFileList(data.content);
	return {
		...extra,
		...data,
		url: urls[0] ?? null,
		urls,
		warnings: Array.isArray(warnings) ? warnings : [],
	};
}

/**
 * The template picker pages through the workspace's designs, then the
 * template library. Its pagination token says which list and where.
 */
export interface DesignListPosition {
	source: 'workspace' | 'library';
	cursor: string | null;
}

export function encodeDesignToken(position: DesignListPosition): string {
	return `${position.source === 'library' ? 'lib' : 'ws'}:${position.cursor ?? ''}`;
}

export function decodeDesignToken(token: string | undefined): DesignListPosition {
	if (!token) return { source: 'workspace', cursor: null };
	const [prefix, ...rest] = token.split(':');
	const cursor = rest.join(':') || null;
	return { source: prefix === 'lib' ? 'library' : 'workspace', cursor };
}

/** The position after a page: the next page of the same list, the library after the workspace, or the end. */
export function nextDesignPosition(
	current: DesignListPosition,
	pagination: { nextCursor?: string | null; hasMore?: boolean } | undefined,
): DesignListPosition | null {
	if (pagination?.hasMore && pagination.nextCursor) {
		return { source: current.source, cursor: pagination.nextCursor };
	}
	return current.source === 'workspace' ? { source: 'library', cursor: null } : null;
}

/** Does a design name match the picker's search text? */
export function matchesFilter(name: string, filter: string | undefined): boolean {
	if (!filter || !filter.trim()) return true;
	return name.toLowerCase().includes(filter.trim().toLowerCase());
}

/** Render job polling: 1 s, then ×1.5 each time, at most 5 s. */
export function nextPollDelay(previousMs: number | undefined): number {
	if (!previousMs) return 1000;
	return Math.min(Math.round(previousMs * 1.5), 5000);
}

/** How long a 429 asks us to wait: `Retry-After` (seconds or a date), else `detail.retryAfter`, capped. */
export function retryAfterMs(
	header: unknown,
	detail: unknown,
	nowMs = Date.now(),
	capMs = 60_000,
): number {
	const raw = Array.isArray(header) ? header[0] : header;
	let ms: number | undefined;
	if (typeof raw === 'string' || typeof raw === 'number') {
		const seconds = Number(raw);
		if (Number.isFinite(seconds)) ms = seconds * 1000;
		else {
			const date = Date.parse(String(raw));
			if (Number.isFinite(date)) ms = date - nowMs;
		}
	}
	if (ms === undefined && detail && typeof detail === 'object') {
		const seconds = Number((detail as { retryAfter?: unknown }).retryAfter);
		if (Number.isFinite(seconds)) ms = seconds * 1000;
	}
	if (ms === undefined || ms < 0) ms = 1000;
	return Math.min(ms, capMs);
}

/** The API's error envelope, `{ error, message, detail? }`, from any response body. */
export function errorEnvelope(
	body: unknown,
	status: number,
): { error: string; message: string; detail?: unknown } {
	let parsed = body;
	if (typeof body === 'string') {
		try {
			parsed = JSON.parse(body);
		} catch {
			parsed = { message: body.slice(0, 300) };
		}
	}
	const object = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
	return {
		error: typeof object.error === 'string' ? object.error : `HTTP_${status}`,
		message:
			typeof object.message === 'string' && object.message
				? object.message
				: `The ${BRAND.displayName} API answered HTTP ${status}`,
		...(object.detail !== undefined ? { detail: object.detail } : {}),
	};
}

/** A connected social account as a dropdown label. */
export function socialAccountLabel(account: {
	name?: string;
	username?: string | null;
	platformName?: string;
	platform?: string;
	status?: string;
	sandbox?: boolean;
}): string {
	const handle = account.username ? ` @${account.username}` : '';
	const flags = [
		account.sandbox ? 'sandbox' : '',
		account.status === 'needs_reconnect' ? 'needs reconnecting' : '',
	].filter(Boolean);
	return `${account.name ?? 'Account'}${handle} (${account.platformName ?? account.platform ?? 'social'})${
		flags.length ? ` [${flags.join(', ')}]` : ''
	}`;
}

/** Smart Resize names every template accepts (besides its own saved sizes and WIDTHxHEIGHT). */
export const COMMON_SIZES: ReadonlyArray<{ id: string; name: string }> = [
	{ id: 'original', name: 'Original (the template’s own size)' },
	{ id: 'square', name: 'Square 1080×1080' },
	{ id: 'portrait', name: 'Portrait 4:5, 1080×1350' },
	{ id: 'story', name: 'Story / Reel 1080×1920' },
	{ id: 'landscape', name: 'Landscape 1.91:1, 1200×630' },
	{ id: 'widescreen', name: 'Widescreen 16:9, 1920×1080' },
	{ id: 'thumbnail', name: 'Thumbnail 16:9, 1280×720' },
	{ id: 'pin', name: 'Pin 2:3, 1000×1500' },
	{ id: 'og-image', name: 'Open Graph image' },
	{ id: 'youtube-thumbnail', name: 'YouTube thumbnail' },
];

/** The template's saved sizes first, then the common names (no duplicates). */
export function sizeChoices(
	saved: Array<{ id: string; name?: string; width?: number; height?: number }> | undefined,
): Array<{ name: string; value: string }> {
	const seen = new Set<string>();
	const choices: Array<{ name: string; value: string }> = [];
	for (const size of saved ?? []) {
		if (!size?.id || seen.has(size.id)) continue;
		seen.add(size.id);
		const dims = size.width && size.height ? ` ${size.width}×${size.height}` : '';
		choices.push({ name: `Saved: ${size.name ?? size.id}${dims}`, value: size.id });
	}
	for (const size of COMMON_SIZES) {
		if (seen.has(size.id)) continue;
		seen.add(size.id);
		choices.push({ name: size.name, value: size.id });
	}
	return choices;
}

/** `X-Webhook-Signature: t=<unix seconds>,v1=<hex>` (several `v1` allowed). */
export function parseSignatureHeader(
	header: unknown,
): { timestamp: number; signatures: string[] } | null {
	const text = Array.isArray(header) ? header[0] : header;
	if (typeof text !== 'string' || !text) return null;
	let timestamp = NaN;
	const signatures: string[] = [];
	for (const part of text.split(',')) {
		const index = part.indexOf('=');
		if (index < 0) continue;
		const key = part.slice(0, index).trim();
		const value = part.slice(index + 1).trim();
		// Digits only: Number() would also read '', '0x10' or '1e9'.
		if (key === 't') timestamp = /^\d{1,15}$/.test(value) ? Number(value) : NaN;
		else if (key === 'v1' && /^[0-9a-f]+$/i.test(value)) signatures.push(value.toLowerCase());
	}
	if (!Number.isSafeInteger(timestamp) || signatures.length === 0) return null;
	return { timestamp, signatures };
}

export interface SignatureCheck {
	ok: boolean;
	/** `unreadable`: the request's raw bytes weren't available, so nothing can be checked. */
	reason?: 'missing' | 'malformed' | 'expired' | 'mismatch' | 'unreadable';
}

/**
 * Check a webhook delivery: `v1` is the hex HMAC-SHA256 of `${t}.${rawBody}`
 * keyed with the subscription's signing secret, and `t` must be within
 * `toleranceSeconds` of now. Use the raw request bytes, not re-serialised JSON.
 */
export function verifyWebhookSignature(args: {
	/** The raw request bytes (n8n's `rawBody`); never re-serialised JSON. */
	payload: Buffer | string | undefined;
	header: unknown;
	secret: string | undefined;
	toleranceSeconds?: number;
	nowSeconds?: number;
}): SignatureCheck {
	if (!args.header || typeof args.secret !== 'string' || !args.secret) {
		return { ok: false, reason: 'missing' };
	}
	if (typeof args.payload !== 'string' && !Buffer.isBuffer(args.payload)) {
		return { ok: false, reason: 'unreadable' };
	}
	const parsed = parseSignatureHeader(args.header);
	if (!parsed) return { ok: false, reason: 'malformed' };
	const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
	// `!(age <= tolerance)`: a NaN tolerance or clock refuses instead of skipping the check.
	if (!(Math.abs(now - parsed.timestamp) <= (args.toleranceSeconds ?? 300))) {
		return { ok: false, reason: 'expired' };
	}
	const body = typeof args.payload === 'string' ? Buffer.from(args.payload, 'utf8') : args.payload;
	const expected = createHmac('sha256', args.secret)
		.update(Buffer.concat([Buffer.from(`${parsed.timestamp}.`, 'utf8'), body]))
		.digest();
	const match = parsed.signatures.some((signature) => {
		const given = Buffer.from(signature, 'hex');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
	return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** The events a webhook subscription can listen to. */
export const WEBHOOK_EVENTS: ReadonlyArray<{ value: string; name: string; description: string }> = [
	{
		value: 'render.completed',
		name: 'Render Completed',
		description: 'A render job (an MP4, or a render sent as a job) succeeded',
	},
	{
		value: 'render.failed',
		name: 'Render Failed',
		description: 'A render job failed (no credits were charged)',
	},
	{
		value: 'social.post.published',
		name: 'Social Post Published',
		description: 'One account of a social post was published',
	},
	{
		value: 'social.post.failed',
		name: 'Social Post Failed',
		description: 'One account of a social post failed for good',
	},
	{
		value: 'design.created',
		name: 'Template Created',
		description: 'A template was created in the workspace',
	},
	{ value: 'design.updated', name: 'Template Updated', description: 'A template was saved' },
	{ value: 'design.deleted', name: 'Template Deleted', description: 'A template was deleted' },
	{
		value: 'workflow.run.completed',
		name: 'Workflow Run Completed',
		description: 'A workflow run finished with at least one row through, or was canceled',
	},
	{
		value: 'workflow.run.failed',
		name: 'Workflow Run Failed',
		description: 'A workflow run failed: no row went through, or the source couldn’t be read',
	},
];

/** A render from the render log (`GET /renders`), plus `url` (first file) and `urls`, like a render result. */
export function shapeRenderItem(render: Record<string, unknown>): Record<string, unknown> {
	const outputs = Array.isArray(render.outputs) ? render.outputs : [];
	const urls = outputs
		.map((output) =>
			output && typeof output === 'object' ? (output as { url?: unknown }).url : null,
		)
		.filter((url): url is string => typeof url === 'string');
	return { ...render, url: urls[0] ?? null, urls };
}

/** A workflow run's status once it won't change any more. */
export function isFinishedRun(status: unknown): boolean {
	return (
		status === 'succeeded' || status === 'partial' || status === 'failed' || status === 'canceled'
	);
}

/** The `YYYY-MM-DD` the analytics API wants, from a date picker (`2026-11-14T00:00:00`) or plain text. */
export function toAnalyticsDay(raw: unknown): string | undefined {
	const text = raw == null ? '' : String(raw).trim();
	if (!text) return undefined;
	const day = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(text);
	return day ? day[1] : text;
}

/** Same events, ignoring order and duplicates. */
export function sameEvents(a: unknown, b: unknown): boolean {
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	const left = [...new Set(a.map(String))].sort();
	const right = [...new Set(b.map(String))].sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** A file name for a downloaded render file, from its URL. */
export function fileNameFromUrl(url: string, fallback: string): string {
	try {
		const last = new URL(url, 'https://placeholder.invalid').pathname.split('/').pop();
		return last && /\.[a-z0-9]{2,5}$/i.test(last) ? decodeURIComponent(last) : fallback;
	} catch {
		return fallback;
	}
}

/** MIME type of a render file by extension. */
export function mimeTypeFor(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'pdf':
			return 'application/pdf';
		case 'mp4':
			return 'video/mp4';
		case 'srt':
			return 'application/x-subrip';
		case 'vtt':
			return 'text/vtt';
		default:
			return 'application/octet-stream';
	}
}
