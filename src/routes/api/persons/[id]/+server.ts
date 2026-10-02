import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonUpdateSchema } from '$lib/schemas/persons.js';
import { deletePerson, getPerson, updatePerson } from '$lib/server/persons.js';
import { publicPerson } from '$lib/server/public-access.js';
import { badInput, gateEntity, openGate, openOptionalGate, readEntity } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openOptionalGate(event);
	try {
		const id = event.params.id as string;
		const r = readEntity(gate, 'person', id);
		if (r instanceof Response) return r;
		const person = r.mode === 'public' ? publicPerson(gate, id) : getPerson(gate, id);
		if (!person) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: person });
	} finally {
		gate.release();
	}
};

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'person', id, 'add');
		if (g instanceof Response) return g;
		const body = await event.request.json().catch(() => null);
		const parsed = PersonUpdateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const { version, ...patch } = parsed.data;
		const res = updatePerson(gate, gate.userId, id, version, patch);
		if ('error' in res) {
			if (res.error === 'NOT_FOUND') {
				return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
			}
			return json(
				{ error: { code: 'VERSION_CONFLICT', message: 'Stale version', current: res.current } },
				{ status: 409 }
			);
		}
		return json({ data: { version: res.version, batchId: res.batchId ?? null } });
	} finally {
		gate.release();
	}
};

export const DELETE: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'person', id, 'delete');
		if (g instanceof Response) return g;
		const res = deletePerson(gate, gate.userId, id);
		if ('error' in res) {
			return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		}
		return json({ data: { message: 'Person deleted', batchId: res.batchId } });
	} finally {
		gate.release();
	}
};
