import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDirectCodes } from '$lib/server/codes.js';
import { getFamilyCode } from '$lib/server/join-codes.js';
import { canDo, type Role } from '$lib/server/permissions.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

// The family code (owner/editor only) and the caller's own direct codes.
export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'createDirectCode');
		if (g instanceof Response) return g;
		const c = canDo(g.role as Role, 'manageFamilyCode') ? getFamilyCode(gate.db, treeId) : null;
		return json({
			data: {
				familyCode: c ? { id: c.id, code: c.code, maxUses: c.maxUses, currentUses: c.currentUses, expiresAt: c.expiresAt } : null,
				directCodes: listDirectCodes(gate.db, treeId, gate.userId)
			}
		});
	} finally {
		gate.release();
	}
};
