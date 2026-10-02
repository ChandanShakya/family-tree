import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { RATE_LIMITS } from '$lib/config.js';
import { checkRateLimit } from '$lib/server/rate-limit.js';
import { logout } from '$lib/server/accounts.js';
import { clearSessionCookie, clientIp } from '$lib/server/api.js';

export const POST: RequestHandler = async (event) => {
	const ip = clientIp(event);
	if (!checkRateLimit(`logout:${ip}`, RATE_LIMITS.logout.limit, RATE_LIMITS.logout.windowMs)) {
		return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		logout(db, event.cookies.get('session'));
		clearSessionCookie(event);
		return json({ data: { message: 'Logged out' } });
	} finally {
		raw.close();
	}
};
