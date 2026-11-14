import type { INodeProperties } from 'n8n-workflow';

import { extraModifications, parameterMapper, templateLocator } from './shared';

export const socialAccountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['socialAccount'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the social accounts connected to the workspace',
				action: 'Get many social accounts',
			},
		],
		default: 'getAll',
	},
];

export const socialPostOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['socialPost'] } },
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				description: 'Cancel a draft, a scheduled post, or the accounts that haven’t posted yet',
				action: 'Cancel a social post',
			},
			{
				name: 'Create',
				value: 'create',
				description:
					'Post a rendered template, an earlier render or media URLs to connected accounts: now, scheduled or as a draft',
				action: 'Create a social post',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a post with every account’s status, permalink and error',
				action: 'Get a social post',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List posts, newest first',
				action: 'Get many social posts',
			},
			{
				name: 'Retry',
				value: 'retry',
				description: 'Queue the failed accounts of a post again',
				action: 'Retry a social post',
			},
		],
		default: 'create',
	},
];

const create = { resource: ['socialPost'], operation: ['create'] };
const fromTemplate = { ...create, mediaSource: ['template'] };

export const socialPostFields: INodeProperties[] = [
	// ----- create -----
	{
		displayName: 'Account Names or IDs',
		name: 'accounts',
		type: 'multiOptions',
		required: true,
		default: [],
		typeOptions: { loadOptionsMethod: 'getSocialAccounts' },
		description:
			'The accounts to post to. Accounts are connected in the app. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: create },
	},
	{
		displayName: 'Caption',
		name: 'caption',
		type: 'string',
		default: '',
		typeOptions: { rows: 4 },
		description: 'The post text. Each platform’s limits are checked before anything is posted.',
		displayOptions: { show: create },
	},
	{
		displayName: 'Media',
		name: 'mediaSource',
		type: 'options',
		default: 'template',
		displayOptions: { show: create },
		options: [
			{
				name: 'Render a Template',
				value: 'template',
				description: 'Render a template when the post goes out (charged as a render)',
			},
			{ name: 'An Earlier Render', value: 'render', description: 'Post the files of a render ID' },
			{ name: 'Media URLs', value: 'urls', description: 'Image, video or PDF URLs' },
			{ name: 'None (Draft Only)', value: 'none', description: 'A draft without media' },
		],
	},
	templateLocator({ show: fromTemplate }, 'The template to render and post'),
	parameterMapper({ show: fromTemplate }),
	extraModifications({ show: fromTemplate }),
	{
		displayName: 'Format',
		name: 'postFormat',
		type: 'options',
		default: 'auto',
		displayOptions: { show: fromTemplate },
		options: [
			{
				name: 'Automatic',
				value: 'auto',
				description: 'JPEG with Instagram or TikTok, MP4 when every account is YouTube, else PNG',
			},
			{ name: 'JPEG', value: 'jpeg' },
			{ name: 'MP4 Video', value: 'mp4' },
			{ name: 'PDF (LinkedIn Document)', value: 'pdf' },
			{ name: 'PNG', value: 'png' },
			{ name: 'WebP', value: 'webp' },
		],
	},
	{
		displayName: 'Render ID',
		name: 'renderId',
		type: 'string',
		required: true,
		default: '',
		description: 'The renderId of a succeeded render (Render Template outputs it)',
		displayOptions: { show: { ...create, mediaSource: ['render'] } },
	},
	{
		displayName: 'Media URLs',
		name: 'mediaUrls',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		placeholder: 'https://example.com/a.jpg, https://example.com/b.jpg',
		description:
			'Up to 35 public URLs, separated by commas or new lines. They are downloaded once, now.',
		displayOptions: { show: { ...create, mediaSource: ['urls'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: create },
		options: [
			{
				displayName: 'Captions per Platform',
				name: 'captions',
				type: 'fixedCollection',
				default: {},
				typeOptions: { multipleValues: true },
				description: 'A different caption on one platform (a LinkedIn page falls back to LinkedIn)',
				options: [
					{
						displayName: 'Caption',
						name: 'caption',
						values: [
							{
								displayName: 'Platform',
								name: 'platform',
								type: 'options',
								default: 'x',
								options: [
									{ name: 'Facebook', value: 'facebook' },
									{ name: 'Instagram', value: 'instagram' },
									{ name: 'LinkedIn', value: 'linkedin' },
									{ name: 'LinkedIn Page', value: 'linkedin_page' },
									{ name: 'TikTok', value: 'tiktok' },
									{ name: 'X', value: 'x' },
									{ name: 'YouTube', value: 'youtube' },
								],
							},
							{
								displayName: 'Caption',
								name: 'text',
								type: 'string',
								default: '',
								typeOptions: { rows: 3 },
							},
						],
					},
				],
			},
			{
				displayName: 'Draft',
				name: 'draft',
				type: 'boolean',
				default: false,
				description: 'Whether to save the post without posting it',
			},
			{
				displayName: 'Pages',
				name: 'includePages',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1-3',
				description: 'Template media only: the pages to render (several pages become a carousel)',
			},
			{
				displayName: 'Platform Options (JSON)',
				name: 'platformOptions',
				type: 'json',
				default: '{}',
				description:
					'Per-platform options, e.g. {"tiktok": {"privacyLevel": "SELF_ONLY"}, "linkedin": {"firstComment": "Link: https://example.com"}, "youtube": {"privacy": "unlisted"}}',
			},
			{
				displayName: 'Quality',
				name: 'quality',
				type: 'number',
				default: 90,
				typeOptions: { minValue: 1, maxValue: 100 },
				description: 'Template media only: JPEG and WebP quality',
			},
			{
				displayName: 'Scale',
				name: 'scale',
				type: 'options',
				default: 1,
				description: 'Template media only: pixel density',
				options: [
					{ name: '1×', value: 1 },
					{ name: '2×', value: 2 },
					{ name: '3×', value: 3 },
				],
			},
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				description:
					'When to post (up to a year ahead). Without an offset it is read in Time Zone. Empty: post now.',
			},
			{
				displayName: 'Time Zone',
				name: 'timezone',
				type: 'string',
				default: '',
				placeholder: 'e.g. Europe/Paris',
				description: 'IANA time zone for Scheduled At (default UTC)',
			},
		],
	},

	// ----- get, cancel, retry -----
	{
		displayName: 'Post ID',
		name: 'postId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['socialPost'], operation: ['get', 'cancel', 'retry'] } },
	},
	{
		displayName: 'Account Target ID',
		name: 'targetId',
		type: 'string',
		default: '',
		description:
			'Retry only this account of the post (a target ID from Get). Empty: every failed account.',
		displayOptions: { show: { resource: ['socialPost'], operation: ['retry'] } },
	},

	// ----- getAll -----
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: '',
		displayOptions: { show: { resource: ['socialPost'], operation: ['getAll'] } },
		options: [
			{ name: 'Any', value: '' },
			{ name: 'Canceled', value: 'canceled' },
			{ name: 'Drafts', value: 'drafts' },
			{ name: 'Needs Attention', value: 'attention', description: 'Failed or partly failed' },
			{ name: 'Published', value: 'published', description: 'Fully or partly published' },
			{ name: 'Queue', value: 'queue', description: 'Scheduled or going out' },
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['socialPost'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['socialPost'], operation: ['getAll'], returnAll: [false] },
		},
	},
];

