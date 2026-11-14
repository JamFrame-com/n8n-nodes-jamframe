import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

import { BRAND } from '../../../shared/brand';

/** The template picker: workspace templates, then the template library; or an id. */
export function templateLocator(
	displayOptions: IDisplayOptions,
	description: string,
): INodeProperties {
	return {
		displayName: 'Template',
		name: 'templateId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description,
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a template…',
				typeOptions: {
					searchListMethod: 'searchTemplates',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. clx8m2k3p0001abcd1234efgh',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[A-Za-z0-9_-]{1,64}$', errorMessage: 'Not a valid template ID' },
					},
				],
			},
		],
	};
}

/** The workflow picker (workflows made in the app); or an id. */
export function workflowLocator(displayOptions: IDisplayOptions): INodeProperties {
	return {
		displayName: 'Workflow',
		name: 'workflowId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: `A ${BRAND.displayName} workflow, made in the app under Workflows`,
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a workflow…',
				typeOptions: { searchListMethod: 'searchWorkflows', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. cmw936lao0000hgw5xnjex7g5',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[A-Za-z0-9_-]{1,64}$', errorMessage: 'Not a valid workflow ID' },
					},
				],
			},
		],
	};
}

/**
 * Where an uploaded file comes from: a public URL the API downloads, or a
 * binary property of the input item (sent as a multipart upload).
 */
export function fileInput(
	displayOptions: IDisplayOptions,
	what: { label: string; urlDescription: string; placeholder: string },
): INodeProperties[] {
	const show = displayOptions.show ?? {};
	return [
		{
			displayName: 'Input',
			name: 'inputType',
			type: 'options',
			default: 'url',
			displayOptions,
			options: [
				{ name: 'URL', value: 'url', description: 'A public address the API downloads' },
				{
					name: 'Binary File',
					value: 'binary',
					description: 'A file of the input item, e.g. from Read Binary File or an HTTP Request',
				},
			],
		},
		{
			displayName: `${what.label} URL`,
			name: 'fileUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: what.placeholder,
			description: what.urlDescription,
			displayOptions: { show: { ...show, inputType: ['url'] } },
		},
		{
			displayName: 'Input Binary Field',
			name: 'binaryPropertyName',
			type: 'string',
			required: true,
			default: 'data',
			hint: 'The name of the input item’s binary field that holds the file',
			displayOptions: { show: { ...show, inputType: ['binary'] } },
		},
	];
}

/**
 * The template's parameters (`GET /designs/{id}`) as fields. Blank fields
 * keep the template's own value. Hidden until a template is picked: n8n shows
 * a red "no fields" error whenever the list is empty.
 */
export function parameterMapper(displayOptions: IDisplayOptions): INodeProperties {
	return {
		displayName: 'Template Parameters',
		name: 'parameters',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		description:
			'The values to fill in. Fields left empty keep the template’s own content. Image, video and audio fields take a public URL.',
		displayOptions: {
			...displayOptions,
			show: { ...displayOptions.show, templateId: [{ _cnd: { exists: true } }] },
		},
		typeOptions: {
			loadOptionsDependsOn: ['templateId.value'],
			resourceMapper: {
				resourceMapperMethod: 'getTemplateParameters',
				mode: 'add',
				valuesLabel: 'Parameters',
				fieldWords: { singular: 'parameter', plural: 'parameters' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: true,
				noFieldsError:
					'This template has no parameters. Give layers a parameter key, or use {{placeholders}} in text, in the editor.',
			},
		},
	};
}

/** Free-form modification keys: one page (`page2@title`) or a style (`title.color`). */
export function extraModifications(displayOptions: IDisplayOptions): INodeProperties {
	return {
		displayName: 'Additional Modifications',
		name: 'extraModifications',
		type: 'fixedCollection',
		placeholder: 'Add Modification',
		default: {},
		typeOptions: { multipleValues: true },
		description:
			'Keys sent as they are, after the parameters above (and winning over them): page2@title sets one page of a carousel, title.color or title.fontSize overrides a style, audio.volume sets the soundtrack volume',
		displayOptions,
		options: [
			{
				displayName: 'Modification',
				name: 'modification',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						placeholder: 'e.g. page2@title',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	};
}
