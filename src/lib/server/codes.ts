import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_JOIN_ROLE } from '$lib/config.js';
import { joinCodes, persons, treeMembers, trees, users } from '$lib/db/schema.js';
import { makeJoinCode, slugify } from './trees.js';
import { createPerson, type PersonInput } from './persons.js';
import { createLink, type LinkType } from './relations.js';
import { notify, notifyReviewers } from './notifications.js';
import { writeTx, type Db, type Handles } from './tx.js';

// §6.4 join codes. Every redemption is one BEGIN IMMEDIATE transaction; the
// counter increment is guarded in SQL, so concurrent redeemers cannot both win.

export type CodeRole = 'viewer' | 'contributor' | 'editor';
export type RelationType = 'parent' | 'child' | 'spouse' | 'sibling' | 'self';

const ROLE_RANK: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, owner: 3 };

export function roleRank(role: string): number {
	return ROLE_RANK[role] ?? -1;
}

/** One identical failure for unknown, expired, exhausted, deactivated and rejected-user codes (AT-12). */
export const JOIN_UNAVAILABLE = 'JOIN_UNAVAILABLE' as const;

// Thrown inside a transaction to roll everything back, including the counter.
class Abort extends Error {
	constructor(readonly code: RedeemError) {
		super(code);
	}
}

export type RedeemError = typeof JOIN_UNAVAILABLE | 'ALREADY_MEMBER' | 'ALREADY_PENDING' | 'VALIDATION';

type CodeRow = typeof joinCodes.$inferSelect;

export function findCode(db: Db, code: string): CodeRow | undefined {
	return db.select().from(joinCodes).where(eq(joinCodes.code, code)).get();
}

export function isUsable(c: CodeRow | undefined, now = new Date()): c is CodeRow {
	if (!c || c.isActive !== 1) return false;
	if (c.expiresAt && c.expiresAt <= now.toISOString()) return false;
	if (c.maxUses !== null && c.currentUses >= c.maxUses) return false;
	return true;
}

// --- Creation ---

export interface DirectCodeInput {
	linkedPersonId: string;
	linkedRelationType: RelationType;
	role?: CodeRole;
	expiresAt?: string | null;
}

/** A direct code needs a visible person in the tree and may not grant more than the creator holds (AT-44). */
export function createDirectCode(
	h: Handles,
	actorId: string,
	actorRole: string,
	treeId: string,
	input: DirectCodeInput
): { id: string; code: string } | { error: 'NOT_FOUND' | 'ROLE_TOO_HIGH' | 'ALREADY_CLAIMED' } {
	const role = input.role ?? DEFAULT_JOIN_ROLE;
	if (roleRank(role) > roleRank(actorRole)) return { error: 'ROLE_TOO_HIGH' };
	const person = h.raw
		.prepare(`SELECT id, userId FROM visible_persons WHERE id = ? AND treeId = ?`)
		.get(input.linkedPersonId, treeId) as { id: string; userId: string | null } | undefined;
	if (!person) return { error: 'NOT_FOUND' };
	if (input.linkedRelationType === 'self' && person.userId) return { error: 'ALREADY_CLAIMED' };
	const tree = h.db.select().from(trees).where(eq(trees.id, treeId)).get();
	if (!tree) return { error: 'NOT_FOUND' };
	const id = randomUUID();
	const code = makeJoinCode(slugify(tree.name));
	h.db
		.insert(joinCodes)
		.values({
			id,
			code,
			type: 'direct',
			treeId,
			createdBy: actorId,
			linkedPersonId: input.linkedPersonId,
			linkedRelationType: input.linkedRelationType,
			role,
			expiresAt: input.expiresAt ?? null,
			maxUses: 1, // direct codes are single use
			currentUses: 0,
			isActive: 1,
			createdAt: new Date().toISOString()
		})
		.run();
	return { id, code };
}

/** Creator, owner or editor may deactivate (§9). */
export function deactivateCode(db: Db, codeId: string): boolean {
	return db.update(joinCodes).set({ isActive: 0 }).where(eq(joinCodes.id, codeId)).run().changes === 1;
}

