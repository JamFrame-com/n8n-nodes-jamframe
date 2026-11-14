import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';

import {
	decodeDesignToken,
	encodeDesignToken,
	matchesFilter,
	nextDesignPosition,
	sizeChoices,
	socialAccountLabel,
	type DesignListPosition,
} from '../../shared/helpers';
import { apiRequest } from '../../shared/transport';

interface DesignSummary {
	id: string;
	name: string;
	orientation?: string;
	pages?: number;
	/** A video template: render it as MP4. */
	animated?: boolean;
}

interface DesignDetail extends DesignSummary {
	pages: number;
	parameters: Array<{ key: string; type: string; pages: number[]; example: string }>;
	sizes: Array<{ id: string; name: string; width: number; height: number }>;
}

/** The selected template's id ('' when none is picked yet or it is an expression). */
function selectedTemplateId(context: ILoadOptionsFunctions): string {
	try {
		const value = context.getNodeParameter('templateId', '', { extractValue: true });
		return typeof value === 'string' ? value.trim() : '';
	} catch {
		return '';
	}
}

async function getDesign(context: ILoadOptionsFunctions, id: string): Promise<DesignDetail> {
	const body = (await apiRequest.call(
		context,
		'GET',
		`/designs/${encodeURIComponent(id)}`,
	)) as unknown as {
		design: DesignDetail;
	};
	return body.design;
}

/** At most this many API pages per search call, so a narrow filter can't page through everything at once. */
const MAX_PAGES_PER_SEARCH = 5;

export const listSearch = {
	/**
	 * Workspace templates first, then the template library ("Library: …").
	 * The API filters by name (`q`); the local check also covers servers
	 * from before `q`.
	 */
	async searchTemplates(
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		const results: INodeListSearchItems[] = [];
		const q = filter?.trim().slice(0, 100) || undefined;
		let position: DesignListPosition | null = decodeDesignToken(paginationToken);
		for (let pages = 0; position && pages < MAX_PAGES_PER_SEARCH && results.length < 25; pages++) {
			const page = (await apiRequest.call(this, 'GET', '/designs', {
				qs: {
					source: position.source,
					limit: 100,
					q,
					cursor: position.cursor ?? undefined,
				} as IDataObject,
			})) as unknown as {
				designs: DesignSummary[];
				pagination: { nextCursor: string | null; hasMore: boolean };
			};
			const prefix = position.source === 'library' ? 'Library: ' : '';
			for (const design of page.designs) {
				if (!matchesFilter(design.name, filter)) continue;
				const details = [
					design.orientation,
					design.animated ? 'video' : undefined,
					design.id,
				].filter(Boolean);
				results.push({
					name: `${prefix}${design.name}`,
					value: design.id,
					description: details.join(' · '),
				});
			}
			position = nextDesignPosition(position, page.pagination);
		}
		return position ? { results, paginationToken: encodeDesignToken(position) } : { results };
	},

	/** The workspace's workflows (the API lists up to 200, most recently changed first), filtered by name. */
	async searchWorkflows(
		this: ILoadOptionsFunctions,
		filter?: string,
	): Promise<INodeListSearchResult> {
		const { workflows } = (await apiRequest.call(this, 'GET', '/workflows')) as unknown as {
			workflows: Array<{
				id: string;
				name: string;
				status: string;
				trigger?: { summary?: string };
			}>;
		};
		return {
			results: workflows
				.filter((workflow) => matchesFilter(workflow.name, filter))
				.map((workflow) => ({
					name: workflow.name,
					value: workflow.id,
					description: [workflow.status, workflow.trigger?.summary, workflow.id]
						.filter(Boolean)
						.join(' · '),
				})),
		};
	},

	/** The template's saved sizes, then the size names every template accepts. */
	async searchSizes(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
		const id = selectedTemplateId(this);
		const saved = id ? (await getDesign(this, id)).sizes : [];
		return { results: sizeChoices(saved) };
	},
};

export const loadOptions = {
	async getSizes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const id = selectedTemplateId(this);
		const saved = id ? (await getDesign(this, id)).sizes : [];
		return sizeChoices(saved);
	},

	async getSocialAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const body = (await apiRequest.call(this, 'GET', '/social/accounts')) as unknown as {
			accounts: Array<{
				id: string;
				name: string;
				username: string | null;
				platform: string;
				platformName: string;
				status: string;
				sandbox: boolean;
			}>;
		};
		return body.accounts.map((account) => ({
			name: socialAccountLabel(account),
			value: account.id,
			description:
				account.status === 'needs_reconnect'
					? 'Can’t post until it is reconnected in the app'
					: account.sandbox
						? 'Sandbox account: posting is simulated'
						: account.platformName,
		}));
	},
};

const TYPE_LABEL: Record<string, string> = {
	text: 'text',
	image: 'image URL',
	video: 'video URL',
	audio: 'audio URL',
	qr: 'QR code value',
	shape: 'colour',
	subtitles: 'SRT/WebVTT text or URL',
	variable: 'placeholder',
};

export const resourceMapping = {
	/** One optional field per template parameter (`GET /designs/{id}`). */
	async getTemplateParameters(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		const id = selectedTemplateId(this);
		if (!id) return { fields: [], emptyFieldsNotice: 'Pick a template to see its parameters.' };
		const design = await getDesign(this, id);
		const fields: ResourceMapperField[] = design.parameters.map((parameter) => {
			const pages = parameter.pages.length
				? `, page${parameter.pages.length > 1 ? 's' : ''} ${parameter.pages.join(', ')}`
				: '';
			return {
				id: parameter.key,
				displayName: `${parameter.key} (${TYPE_LABEL[parameter.type] ?? parameter.type}${pages})`,
				required: false,
				defaultMatch: false,
				canBeUsedToMatch: false,
				display: true,
				type: 'string',
			};
		});
		// A template without parameters gets the mapper's `noFieldsError`; a notice here would repeat it.
		return { fields };
	},
};
