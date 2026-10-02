import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ClaimReviewSchema } from '$lib/schemas/collab.js';
import { apiError } from '$lib/server/api.js';
import { reviewClaim } from '$lib/server/claims.js';
import { gateEntity, openGate } from '$lib/server/tree-route.js';

export const PUT: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const id = event.params.id as string;
		const g = gateEntity(gate, 'claim', id, 'review');
		if (g instanceof Response) return g;
		const parsed = ClaimReviewSchema.safeParse(await event.request.json().catch(() => null));
		if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
		const r = reviewClaim(gate, gate.userId, id, parsed.data);
		if (r.ok) return json({ data: { status: r.status } });
		const map: Record<string, [number, string]> = {
			NOT_FOUND: [404, 'Not found'],
			NOT_PENDING: [409, 'This claim was already reviewed'],
			ALREADY_CLAIMED: [409, 'This person is already claimed; the claim was rejected'],
			ALREADY_LINKED: [409, 'The claimant is already linked to another person; the claim was rejected'],
			LINK_FAILED: [409, 'The relationship could not be created']
		};
		const [status, message] = map[r.error] ?? [409, 'Conflict'];
		return apiError(status, status === 404 ? 'NOT_FOUND' : r.error === 'NOT_PENDING' ? 'DUPLICATE' : r.error, message);
	} finally {
		gate.release();
	}
};
