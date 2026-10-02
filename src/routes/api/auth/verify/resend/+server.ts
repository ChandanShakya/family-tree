import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { resendVerification } from '$lib/server/accounts.js';
import { baseUrl, errorJson } from '$lib/server/api.js';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const res = resendVerification(db, user.id, { baseUrl: baseUrl(event) });
		if (!res.ok) return errorJson(res);
		return json({ data: { message: res.message } });
	} finally {
		raw.close();
	}
};
