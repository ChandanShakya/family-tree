import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { setMatch } from '$lib/server/combined.js';
import { badInput, openGate } from '$lib/server/tree-route.js';

const Schema = z.object({ personAId: z.string().uuid(), personBId: z.string().uuid(), same: z.boolean() });

/** The caller's verdict that two people in two of their trees are (not) the same person. */
export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const parsed = Schema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const res = setMatch(gate, gate.userId, parsed.data.personAId, parsed.data.personBId, parsed.data.same);
		if ('error' in res) return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
		return json({ data: { message: 'Saved' } });
	} finally {
		gate.release();
	}
};
