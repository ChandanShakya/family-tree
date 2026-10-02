import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { AccountUpdateSchema } from '$lib/schemas/auth.js';
import { deleteAccount, updateAccount } from '$lib/server/accounts.js';
import { clearSessionCookie, errorJson } from '$lib/server/api.js';
import { eq } from 'drizzle-orm';
import { users } from '$lib/db/schema.js';

export const PUT: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
	}
	const body = await event.request.json().catch(() => null);
	const parsed = AccountUpdateSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{ error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid input' } },
			{ status: 400 }
		);
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const res = updateAccount(db, user.id, {
			displayName: parsed.data.displayName,
			themePref: parsed.data.themePref,
			dateDisplayPref: parsed.data.dateDisplayPref,
			notifyPrefs: parsed.data.notifyPrefs
		});
		if (!res.ok) return errorJson(res);
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		return json({
			data: {
				message: res.message,
				profile: row
					? {
							displayName: row.displayName,
							themePref: row.themePref,
							dateDisplayPref: row.dateDisplayPref
						}
					: null
			}
		});
	} finally {
		raw.close();
	}
};

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
	}
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const res = deleteAccount(db, user.id);
		if (!res.ok) return errorJson(res);
		clearSessionCookie(event);
		return json({ data: { message: res.message } });
	} finally {
		raw.close();
	}
};
