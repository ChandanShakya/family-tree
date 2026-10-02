import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EventCreateSchema } from '$lib/schemas/events.js';
import { createEvent } from '$lib/server/events.js';
import { badInput, gateTree, openGate } from '$lib/server/tree-route.js';

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const body = await event.request.json().catch(() => null);
		const parsed = EventCreateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const g = gateTree(gate, parsed.data.treeId, 'add');
		if (g instanceof Response) return g;
		const res = createEvent(gate, gate.userId, parsed.data.treeId, {
			personId: parsed.data.personId,
			type: parsed.data.type,
			date: parsed.data.date,
			dateCal: parsed.data.dateCal,
			place: parsed.data.place,
			description: parsed.data.description
		});
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { id: res.id, batchId: res.batchId } }, { status: 201 });
	} finally {
		gate.release();
	}
};
