import { describe, expect, test, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createSession } from '$lib/server/auth.js';
import { createTree } from '$lib/server/trees.js';
import { createPerson, deletePerson } from '$lib/server/persons.js';

// §3 graceful shutdown, §6.12 startup maintenance, §11 production refusal, §11 backup scripts as run by an operator.

const DIR = `./.test-tmp-ops-${process.pid}`;
afterAll(() => rmSync(DIR, { force: true, recursive: true }));

function makeDb(name: string) {
	mkdirSync(`${DIR}/${name}`, { recursive: true });
	const dbPath = `${DIR}/${name}/ops.db`;
	const raw = new Database(dbPath);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	return { raw, db: drizzle(raw, { schema }), dbPath };
}

function start(port: number, env: Record<string, string>): { child: ChildProcess; out: string[]; exited: Promise<number | null> } {
	const out: string[] = [];
	const child = spawn('node', ['build'], { env: { ...process.env, PORT: String(port), ORIGIN: `http://localhost:${port}`, ...env } });
	child.stdout?.on('data', (d) => out.push(String(d)));
	child.stderr?.on('data', (d) => out.push(String(d)));
	return { child, out, exited: new Promise((r) => child.on('exit', (c) => r(c))) };
}

async function up(port: number): Promise<boolean> {
	for (let i = 0; i < 100; i++) {
		if (await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false)) return true;
		await new Promise((r) => setTimeout(r, 200));
	}
	return false;
}

