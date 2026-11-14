# Changelog

## 0.1.0 (unreleased)

- JamFrame node: Render Template (template picker incl. the template library, template parameters as fields, Smart Resize, MP4, render jobs with wait), Render get/get many (the render log), Render Job get/wait, Template get/get many/generate with AI, Image remove background and Audio transcribe (from a URL or a binary file), Social Account get many, Social Post create/get/get many/cancel/retry, Social Analytics Report overview/daily/insights, Workflow get/get many/run (with wait), Workflow Run get/get many/cancel.
- JamFrame Trigger: render, social post, template and workflow run events through webhook subscriptions, with signature verification.
- JamFrame API credentials: API key and base URL.
- Node and credential names are `jamFrame`, `jamFrameTrigger` and `jamFrameApi` (n8n's linter wants node files named after the node's `name`).
