import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { relatives } from '$lib/server/graph.js';
import { openOptionalGate, readEntity } from '$lib/server/tree-route.js';

// allowPublic: ids only, so the structure of a public tree is visible while living people stay "Living".
export const GET: RequestHandler = async (event) => {
	const gate = openOptionalGate(event);
	try {
		const id = event.params.id as string;
		const r = readEntity(gate, 'person', id);
		if (r instanceof Response) return r;
		return json({ data: relatives(gate.raw, r.treeId, id) });
	} finally {
		gate.release();
	}
};
