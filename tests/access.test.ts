import { stopServer } from './helpers.js';
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/db/schema.js';
import { treeMembers, users } from '$lib/db/schema.js';
import { applyPragmas } from '$lib/db/index.js';
import { createSession } from '$lib/server/auth.js';
import { createTree } from '$lib/server/trees.js';
import { createPerson } from '$lib/server/persons.js';
import { createLink } from '$lib/server/relations.js';
import { createEvent } from '$lib/server/events.js';
import { addMedia } from '$lib/server/media.js';
import { canDo, type Role } from '$lib/server/permissions.js';
import { ROUTE_POLICIES, type ProbeContext } from '$lib/server/route-policies.js';
import { createDirectCode, redeemCode } from '$lib/server/codes.js';
import { getFamilyCode } from '$lib/server/join-codes.js';
import { submitClaim } from '$lib/server/claims.js';
import { updatePerson } from '$lib/server/persons.js';

// Live-server probe of every `tree`-access route, auto-generated from the
// route policy registry (§8): no session → 401, non-member → 404,
// below-role → 403, at-role → success. Runs against `node build`, like AT-47.

const DIR = './.test-tmp-access';
const DB = `${DIR}/access.db`;
const PHOTOS = `${DIR}/photos`;
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4Y2x8xtiYAUIBACPqBMlwUmUNAAAAAElFTkSuQmCC',
	'base64'
);
const PORT = 4192;
const BASE = `http://localhost:${PORT}`;

interface Fixture {
	treeA: string;
	treeB: string;
	treeC: string;
	treeD: string;
	personA1: string;
	personA2: string;
	personA3: string;
	personB1: string;
	linkA1: string;
	linkA2: string;
	eventA1: string;
	eventA2: string;
	extra: Extra;
	mediaA1: string;
	mediaA2: string;
	memberX: string;
	editorA: string;
	cookies: Record<Role & string, string> & { ownerB: string };
}

let fx: Fixture;
let server: ReturnType<typeof import('node:child_process').spawn> | null = null;

function fill(route: string, params: Record<string, string>): string {
	return route.replace(/:([A-Za-z]+)/g, (_, k) => params[k] ?? `missing-${k}`);
}

