import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { JoinCodeCreateSchema } from '$lib/schemas/collab.js';
import { apiError } from '$lib/server/api.js';
import { isEmailVerified } from '$lib/server/accounts.js';
import { createDirectCode } from '$lib/server/codes.js';
import { regenerateFamilyCode } from '$lib/server/join-codes.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

// Direct code (any non-viewer, capped at the creator's role) or family-code regeneration (owner/editor).
export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const parsed = JoinCodeCreateSchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
		const input = parsed.data;
		const g = gateTree(gate, input.treeId, input.type === 'family' ? 'manageFamilyCode' : 'createDirectCode');
		if (g instanceof Response) return g;
		if (!isEmailVerified(gate.db, gate.userId)) {
			return apiError(403, 'FORBIDDEN', 'Verify your email before generating join codes');
		}
		if (input.type === 'family') {
			const res = regenerateFamilyCode(gate.db, input.treeId, gate.userId, input.expiresAt ?? null);
			return 'error' in res ? apiError(404, 'NOT_FOUND', 'Not found') : json({ data: res }, { status: 201 });
		}
		const res = createDirectCode(gate, gate.userId, g.role, input.treeId, input);
		if ('error' in res) {
			if (res.error === 'ROLE_TOO_HIGH') return apiError(403, 'FORBIDDEN', 'A code cannot grant a role above your own');
			if (res.error === 'ALREADY_CLAIMED') return apiError(409, 'DUPLICATE', 'That person is already claimed');
			return apiError(404, 'NOT_FOUND', 'Not found');
		}
		return json({ data: res }, { status: 201 });
	} finally {
		gate.release();
	}
};