export function listDirectCodes(db: Db, treeId: string, userId: string) {
	return db
		.select({
			id: joinCodes.id,
			code: joinCodes.code,
			role: joinCodes.role,
			linkedPersonId: joinCodes.linkedPersonId,
			linkedRelationType: joinCodes.linkedRelationType,
			expiresAt: joinCodes.expiresAt,
			currentUses: joinCodes.currentUses,
			isActive: joinCodes.isActive
		})
		.from(joinCodes)
		.where(and(eq(joinCodes.treeId, treeId), eq(joinCodes.type, 'direct'), eq(joinCodes.createdBy, userId)))
		.all();
}

// --- Preview ---

export interface CodePreview {
	treeName: string;
	kind: 'family' | 'direct';
	relation: RelationType | null;
	personName: string | null;
	inviter: string | null;
}

export function previewCode(db: Db, code: string, now = new Date()): CodePreview | null {
	const c = findCode(db, code);
	if (!isUsable(c, now)) return null;
	const tree = db.select({ n: trees.name }).from(trees).where(eq(trees.id, c.treeId)).get();
	const linked = c.linkedPersonId
		? db.select({ f: persons.firstName, l: persons.lastName }).from(persons).where(eq(persons.id, c.linkedPersonId)).get()
		: undefined;
	const inviter = c.createdBy ? db.select({ n: users.displayName }).from(users).where(eq(users.id, c.createdBy)).get() : undefined;
	return {
		treeName: tree?.n ?? '',
		kind: c.type === 'direct' ? 'direct' : 'family',
		relation: (c.linkedRelationType as RelationType | null) ?? null,
		personName: linked ? `${linked.f} ${linked.l ?? ''}`.trim() : null,
		inviter: inviter?.n ?? null
	};
}

// --- Redemption ---

export type RedeemResult =
	| { ok: true; treeId: string; status: 'pending' | 'active'; personId: string }
	| { ok: false; error: RedeemError };

/** Mirrors the §6.4 mapping; `new` is the person created at redemption. */
function linkNewToLinked(h: Handles, actorId: string, treeId: string, rel: Exclude<RelationType, 'self'>, newId: string, linkedId: string) {
	const [a, b, type]: [string, string, LinkType] =
		rel === 'parent' ? [newId, linkedId, 'parent'] : rel === 'child' ? [linkedId, newId, 'parent'] : [newId, linkedId, rel];
	const r = createLink(h, actorId, treeId, { person1Id: a, person2Id: b, type });
	if ('error' in r) throw new Abort(JOIN_UNAVAILABLE);
}

