/**
 * Every product-specific string in this package that n8n's linter lets us
 * keep out of the node and credential classes. A rename edits this file,
 * plus the literals listed in the README's
 * "Renaming" section (class names, `name` fields, file names and
 * package.json), which n8n requires to be literal.
 */
export const BRAND = {
	/** Shown in the n8n UI. */
	displayName: 'JamFrame',
	/** The API origin; the API lives under `/v1`. */
	defaultBaseUrl: 'https://api.jamframe.com',
	/** Where API keys are created, for help texts. */
	apiKeysHint: 'Create one in the app under Developers → API Keys. Keys start with jf_live_.',
	/** This package's README, linked from the credentials dialog. */
	docsUrl: 'https://github.com/JamFrame-com/n8n-nodes-jamframe#readme',
} as const;

/** The credential type's `name` (must match the literal in the credential class). */
export const CREDENTIAL_NAME = 'jamFrameApi';
