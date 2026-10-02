import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { EDIT_NOTIFY_COALESCE_MINUTES } from '$lib/config.js';
import { notifications, persons, treeMembers, users } from '$lib/db/schema.js';
import type { Db } from './tx.js';

export type NotificationType = 'join' | 'join_approval' | 'claim' | 'claim_review' | 'edit';

export interface NewNotification {
	userId: string;
	treeId?: string | null;
	actorId?: string | null;
	personId?: string | null;
	type: NotificationType;
	title: string;
	body?: string | null;
	linkUrl?: string | null;
}

/** `users.notifyPrefs` is `{ [type]: boolean }`; a missing key means on. */
export function wantsNotification(db: Db, userId: string, type: NotificationType): boolean {
	const raw = db.select({ p: users.notifyPrefs }).from(users).where(eq(users.id, userId)).get()?.p;
	if (!raw) return true;
	try {
		return (JSON.parse(raw) as Record<string, unknown>)[type] !== false;
	} catch {
		return true;
	}
}

export function notify(db: Db, n: NewNotification, now = new Date()): void {
	if (!wantsNotification(db, n.userId, n.type)) return;
	db.insert(notifications)
		.values({
			id: randomUUID(),
			userId: n.userId,
			treeId: n.treeId ?? null,
			actorId: n.actorId ?? null,
			personId: n.personId ?? null,
			type: n.type,
			title: n.title,
			body: n.body ?? null,
			linkUrl: n.linkUrl ?? null,
			isRead: 0,
			createdAt: now.toISOString()
		})
		.run();
}

/** Owner and editors of a tree (active), optionally excluding the actor. */
export function reviewerIds(db: Db, treeId: string, exceptUserId?: string): string[] {
	return db
		.select({ userId: treeMembers.userId })
		.from(treeMembers)
		.where(
			and(
				eq(treeMembers.treeId, treeId),
				eq(treeMembers.status, 'active'),
				inArray(treeMembers.role, ['owner', 'editor'])
			)
		)
		.all()
		.map((r) => r.userId)
		.filter((id) => id !== exceptUserId);
}

export function notifyReviewers(db: Db, treeId: string, n: Omit<NewNotification, 'userId'>, exceptUserId?: string): void {
	for (const userId of reviewerIds(db, treeId, exceptUserId)) notify(db, { ...n, userId, treeId });
}

/**
 * Tell a claimed person that someone else edited them (§5.1). Coalesced: at
 * most one UNREAD `edit` notification per (claimed person, editor) inside the
 * coalescing window, backed by ix_notif_coalesce.
 */
export function notifyEdit(
	db: Db,
	input: { treeId: string; personId: string; actorId: string },
	now = new Date()
): boolean {
	const p = db.select({ userId: persons.userId, firstName: persons.firstName }).from(persons).where(eq(persons.id, input.personId)).get();
	if (!p?.userId || p.userId === input.actorId) return false;
	const cutoff = new Date(now.getTime() - EDIT_NOTIFY_COALESCE_MINUTES * 60_000).toISOString();
	const recent = db
		.select({ id: notifications.id })
		.from(notifications)
		.where(
			and(
				eq(notifications.userId, p.userId),
				eq(notifications.type, 'edit'),
				eq(notifications.personId, input.personId),
				eq(notifications.actorId, input.actorId),
				eq(notifications.isRead, 0),
				sql`${notifications.createdAt} > ${cutoff}`
			)
		)
		.get();
	if (recent) return false;
	const actor = db.select({ n: users.displayName }).from(users).where(eq(users.id, input.actorId)).get();
	notify(
		db,
		{
			userId: p.userId,
			treeId: input.treeId,
			actorId: input.actorId,
			personId: input.personId,
			type: 'edit',
			title: `${actor?.n ?? 'Someone'} edited your profile`,
			linkUrl: `/persons/${input.personId}`
		},
		now
	);
	return true;
}

export function listNotifications(db: Db, userId: string, cursor?: string, limit = 30) {
	const [cAt, cId] = cursor?.split('|') ?? [];
	const rows = db
		.select()
		.from(notifications)
		.where(
			and(
				eq(notifications.userId, userId),
				cAt && cId
					? or(lt(notifications.createdAt, cAt), and(eq(notifications.createdAt, cAt), lt(notifications.id, cId)))
					: undefined
			)
		)
		.orderBy(desc(notifications.createdAt), desc(notifications.id))
		.limit(limit + 1)
		.all();
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	const unreadCount = db
		.select({ c: sql<number>`count(*)` })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)))
		.get()?.c ?? 0;
	return { data: page, nextCursor: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null, unreadCount };
}

/** Mark specific notifications (only the caller's own) or all of them read. */
export function markRead(db: Db, userId: string, input: { ids?: string[]; all?: boolean }): number {
	const where = input.all
		? and(eq(notifications.userId, userId), eq(notifications.isRead, 0))
		: and(eq(notifications.userId, userId), inArray(notifications.id, input.ids ?? []), eq(notifications.isRead, 0));
	return db.update(notifications).set({ isRead: 1 }).where(where).run().changes;
}
