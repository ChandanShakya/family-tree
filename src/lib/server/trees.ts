import { randomUUID, randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { joinCodes, relationships, treeMembers, trees } from '$lib/db/schema.js';
import { FAMILY_CODE_DEFAULT_MAX_USES, TREE_FOCUS_MODE_THRESHOLD, DEFAULT_FOCUS_DEPTH, MAX_TRAVERSAL_DEPTH, MAX_TRAVERSAL_NODES } from '$lib/config.js';
import type { HistoryEntry } from '$lib/types.js';
import { writeHistory } from './audit.js';
import { ancestors, cached, chainRoots, descendants, generationDepth } from './graph.js';
import type { PersonRow } from './persons.js';
import { commitThenDelete } from './storage.js';
import { writeTx, type Db, type Handles } from './tx.js';

function newId(): string {
	return randomUUID();
}

// Family-code suffix: 8 chars from 32 unambiguous symbols (§5.1).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeJoinCode(slug: string): string {
	let suffix = '';
	for (let i = 0; i < 8; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] as string;
	return `${slug}-${suffix}`;
}

export function slugify(name: string): string {
	const s = name
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, '')
		.slice(0, 12);
	return s || 'TREE';
}

export interface TreeInput {
	name: string;
	description?: string;
}

/** Create a tree: owner membership + one active family code (§6.2). */
export function createTree(h: Handles, ownerId: string, input: TreeInput): { id: string; joinCode: string } {
	const now = new Date().toISOString();
	const id = newId();
	const code = makeJoinCode(slugify(input.name));
	writeTx(h.db, (tx) => {
		tx.insert(trees)
			.values({
				id,
				name: input.name,
				description: input.description ?? null,
				ownerId,
				isPublic: 0,
				createdAt: now,
				updatedAt: now
			})
			.run();
		tx.insert(treeMembers)
			.values({
				id: newId(),
				treeId: id,
				userId: ownerId,
				personId: null,
				role: 'owner',
				status: 'active',
				invitedBy: ownerId,
				joinedAt: now,
				joinedViaType: 'manual'
			})
			.run();
		tx.insert(joinCodes)
			.values({
				id: newId(),
				code,
				type: 'family',
				treeId: id,
				createdBy: ownerId,
				role: 'contributor',
				maxUses: FAMILY_CODE_DEFAULT_MAX_USES,
				currentUses: 0,
				isActive: 1,
				createdAt: now
			})
			.run();
		writeHistory(tx, {
			treeId: id,
			entityType: 'tree',
			entityId: id,
			changedBy: ownerId,
			action: 'create',
			note: 'tree created'
		});
	});
	return { id, joinCode: code };
}

/** Trees the user is an active member of, with member counts (§6.2 dashboard). */
export function listUserTrees(db: Db, userId: string) {
	const mine = db
		.select({ treeId: treeMembers.treeId })
		.from(treeMembers)
		.where(and(eq(treeMembers.userId, userId), eq(treeMembers.status, 'active')))
		.all();
	return mine
		.map((m) => getTreeRow(db, m.treeId))
		.filter((t) => t !== undefined)
		.map((t) => ({
			...t,
			memberCount: db
				.select({ id: treeMembers.id })
				.from(treeMembers)
				.where(and(eq(treeMembers.treeId, t.id), eq(treeMembers.status, 'active')))
				.all().length
		}));
}

export function getTreeRow(db: Db, treeId: string) {
	return db.select().from(trees).where(eq(trees.id, treeId)).get();
}

export interface TreeView {
	tree: Record<string, unknown>;
	persons: PersonRow[];
	relationships: Array<typeof relationships.$inferSelect>;
	members: Array<Record<string, unknown>>;
	totalPersons: number;
	truncated: boolean;
}

