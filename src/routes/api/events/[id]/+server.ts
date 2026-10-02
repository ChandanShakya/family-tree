import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EventUpdateSchema } from '$lib/schemas/events.js';
import { deleteEvent, updateEvent } from '$lib/server/events.js';
import { badInput, gateEntity, openGate } from '$lib/server/tree-route.js';

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'event', id, 'add');
		if (g instanceof Response) return g;
		const body = await event.request.json().catch(() => null);
		const parsed = EventUpdateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const res = updateEvent(gate, gate.userId, id, {
			type: parsed.data.type,
			date: parsed.data.date,
			dateCal: parsed.data.dateCal,
			place: parsed.data.place,
			description: parsed.data.description
		});
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { message: 'Event updated', batchId: res.batchId ?? null } });
	} finally {
		gate.release();
	}
};

export const DELETE: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'event', id, 'delete');
		if (g instanceof Response) return g;
		const res = deleteEvent(gate, gate.userId, id);
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { message: 'Event deleted', batchId: res.batchId } });
	} finally {
		gate.release();
	}
};
