import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TreeCreateSchema } from '$lib/schemas/trees.js';
import { createTree, getTreeRow, listUserTrees } from '$lib/server/trees.js';
import { listMembers } from '$lib/server/members.js';
import { badInput, openGate } from '$lib/server/tree-route.js';

export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const data = listUserTrees(gate.db, gate.userId);
		return json({ data });
	} finally {
		gate.release();
	}
};

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const body = await event.request.json().catch(() => null);
		const parsed = TreeCreateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const { id, joinCode } = createTree(gate, gate.userId, {
			name: parsed.data.name,
			description: parsed.data.description
		});
		const tree = getTreeRow(gate.db, id);
		const members = listMembers(gate.db, id);
		return json({ data: { tree, members, joinCode } }, { status: 201 });
	} finally {
		gate.release();
	}
};
