import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { MAX_TRAVERSAL_DEPTH } from '$lib/config.js';
import { saveSettings } from '$lib/server/combined.js';
import { badInput, openGate } from '$lib/server/tree-route.js';

const Schema = z.object({
	share: z.enum(['me', 'chosen', 'members']),
	depth: z.number().int().min(1).max(MAX_TRAVERSAL_DEPTH).nullable(),
	viewers: z.array(z.string().uuid()).max(200)
});

/** The caller's own combined-view sharing settings. */
export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const parsed = Schema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const res = saveSettings(gate, gate.userId, parsed.data);
		if ('error' in res) return badInput('You can only share with members of your trees');
		return json({ data: { message: 'Saved' } });
	} finally {
		gate.release();
	}
};
