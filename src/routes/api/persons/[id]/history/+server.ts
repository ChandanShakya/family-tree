import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { personHistory } from '$lib/server/persons.js';
import { gateEntity, openGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'person', id, 'view');
		if (g instanceof Response) return g;
		const cursor = event.url.searchParams.get('cursor') ?? undefined;
		const page = personHistory(gate, id, cursor);
		return json({ data: page.data, nextCursor: page.nextCursor });
	} finally {
		gate.release();
	}
};
