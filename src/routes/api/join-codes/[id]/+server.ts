import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { joinCodes } from '$lib/db/schema.js';
import { apiError } from '$lib/server/api.js';
import { deactivateCode, roleRank } from '$lib/server/codes.js';
import { gateEntity, openGate } from '$lib/server/tree-route.js';

// The creator, an owner or an editor may deactivate a code (§9).
export const DELETE: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'joinCode', id, 'createDirectCode');
		if (g instanceof Response) return g;
		const row = gate.db.select().from(joinCodes).where(eq(joinCodes.id, id)).get();
		if (!row) return apiError(404, 'NOT_FOUND', 'Not found');
		if (row.createdBy !== gate.userId && roleRank(g.role) < roleRank('editor')) {
			return apiError(403, 'FORBIDDEN', 'Only the creator, an owner or an editor can deactivate this code');
		}
		deactivateCode(gate.db, id);
		return json({ data: { message: 'Code deactivated' } });
	} finally {
		gate.release();
	}
};
