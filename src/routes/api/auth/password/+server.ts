import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { PasswordChangeSchema } from '$lib/schemas/auth.js';
import { changePassword } from '$lib/server/accounts.js';
import { errorJson } from '$lib/server/api.js';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
	}
	const body = await event.request.json().catch(() => null);
	const parsed = PasswordChangeSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{ error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
			{ status: 400 }
		);
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const res = await changePassword(db, user.id, user.sessionId, {
			currentPassword: parsed.data.currentPassword,
			password: parsed.data.password
		});
		if (!res.ok) return errorJson(res);
		return json({ data: { message: res.message } });
	} finally {
		raw.close();
	}
};
