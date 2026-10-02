import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { RelationshipCreateSchema } from '$lib/schemas/relationships.js';
import { createLink } from '$lib/server/relations.js';
import { badInput, gateTree, openGate } from '$lib/server/tree-route.js';

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const body = await event.request.json().catch(() => null);
		const parsed = RelationshipCreateSchema.safeParse(body);
		if (!parsed.success) return badInput(parsed.error.issues[0]?.message ?? 'Invalid input');
		const g = gateTree(gate, parsed.data.treeId, 'add');
		if (g instanceof Response) return g;
		const res = createLink(gate, gate.userId, parsed.data.treeId, {
			person1Id: parsed.data.person1Id,
			person2Id: parsed.data.person2Id,
			type: parsed.data.type,
			startDate: parsed.data.startDate,
			endDate: parsed.data.endDate,
			notes: parsed.data.notes
		});
		if ('error' in res) {
			const status =
				res.error === 'NOT_FOUND' ? 404 : res.error === 'GRAPH_TOO_DEEP' || res.error === 'CYCLE' || res.error === 'DUPLICATE' ? 409 : 400;
			const code =
				res.error === 'NOT_FOUND'
					? 'NOT_FOUND'
					: res.error === 'GRAPH_TOO_DEEP'
						? 'GRAPH_TOO_DEEP'
						: res.error === 'CYCLE'
							? 'CYCLE'
							: res.error === 'DUPLICATE'
								? 'DUPLICATE'
								: 'VALIDATION';
			return json({ error: { code, message: messageFor(res.error) } }, { status });
		}
		return json(
			{ data: { id: res.id, batchId: res.batchId, ...(res.parentWarning ? { parentWarning: true } : {}) } },
			{ status: 201 }
		);
	} finally {
		gate.release();
	}
};

function messageFor(code: string): string {
	switch (code) {
		case 'NOT_FOUND':
			return 'Not found';
		case 'SELF_LINK':
			return 'A person cannot be linked to themselves';
		case 'DUPLICATE':
			return 'Relationship already exists';
		case 'CYCLE':
			return 'Link would create a cycle';
		case 'GRAPH_TOO_DEEP':
			return 'Link would exceed the traversal depth cap';
		case 'SHARED_PARENTS':
			return 'Siblings through shared parents are derived, not stored';
		default:
			return 'Invalid input';
	}
}
