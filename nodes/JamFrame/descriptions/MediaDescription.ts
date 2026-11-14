import type { INodeProperties } from 'n8n-workflow';

import { fileInput } from './shared';

export const imageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['image'] } },
		options: [
			{
				name: 'Remove Background',
				value: 'removeBackground',
				description:
					'Cut the subject out of a picture onto a transparent PNG, saved in the brand library. Costs 1 AI credit.',
				action: 'Remove an image background',
			},
		],
		default: 'removeBackground',
	},
];

const removeBackground = { resource: ['image'], operation: ['removeBackground'] };

export const imageFields: INodeProperties[] = [
	...fileInput(
		{ show: removeBackground },
		{
			label: 'Image',
			placeholder: 'https://example.com/photos/product.jpg',
			urlDescription: 'A PNG, JPEG, GIF or WebP picture up to 10 MB',
		},
	),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: removeBackground },
		options: [
			{
				displayName: 'Asset Name',
				name: 'name',
				type: 'string',
				default: '',
				description:
					'Name of the new brand-library image, followed by "(no background)". Default: the file name, or "Image".',
			},
			{
				displayName: 'Download Result',
				name: 'download',
				type: 'boolean',
				default: false,
				description: 'Whether to also download the transparent PNG as binary data (data)',
			},
		],
	},
];

export const audioOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['audio'] } },
		options: [
			{
				name: 'Transcribe',
				value: 'transcribe',
				description:
					'Turn the speech in an audio file or a video into subtitle cues, SRT and WebVTT. Costs 1 AI credit per minute.',
				action: 'Transcribe audio or video',
			},
		],
		default: 'transcribe',
	},
];

const transcribe = { resource: ['audio'], operation: ['transcribe'] };

export const audioFields: INodeProperties[] = [
	...fileInput(
		{ show: transcribe },
		{
			label: 'Audio or Video',
			placeholder: 'https://example.com/audio/voiceover.mp3',
			urlDescription:
				'An MP3, M4A, WAV or Ogg file, or an MP4 or WebM video with sound, up to 100 MB',
		},
	),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: transcribe },
		options: [
			{
				displayName: 'Duration (Seconds)',
				name: 'duration',
				type: 'number',
				default: 60,
				typeOptions: { minValue: 0.5, numberPrecision: 2 },
				description: 'How many seconds to transcribe (default: to the end)',
			},
			{
				displayName: 'Include Word Timings',
				name: 'words',
				type: 'boolean',
				default: false,
				description: 'Whether to also return each word with its start and end time',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'e.g. en',
				description: 'ISO 639-1 code of the spoken language. Detected when empty.',
			},
			{
				displayName: 'Max Characters per Line',
				name: 'maxCharsPerLine',
				type: 'number',
				default: 42,
				typeOptions: { minValue: 12, maxValue: 80 },
			},
			{
				displayName: 'Max Lines per Cue',
				name: 'maxLines',
				type: 'number',
				default: 2,
				typeOptions: { minValue: 1, maxValue: 3 },
			},
			{
				displayName: 'Offset (Seconds)',
				name: 'offset',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
				description: 'Seconds added to every cue: where Start lands on your video’s timeline',
			},
			{
				displayName: 'Start (Seconds)',
				name: 'start',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberPrecision: 2 },
				description: 'Seconds into the file to start from',
			},
			{
				displayName: 'Style',
				name: 'style',
				type: 'options',
				default: 'standard',
				options: [
					{
						name: 'Standard',
						value: 'standard',
						description: 'Up to 2 lines of 42 characters',
					},
					{
						name: 'Short',
						value: 'short',
						description: 'One line of up to 24 characters, for vertical social video',
					},
				],
			},
		],
	},
];
