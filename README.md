# n8n-nodes-jamframe

An [n8n](https://n8n.io) community node package for JamFrame: render images,
carousels, PDFs and MP4 videos from your templates, post them to connected
social accounts, run your JamFrame workflows, design templates and edit media
with AI, and start n8n workflows when a render job ends, a post goes out, a
template changes or a workflow run ends.

> **Not published yet.** Check the package name `n8n-nodes-jamframe`, the
> `jamframe.com` URLs and the GitHub repository URLs in `package.json` and
> the codex files before the first publish (see [Renaming](#renaming)): n8n stores node and
> credential names in every saved workflow, so they can't change afterwards.

It contains:

| | |
| --- | --- |
| **JamFrame** node | Render a template; get or list past renders; get or wait for a render job; get, list and generate templates (AI); remove an image's background (AI); transcribe audio or video into subtitles (AI); list social accounts; create, get, list, cancel and retry social posts; social analytics; get, list and run workflows; get, list and cancel workflow runs |
| **JamFrame Trigger** node | Starts a workflow on `render.completed`, `render.failed`, `social.post.published`, `social.post.failed`, `design.created`, `design.updated`, `design.deleted`, `workflow.run.completed` or `workflow.run.failed`; subscribes and unsubscribes itself, and checks each delivery's signature |
| **JamFrame API** credentials | An API key and the API's base URL |

It talks to the API-key authenticated `/v1` API only (the
[API reference](https://app.jamframe.com/docs/api)) and has no runtime
dependencies.

## Install

Once the package is on npm:

- **n8n UI** (self-hosted, owner or admin): **Settings → Community Nodes →
  Install**, enter `n8n-nodes-jamframe`, accept the risk notice. Verified
  community nodes can also be added from the nodes panel, including on n8n
  Cloud.
- **Manually** (queue mode, or a private build): in the n8n host or container,
  `mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm i n8n-nodes-jamframe`,
  then restart n8n.

To try an unpublished build, run `npm run dev` in this folder (see
[Develop](#develop)), or `npm pack` and install the `.tgz` the same way.

## Credentials

**JamFrame API**:

- **API Key**: create one in the app under **Settings → API keys** (keys start
  with `jf_live_`). A key belongs to one workspace; everything the nodes do
  happens in that workspace.
- **Base URL**: `https://api.jamframe.com` (the default), or your staging or
  self-hosted address, without `/v1`.

n8n tests the credential with `POST /v1/auth`, which answers 200 for a
valid key.

## The JamFrame node

### Render → Render Template

`POST /v1/render`. Costs 1 credit per image or PDF page, 1 per second of
video, only when the render succeeds.

- **Template**: pick from the list (your workspace's templates first, then the
  template library, labelled `Library: …`; type to search by name; video
  templates say `video`), or paste an ID (useful with expressions; a library
  template's slug such as `tool-quote-card-paper` works too). Library
  templates render like your own and are charged to your workspace.
- **Template Parameters**: one field per parameter of the chosen template,
  loaded from `GET /v1/designs/{id}` (text, image/video/audio URLs, QR
  values, shape colours, `{{placeholders}}`, subtitles). Empty fields keep the
  template's own content. Switch the mapper to **Map Automatically** to take
  values from input fields with the same names.
- **Additional Modifications**: any other key, sent as it is and winning over
  the fields above: `page2@title` (one page of a carousel), `title.color`,
  `title.fontSize`, `badge.hidden`, `audio.volume`, `subtitles.style.position`…
- **Format**: PNG, JPEG, WebP (one file per page), PDF (one file), MP4 video
  (one file; each page a scene; always a render job).
- **Resize** (Smart Resize): **One Size** takes a size saved on the template,
  a size name (`story`, `square`, `portrait`, `landscape`, `widescreen`,
  `thumbnail`, `pin`, `original`, or a preset such as `instagram-story`) or
  `WIDTHxHEIGHT` in the **Custom** mode. **Several Sizes** renders up to 10
  sizes in one call (images and PDF, not as a job; 1 credit per page per
  size).
- **Run as Job**: queue the render (`"async": true`) and get a job ID at once.
- **Wait for Completion** (default on): when the API answers with a job (a job
  render, or an MP4 still rendering after 90 seconds), poll
  `GET /v1/render-jobs/{id}` after 1 s, then every ×1.5 up to 5 s, until it
  ends; give up after **Timeout** (600 s by default; the job keeps running).
  Off: output `{ jobId, status }`.
- **Options**: Pages (`1, 3-4`), Scale (1–3×), Quality (JPEG/WebP), Subtitles
  File (MP4: also store an `.srt`/`.vtt`), Webhook URL (jobs: the API POSTs
  `{ event, job }` there when the job ends), Timeout, **Download Files** (each
  file as binary data `data`, `data_1`, …).

Output: the API's render result (`content`, `format`, `pages`, `credits`,
`renderId`, `responseTime`, `duration` and `subtitles` for MP4) plus `url`
(the first file), `urls` (every file; with several sizes, every size's files in
order), `warnings` (e.g. modification keys that matched nothing) and `jobId`
when it ran as a job.

### Render → Get / Get Many

The render log: `GET /v1/renders/{id}` and `GET /v1/renders` (newest first;
**Filters**: Status, Template ID; Return All / Limit). Renders made anywhere
are listed: this node, the app, signed and dynamic URLs, forms, workflows,
Zapier and Make. Each item has `outputs` (fresh file links that work for
5 minutes; files are kept 8 days) plus `url` and `urls` as above. **Get** can
also download the files as binary data. Free.

### Render Job → Get / Wait

`GET /v1/render-jobs/{id}`: status (`queued`, `running`, `succeeded`,
`failed`), `progress`, and the files (`url`, `urls`, `result`) once it
succeeded. **Wait** polls as above; a failed job fails the node with the job's
error (no credits are charged for it).

### Template → Get / Get Many

`GET /v1/designs/{id}` (pages, parameters and saved sizes) and
`GET /v1/designs` with **Source** = Workspace or Template Library
(`?source=library`), with Return All / Limit.

### Template → Generate with AI

`POST /v1/designs/generate`. The design agent designs a new template from
your **Prompt** and saves it in the workspace, with parameter keys on the
layers a render changes (`title`, `photo`, `cta`…). Costs 5 AI credits,
refunded if it fails.

- **Size**: a preset (`instagram-story`, `linkedin-carousel`, `og-image`…), a
  short name (`square`, `portrait`, `story`, `landscape`) or `WIDTHxHEIGHT`;
  1080x1350 when empty.
- **Brand**: the workspace's brand kit (default), no brand, or custom colours,
  fonts and a logo.
- **Wait for Completion** (default on): a design takes 10–40 seconds; the API
  waits about 25 seconds, then the node polls
  `GET /v1/designs/generate/{jobId}` until it is saved (**Timeout**, 300 s by
  default). Off: output `{ jobId, status }` at once.
- **Options**: Name, Pages (1–10, a carousel), Video (an animated template),
  Reference Image URL, Timeout.

Output: the job (`message`, `changes`, `creditsCharged`, `design` with its
parameters and `editorUrl`) plus `templateId`, ready for Render Template's
**By ID** mode (`{{ $json.templateId }}`).

### Image → Remove Background

`POST /v1/images/remove-background`. Cuts the subject out onto a transparent
PNG and saves it in the workspace's brand library; `url` can go straight into
an image parameter of a render. Costs 1 AI credit (4 on a server without the
local cut-out model, where an image model redraws the subject).

- **Input**: a public **URL**, or a **Binary File** of the input item (e.g.
  from Google Drive or an HTTP Request node), sent as a multipart upload. PNG,
  JPEG, GIF or WebP up to 10 MB.
- **Options**: Asset Name, **Download Result** (the PNG as binary data
  `data`).

### Audio → Transcribe

`POST /v1/ai/transcribe`. Turns the speech in an audio file or a video into
subtitle cues (`cues`), plus the same as `srt` and `vtt` and the full `text`.
Pass `{{ $json.cues }}` (or `srt`) to a template's subtitles parameter to burn
them into an MP4. Costs 1 AI credit per minute of audio.

- **Input**: a **URL** or a **Binary File** (MP3, M4A, WAV, Ogg, MP4, WebM;
  up to 100 MB and 2 hours).
- **Options**: Language (detected when empty), Style (Standard: 2 lines of
  42 characters; Short: one line of 24, for vertical video), Max Characters
  per Line, Max Lines per Cue, Start and Duration (only a window of the file),
  Offset (moves the cues on your video's timeline), Include Word Timings.

### Social Account → Get Many

`GET /v1/social/accounts`: the accounts connected in the app (connecting
needs the platforms' OAuth in a browser, so it happens in the app).

### Social Post → Create / Get / Get Many / Cancel / Retry

`POST /v1/social/posts` and friends.

- **Accounts**: pick from the connected accounts (sandbox accounts and accounts
  that need reconnecting are labelled).
- **Caption**, and per-platform captions under Additional Fields.
- **Media**: **Render a Template** (same template picker and parameters as
  Render; the render is charged when the post goes out; several pages become a
  carousel, a PDF a LinkedIn document), **An Earlier Render** (a `renderId`,
  e.g. from Render Template), **Media URLs**, or **None** (drafts).
- **Additional Fields**: Scheduled At + Time Zone, Draft, Pages, Scale,
  Quality, Platform Options (JSON, e.g.
  `{"tiktok": {"privacyLevel": "SELF_ONLY"}}`).

Every account is checked against its platform's rules before anything is
created; a refusal fails the node with every problem listed. Publishing is
asynchronous: use **Get**, or the trigger's `social.post.*` events, for each
account's permalink or error.

### Social Analytics Report → Get Overview / Get Daily / Get Insights

`GET /v1/social/analytics/overview`, `/daily` and `/insights`: how the
workspace's posts are doing (impressions or views, reach, likes, comments,
shares, saves, clicks, engagement). **From** and **To** pick the days (the
last 28 days when empty; days are in the organization's analytics time zone);
**Filters** narrow it to some platforms or accounts. A metric is `null` when
the platforms in scope don't report it. Free.

- **Get Overview**: one item with the totals, the period before and the change
  in percent.
- **Get Daily**: one item per day (`day`, the metrics, `postsPublished`,
  `timezone`), ready for a sheet or a chart.
- **Get Insights**: one item with the top 5 posts, the best weekday and hour
  to post, and each platform compared.

### Workflow → Get / Get Many / Run

Workflows are made in the app (Workflows): they read rows from Google Sheets,
a CSV or XLSX file, Airtable, a Drive folder or an incoming webhook, render a
template per row and deliver each render. This node starts them and reads
their results.

- **Workflow**: pick from the list or paste an ID.
- **Run** (`POST /v1/workflows/{id}/run`): starts a run now, drafts included.
  Each row costs the usual render credits. **Options**: Max Rows (a test run),
  Rows (JSON: the rows for a workflow whose source is an incoming webhook),
  Timeout.
- **Wait for Completion** (default on): polls
  `GET /v1/workflows/{id}/runs/{runId}` until the run ends (**Timeout**, 600 s
  by default; the run keeps going), then outputs the run with each row's
  `status`, `urls`, `deliveries` and `error`. A `failed` run (no row went
  through) fails the node; `partial` and `canceled` runs are output. Off:
  output the queued run at once.
- **Get** / **Get Many**: the workflow with its steps, trigger, last run and
  `problems` (what stops it from running).

### Workflow Run → Get / Get Many / Cancel

`GET /v1/workflows/{id}/runs/{runId}` (with each row's result),
`GET /v1/workflows/{id}/runs` (newest first) and
`POST /v1/workflows/{id}/runs/{runId}/cancel` (rows not started yet are
skipped; the row in progress finishes).

### Errors

API errors fail the node with the API's message (for example `Quota exceeded:
requested 3, remaining 1 of 100`); the error code (`QUOTA_EXCEEDED`,
`VALIDATION_ERROR`, `NOT_FOUND`…) and `detail` are in the error's description,
and the HTTP status in its code. A `429` is retried twice after `Retry-After`.
With **Settings → On Error → Continue**, the item carries `error` instead.

## Trigger

The **JamFrame Trigger** node uses the API's webhook subscriptions (REST
hooks):

1. Activating the workflow calls `POST /v1/webhooks/subscriptions` with
   n8n's webhook URL and the chosen events, and keeps the subscription ID and
   its signing secret (shown only once) in the node's static data.
2. Each delivery's `X-Webhook-Signature` (`t=<unix>,v1=<HMAC-SHA256 of
   "t.<raw body>">`) is checked against that secret on the raw request body,
   with a 5-minute tolerance. A delivery that fails the check is answered
   `401` and doesn't start the workflow (turn **Verify Signature** off only to
   debug).
3. Deactivating the workflow deletes the subscription. Changing the events or
   the URL replaces it.

Each execution gets the event envelope: `id`, `type`, `createdAt`, `data` (a
render job for `render.*`, `{ post, target }` for `social.post.*`, the template
summary for `design.*`, the run plus `workflowName` for `workflow.run.*`) and
`deliveryId` (the `X-Webhook-Delivery` header, the
same across retries: use it to deduplicate, since delivery is at-least-once).
A workspace can have at most 20 subscriptions.

**Your n8n must be reachable from the internet.** The API only delivers to
public addresses (no `localhost`, private or link-local hosts) and requires
`https://` in production. n8n's webhook URLs are `http://localhost:5678/…` by
default, so on a local n8n set `WEBHOOK_URL` to a public HTTPS address (for
example a tunnel such as `cloudflared` or `ngrok`) before activating, or
activation fails with `url must not target a private host`. n8n's test URL
(`/webhook-test/…`) and production URL (`/webhook/…`) differ; the node
re-subscribes when the URL changes.

### Without the trigger node

If you can't use the node (an older n8n, or you want one endpoint for several
workflows):

1. Add n8n's built-in **Webhook** node (POST, **Raw Body** on), activate the
   workflow and copy its production URL.
2. In the app, open **Webhooks**, add a subscription with that URL and the
   events, and copy the signing secret it shows once (or use
   `POST /v1/webhooks/subscriptions` with your API key).
3. Verify the signature in a **Code** node before acting on the event:

   ```js
   const crypto = require('crypto');
   const secret = $env.JAMFRAME_WEBHOOK_SECRET; // or paste it in a credential
   const item = $input.first();
   // The raw body (works with n8n's filesystem and S3 binary modes too).
   const raw = await this.helpers.getBinaryDataBuffer(0, 'data');
   const header = item.json.headers['x-webhook-signature'] ?? '';
   const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
   const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.`).update(raw).digest();
   const given = Buffer.from(parts.v1 ?? '', 'hex');
   const ok = /^\d+$/.test(parts.t ?? '')
     && Math.abs(Date.now() / 1000 - Number(parts.t)) <= 300
     && given.length === expected.length
     && crypto.timingSafeEqual(given, expected);
   if (!ok) throw new Error('Bad signature');
   return [{ json: JSON.parse(raw.toString('utf8')) }];
   ```

   (The Code node needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` on self-hosted
   n8n.)

## Example workflows

- **Render and post**: Schedule Trigger → Google Sheets (rows with
  `title`, `photo`) → JamFrame *Render Template* (a carousel template,
  parameters mapped automatically from the row, format JPEG) → JamFrame
  *Create Social Post* (Media: An Earlier Render, Render ID
  `{{$json.renderId}}`, caption from the row).
- **Videos without waiting**: Webhook → JamFrame *Render Template* (MP4, Run
  as Job, Wait for Completion off) → respond with the job ID. A second
  workflow starts on **JamFrame Trigger** (`render.completed`) and sends
  `{{$json.data.result.content}}` to Slack.
- **Post status**: **JamFrame Trigger** (`social.post.failed`) → Slack
  message with `{{$json.data.target.accountName}}` and
  `{{$json.data.target.error.message}}`.
- **Product photos**: Google Drive Trigger (new file in a folder) → Google
  Drive *Download* → JamFrame *Remove Background* (Input: Binary File) →
  JamFrame *Render Template* (the photo parameter `{{$json.url}}`) → JamFrame
  *Create Social Post*.
- **Weekly report**: Schedule Trigger (Mondays) → JamFrame *Get Overview*
  (From: `{{$today.minus({days: 7})}}`) → Slack message with
  `{{$json.totals.impressions}}` and `{{$json.change.engagement}}`%.
- **Batch from the app**: Schedule Trigger → JamFrame *Run Workflow* (a
  workflow made in the app, Wait for Completion on) → Filter (rows with
  `status` = `failed`) → email the list.

## Develop

```sh
npm install
npm run dev        # n8n with this package loaded, rebuilding on changes (Docker or Podman since n8n 3)
npm run lint       # n8n's community-node linter (n8n-node lint)
npm run build      # tsc → dist/, plus the icons
npm test           # build, then node:test unit tests (test/*.test.mjs), no n8n runtime or network
JAMFRAME_SMOKE_API_KEY=jf_live_… npm run test:smoke   # the built node against a running API (1 credit)
```

`n8n-node dev --external-n8n` loads the package into an n8n you started
yourself with `N8N_DEV_RELOAD=true`.

The tests drive the built nodes with a fake n8n context whose HTTP helper
answers from a script: the render, render log, job polling, AI design (with
its job), background removal and transcription (URL and multipart uploads),
workflow runs, social post, analytics and pagination requests, error mapping,
the template and workflow pickers, the parameter mapper, and the trigger's
subscribe / verify / unsubscribe cycle. One test checks that every resource
and operation in the UI has a handler.

`test:smoke` (`test/live.smoke.mjs`) runs the built node against a real API:
`JAMFRAME_SMOKE_BASE_URL` defaults to `http://localhost:3100`. It checks the
credential, the template picker, a one-page PNG render of a library template
(1 credit), the render log, workflows and analytics. With
`JAMFRAME_SMOKE_AI=1` it also uploads that PNG to Remove Background (1 AI
credit).

Layout:

```
credentials/JamFrameApi.credentials.ts   API key + base URL, Bearer auth, test request
nodes/JamFrame/                          the action node: description files, methods (pickers, mapper, sizes, accounts), actions
nodes/JamFrameTrigger/                   the trigger node
shared/brand.ts                           product name, default base URL, docs URL
shared/helpers.ts                         pure helpers (signature check, modifications, pagination, result shaping)
shared/transport.ts                       API calls, file uploads, error mapping, 429 retry, polling (render jobs, AI designs, workflow runs)
icons/                                    the JF mark (the same file for light and dark themes)
test/                                     unit tests, and the live smoke test
.github/workflows/                        CI and the provenance publish workflow from n8n's template
```

## Publishing (not done yet)

Nothing has been published. To publish and get the node verified (n8n's
requirements as of 2026-11-10):

1. **Decide the name** and apply [Renaming](#renaming) if it changes. Reserve
   the npm name (`n8n-nodes-jamframe`, or `@<org>/n8n-nodes-jamframe` under
   an npm organization).
2. **Create the public GitHub repository** this package's URLs point at,
   `github.com/JamFrame-com/n8n-nodes-jamframe` (the `repository` and `homepage` in
   `package.json`, the codex `.node.json` files, `documentationUrl` in the
   credential and `docsUrl` in `shared/brand.ts`), and push this folder to it.
   n8n checks that the npm package's repository URL, author and git link match
   a public repository, and GitHub only runs workflows from a repository's
   root `.github/`.
3. **Check the icons** in `icons/` (SVG, light and dark variants) and the
   author email in `package.json`.
4. **npm**: create the account (or organization), then add a **Trusted
   Publisher** for the package (GitHub Actions, the repository, workflow
   `publish.yml`), or store a granular token as the `NPM_TOKEN` Actions secret.
   Since 1 May 2026 n8n accepts only packages published from GitHub Actions
   with a provenance statement; `.github/workflows/publish.yml` does that on a
   version tag.
5. **Release**: `npm run release` (lint, build, version bump, changelog, tag,
   push); the tag triggers the publish workflow.
6. **Check**: `npx @n8n/scan-community-package n8n-nodes-jamframe` against
   the published package.
7. **Submit** for verification at the n8n Creator Portal,
   <https://creators.n8n.io/nodes> (review takes up to four weeks).

## Requirements this package follows

Checked against n8n's documentation on 2026-11-10:

- Naming `n8n-nodes-…` or `@scope/n8n-nodes-…`, the `n8n-community-node-package`
  keyword, and an `n8n` section in `package.json` listing `dist/` node and
  credential files with `n8nNodesApiVersion: 1` and `strict: true`
  ([submit community nodes](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/),
  the `@n8n/node-cli` template).
- Built with the official tooling, `@n8n/node-cli` 0.55.6 (`n8n-node build`,
  `lint`, `dev`, `release`), from its `programmatic/example` template
  ([n8n-node CLI](https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/)).
- Verification rules: MIT license, no runtime dependencies, no environment
  variables or file access in the node code, English UI and docs, README,
  publishing from GitHub Actions with provenance, programmatic style for the
  trigger (declarative nodes can't be triggers)
  ([verification guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/)).
- `resourceLocator` with a `searchListMethod`, and a `resourceMapper` with a
  `resourceMapperMethod`
  ([UI elements](https://docs.n8n.io/integrations/creating-nodes/build/reference/ui-elements/)).
- File layout `nodes/<Node>/<Node>.node.ts` + `.node.json` codex,
  `credentials/<Name>.credentials.ts`
  ([node file structure](https://docs.n8n.io/integrations/creating-nodes/build/reference/node-file-structure/)).
- Manual install into `~/.n8n/nodes`
  ([manual install](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/)).
- n8n's linter (`@n8n/eslint-plugin-community-nodes` via `n8n-node lint`)
  passes with no errors or warnings. Among its rules: no `setTimeout` (the
  polling uses `sleep` from `n8n-workflow`), only `n8n-workflow` and
  `node:crypto` imported, errors thrown as `NodeApiError` / `NodeOperationError`,
  literal credential `documentationUrl`, codex categories from n8n's list, node
  file names that match the node's `name`, singular resource names.
- File uploads (Remove Background, Transcribe) use the runtime's built-in
  `FormData` and `Blob`, not the `form-data` package (no dependencies allowed).
  n8n's `httpRequest` hands them to axios, which streams them as
  `multipart/form-data`; checked with n8n-core 2.16 against an echo server.

## Renaming

`shared/brand.ts` holds the display name, the default base URL, the API key
hint and the docs URL. n8n requires the rest to be literals, so a rename also
edits (all before the first publish; node and credential names are stored in
users' workflows):

- `package.json`: `name`, `description`, `keywords`, `homepage`, `repository`,
  `author`, and the `n8n.nodes` / `n8n.credentials` paths if files are renamed.
- `credentials/JamFrameApi.credentials.ts`: the class name, `name =
  'jamFrameApi'` (also `CREDENTIAL_NAME` in `shared/brand.ts` and the
  `credentials` entry of both nodes), `displayName`, `documentationUrl`.
- `nodes/JamFrame/JamFrame.node.ts` and
  `nodes/JamFrameTrigger/JamFrameTrigger.node.ts`: the class names,
  `name: 'jamFrame'` / `'jamFrameTrigger'`, the trigger's `displayName`
  (n8n's linter wants "Trigger" in a literal). The linter also wants each
  node file named after its `name` with a capital first letter (`jamFrame` →
  `JamFrame.node.ts`).
- The `.node.json` codex files: `node` (`<package>.<node name>`) and the URLs.
- The folder, file and icon names, and the paths in `test/`.

## License

[MIT](LICENSE.md)
