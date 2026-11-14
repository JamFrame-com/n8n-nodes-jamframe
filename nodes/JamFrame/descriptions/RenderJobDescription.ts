import type { INodeProperties } from 'n8n-workflow';

export const renderJobOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['renderJob'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a render job’s status, progress, and files once it succeeds',
				action: 'Get a render job',
			},
			{
				name: 'Wait',
				value: 'wait',
				description: 'Poll a render job until it succeeds (or fail if it fails)',
				action: 'Wait for a render job',
			},
		],
		default: 'get',
	},
];

export const renderJobFields: INodeProperties[] = [
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. clx8n0q1r0008abcd1234efgh',
		description: 'The jobId a render answered with',
		displayOptions: { show: { resource: ['renderJob'] } },
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		default: 600,
		typeOptions: { minValue: 5 },
		description: 'How long to poll before giving up (the job keeps running)',
		displayOptions: { show: { resource: ['renderJob'], operation: ['wait'] } },
	},
];