export const socialAnalyticsOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['socialAnalytics'] } },
		options: [
			{
				name: 'Get Daily',
				value: 'getDaily',
				description:
					'One item per day of the range: what the posts gained that day, and how many posts went out',
				action: 'Get daily social analytics',
			},
			{
				name: 'Get Insights',
				value: 'getInsights',
				description:
					'The top 5 posts, the best weekday and hour to post, and each platform compared',
				action: 'Get social analytics insights',
			},
			{
				name: 'Get Overview',
				value: 'getOverview',
				description:
					'Impressions, reach, likes, comments, shares, saves, clicks and engagement for the range, with the change from the period before',
				action: 'Get a social analytics overview',
			},
		],
		default: 'getOverview',
	},
];

const analytics = { resource: ['socialAnalytics'] };

export const socialAnalyticsFields: INodeProperties[] = [
	{
		displayName: 'From',
		name: 'from',
		type: 'dateTime',
		default: '',
		description:
			'First day of the range, in the organization’s analytics time zone. Empty: 27 days before To.',
		displayOptions: { show: analytics },
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'dateTime',
		default: '',
		description: 'Last day of the range, included. Empty: today. At most 366 days.',
		displayOptions: { show: analytics },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: analytics },
		options: [
			{
				displayName: 'Account Names or IDs',
				name: 'accountIds',
				type: 'multiOptions',
				default: [],
				typeOptions: { loadOptionsMethod: 'getSocialAccounts' },
				description:
					'Only these accounts. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Platforms',
				name: 'platforms',
				type: 'multiOptions',
				default: [],
				description: 'Only these platforms',
				options: [
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'LinkedIn Page', value: 'linkedin_page' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X', value: 'x' },
					{ name: 'YouTube', value: 'youtube' },
				],
			},
		],
	},
];
