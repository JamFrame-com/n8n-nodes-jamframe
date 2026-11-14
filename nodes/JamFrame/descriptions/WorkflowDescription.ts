import type { INodeProperties } from 'n8n-workflow';

import { workflowLocator } from './shared';

export const workflowOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workflow'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description:
					'Get a workflow with its steps, trigger, last run and what stops it from running',
				action: 'Get a workflow',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the workspace’s workflows, most recently changed first',
				action: 'Get many workflows',
			},
			{
				name: 'Run',
				value: 'run',
				description:
					'Start a run now (drafts too): each row renders the template (render credits) and goes to the workflow’s deliveries',
				action: 'Run a workflow',
			},
		],
		default: 'run',
	},
];

const run = { resource: ['workflow'], operation: ['run'] };

export const workflowFields: INodeProperties[] = [
	workflowLocator({ show: { resource: ['workflow'], operation: ['get', 'run'] } }),
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		displayOptions: { show: run },
		description:
			'Whether to wait until the run ends and output each row’s result. Off: output the queued run at once.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: run },
		options: [
			{
				displayName: 'Max Rows',
				name: 'maxRows',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1, maxValue: 10000 },
				description: 'Render only the first N rows (a test run)',
			},
			{
				displayName: 'Rows (JSON)',
				name: 'payload',
				type: 'json',
				default: '[]',
				description:
					'For a workflow whose source is an incoming webhook: the rows to render, as an array of objects (or one object)',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 600,
				typeOptions: { minValue: 5 },
				description: 'How long Wait for Completion waits before giving up (the run keeps going)',
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['workflow'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['workflow'], operation: ['getAll'], returnAll: [false] } },
	},
];

export const workflowRunOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workflowRun'] } },
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				description: 'Cancel a queued or running run: rows not started yet are skipped',
				action: 'Cancel a workflow run',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a run with each row’s files, deliveries and errors',
				action: 'Get a workflow run',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List a workflow’s runs, newest first',
				action: 'Get many workflow runs',
			},
		],
		default: 'get',
	},
];

export const workflowRunFields: INodeProperties[] = [
	workflowLocator({ show: { resource: ['workflowRun'] } }),
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. cmwa1b2c3d0001abcd1234efgh',
		description: 'The run’s ID (Workflow → Run and the Workflow Run events give it)',
		displayOptions: { show: { resource: ['workflowRun'], operation: ['get', 'cancel'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['workflowRun'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['workflowRun'], operation: ['getAll'], returnAll: [false] },
		},
	},
];