async function seed(): Promise<Fixture> {
	rmSync(DB, { force: true });
	mkdirSync(DIR, { recursive: true });
	const raw = new Database(DB);
	applyPragmas(raw);
	migrate(drizzle(raw), { migrationsFolder: './src/lib/db/migrations' });
	const db = drizzle(raw, { schema });
	const now = new Date().toISOString();
	const addUser = (email: string) => {
		const id = randomUUID();
		db.insert(users).values({ id, email, displayName: email, emailVerifiedAt: now, createdAt: now }).run();
		return id;
	};
	const handles = { raw, db };
	const ownerA = addUser('ax-owner@example.com');
	const editorA = addUser('ax-editor@example.com');
	const contributorA = addUser('ax-contrib@example.com');
	const viewerA = addUser('ax-viewer@example.com');
	const ownerB = addUser('bx-owner@example.com');
	const memberX = addUser('ax-memberx@example.com');
	const treeA = createTree(handles, ownerA, { name: 'A' }).id;
	const treeB = createTree(handles, ownerB, { name: 'B' }).id;
	const treeC = createTree(handles, ownerA, { name: 'C' }).id;
	const treeD = createTree(handles, ownerA, { name: 'D' }).id;
	const addMember = (treeId: string, userId: string, role: string) => {
		db.insert(treeMembers).values({
			id: `m-${treeId}-${userId}`,
			treeId,
			userId,
			role,
			status: 'active',
			joinedAt: now,
			joinedViaType: 'manual'
		}).run();
	};
	addMember(treeA, editorA, 'editor');
	addMember(treeA, contributorA, 'contributor');
	addMember(treeA, viewerA, 'viewer');
	addMember(treeA, memberX, 'viewer');
	addMember(treeD, editorA, 'editor');
	const personA1 = createPerson(handles, ownerA, treeA, { firstName: 'A1' }).id;
	const personA2 = createPerson(handles, ownerA, treeA, { firstName: 'A2' }).id;
	const personA3 = createPerson(handles, ownerA, treeA, { firstName: 'A3' }).id;
	const personB1 = createPerson(handles, ownerB, treeB, { firstName: 'B1' }).id;
	const linkA1 = (createLink(handles, ownerA, treeA, { person1Id: personA1, person2Id: personA2, type: 'spouse' }) as { id: string }).id;
	const linkA2 = (createLink(handles, ownerA, treeA, { person1Id: personA1, person2Id: personA3, type: 'spouse' }) as { id: string }).id;
	const eventA1 = (createEvent(handles, ownerA, treeA, { personId: personA1, type: 'residence' }) as { id: string }).id;
	const eventA2 = (createEvent(handles, ownerA, treeA, { personId: personA1, type: 'occupation' }) as { id: string }).id;
	const cookieFor = async (userId: string) => (await createSession(db, userId, null)).token;
	const cookies = {
		owner: await cookieFor(ownerA),
		editor: await cookieFor(editorA),
		contributor: await cookieFor(contributorA),
		viewer: await cookieFor(viewerA),
		ownerB: await cookieFor(ownerB)
	};
	process.env.PHOTO_PATH = PHOTOS;
	const mkMedia = async () => {
		const r = await addMedia(handles, ownerA, treeA, { personId: personA1, buf: PNG });
		if ('error' in r) throw new Error(r.error);
		return r.media.id;
	};
	const mediaA1 = await mkMedia();
	const mediaA2 = await mkMedia();
	// Phase 4 fixtures: a direct code (made by the contributor), a pending joiner, a pending claim, a person edit to revert.
	const directCode = createDirectCode(handles, contributorA, 'contributor', treeA, { linkedPersonId: personA2, linkedRelationType: 'child', role: 'viewer' });
	if ('error' in directCode) throw new Error(directCode.error);
	const pendingUser = addUser('ax-pending@example.com');
	const joined = redeemCode(handles, pendingUser, getFamilyCode(db, treeA)!.code, { firstName: 'Pending' });
	if (!joined.ok) throw new Error(joined.error);
	const claimant = addUser('ax-claimant@example.com');
	addMember(treeA, claimant, 'viewer');
	const personA4 = createPerson(handles, ownerA, treeA, { firstName: 'Claimable' }).id;
	const claim = submitClaim(handles, claimant, { treeId: treeA, personId: personA4, proofMethod: 'manual' });
	if (!claim.ok) throw new Error(claim.error);
	const personA5 = createPerson(handles, ownerA, treeA, { firstName: 'Edited' }).id;
	const edited = updatePerson(handles, ownerA, personA5, 1, { firstName: 'Edited2' });
	if (!('updated' in edited)) throw new Error('edit failed');
	const hist = raw.prepare(`SELECT id FROM changeHistory WHERE entityId = ? AND action = 'update' AND field = 'firstName'`).get(personA5) as { id: string };
	const extra: Extra = { directCodeId: directCode.id, pendingUserId: pendingUser, claimId: claim.claimId, historyId: hist.id };
	raw.close();
	return {
		extra,
		treeA, treeB, treeC, treeD, personA1, personA2, personA3, personB1,
		linkA1, linkA2, eventA1, eventA2, mediaA1, mediaA2, memberX, editorA, cookies
	};
}

async function req(
	method: string,
	path: string,
	opts?: { cookie?: string; body?: unknown; query?: Record<string, string>; form?: Record<string, string> }
): Promise<{ status: number; json: unknown }> {
	const url = new URL(path, BASE);
	for (const [k, v] of Object.entries(opts?.query ?? {})) url.searchParams.set(k, v);
	const hasBody = opts?.body !== undefined && method !== 'GET' && method !== 'HEAD';
	let formBody: FormData | undefined;
	if (opts?.form) {
		formBody = new FormData();
		for (const [k, v] of Object.entries(opts.form)) formBody.set(k, v);
		formBody.set('file', new Blob([PNG], { type: 'image/png' }), 'probe.png');
	}
	const res = await fetch(url, {
		method,
		headers: {
			...(opts?.cookie ? { cookie: `session=${opts.cookie}` } : {}),
			...(formBody ? { origin: BASE } : {}),
			...(hasBody ? { 'content-type': 'application/json' } : {})
		},
		body: formBody ?? (hasBody ? JSON.stringify(opts?.body) : undefined)
	});
	const json = await res.json().catch(() => null);
	return { status: res.status, json };
}

type Extra = Pick<ProbeContext, 'directCodeId' | 'pendingUserId' | 'claimId' | 'historyId'>;
const NOPE: Extra = { directCodeId: 'nope', pendingUserId: 'nope', claimId: 'nope', historyId: 'nope' };

function ctxFor(treeId: string, personId: string, otherId: string, linkId: string, eventId: string, member: string, mediaId: string, extra: Extra = NOPE): ProbeContext {
	return { treeId, personId, otherPersonId: otherId, linkId, eventId, memberUserId: member, mediaId, ...extra };
}

const treePolicies = ROUTE_POLICIES.filter((p) => p.access === 'tree');

function lowestAllowed(action: string): Role {
	const order: Role[] = ['viewer', 'contributor', 'editor', 'owner'];
	return order.find((r) => canDo(r, action as never)) ?? 'owner';
}

