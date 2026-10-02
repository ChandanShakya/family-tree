import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { transferOwnership } from '$lib/server/members.js';
import { badInput, gateTree, openGate } from '$lib/server/tree-route.js';

const Body = z.object({ userId: z.uuid({ error: 'Valid userId is required' }) });

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'transferDelete');
		if (g instanceof Response) return g;
		const body = await event.request.json().catch(() => null);
		const parsed = Body.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const res = transferOwnership(gate.db, treeId, parsed.data.userId);
		if ('error' in res) {
			if (res.error === 'NOT_FOUND' || res.error === 'NOT_MEMBER') {
				return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
			}
			return json({ error: { code: 'VALIDATION', message: 'Already the owner' } }, { status: 400 });
		}
		return json({ data: { message: 'Ownership transferred' } });
	} finally {
		gate.release();
	}
};
