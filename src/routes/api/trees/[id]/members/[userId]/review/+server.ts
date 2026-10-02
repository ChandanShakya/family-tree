import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MemberReviewSchema } from '$lib/schemas/collab.js';
import { apiError } from '$lib/server/api.js';
import { reviewMember } from '$lib/server/codes.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

export const POST: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.params.id as string;
		const g = gateTree(gate, treeId, 'review');
		if (g instanceof Response) return g;
		const parsed = MemberReviewSchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
		const r = reviewMember(gate, gate.userId, treeId, event.params.userId as string, parsed.data.decision);
		return r.ok ? json({ data: { message: parsed.data.decision === 'approve' ? 'Member approved' : 'Request rejected' } }) : apiError(404, 'NOT_FOUND', 'Not found');
	} finally {
		gate.release();
	}
};