/** Full graph under the focus threshold, else a focus subgraph (§6.11). */
export function getTreeView(
	h: Handles,
	treeId: string,
	opts?: { focus?: string; depth?: number; userId?: string }
): TreeView | null {
	const tree = getTreeRow(h.db, treeId);
	if (!tree) return null;
	const totalPersons = countVisible(h.raw, treeId);
	if (totalPersons <= TREE_FOCUS_MODE_THRESHOLD) {
		const persons = h.raw
			.prepare(`SELECT * FROM visible_persons WHERE treeId = ? LIMIT ${MAX_TRAVERSAL_NODES + 1}`)
			.all(treeId) as PersonRow[];
		const rels = h.db.select().from(relationships).where(eq(relationships.treeId, treeId)).all();
		const members = h.db.select().from(treeMembers).where(eq(treeMembers.treeId, treeId)).all();
		return { tree: tree as Record<string, unknown>, persons, relationships: rels, members, totalPersons, truncated: false };
	}
	const depth = Math.min(opts?.depth ?? DEFAULT_FOCUS_DEPTH, MAX_TRAVERSAL_DEPTH);
	// Default focus (§6.11): the caller's own person, else the oldest root.
	let focusId = opts?.focus;
	if (!focusId && opts?.userId) {
		focusId = (
			h.raw
				.prepare(`SELECT id FROM visible_persons WHERE treeId = ? AND userId = ?`)
				.get(treeId, opts.userId) as { id: string } | undefined
		)?.id;
	}
	if (!focusId) {
		// The oldest person at the top of a chain; a tree without any links falls back to its oldest person.
		const roots = chainRoots(h.raw, treeId);
		const pickOldest = (where: string, args: unknown[]) =>
			(
				h.raw
					.prepare(`SELECT id FROM visible_persons WHERE ${where} ORDER BY birthDateNorm IS NULL, birthDateNorm, createdAt LIMIT 1`)
					.get(...args) as { id: string } | undefined
			)?.id;
		focusId = roots.length
			? pickOldest(`id IN (SELECT value FROM json_each(?))`, [JSON.stringify(roots)])
			: pickOldest(`treeId = ?`, [treeId]);
	}
	const ids = new Set<string>();
	if (focusId) {
		ids.add(focusId);
		for (const a of ancestors(h.raw, treeId, focusId, depth).ids) ids.add(a);
		for (const d of descendants(h.raw, treeId, focusId, depth).ids) ids.add(d);
		// Plus their spouses and siblings (§7.6 focus mode), still under the node cap.
		const batch = JSON.stringify([...ids]);
		const side = h.raw
			.prepare(
				`SELECT person1Id AS a, person2Id AS b FROM relationships INDEXED BY ix_rel_p1
				 WHERE person1Id IN (SELECT value FROM json_each(?)) AND treeId = ? AND type IN ('spouse', 'sibling')
				 UNION
				 SELECT person1Id, person2Id FROM relationships INDEXED BY ix_rel_p2
				 WHERE person2Id IN (SELECT value FROM json_each(?)) AND treeId = ? AND type IN ('spouse', 'sibling')`
			)
			.all(batch, treeId, batch, treeId) as Array<{ a: string; b: string }>;
		for (const r of side) {
			ids.add(r.a);
			ids.add(r.b);
		}
		const derived = h.raw
			.prepare(
				`SELECT DISTINCT c.person2Id AS id FROM relationships pr INDEXED BY ix_rel_p2
				 JOIN relationships c INDEXED BY ix_rel_p1 ON c.person1Id = pr.person1Id AND c.type = 'parent' AND c.treeId = pr.treeId
				 WHERE pr.treeId = ? AND pr.type = 'parent' AND pr.person2Id IN (SELECT value FROM json_each(?))
				 LIMIT ?`
			)
			.all(treeId, batch, MAX_TRAVERSAL_NODES) as Array<{ id: string }>;
		for (const r of derived) ids.add(r.id);
	}
	const persons =
		ids.size === 0
			? []
			: (h.raw
					.prepare(
						`SELECT * FROM visible_persons WHERE treeId = ? AND id IN (SELECT value FROM json_each(?)) LIMIT ?`
					)
					.all(treeId, JSON.stringify([...ids]), MAX_TRAVERSAL_NODES) as PersonRow[]);
	// Links between the shown people only, found through the person1 index (never a scan of the tree's links).
	const shown = JSON.stringify(persons.map((p) => p.id as string));
	const rels = h.raw
		.prepare(
			`SELECT * FROM relationships INDEXED BY ix_rel_p1
			 WHERE person1Id IN (SELECT value FROM json_each(?)) AND treeId = ? AND person2Id IN (SELECT value FROM json_each(?))`
		)
		.all(shown, treeId, shown) as Array<typeof relationships.$inferSelect>;
	const members = h.db.select().from(treeMembers).where(eq(treeMembers.treeId, treeId)).all();
	return {
		tree: tree as Record<string, unknown>,
		persons,
		relationships: rels,
		members,
		totalPersons,
		truncated: true
	};
}

