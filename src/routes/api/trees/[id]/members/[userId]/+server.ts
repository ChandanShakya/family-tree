import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MemberRoleSchema } from '$lib/schemas/trees.js';
import { changeMemberRole, removeMember } from '$lib/server/members.js';
import { badInput, gateTree, openGate } from '$lib/server/tree-route.js';

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const targetUserId = event.params.userId as string;
		const g = gateTree(gate, treeId, 'manageMembers');
		if (g instanceof Response) return g;
		const body = await event.request.json().catch(() => null);
		const parsed = MemberRoleSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const res = changeMemberRole(gate.db, treeId, targetUserId, parsed.data.role);
		if ('error' in res) {
			if (res.error === 'NOT_FOUND') {
				return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
			}
			return json(
				{ error: { code: 'FORBIDDEN', message: 'Ownership must be transferred first' } },
				{ status: 403 }
			);
		}
		return json({ data: { message: 'Role updated' } });
	} finally {
		gate.release();
	}
};

export const DELETE: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const targetUserId = event.params.userId as string;
		if (targetUserId === gate.userId) {
			// Leaving: any active member may remove themselves (owner excluded by service).
			const g = gateTree(gate, treeId, 'view');
			if (g instanceof Response) return g;
		} else {
			const g = gateTree(gate, treeId, 'manageMembers');
			if (g instanceof Response) return g;
		}
		const res = removeMember(gate.db, treeId, targetUserId);
		if ('error' in res) {
			if (res.error === 'NOT_FOUND') {
				return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
			}
			return json(
				{ error: { code: 'FORBIDDEN', message: 'Ownership must be transferred first' } },
				{ status: 403 }
			);
		}
		return json({ data: { message: 'Member removed' } });
	} finally {
		gate.release();
	}
};
