import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { openDb } from '$lib/db/index.js';
import { apiError } from '$lib/server/api.js';
import { claimAudience, claimSearch } from '$lib/server/claims.js';

// "Find yourself": members, or holders of a valid code for that tree (§6.5).
export const GET: RequestHandler = async (event) => {
	const sp = event.url.searchParams;
	const treeId = sp.get('treeId') ?? '';
	const q = (sp.get('q') ?? '').trim().slice(0, 200);
	if (!treeId || !q) return apiError(400, 'VALIDATION', 'treeId and q are required');
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const audience = claimAudience(db, event.locals.user?.id ?? null, treeId, sp.get('code'));
		if (!audience) return apiError(404, 'NOT_FOUND', 'Not found');
		return json({ data: claimSearch({ raw, db }, treeId, q, audience) });
	} finally {
		raw.close();
	}
};