function highestDenied(action: string): Role | null {
	const order: Role[] = ['owner', 'editor', 'contributor', 'viewer'];
	return order.find((r) => !canDo(r, action as never)) ?? null;
}

beforeAll(async () => {
	fx = await seed();
	const { spawn } = await import('node:child_process');
	server = spawn('node', ['build'], {
		env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, ORIGIN: BASE, RATE_LIMIT_API_MAX: '100000', PHOTO_PATH: PHOTOS }
	});
	for (let i = 0; i < 60; i++) {
		try {
			const r = await fetch(`${BASE}/api/health`);
			if (r.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error('built server did not respond');
}, 60_000);

afterAll(async () => {
	await stopServer(server);
	rmSync(DIR, { force: true, recursive: true });
});

describe('AT-29: registry probe matrix over live routes', () => {
	test('AT-29: anonymous callers get 401 on every tree route', async () => {
		for (const p of treePolicies) {
			const probe = p.probe?.(ctxFor(fx.treeA, fx.personA1, fx.personA2, fx.linkA1, fx.eventA1, fx.memberX, fx.mediaA1, fx.extra));
			const path = fill(p.route, probe?.params ?? {});
			const query = p.route.endsWith('/relation') ? { to: fx.personA2 } : (probe?.query as Record<string, string> | undefined);
			const r = await req(p.method, path, { body: probe?.body, query, form: probe?.form });
			expect(r.status, `${p.method} ${p.route}`).toBe(401);
		}
	});

	test('AT-29 (/photos, a session route outside the tree matrix): anonymous 401, other tree 404, member 200, traversal 404', async () => {
		const raw = new Database(DB, { readonly: true });
		const m = raw.prepare(`SELECT storagePath, thumbPath FROM media WHERE id = ?`).get(fx.mediaA1) as { storagePath: string; thumbPath: string | null };
		raw.close();
		const get = (path: string, cookie?: string) => fetch(`${BASE}/photos/${path}`, { headers: cookie ? { cookie: `session=${cookie}` } : {} });
		for (const path of [m.storagePath, m.thumbPath].filter(Boolean) as string[]) {
			expect((await get(path)).status, `anon ${path}`).toBe(401);
			expect((await get(path, fx.cookies.ownerB)).status, `tree B ${path}`).toBe(404);
			for (const role of ['owner', 'editor', 'contributor', 'viewer'] as const) {
				const r = await get(path, fx.cookies[role]);
				expect(r.status, `${role} ${path}`).toBe(200);
				expect(r.headers.get('cache-control')).toMatch(/^private/);
				await r.arrayBuffer();
			}
		}
		for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'nope/x.webp', `${fx.treeA}%2F..%2F..%2Fh.db`]) {
			expect((await get(bad, fx.cookies.owner)).status, bad).toBe(404);
		}
	});

	test('AT-09: active member of tree A calling tree B routes gets 404 everywhere', async () => {
		for (const p of treePolicies) {
			const probe = p.probe?.(ctxFor(fx.treeB, fx.personB1, fx.personB1, 'nope', 'nope', 'nope', 'nope'));
			const path = fill(p.route, probe?.params ?? {});
			const query = p.route.endsWith('/relation') ? { to: fx.personB1 } : (probe?.query as Record<string, string> | undefined);
			const r = await req(p.method, path, { cookie: fx.cookies.owner, body: probe?.body, query, form: probe?.form });
			expect(r.status, `${p.method} ${p.route}`).toBe(404);
		}
	});

	test('AT-07: viewer gets 403 on every route above the viewer role', async () => {
		const targets = treePolicies.filter((p) => p.action && !canDo('viewer', p.action));
		expect(targets.length).toBeGreaterThan(0);
		for (const p of targets) {
			const probe = p.probe?.(ctxFor(fx.treeA, fx.personA1, fx.personA2, fx.linkA1, fx.eventA1, fx.memberX, fx.mediaA1, fx.extra));
			const path = fill(p.route, probe?.params ?? {});
			const query = p.route.endsWith('/relation') ? { to: fx.personA2 } : (probe?.query as Record<string, string> | undefined);
			const r = await req(p.method, path, { cookie: fx.cookies.viewer, body: probe?.body, query, form: probe?.form });
			expect(r.status, `${p.method} ${p.route}`).toBe(403);
		}
	});

	test('AT-29: below-role callers get 403; at-role callers succeed', async () => {
		for (const p of treePolicies) {
			if (!p.action || !p.probe) continue;
			const denied = highestDenied(p.action);
			if (denied) {
				const probe = p.probe(ctxFor(fx.treeA, fx.personA1, fx.personA2, fx.linkA1, fx.eventA1, fx.memberX, fx.mediaA1, fx.extra));
				const path = fill(p.route, probe.params ?? {});
				const query = p.route.endsWith('/relation') ? { to: fx.personA2 } : (probe?.query as Record<string, string> | undefined);
				const r = await req(p.method, path, {
					cookie: fx.cookies[denied],
					body: probe.body,
					query,
					form: probe.form
				});
				expect(r.status, `${p.method} ${p.route} as ${denied}`).toBe(403);
			}
		}
		// Success passes, each against a caller at the lowest allowed role.
		// Destructive probes use expendable fixtures; the tree transfer and
		// the tree delete run last because they change ownership/existence.
		const deferred: typeof treePolicies = [];
		const order = treePolicies.filter((p) => {
			if (p.route.endsWith('/transfer') || (p.route === '/api/trees/:id' && p.method === 'DELETE')) {
				deferred.push(p);
				return false;
			}
			return true;
		});
		for (const p of order) {
			if (!p.action || !p.probe) continue;
			const role = lowestAllowed(p.action);
			let probe = p.probe(ctxFor(fx.treeA, fx.personA1, fx.personA2, fx.linkA1, fx.eventA1, fx.memberX, fx.mediaA1, fx.extra));
			let cookie = fx.cookies[role];
			if (p.route === '/api/relationships' && p.method === 'POST') {
				// The fixture pair is already linked; mint a fresh person first.
				const created = await req('POST', '/api/persons', {
					cookie: fx.cookies.contributor,
					body: { treeId: fx.treeA, firstName: 'RelNew' }
				});
				expect(created.status).toBe(201);
				const newId = (created.json as { data: { id: string } }).data.id;
				probe = { body: { treeId: fx.treeA, person1Id: fx.personA1, person2Id: newId, type: 'spouse' } };
				cookie = fx.cookies.contributor;
			}
			if (p.route === '/api/persons/:id' && p.method === 'DELETE') {
				probe = { params: { id: fx.personA3 } };
			}
			if (p.route === '/api/relationships/:id' && p.method === 'DELETE') {
				probe = { params: { id: fx.linkA2 } };
			}
			if (p.route === '/api/media/:id' && p.method === 'DELETE') {
				probe = { params: { id: fx.mediaA2 } };
			}
			if (p.route === '/api/events/:id' && p.method === 'DELETE') {
				probe = { params: { id: fx.eventA2 } };
			}
			if (p.route.endsWith('/members/:userId')) {
				probe = { params: { id: fx.treeA, userId: fx.memberX }, body: probe.body };
			}
			const path = fill(p.route, probe.params ?? {});
			const query = p.route.endsWith('/relation') ? { to: fx.personA2 } : (probe?.query as Record<string, string> | undefined);
			const r = await req(p.method, path, { cookie, body: probe.body, query, form: probe.form });
			expect([200, 201].includes(r.status), `${p.method} ${p.route} as ${role}: ${r.status}`).toBe(true);
		}
		// Deferred last: ownership transfer (treeD) then tree deletion (treeC).
		for (const p of deferred) {
			if (!p.probe) continue;
			let probe: { params?: Record<string, string>; body?: unknown };
			if (p.route.endsWith('/transfer')) {
				probe = {
					params: { id: fx.treeD },
					body: { userId: fx.editorA }
				};
			} else {
				probe = { params: { id: fx.treeC }, body: { confirmName: 'C' } };
			}
			const path = fill(p.route, probe.params ?? {});
			const r = await req(p.method, path, { cookie: fx.cookies.owner, body: probe.body });
			expect([200, 201].includes(r.status), `${p.method} ${p.route} deferred: ${r.status}`).toBe(true);
		}
	});

	test('unverified owner cannot make a tree public (§5.1)', async () => {
		const raw = new Database(DB);
		const set = (v: string | null) => raw.prepare(`UPDATE users SET emailVerifiedAt = ? WHERE email = 'ax-owner@example.com'`).run(v);
		try {
			set(null);
			const r = await req('PUT', `/api/trees/${fx.treeA}`, { cookie: fx.cookies.owner, body: { isPublic: true } });
			expect(r.status).toBe(403);
			const c = await req('POST', '/api/join-codes', { cookie: fx.cookies.owner, body: { treeId: fx.treeA, type: 'family' } });
			expect(c.status).toBe(403);
			set(new Date().toISOString());
			const ok = await req('PUT', `/api/trees/${fx.treeA}`, { cookie: fx.cookies.owner, body: { isPublic: true } });
			expect(ok.status).toBe(200);
		} finally {
			raw.close();
		}
	});
}, 180_000);
