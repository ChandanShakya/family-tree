import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { LoginSchema } from '$lib/schemas/auth.js';
import { login } from '$lib/server/accounts.js';
import { clientIp, errorJson, setSessionCookie } from '$lib/server/api.js';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => null);
	const parsed = LoginSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{ error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
			{ status: 400 }
		);
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const res = await login(
			db,
			{ email: parsed.data.email, password: parsed.data.password },
			{ ip: clientIp(event), userAgent: event.request.headers.get('user-agent') }
		);
		if (!res.ok) return errorJson(res);
		setSessionCookie(event, res.token);
		return json({ data: { message: 'Logged in' } });
	} finally {
		raw.close();
	}
};
