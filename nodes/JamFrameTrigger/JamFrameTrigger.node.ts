import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { BRAND } from '../../shared/brand';
import { sameEvents, verifyWebhookSignature, WEBHOOK_EVENTS } from '../../shared/helpers';
import { apiRequest } from '../../shared/transport';

interface StaticData extends IDataObject {
	subscriptionId?: string;
	signingSecret?: string;
}

/**
 * REST hooks: activating the workflow subscribes n8n's webhook URL with
 * `POST /v1/webhooks/subscriptions` and keeps the subscription id and
 * its signing secret (shown once) in the node's static data; deactivating
 * deletes the subscription. Every delivery's `X-Webhook-Signature` is checked
 * against that secret before the workflow runs.
 */
export class JamFrameTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'JamFrame Trigger',
		name: 'jamFrameTrigger',
		icon: { light: 'file:../../icons/jamframe.svg', dark: 'file:../../icons/jamframe.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when a render job ends, a social post goes out, a template changes or a workflow run ends',
		defaults: { name: `${BRAND.displayName} Trigger` },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'jamFrameApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'The API only delivers to public addresses (HTTPS in production): n8n’s webhook URL must be reachable from the internet, not localhost',
				name: 'publicUrlNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['render.completed'],
				options: WEBHOOK_EVENTS.map((event) => ({ ...event })),
				description: 'The events that start the workflow',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Verify Signature',
						name: 'verifySignature',
						type: 'boolean',
						default: true,
						description:
							'Whether to refuse deliveries whose X-Webhook-Signature doesn’t match the subscription’s signing secret (or is more than 5 minutes old)',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			/** Is the stored subscription still there, for this URL and these events, with a known secret? */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as StaticData;
				if (!data.subscriptionId || !data.signingSecret) return false;
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events') as string[];
				let subscription: { url: string; events: string[]; status?: string } | undefined;
				try {
					const body = (await apiRequest.call(
						this,
						'GET',
						`/webhooks/subscriptions/${encodeURIComponent(data.subscriptionId)}`,
					)) as unknown as { subscription: { url: string; events: string[]; status?: string } };
					subscription = body.subscription;
				} catch (error) {
					if (error instanceof NodeApiError && error.httpCode === '404') {
						delete data.subscriptionId;
						delete data.signingSecret;
						return false;
					}
					throw new NodeApiError(this.getNode(), error as JsonObject);
				}
				if (
					subscription.url === webhookUrl &&
					sameEvents(subscription.events, events) &&
					(subscription.status === undefined || subscription.status === 'active')
				) {
					return true;
				}
				// The URL or the events changed, or the API suspended the subscription
				// after repeated failed deliveries (it sends nothing more until it is
				// re-activated): drop it so `create` makes a working one.
				await apiRequest.call(
					this,
					'DELETE',
					`/webhooks/subscriptions/${encodeURIComponent(data.subscriptionId)}`,
				);
				delete data.subscriptionId;
				delete data.signingSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl)
					throw new NodeOperationError(this.getNode(), 'n8n has no webhook URL for this node');
				const events = this.getNodeParameter('events') as string[];
				if (!events.length)
					throw new NodeOperationError(this.getNode(), 'Choose at least one event');
				const body = (await apiRequest.call(this, 'POST', '/webhooks/subscriptions', {
					body: { url: webhookUrl, events },
				})) as unknown as { subscription: { id: string }; signingSecret: string };
				const data = this.getWorkflowStaticData('node') as StaticData;
				data.subscriptionId = body.subscription.id;
				data.signingSecret = body.signingSecret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as StaticData;
				if (data.subscriptionId) {
					try {
						await apiRequest.call(
							this,
							'DELETE',
							`/webhooks/subscriptions/${encodeURIComponent(data.subscriptionId)}`,
						);
					} catch (error) {
						// Already gone (deleted in the app, or after a 410): nothing left to clean up.
						if (!(error instanceof NodeApiError && error.httpCode === '404')) {
							throw new NodeApiError(this.getNode(), error as JsonObject);
						}
					}
				}
				delete data.subscriptionId;
				delete data.signingSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const headers = this.getHeaderData() as Record<string, string | string[] | undefined>;
		const options = this.getNodeParameter('options', {}) as { verifySignature?: boolean };

		if (options.verifySignature !== false) {
			const data = this.getWorkflowStaticData('node') as StaticData;
			// Only the bytes as received can be checked. Without n8n's raw body the
			// delivery is refused: re-serialising the parsed body would check
			// different bytes from the ones that were signed.
			const check = verifyWebhookSignature({
				payload: request.rawBody as Buffer | undefined,
				header: headers['x-webhook-signature'],
				secret: data.signingSecret,
			});
			if (!check.ok) {
				const response = this.getResponseObject();
				response.status(401).json({ error: 'INVALID_SIGNATURE', reason: check.reason });
				return { noWebhookResponse: true };
			}
		}

		const envelope = this.getBodyData() as IDataObject;
		const deliveryId = headers['x-webhook-delivery'];
		return {
			workflowData: [
				this.helpers.returnJsonArray({
					...envelope,
					deliveryId: Array.isArray(deliveryId) ? deliveryId[0] : (deliveryId ?? null),
				}),
			],
		};
	}
}
