import { describe, expect, test, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createTree } from '$lib/server/trees.js';
import { createPerson, deletePerson } from '$lib/server/persons.js';
import { createLink } from '$lib/server/relations.js';
import { createEvent } from '$lib/server/events.js';
import { runMaintenance } from '../src/lib/server/workers/maintenance-core.mjs';
import { sweepOrphans } from '../scripts/lib/sweep.js';
import { makeUser } from './helpers.js';

const DIR = `./.test-tmp-maint-${process.pid}`;
afterAll(() => rmSync(DIR, { force: true, recursive: true }));

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function seed(name: string) {
	rmSync(`${DIR}/${name}`, { force: true, recursive: true });
	mkdirSync(`${DIR}/${name}/photos`, { recursive: true });
	const dbPath = `${DIR}/${name}/m.db`;
	const raw = new Database(dbPath);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	const db = drizzle(raw, { schema });
	return { raw, db, h: { raw, db }, dbPath, photos: `${DIR}/${name}/photos` };
}

describe('AT-46: maintenance pass', () => {
	test('AT-46: purges persons soft-deleted longer than SOFT_DELETE_PURGE_DAYS with dependents and files; removes expired sessions, old tokens and old claim attempts; newer rows are untouched', () => {
		const s = seed('pass');
		const owner = makeUser(s.db);
		const tree = createTree(s.h, owner.id, { name: 'M' }).id;
		const old = createPerson(s.h, owner.id, tree, { firstName: 'OldDeleted' }).id;
		const recent = createPerson(s.h, owner.id, tree, { firstName: 'RecentDeleted' }).id;
		const alive = createPerson(s.h, owner.id, tree, { firstName: 'Alive' }).id;
		createLink(s.h, owner.id, tree, { person1Id: old, person2Id: alive, type: 'parent' });
		createLink(s.h, owner.id, tree, { person1Id: recent, person2Id: alive, type: 'spouse' });
		createEvent(s.h, owner.id, tree, { personId: old, type: 'residence' });
		createEvent(s.h, owner.id, tree, { personId: recent, type: 'residence' });
		// photos for both deleted people and for the living one
		const addMedia = (personId: string, label: string) => {
			const dir = join(s.photos, tree, personId);
			mkdirSync(dir, { recursive: true });
			const a = `${tree}/${personId}/${label}.jpg`;
			const b = `${tree}/${personId}/${label}-thumb.webp`;
			writeFileSync(join(s.photos, a), 'x');
			writeFileSync(join(s.photos, b), 'x');
			s.raw.prepare(`INSERT INTO media (id, personId, treeId, storagePath, thumbPath, mime, sizeBytes, type, createdAt) VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1, 'photo', 'n')`).run(randomUUID(), personId, tree, a, b);
			return [join(s.photos, a), join(s.photos, b)];
		};
		const oldFiles = addMedia(old, 'a');
		const recentFiles = addMedia(recent, 'b');
		const aliveFiles = addMedia(alive, 'c');
		deletePerson(s.h, owner.id, old);
		deletePerson(s.h, owner.id, recent);
		s.raw.prepare(`UPDATE persons SET deletedAt = ? WHERE id = ?`).run(iso(-31 * DAY), old);
		s.raw.prepare(`UPDATE persons SET deletedAt = ? WHERE id = ?`).run(iso(-5 * DAY), recent);
		s.raw.prepare(`INSERT INTO profileClaims (id, userId, personId, treeId, proofMethod, status, createdAt) VALUES ('c1', ?, ?, ?, 'manual', 'pending', 'n')`).run(owner.id, old, tree);

		// sessions: one expired, one valid
		const ses = (id: string, exp: string) => s.raw.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, 'n', 'n')`).run(id, owner.id, `h-${id}`, exp);
		ses('s-expired', iso(-DAY));
		ses('s-valid', iso(DAY));
		// tokens: expired >24h old, used >24h old, expired but young, valid, used but young
		const tok = (table: string, id: string, exp: string, used: string | null, created: string) =>
			s.raw.prepare(`INSERT INTO ${table} (id, userId, tokenHash, expiresAt, usedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)`).run(id, owner.id, `t-${table}-${id}`, exp, used, created);
		for (const t of ['passwordResetTokens', 'emailVerificationTokens']) {
			tok(t, 'expired-old', iso(-2 * DAY), null, iso(-3 * DAY));
			tok(t, 'used-old', iso(DAY), iso(-2 * DAY), iso(-3 * DAY));
			tok(t, 'expired-young', iso(-1000), null, iso(-3600_000));
			tok(t, 'valid', iso(DAY), null, iso(-3600_000));
			tok(t, 'used-young', iso(DAY), iso(-1000), iso(-3600_000));
		}
		// claim attempts: window started 3 days ago (ended 2 days ago), 36 h ago (ended 12 h ago), now
		const att = (p: string, start: string) => s.raw.prepare(`INSERT INTO claimAttempts (userId, personId, count, windowStart) VALUES (?, ?, 1, ?)`).run(owner.id, p, start);
		att('p-old', iso(-3 * DAY));
		att('p-mid', iso(-36 * 3600_000));
		att('p-new', iso(0));
		s.raw.close();

		const r = runMaintenance({ dbPath: s.dbPath, photoRoot: s.photos, purgeDays: 30 });
		expect(r.errors).toEqual([]);
		expect(r).toMatchObject({ personsPurged: 1, filesRemoved: 2, sessions: 1, tokens: 4, claimAttempts: 1 });

		const db = new Database(s.dbPath, { readonly: true });
		const ids = (sql: string) => (db.prepare(sql).all() as Array<{ id: string }>).map((x) => x.id).sort();
		expect(db.prepare(`SELECT id FROM persons WHERE id = ?`).get(old)).toBeUndefined();
		expect(db.prepare(`SELECT COUNT(*) AS c FROM events WHERE personId = ?`).get(old)).toEqual({ c: 0 }); // dependents go with it
		expect(db.prepare(`SELECT COUNT(*) AS c FROM relationships WHERE person1Id = ?`).get(old)).toEqual({ c: 0 });
		expect(db.prepare(`SELECT COUNT(*) AS c FROM media WHERE personId = ?`).get(old)).toEqual({ c: 0 });
		expect(db.prepare(`SELECT COUNT(*) AS c FROM profileClaims WHERE personId = ?`).get(old)).toEqual({ c: 0 });
		expect(oldFiles.some(existsSync)).toBe(false);
		expect(existsSync(join(s.photos, tree, old))).toBe(false); // the emptied folder too
		// newer rows are untouched
		expect(db.prepare(`SELECT id FROM persons WHERE id = ?`).get(recent)).toBeDefined();
		expect(db.prepare(`SELECT COUNT(*) AS c FROM events WHERE personId = ?`).get(recent)).toEqual({ c: 1 });
		expect(recentFiles.every(existsSync) && aliveFiles.every(existsSync)).toBe(true);
		expect(ids(`SELECT id FROM sessions`)).toEqual(['s-valid']);
		for (const t of ['passwordResetTokens', 'emailVerificationTokens']) {
			expect(ids(`SELECT id FROM ${t}`), t).toEqual(['expired-young', 'used-young', 'valid']);
		}
		expect((db.prepare(`SELECT personId FROM claimAttempts ORDER BY personId`).all() as Array<{ personId: string }>).map((x) => x.personId)).toEqual(['p-mid', 'p-new']);
		// History rows stay (audit trail) but carry no data about the purged person; the recent one keeps its data.
		const hist = (id: string) =>
			db.prepare(`SELECT oldValue, newValue, snapshot FROM changeHistory WHERE entityId = ? OR snapshot LIKE ? OR newValue LIKE ?`).all(id, `%${id}%`, `%${id}%`) as Array<Record<string, string | null>>;
		expect(hist(old).length).toBeGreaterThan(0);
		expect(JSON.stringify(hist(old))).not.toContain('OldDeleted');
		expect(hist(old).every((r) => r.oldValue === null && r.newValue === null && r.snapshot === null)).toBe(true);
		expect(JSON.stringify(hist(recent))).toContain('RecentDeleted');
		db.close();
		// a second pass finds nothing new
		expect(runMaintenance({ dbPath: s.dbPath, photoRoot: s.photos, purgeDays: 30 })).toMatchObject({ personsPurged: 0, filesRemoved: 0, sessions: 0, tokens: 0, claimAttempts: 0 });
	});

	test('AT-46: a failing step is reported and the other steps still run', () => {
		const s = seed('fail');
		const owner = makeUser(s.db);
		s.raw.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt) VALUES ('x', ?, 'h', ?, 'n', 'n')`).run(owner.id, iso(-DAY));
		s.raw.exec(`CREATE TRIGGER block_token_delete BEFORE DELETE ON passwordResetTokens BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);
		s.raw.prepare(`INSERT INTO passwordResetTokens (id, userId, tokenHash, expiresAt, createdAt) VALUES ('t', ?, 'th', ?, ?)`).run(owner.id, iso(-2 * DAY), iso(-3 * DAY));
		s.raw.close();
		const r = runMaintenance({ dbPath: s.dbPath, photoRoot: s.photos, purgeDays: 30 });
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toContain('old tokens');
		expect(r.sessions).toBe(1);
	});
});

describe('AT-34: sweep-orphans', () => {
	test('AT-34: removes only files no row references (media, thumbnails, avatars, covers stay)', () => {
		const s = seed('sweep');
		const owner = makeUser(s.db);
		const tree = createTree(s.h, owner.id, { name: 'Sweep' }).id;
		const person = createPerson(s.h, owner.id, tree, { firstName: 'P' }).id;
		const put = (rel: string) => {
			mkdirSync(join(s.photos, rel, '..'), { recursive: true });
			writeFileSync(join(s.photos, rel), 'x');
		};
		const kept = [`${tree}/${person}/m.jpg`, `${tree}/${person}/m-thumb.webp`, `_avatars/${owner.id}/a.png`, `${tree}/_cover/c.png`];
		const orphans = [`${tree}/${person}/orphan.jpg`, `${tree}/_tree/loose.png`, `_avatars/${owner.id}/old.png`, `stray.png`];
		for (const f of [...kept, ...orphans]) put(f);
		s.raw.prepare(`INSERT INTO media (id, personId, treeId, storagePath, thumbPath, mime, sizeBytes, type, createdAt) VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1, 'photo', 'n')`).run(randomUUID(), person, tree, kept[0], kept[1]);
		s.raw.prepare(`UPDATE users SET avatarUrl = ? WHERE id = ?`).run(`/photos/${kept[2]}`, owner.id);
		s.raw.prepare(`UPDATE trees SET coverImage = ? WHERE id = ?`).run(`/photos/${kept[3]}`, tree);
		s.raw.close();
		const removed = sweepOrphans(s.dbPath, s.photos);
		expect(removed.sort()).toEqual([...orphans].sort());
		for (const f of kept) expect(existsSync(join(s.photos, f)), f).toBe(true);
		for (const f of orphans) expect(existsSync(join(s.photos, f)), f).toBe(false);
		expect(sweepOrphans(s.dbPath, s.photos)).toEqual([]);
	});
});
