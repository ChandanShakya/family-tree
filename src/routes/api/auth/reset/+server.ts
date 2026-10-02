import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { ResetSchema } from '$lib/schemas/auth.js';
import { resetPassword } from '$lib/server/accounts.js';
import { errorJson } from '$lib/server/api.js';

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => null);
	const parsed = ResetSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{ error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
			{ status: 400 }
		);
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const res = await resetPassword(db, { token: parsed.data.token, password: parsed.data.password });
		if (!res.ok) return errorJson(res);
		return json({ data: { message: res.message } });
	} finally {
		raw.close();
	}
};
