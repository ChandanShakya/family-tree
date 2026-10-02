import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { RATE_LIMITS } from '$lib/config.js';
import { openDb } from '$lib/db/index.js';
import { ClaimCreateSchema } from '$lib/schemas/collab.js';
import { apiError } from '$lib/server/api.js';
import { claimAudience, listClaims, submitClaim } from '$lib/server/claims.js';
import { checkRateLimit } from '$lib/server/rate-limit.js';
import { gateTree, openGate } from '$lib/server/tree-route.js';

// Pending claims of a tree (owner/editor review queue).
export const GET: RequestHandler = async (event) => {
	const gate = openGate(event);
	if (gate instanceof Response) return gate;
	try {
		const treeId = event.url.searchParams.get('treeId') ?? '';
		const g = gateTree(gate, treeId, 'review');
		if (g instanceof Response) return g;
		return json({ data: listClaims(gate.db, treeId, event.url.searchParams.get('status') ?? 'pending') });
	} finally {
		gate.release();
	}
};

// Submit a matching or manual claim: active members and holders of a valid code for that tree.
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return apiError(401, 'UNAUTHENTICATED', 'Not signed in');
	if (!checkRateLimit(`claims:${user.id}`, RATE_LIMITS.claims.limit, RATE_LIMITS.claims.windowMs)) {
		return apiError(429, 'RATE_LIMITED', 'Too many claims', { retryAfter: 3600 });
	}
	const parsed = ClaimCreateSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
	const { code, ...input } = parsed.data;
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		// Same answer for "not allowed" and "no such tree": existence is not disclosed.
		if (!claimAudience(db, user.id, input.treeId, code)) return apiError(404, 'NOT_FOUND', 'Not found');
		const r = submitClaim({ raw, db }, user.id, input);
		if (r.ok) return json({ data: { id: r.claimId, status: r.approved ? 'approved' : 'pending', matchScore: r.matchScore } }, { status: 201 });
		if (r.error === 'NOT_FOUND') return apiError(404, 'NOT_FOUND', 'Not found');
		if (r.error === 'DUPLICATE') return apiError(409, 'DUPLICATE', 'You already have a pending claim on this person');
		return apiError(409, r.error, r.error === 'ALREADY_CLAIMED' ? 'This person is already claimed' : 'You are already linked to a person in this tree');
	} finally {
		raw.close();
	}
};
