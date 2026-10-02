import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { treeActivity } from '$lib/server/trees.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'view');
		if (g instanceof Response) return g;
		const cursor = event.url.searchParams.get('cursor') ?? undefined;
		const page = treeActivity(gate.raw, treeId, cursor);
		return json({ data: page.data, nextCursor: page.nextCursor });
	} finally {
		gate.release();
	}
};
