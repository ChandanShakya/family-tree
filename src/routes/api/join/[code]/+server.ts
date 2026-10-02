import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { openDb } from '$lib/db/index.js';
import { JoinRedeemSchema } from '$lib/schemas/collab.js';
import { apiError, clientIp } from '$lib/server/api.js';
import { JOIN_UNAVAILABLE, previewCode, redeemCode } from '$lib/server/codes.js';
import { codeFailed, guardCode } from '$lib/server/code-guard.js';

// "Not found" is a failure (lockout tiers, code-guard.ts); every unavailable code looks the same.
const unavailable = (): Response => apiError(404, JOIN_UNAVAILABLE, 'This code is not available');

function guard(ip: string): Response | null {
	const g = guardCode(ip);
	return g.ok ? null : apiError(429, g.code, g.code === 'LOCKED' ? 'Too many failed attempts' : 'Too many requests', { retryAfter: g.retryAfter });
}

function failed(ip: string): Response {
	codeFailed(ip);
	return unavailable();
}

export const GET: RequestHandler = async (event) => {
	const ip = clientIp(event);
	const g = guard(ip);
	if (g) return g;
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const p = previewCode(db, event.params.code as string);
		return p ? json({ data: p }) : failed(ip);
	} finally {
		raw.close();
	}
};

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return apiError(401, 'UNAUTHENTICATED', 'Not signed in');
	const ip = clientIp(event);
	const g = guard(ip);
	if (g) return g;
	const parsed = JoinRedeemSchema.safeParse(await event.request.json().catch(() => ({})));
	if (!parsed.success) return apiError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const r = redeemCode({ raw, db }, user.id, event.params.code as string, parsed.data);
		if (r.ok) return json({ data: { treeId: r.treeId, status: r.status, personId: r.personId } }, { status: 201 });
		if (r.error === JOIN_UNAVAILABLE) return failed(ip);
		if (r.error === 'ALREADY_MEMBER') return apiError(409, 'DUPLICATE', 'You are already a member of this tree');
		if (r.error === 'ALREADY_PENDING') return apiError(409, 'DUPLICATE', 'Your request to join is waiting for approval');
		return apiError(400, 'VALIDATION', 'Your first name is required');
	} finally {
		raw.close();
	}
};
