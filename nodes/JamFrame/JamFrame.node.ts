import type {
	IDataObject,
	JsonObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { BRAND } from '../../shared/brand';
import { runOperation } from './actions';
import { designFields, designOperations } from './descriptions/DesignDescription';
import {
	audioFields,
	audioOperations,
	imageFields,
	imageOperations,
} from './descriptions/MediaDescription';
import { renderFields, renderOperations } from './descriptions/RenderDescription';
import { renderJobFields, renderJobOperations } from './descriptions/RenderJobDescription';
import {
	socialAccountOperations,
	socialAnalyticsFields,
	socialAnalyticsOperations,
	socialPostFields,
	socialPostOperations,
} from './descriptions/SocialDescription';
import {
	workflowFields,
	workflowOperations,
	workflowRunFields,
	workflowRunOperations,
} from './descriptions/WorkflowDescription';
import { listSearch, loadOptions, resourceMapping } from './methods';

/**
 * Programmatic style: the template picker, the parameter mapper and job
 * polling need code that declarative routing can't express.
 */
export class JamFrame implements INodeType {
	description: INodeTypeDescription = {
		displayName: BRAND.displayName,
		name: 'jamFrame',
		icon: { light: 'file:../../icons/jamframe.svg', dark: 'file:../../icons/jamframe.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Render images, carousels, PDFs and videos from templates, post them to social accounts, and run workflows',
		defaults: { name: BRAND.displayName },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'jamFrameApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Audio', value: 'audio' },
					{ name: 'Image', value: 'image' },
					{ name: 'Render', value: 'render' },
					{ name: 'Render Job', value: 'renderJob' },
					{ name: 'Social Account', value: 'socialAccount' },
					{ name: 'Social Analytics Report', value: 'socialAnalytics' },
					{ name: 'Social Post', value: 'socialPost' },
					{ name: 'Template', value: 'design' },
					{ name: 'Workflow', value: 'workflow' },
					{ name: 'Workflow Run', value: 'workflowRun' },
				],
				default: 'render',
			},
			...renderOperations,
			...renderFields,
			...renderJobOperations,
			...renderJobFields,
			...designOperations,
			...designFields,
			...imageOperations,
			...imageFields,
			...audioOperations,
			...audioFields,
			...socialAccountOperations,
			...socialPostOperations,
			...socialPostFields,
			...socialAnalyticsOperations,
			...socialAnalyticsFields,
			...workflowOperations,
			...workflowFields,
			...workflowRunOperations,
			...workflowRunFields,
		],
	};

	methods = { listSearch, loadOptions, resourceMapping };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const output = await runOperation.call(this, resource, operation, i);
				returnData.push(...(Array.isArray(output) ? output : [output]));
			} catch (error) {
				if (this.continueOnFail()) {
					const detail = (error as { description?: string }).description;
					returnData.push({
						json: { error: (error as Error).message, ...(detail ? { detail } : {}) } as IDataObject,
						pairedItem: { item: i },
					});
					continue;
				}
				// Both constructors hand back an error that is already theirs, so nothing is double-wrapped.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [returnData];
	}
}