describe('operations', () => {
	test('production refuses to start without SESSION_SECRET and VERIFICATION_PEPPER of at least 32 characters', async () => {
		const { dbPath } = makeDb('prod');
		const s = start(4231, { NODE_ENV: 'production', DATABASE_PATH: dbPath, SESSION_SECRET: 'short', VERIFICATION_PEPPER: 'x'.repeat(40) });
		const code = await s.exited;
		expect(code).not.toBe(0);
		expect(s.out.join('')).toContain('SESSION_SECRET must be set to at least 32 characters');
		const ok = start(4232, { NODE_ENV: 'production', DATABASE_PATH: dbPath, SESSION_SECRET: 's'.repeat(40), VERIFICATION_PEPPER: 'p'.repeat(40) });
		expect(await up(4232)).toBe(true);
		ok.child.kill('SIGTERM');
		expect(await ok.exited).toBe(0);
	}, 60_000);

	test('startup maintenance purges old soft-deleted people without delaying the listener', async () => {
		const { raw, db, dbPath } = makeDb('maint');
		const owner = randomUUID();
		db.insert(users).values({ id: owner, email: 'o@example.com', displayName: 'O', createdAt: 'n' }).run();
		const h = { raw, db };
		const tree = createTree(h, owner, { name: 'T' }).id;
		const gone = createPerson(h, owner, tree, { firstName: 'Gone' }).id;
		const stays = createPerson(h, owner, tree, { firstName: 'Stays' }).id;
		deletePerson(h, owner, gone);
		raw.prepare(`UPDATE persons SET deletedAt = ? WHERE id = ?`).run(new Date(Date.now() - 40 * 86_400_000).toISOString(), gone);
		raw.close();
		const s = start(4233, { DATABASE_PATH: dbPath });
		expect(await up(4233)).toBe(true);
		for (let i = 0; i < 50 && !s.out.join('').includes('maintenance:'); i++) await new Promise((r) => setTimeout(r, 200));
		expect(s.out.join('')).toMatch(/maintenance: purged 1 people/);
		s.child.kill('SIGTERM');
		await s.exited;
		const check = new Database(dbPath, { readonly: true });
		expect(check.prepare(`SELECT id FROM persons WHERE id = ?`).get(gone)).toBeUndefined();
		expect(check.prepare(`SELECT id FROM persons WHERE id = ?`).get(stays)).toBeDefined();
		check.close();
	}, 60_000);

	test('SIGTERM: in-flight request finishes, new connections are refused, the WAL is checkpointed, exit code 0', async () => {
		const { raw, db, dbPath } = makeDb('term');
		const owner = randomUUID();
		db.insert(users).values({ id: owner, email: 'o@example.com', displayName: 'O', emailVerifiedAt: 'n', createdAt: 'n' }).run();
		const tree = createTree({ raw, db }, owner, { name: 'T' }).id;
		const token = (await createSession(db, owner, null)).token;
		raw.close();
		const s = start(4234, { DATABASE_PATH: dbPath, BODY_SIZE_LIMIT: '12M', RATE_LIMIT_API_MAX: '100000' });
		expect(await up(4234)).toBe(true);
		// a slow request: a 10 000-person GEDCOM import (about 2-3 s in its worker)
		const lines = ['0 HEAD'];
		for (let i = 0; i < 10_000; i++) lines.push(`0 @I${i}@ INDI`, `1 NAME P${i} /Fam/`);
		lines.push('0 TRLR');
		const form = new FormData();
		form.set('treeId', tree);
		form.set('file', new Blob([lines.join('\n')]), 'x.ged');
		const inflight = fetch('http://localhost:4234/api/gedcom/import', { method: 'POST', headers: { cookie: `session=${token}`, origin: 'http://localhost:4234' }, body: form }).then((r) => r.status);
		// wait until the worker holds the write lock, then stop the server mid-import
		const probe = new Database(dbPath);
		probe.pragma('busy_timeout = 0');
		let locked = false;
		for (let i = 0; i < 600 && !locked; i++) {
			try {
				probe.exec('BEGIN IMMEDIATE');
				probe.exec('ROLLBACK');
				await new Promise((r) => setTimeout(r, 5));
			} catch {
				locked = true;
			}
		}
		probe.close();
		expect(locked).toBe(true);
		s.child.kill('SIGTERM');
		await new Promise((r) => setTimeout(r, 200));
		await expect(fetch('http://localhost:4234/api/health')).rejects.toThrow(); // no new connections
		expect(await inflight).toBe(201); // the import still commits
		expect(await s.exited).toBe(0);
		const check = new Database(dbPath, { readonly: true });
		expect((check.prepare(`SELECT COUNT(*) AS c FROM persons`).get() as { c: number }).c).toBe(10_000);
		check.close();
		const wal = `${dbPath}-wal`;
		expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true); // checkpointed (TRUNCATE)
	}, 90_000);

	test('backup and restore scripts as an operator runs them: snapshot, wipe, restore, same data and a rebuilt full-text index', () => {
		const { raw, db, dbPath } = makeDb('cli');
		const owner = randomUUID();
		db.insert(users).values({ id: owner, email: 'o@example.com', displayName: 'O', createdAt: 'n' }).run();
		const tree = createTree({ raw, db }, owner, { name: 'Cli' }).id;
		for (const n of ['Anita', 'Bishnu', 'Chandra']) createPerson({ raw, db }, owner, tree, { firstName: n, lastName: 'Rai' });
		mkdirSync(`${DIR}/cli/photos/${tree}`, { recursive: true });
		rmSync(`${DIR}/cli/photos/${tree}/p.jpg`, { force: true });
		execFileSync('node', ['-e', `require('fs').writeFileSync('${DIR}/cli/photos/${tree}/p.jpg','img')`]);
		const env = { ...process.env, DATABASE_PATH: dbPath, PHOTO_PATH: `${DIR}/cli/photos`, MIGRATIONS_PATH: './src/lib/db/migrations' };
		execFileSync('npx', ['tsx', 'scripts/backup.ts', `${DIR}/cli/out`], { env, stdio: 'pipe' });
		raw.close();
		const files = readdirSync(`${DIR}/cli/out`);
		const dbFile = files.find((f) => f.startsWith('family-') && f.endsWith('.db'))!;
		const tarFile = files.find((f) => f.startsWith('photos-') && f.endsWith('.tar'))!;
		expect([!!dbFile, !!tarFile]).toEqual([true, true]);
		for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
		rmSync(`${DIR}/cli/photos`, { recursive: true });
		execFileSync('npx', ['tsx', 'scripts/restore.ts', `${DIR}/cli/out/${dbFile}`, `${DIR}/cli/out/${tarFile}`], { env, stdio: 'pipe' });
		const back = new Database(dbPath, { readonly: true });
		expect(back.prepare(`SELECT (SELECT COUNT(*) FROM persons) AS p, (SELECT COUNT(*) FROM persons_fts) AS f`).get()).toEqual({ p: 3, f: 3 });
		back.close();
		expect(existsSync(`${DIR}/cli/photos/${tree}/p.jpg`)).toBe(true);
	}, 60_000);
});