export function redeemCode(h: Handles, userId: string, code: string, details: Partial<PersonInput>, now = new Date()): RedeemResult {
	try {
		return writeTx(h.db, (tx): RedeemResult => {
			const th: Handles = { raw: h.raw, db: tx };
			const c = findCode(tx, code);
			if (!isUsable(c, now)) throw new Abort(JOIN_UNAVAILABLE);
			const existing = tx
				.select()
				.from(treeMembers)
				.where(and(eq(treeMembers.treeId, c.treeId), eq(treeMembers.userId, userId)))
				.get();
			if (existing?.status === 'active') throw new Abort('ALREADY_MEMBER');
			if (existing?.status === 'pending') throw new Abort('ALREADY_PENDING');
			// A rejected visitor cannot re-apply: same generic failure as an unknown code.
			if (existing) throw new Abort(JOIN_UNAVAILABLE);

			// Everything but a `self` code needs the visitor's own details; fail before taking a slot.
			const isSelf = c.type === 'direct' && c.linkedRelationType === 'self';
			if (!isSelf && !details.firstName) throw new Abort('VALIDATION');

			// Guarded increment: the SQL, not the read above, decides who gets the slot.
			const won = tx
				.update(joinCodes)
				.set({ currentUses: sql`${joinCodes.currentUses} + 1` })
				.where(
					and(
						eq(joinCodes.id, c.id),
						eq(joinCodes.isActive, 1),
						sql`(${joinCodes.maxUses} IS NULL OR ${joinCodes.currentUses} < ${joinCodes.maxUses})`,
						sql`(${joinCodes.expiresAt} IS NULL OR ${joinCodes.expiresAt} > ${now.toISOString()})`
					)
				)
				.run().changes;
			if (won !== 1) throw new Abort(JOIN_UNAVAILABLE);

			const isDirect = c.type === 'direct';
			const status = isDirect ? 'active' : 'pending';
			const role = isDirect ? c.role : DEFAULT_JOIN_ROLE;
			const stamp = now.toISOString();
			let personId: string;
			if (isSelf) {
				// The only code-based claim: null-guarded, so an already-claimed person fails the whole redemption.
				if (!c.linkedPersonId) throw new Abort(JOIN_UNAVAILABLE);
				const claimed = tx
					.update(persons)
					.set({ userId, claimedAt: stamp, claimedVia: 'claim_code' })
					.where(and(eq(persons.id, c.linkedPersonId), sql`${persons.userId} IS NULL`, sql`${persons.deletedAt} IS NULL`))
					.run().changes;
				if (claimed !== 1) throw new Abort(JOIN_UNAVAILABLE);
				personId = c.linkedPersonId;
			} else {
				personId = createPerson(th, userId, c.treeId, details as PersonInput).id;
				tx.update(persons).set({ userId, claimedAt: stamp, claimedVia: 'join_code' }).where(eq(persons.id, personId)).run();
			}
			tx.insert(treeMembers)
				.values({
					id: randomUUID(),
					treeId: c.treeId,
					userId,
					personId,
					role,
					status,
					invitedBy: c.createdBy,
					joinedAt: stamp,
					joinedViaCode: c.code,
					joinedViaType: c.type
				})
				.run();
			if (isDirect && c.linkedRelationType && c.linkedRelationType !== 'self' && c.linkedPersonId) {
				linkNewToLinked(th, userId, c.treeId, c.linkedRelationType as Exclude<RelationType, 'self'>, personId, c.linkedPersonId);
			}
			const who = tx.select({ n: users.displayName }).from(users).where(eq(users.id, userId)).get()?.n ?? 'Someone';
			const treeLink = `/trees/${c.treeId}`;
			if (isDirect) {
				if (c.createdBy) {
					notify(tx, { userId: c.createdBy, treeId: c.treeId, actorId: userId, personId, type: 'join', title: `${who} joined your tree`, linkUrl: treeLink }, now);
				}
			} else {
				notifyReviewers(tx, c.treeId, { actorId: userId, personId, type: 'join_approval', title: `${who} asks to join`, linkUrl: `${treeLink}/members` }, userId);
			}
			return { ok: true, treeId: c.treeId, status, personId };
		});
	} catch (e) {
		if (e instanceof Abort) return { ok: false, error: e.code };
		throw e;
	}
}

// --- Review of pending family-code joiners ---

export type ReviewResult = { ok: true } | { ok: false; error: 'NOT_FOUND' };

export function reviewMember(
	h: Handles,
	reviewerId: string,
	treeId: string,
	userId: string,
	decision: 'approve' | 'reject'
): ReviewResult {
	return writeTx(h.db, (tx): ReviewResult => {
		const m = tx
			.select()
			.from(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId), eq(treeMembers.status, 'pending')))
			.get();
		if (!m) return { ok: false, error: 'NOT_FOUND' };
		const tree = tx.select({ n: trees.name }).from(trees).where(eq(trees.id, treeId)).get();
		if (decision === 'approve') {
			tx.update(treeMembers).set({ status: 'active' }).where(eq(treeMembers.id, m.id)).run();
			notify(tx, { userId, treeId, actorId: reviewerId, personId: m.personId, type: 'join_approval', title: `You joined ${tree?.n ?? 'the tree'}`, linkUrl: `/trees/${treeId}` });
		} else {
			// The pending person was never visible: remove it, keep a rejected row so the code cannot be reused.
			if (m.personId) tx.delete(persons).where(eq(persons.id, m.personId)).run();
			tx.update(treeMembers).set({ status: 'rejected', personId: null }).where(eq(treeMembers.id, m.id)).run();
			notify(tx, { userId, treeId, actorId: reviewerId, type: 'join_approval', title: `Your request to join ${tree?.n ?? 'the tree'} was declined` });
		}
		return { ok: true };
	});
}
