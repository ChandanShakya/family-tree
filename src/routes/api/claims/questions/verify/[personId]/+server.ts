import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { LOCKOUT_TIERS, RATE_LIMITS } from '$lib/config.js';
import { openDb } from '$lib/db/index.js';
import { VerifySchema } from '$lib/schemas/collab.js';
import { apiError, clientIp } from '$lib/server/api.js';
import { claimAudience, verifyAnswers } from '$lib/server/claims.js';
import { checkRateLimit, isBlocked, recordFailure } from '$lib/server/rate-limit.js';

// Answers are limited per (user, person) in claimAttempts (5/24 h), 20/hour/IP, and by lockout tiers per IP.
export const PUT: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return apiError(401, 'UNAUTHENTICATED', 'Not signed in');
	const ip = clientIp(event);
	const blocked = isBlocked(`lock:verify:${ip}`);
	if (blocked > 0) return apiError(429, 'LOCKED', 'Too many failed attempts', { retryAfter: Math.ceil(blocked / 1000) });
	if (!checkRateLimit(`verify:${ip}`, RATE_LIMITS.verify.limit, RATE_LIMITS.verify.windowMs)) {
		return apiError(429, 'RATE_LIMITED', 'Too many requests', { retryAfter: 3600 });
	}
	const parsed = VerifySchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const personId = event.params.personId as string;
		const p = raw.prepare(`SELECT treeId FROM visible_persons WHERE id = ?`).get(personId) as { treeId: string } | undefined;
		if (!p || !claimAudience(db, user.id, p.treeId, parsed.data.code)) return apiError(404, 'NOT_FOUND', 'Not found');
		const r = verifyAnswers({ raw, db }, user.id, p.treeId, personId, parsed.data.answers);
		if (r.ok && r.claimed) return json({ data: { claimed: true, status: 'auto_approved' } });
		if (r.ok) return apiError(409, r.reason, r.reason === 'ALREADY_CLAIMED' ? 'This person is already claimed' : 'You are already linked to a person in this tree');
		if (r.error === 'WRONG') {
			recordFailure(`lock:verify:${ip}`, LOCKOUT_TIERS);
			return apiError(403, 'FORBIDDEN', 'The answers did not match');
		}
		if (r.error === 'LOCKED') return apiError(429, 'LOCKED', 'Too many attempts for this person', { retryAfter: r.retryAfterSec });
		if (r.error === 'NOT_ENOUGH_QUESTIONS') return apiError(409, 'VALIDATION', 'This person cannot be claimed by answering questions');
		return apiError(404, 'NOT_FOUND', 'Not found');
	} finally {
		raw.close();
	}
};
