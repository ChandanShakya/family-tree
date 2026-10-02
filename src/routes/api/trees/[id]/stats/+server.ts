import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { treeStats } from '$lib/server/trees.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'view');
		if (g instanceof Response) return g;
		const stats = treeStats(gate, treeId);
		if (!stats) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: stats });
	} finally {
		gate.release();
	}
};
