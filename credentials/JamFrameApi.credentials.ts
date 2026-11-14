import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { BRAND } from '../shared/brand';

/**
 * A workspace API key (`jf_live_…`) and the API's base URL. Every request
 * sends `Authorization: Bearer <key>`; the test calls `POST /v1/auth`,
 * which answers 200 for a valid key.
 */
export class JamFrameApi implements ICredentialType {
	name = 'jamFrameApi';

	displayName = 'JamFrame API';

	icon: Icon = { light: 'file:../icons/jamframe.svg', dark: 'file:../icons/jamframe.dark.svg' };

	documentationUrl =
		'https://github.com/JamFrame-com/n8n-nodes-jamframe?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: BRAND.apiKeysHint,
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: BRAND.defaultBaseUrl,
			description:
				'The API’s address, without /v1. Change it only for a staging or self-hosted instance.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "").replace(/(\\/api)?\\/v1$/, "")}}',
			url: '/v1/auth',
			method: 'POST',
		},
	};
}
