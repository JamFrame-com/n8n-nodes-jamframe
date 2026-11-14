import type { INodeProperties } from 'n8n-workflow';

import { extraModifications, parameterMapper, templateLocator } from './shared';

const show = { resource: ['render'], operation: ['render'] };

export const renderOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['render'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description:
					'Get a render from the render log with fresh links to its files (files are kept 8 days)',
				action: 'Get a render',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the workspace’s renders, newest first, with fresh links to their files',
				action: 'Get many renders',
			},
			{
				name: 'Render Template',
				value: 'render',
				description:
					'Render a template to an image, a carousel, a PDF or an MP4 video. Costs 1 credit per image or PDF page, 1 per second of video.',
				action: 'Render a template',
			},
		],
		default: 'render',
	},
];

const renderLog: INodeProperties[] = [
	{
		displayName: 'Render ID',
		name: 'renderId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. clx8n0q1r0005abcd1234efgh',
		description:
			'The renderId of a render (Render Template and the Render Completed event give it)',
		displayOptions: { show: { resource: ['render'], operation: ['get'] } },
	},
	{
		displayName: 'Download Files',
		name: 'download',
		type: 'boolean',
		default: false,
		description: 'Whether to also download each file as binary data (data, data_1, …)',
		displayOptions: { show: { resource: ['render'], operation: ['get'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['render'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['render'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['render'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'succeeded',
				options: [
					{ name: 'Failed', value: 'failed', description: 'Failed renders, with the reason' },
					{ name: 'Succeeded', value: 'succeeded' },
				],
			},
			{
				displayName: 'Template ID',
				name: 'designId',
				type: 'string',
				default: '',
				description: 'Only renders of this template',
			},
		],
	},
];

export const renderFields: INodeProperties[] = [
	...renderLog,
	templateLocator(
		{ show },
		'A template of your workspace, or one from the template library (charged to your workspace like your own). By ID also takes a library template’s slug, e.g. tool-quote-card-paper.',
	),
	parameterMapper({ show }),
	extraModifications({ show }),
	{
		displayName: 'Format',
		name: 'format',
		type: 'options',
		default: 'png',
		displayOptions: { show },
		options: [
			{ name: 'JPEG', value: 'jpeg', description: 'One image per page' },
			{
				name: 'MP4 Video',
				value: 'mp4',
				description: 'One video, each page a scene; runs as a render job',
			},
			{ name: 'PDF', value: 'pdf', description: 'One file with every page' },
			{ name: 'PNG', value: 'png', description: 'One image per page' },
			{ name: 'WebP', value: 'webp', description: 'One image per page' },
		],
	},
	{
		displayName: 'Resize',
		name: 'resizeMode',
		type: 'options',
		default: 'none',
		displayOptions: { show },
		description: 'Smart Resize: lay every page out at another size',
		options: [
			{ name: 'Template Size', value: 'none', description: 'Render at the template’s own size' },
			{ name: 'One Size', value: 'size', description: 'Render every page at one other size' },
			{
				name: 'Several Sizes',
				value: 'sizes',
				description:
					'Render each size in one call (images and PDF only, not as a job); 1 credit per page per size',
			},
		],
	},
	{
		displayName: 'Size',
		name: 'size',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show: { ...show, resizeMode: ['size'] } },
		description: 'A size saved on the template, a size name, or WIDTHxHEIGHT',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a size…',
				typeOptions: { searchListMethod: 'searchSizes', searchable: false },
			},
			{
				displayName: 'Custom',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 1080x1920, story or instagram-story',
			},
		],
	},
	{
		displayName: 'Sizes Names or IDs',
		name: 'sizes',
		type: 'multiOptions',
		default: [],
		required: true,
		displayOptions: { show: { ...show, resizeMode: ['sizes'] } },
		typeOptions: { loadOptionsMethod: 'getSizes', loadOptionsDependsOn: ['templateId.value'] },
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Up to 10 sizes. With an expression: an array such as ["original", "story", "1200x630"].',
	},
	{
		displayName: 'Run as Job',
		name: 'runAsJob',
		type: 'boolean',
		default: false,
		displayOptions: { show },
		description:
			'Whether to queue the render and get a job ID at once (MP4 renders are always jobs). Turn on Wait for Completion to get the files in this step.',
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		displayOptions: { show },
		description:
			'Whether to poll the render job until it finishes when the API answers with a job (a job render, or an MP4 still rendering after 90 seconds). Off: output the job ID and status.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Download Files',
				name: 'download',
				type: 'boolean',
				default: false,
				description: 'Whether to also download each file as binary data (data, data_1, …)',
			},
			{
				displayName: 'Pages',
				name: 'includePages',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1, 3-4',
				description: 'Pages to render, from 1. All pages when empty. At most 20 per render.',
			},
			{
				displayName: 'Quality',
				name: 'quality',
				type: 'number',
				default: 90,
				typeOptions: { minValue: 1, maxValue: 100 },
				description: 'JPEG and WebP compression quality',
			},
			{
				displayName: 'Scale',
				name: 'scale',
				type: 'options',
				default: 1,
				description: 'Pixel density of images (2 = twice the canvas size)',
				options: [
					{ name: '1×', value: 1 },
					{ name: '2×', value: 2 },
					{ name: '3×', value: 3 },
				],
			},
			{
				displayName: 'Subtitles File',
				name: 'subtitles',
				type: 'options',
				default: 'srt',
				description: 'MP4 only: also store the subtitles next to the video and return its URL',
				options: [
					{ name: 'SRT', value: 'srt' },
					{ name: 'WebVTT', value: 'vtt' },
				],
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 600,
				typeOptions: { minValue: 5 },
				description: 'How long Wait for Completion polls before giving up (the job keeps running)',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/render-done',
				description:
					'Jobs only (Run as Job, or MP4): the API POSTs { event, job } here when the job ends. Public HTTPS address.',
			},
		],
	},
];
