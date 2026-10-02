import type { PageServerLoad } from './$types';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { users } from '$lib/db/schema.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { profile: null };
	const dbPath = env.DATABASE_PATH ?? './data/family.db';
	const { raw, db } = openDb(dbPath);
	try {
		const row = db.select().from(users).where(eq(users.id, locals.user.id)).get();
		if (!row) return { profile: null };
		return {
			profile: {
				displayName: row.displayName,
				email: row.email,
				emailVerified: row.emailVerifiedAt !== null,
				themePref: row.themePref,
				dateDisplayPref: row.dateDisplayPref,
				notifyPrefs: parsePrefs(row.notifyPrefs)
			}
		};
	} finally {
		raw.close();
	}
};

function parsePrefs(raw: string | null): Record<string, boolean> {
	try {
		return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
	} catch {
		return {};
	}
}
