# Changelog

## 0.1.3 (18 Nov 2026)

- **Template → Generate with AI** says it costs 15 to 30 AI credits (it said 5), as JamFrame now charges for a new design. The README says the same.
- The README says background removal costs 8 AI credits when an image model does the cut-out (it said 4).

## 0.1.2 (14 Nov 2026)

- Template Parameters stay hidden until a template is picked. In 0.1.1 n8n still showed its own red "No parameters found" message before a template was chosen. A template that really has no parameters still says so.

## 0.1.1 (14 Nov 2026)

- Template Parameters no longer shows a red "This template has no parameters" error before a template is picked. The note above the fields says which case it is: pick a template, or the template has no parameters.
- The API key hint points to **Developers → API Keys** in the app (it said Settings → API keys).

## 0.1.0 (14 Nov 2026)

- JamFrame node: Render Template (template picker incl. the template library, template parameters as fields, Smart Resize, MP4, render jobs with wait), Render get/get many (the render log), Render Job get/wait, Template get/get many/generate with AI, Image remove background and Audio transcribe (from a URL or a binary file), Social Account get many, Social Post create/get/get many/cancel/retry, Social Analytics Report overview/daily/insights, Workflow get/get many/run (with wait), Workflow Run get/get many/cancel.
- JamFrame Trigger: render, social post, template and workflow run events through webhook subscriptions, with signature verification.
- JamFrame API credentials: API key and base URL.
- Node and credential names are `jamFrame`, `jamFrameTrigger` and `jamFrameApi` (n8n's linter wants node files named after the node's `name`).
