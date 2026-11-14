import type { INodeProperties } from 'n8n-workflow';

import { templateLocator } from './shared';

const generate = { resource: ['design'], operation: ['generate'] };

export const designOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['design'] } },
		options: [
			{
				name: 'Generate with AI',
				value: 'generate',
				description:
					'Design a new template from a description with the design agent and save it in the workspace. Costs 5 AI credits.',
				action: 'Generate a template with AI',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a template with its pages, parameters and saved sizes',
				action: 'Get a template',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List your workspace’s templates or the template library',
				action: 'Get many templates',
			},
		],
		default: 'get',
	},
];

export const designFields: INodeProperties[] = [
	templateLocator({ show: { resource: ['design'], operation: ['get'] } }, 'The template to read'),
	{
		displayName: 'Source',
		name: 'source',
		type: 'options',
		default: 'workspace',
		displayOptions: { show: { resource: ['design'], operation: ['getAll'] } },
		options: [
			{ name: 'Workspace', value: 'workspace', description: 'Your own templates' },
			{
				name: 'Template Library',
				value: 'library',
				description: 'The ready-made templates any workspace can render',
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['design'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['design'], operation: ['getAll'], returnAll: [false] } },
	},

	// ----- generate -----
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 4 },
		placeholder:
			'e.g. Announce our summer sale, 30% off everything this weekend. Bold and playful.',
		description:
			'What to design: purpose, content, audience, style. Also the template’s name unless Name is set.',
		displayOptions: { show: generate },
	},
	{
		displayName: 'Size',
		name: 'designSize',
		type: 'string',
		default: '',
		placeholder: 'e.g. instagram-portrait, story or 1080x1350',
		description:
			'A size preset (instagram-post, instagram-story, linkedin-carousel, youtube-thumbnail, og-image, a4-portrait…), a short name (square, portrait, story, landscape) or WIDTHxHEIGHT. Empty: 1080x1350.',
		displayOptions: { show: generate },
	},
	{
		displayName: 'Brand',
		name: 'brand',
		type: 'options',
		default: 'workspace',
		displayOptions: { show: generate },
		options: [
			{
				name: 'Workspace Brand Kit',
				value: 'workspace',
				description: 'The colours, fonts and logo in the workspace’s brand library',
			},
			{ name: 'No Brand', value: 'none', description: 'Let the agent choose freely' },
			{ name: 'Custom', value: 'custom', description: 'The colours, fonts and logo below' },
		],
	},
	{
		displayName: 'Brand Colours',
		name: 'brandColors',
		type: 'fixedCollection',
		placeholder: 'Add Colour',
		default: {},
		typeOptions: { multipleValues: true },
		description: 'Primary first, up to 12',
		displayOptions: { show: { ...generate, brand: ['custom'] } },
		options: [
			{
				displayName: 'Colour',
				name: 'colour',
				values: [{ displayName: 'Colour', name: 'value', type: 'color', default: '#000000' }],
			},
		],
	},
	{
		displayName: 'Brand Fonts',
		name: 'brandFonts',
		type: 'string',
		default: '',
		placeholder: 'e.g. Poppins, Inter',
		description:
			'Font families, heading first, separated by commas (up to 4): brand-library fonts or Google fonts the editor offers',
		displayOptions: { show: { ...generate, brand: ['custom'] } },
	},
	{
		displayName: 'Brand Logo URL',
		name: 'brandLogo',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/logo.png',
		description: 'A brand-library image URL or any HTTPS image URL',
		displayOptions: { show: { ...generate, brand: ['custom'] } },
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		displayOptions: { show: generate },
		description:
			'Whether to wait until the template is saved (usually 10–40 seconds). Off: output the job ID and status at once.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: generate },
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'The template’s name (default: from the prompt)',
			},
			{
				displayName: 'Pages',
				name: 'pages',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1, maxValue: 10 },
				description: 'How many pages to design (a carousel)',
			},
			{
				displayName: 'Reference Image URL',
				name: 'referenceImageUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/moodboard.png',
				description:
					'A public HTTPS PNG, JPEG, GIF or WebP to recreate or take inspiration from (a screenshot, a mood board)',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 300,
				typeOptions: { minValue: 5 },
				description: 'How long Wait for Completion waits before giving up (the job keeps running)',
			},
			{
				displayName: 'Video',
				name: 'video',
				type: 'boolean',
				default: false,
				description:
					'Whether to make an animated video template (page durations, transitions, animations); render it as MP4',
			},
		],
	},
];
