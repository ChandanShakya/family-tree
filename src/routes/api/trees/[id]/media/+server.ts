import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTreeMedia } from '$lib/server/media.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const g = gateTree(gate, event.params.id as string, 'view');
		if (g instanceof Response) return g;
		const cursor = event.url.searchParams.get('cursor') ?? undefined;
		return json(listTreeMedia(gate, event.params.id as string, cursor));
	} finally {
		gate.release();
	}
};
