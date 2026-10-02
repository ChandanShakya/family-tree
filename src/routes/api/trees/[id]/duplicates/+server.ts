import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duplicateFinder } from '$lib/server/search.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'view');
		if (g instanceof Response) return g;
		return json({ data: duplicateFinder(gate, treeId) });
	} finally {
		gate.release();
	}
};
