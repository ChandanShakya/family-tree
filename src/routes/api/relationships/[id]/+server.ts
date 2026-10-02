import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { RelationshipUpdateSchema } from '$lib/schemas/relationships.js';
import { deleteLink, updateLink } from '$lib/server/relations.js';
import { badInput, gateEntity, openGate } from '$lib/server/tree-route.js';

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'relationship', id, 'add');
		if (g instanceof Response) return g;
		const body = await event.request.json().catch(() => null);
		const parsed = RelationshipUpdateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const res = updateLink(gate, gate.userId, id, {
			startDate: parsed.data.startDate,
			endDate: parsed.data.endDate,
			notes: parsed.data.notes
		});
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { message: 'Relationship updated', batchId: res.batchId ?? null } });
	} finally {
		gate.release();
	}
};

export const DELETE: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'relationship', id, 'delete');
		if (g instanceof Response) return g;
		const res = deleteLink(gate, gate.userId, id);
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { message: 'Relationship deleted', batchId: res.batchId } });
	} finally {
		gate.release();
	}
};
