import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { relationPath } from '$lib/server/graph.js';
import { badInput, openOptionalGate, readEntity } from '$lib/server/tree-route.js';
import { resolveTreeId } from '$lib/server/permissions.js';

export const GET: RequestHandler = async (event) => {
	const gate = openOptionalGate(event);
	try {
		const id = event.params.id as string;
		const otherId = event.url.searchParams.get('to');
		if (!otherId) return badInput('Query parameter "to" is required');
		const g = readEntity(gate, 'person', id);
		if (g instanceof Response) return g;
		const otherTree = resolveTreeId(gate.db, 'person', otherId);
		if (!otherTree || otherTree !== g.treeId) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		const rel = relationPath(gate.raw, g.treeId, id, otherId);
		if (!rel) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: rel });
	} finally {
		gate.release();
	}
};