export function updateTree(
	db: Db,
	treeId: string,
	patch: { name?: string; description?: string | null; isPublic?: boolean }
): { updated: true } | { error: 'NOT_FOUND' } {
	const row = getTreeRow(db, treeId);
	if (!row) return { error: 'NOT_FOUND' };
	const now = new Date().toISOString();
	writeTx(db, (tx) => {
		tx.update(trees)
			.set({
				...(patch.name !== undefined ? { name: patch.name } : {}),
				...(patch.description !== undefined ? { description: patch.description } : {}),
				...(patch.isPublic !== undefined ? { isPublic: patch.isPublic ? 1 : 0 } : {}),
				updatedAt: now
			})
			.where(eq(trees.id, treeId))
			.run();
	});
	return { updated: true };
}

/** Owner-only hard delete. Rows cascade; the tree's photo directory goes after commit (§6.7). */
export function deleteTree(db: Db, treeId: string): { deleted: true } | { error: string } {
	const row = getTreeRow(db, treeId);
	if (!row) return { error: 'NOT_FOUND' };
	commitThenDelete(db, (tx) => {
		// One directory holds media, thumbnails and cover; removed only after commit.
		tx.delete(trees).where(eq(trees.id, treeId)).run();
		return { value: null, after: { dirs: [treeId] } };
	});
	return { deleted: true };
}

export interface TreeStats {
	persons: number;
	relationships: number;
	generationDepth: number;
	truncated: boolean;
}

/**
 * Visible people (§5.1) without scanning the view: live rows minus the few whose membership is not active.
 * The view's per-row membership check costs ~5x as much on a 50 000-person tree.
 */
function countVisible(raw: Database.Database, treeId: string): number {
	return cached(raw, treeId, 'count', () => scanCountVisible(raw, treeId));
}

function scanCountVisible(raw: Database.Database, treeId: string): number {
	const live = (raw.prepare(`SELECT COUNT(*) AS c FROM persons WHERE treeId = ? AND deletedAt IS NULL`).get(treeId) as { c: number }).c;
	const hidden = (
		raw
			.prepare(
				`SELECT COUNT(DISTINCT p.id) AS c FROM treeMembers m JOIN persons p ON p.id = m.personId
				 WHERE m.treeId = ? AND m.status <> 'active' AND p.deletedAt IS NULL`
			)
			.get(treeId) as { c: number }
	).c;
	return live - hidden;
}

export function treeStats(h: Handles, treeId: string): TreeStats | null {
	if (!getTreeRow(h.db, treeId)) return null;
	const persons = countVisible(h.raw, treeId);
	const rels = (
		h.raw.prepare(`SELECT COUNT(*) AS c FROM relationships WHERE treeId = ?`).get(treeId) as {
			c: number;
		}
	).c;
	const gen = generationDepth(h.raw, treeId);
	return { persons, relationships: rels, generationDepth: gen.depth, truncated: gen.truncated };
}

export interface ActivityPage {
	data: HistoryEntry[];
	nextCursor: string | null;
}

function encodeCursor(changedAt: string, id: string): string {
	return Buffer.from(JSON.stringify({ changedAt, id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { changedAt: string; id: string } | null {
	try {
		const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
			changedAt: string;
			id: string;
		};
		if (typeof v.changedAt === 'string' && typeof v.id === 'string') return v;
		return null;
	} catch {
		return null;
	}
}

export function treeActivity(
	raw: Database.Database,
	treeId: string,
	cursor?: string,
	limit = 50
): ActivityPage {
	const decoded = cursor ? decodeCursor(cursor) : null;
	const rows = (
		decoded
			? raw
					.prepare(
						`SELECT h.*, (SELECT displayName FROM users u WHERE u.id = h.changedBy) AS changedByName FROM changeHistory h WHERE treeId = ? AND (changedAt < ? OR (changedAt = ? AND id < ?)) ORDER BY changedAt DESC, id DESC LIMIT ?`
					)
					.all(treeId, decoded.changedAt, decoded.changedAt, decoded.id, limit + 1)
			: raw
					.prepare(`SELECT h.*, (SELECT displayName FROM users u WHERE u.id = h.changedBy) AS changedByName FROM changeHistory h WHERE treeId = ? ORDER BY changedAt DESC, id DESC LIMIT ?`)
					.all(treeId, limit + 1)
	) as HistoryEntry[];
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	const nextCursor =
		rows.length > limit && last ? encodeCursor(last.changedAt as string, last.id as string) : null;
	return { data: page, nextCursor };
}
