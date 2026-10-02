import type { LayoutServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { openDb } from '$lib/db/index.js';
import { env } from '$env/dynamic/private';
import { notifications, users } from '$lib/db/schema.js';
import { and, sql } from 'drizzle-orm';
import type { ThemePref } from '$lib/theme.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { me: null, unread: 0 };
	const { raw, db } = openDb(env.DATABASE_PATH ?? './data/family.db');
	try {
		const u = db.select().from(users).where(eq(users.id, locals.user.id)).get();
		const unread = db.select({ c: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.userId, locals.user.id), eq(notifications.isRead, 0))).get()?.c ?? 0;
		return u ? { me: { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, dateDisplayPref: (u.dateDisplayPref as 'AD' | 'BS' | 'both') ?? 'AD', themePref: (u.themePref as ThemePref) ?? 'system' }, unread } : { me: null, unread: 0 };
	} finally {
		raw.close();
	}
};
