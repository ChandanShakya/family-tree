import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

// AT-30 (CSP) and accessibility (axe, WCAG 2 A/AA) over the main pages, in light and dark mode.
// AT-45 (service worker). Users are inserted directly: /register is rate limited per IP.

const DB = './.test-tmp-e2e/e2e.db';
test.describe.configure({ mode: 'serial' });

interface Seed {
	treeId: string;
	publicTreeId: string;
	personId: string;
	deadId: string;
	code: string;
	token: string;
}
let seed: Seed;

function db(): Database.Database {
	const d = new Database(DB);
	d.pragma('busy_timeout = 5000');
	return d;
}

function insertUser(d: Database.Database, name: string) {
	const id = randomUUID();
	const token = randomBytes(32).toString('base64url');
	const now = new Date().toISOString();
	d.prepare(`INSERT INTO users (id, email, displayName, emailVerifiedAt, createdAt) VALUES (?, ?, ?, ?, ?)`).run(id, `${id}@example.com`, name, now, now);
	d.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)`).run(
		randomUUID(),
		id,
		createHash('sha256').update(token).digest('hex'),
		new Date(Date.now() + 864e5).toISOString(),
		now,
		now
	);
	return { id, token };
}

async function signedIn(browser: Browser, token = seed.token) {
	return browser.newContext({
		storageState: { cookies: [{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 }], origins: [] }
	});
}

test.beforeAll(async ({ browser }) => {
	const d = db();
	const owner = insertUser(d, 'Quality Owner');
	const now = new Date().toISOString();
	const tree = (name: string, pub: number) => {
		const id = randomUUID();
		d.prepare(`INSERT INTO trees (id, name, ownerId, isPublic, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`).run(id, name, owner.id, pub, now, now);
		d.prepare(`INSERT INTO treeMembers (id, treeId, userId, role, status, joinedAt, joinedViaType) VALUES (?, ?, ?, 'owner', 'active', ?, 'manual')`).run(randomUUID(), id, owner.id, now);
		return id;
	};
	const person = (treeId: string, first: string, last: string, extra: Record<string, unknown> = {}) => {
		const id = randomUUID();
		d.prepare(
			`INSERT INTO persons (id, treeId, firstName, lastName, birthDate, birthDateNorm, deathDate, deathDateNorm, birthPlace, isLiving, version, createdBy, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
		).run(id, treeId, first, last, extra.birth ?? null, extra.birthNorm ?? null, extra.death ?? null, extra.deathNorm ?? null, extra.place ?? null, extra.living ?? null, owner.id, now, now);
		return id;
	};
	const treeId = tree('Quality Tree', 0);
	const publicTreeId = tree('Quality Public', 1);
	const personId = person(treeId, 'Asha', 'Rai', { birth: '1950', birthNorm: '1950-00-00', place: 'Pokhara', living: 0, death: '2010', deathNorm: '2010-00-00' });
	const kid = person(treeId, 'Bikash', 'Rai', { birth: '1975', birthNorm: '1975-00-00' });
	d.prepare(`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdBy, createdAt) VALUES (?, ?, ?, ?, 'parent', ?, ?)`).run(randomUUID(), treeId, personId, kid, owner.id, now);
	const deadId = person(publicTreeId, 'Dev', 'Deceased', { birth: '1900', birthNorm: '1900-00-00', death: '1980', deathNorm: '1980-00-00', place: 'Oldtown', living: 0 });
	person(publicTreeId, 'Lila', 'Living', { birth: '1990', birthNorm: '1990-00-00', place: 'Secretville', living: 1 });
	const code = `QUALITY-${randomBytes(4).toString('hex').toUpperCase()}`;
	d.prepare(`INSERT INTO joinCodes (id, code, type, treeId, createdBy, role, maxUses, currentUses, isActive, createdAt) VALUES (?, ?, 'family', ?, ?, 'contributor', 50, 0, 1, ?)`).run(randomUUID(), code, treeId, owner.id, now);
	d.close();
	seed = { treeId, publicTreeId, personId, deadId, code, token: owner.token };
	void browser;
});

function watchCsp(page: Page): string[] {
	const violations: string[] = [];
	page.on('console', (m) => {
		if (/content security policy|violates the following/i.test(m.text())) violations.push(m.text());
	});
	void page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (e) => {
			console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
		});
	});
	return violations;
}

async function checkPage(page: Page, path: string, label: string, opts: { expectUrl?: RegExp } = {}) {
	const csp = watchCsp(page);
	await page.goto(path);
	await page.waitForLoadState('networkidle');
	if (opts.expectUrl) await expect(page).toHaveURL(opts.expectUrl);
	await page.getByRole('main').first().waitFor();
	expect.soft(csp, `CSP violations on ${label}`).toEqual([]);
	const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
	const bad = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
	expect.soft(bad, `axe on ${label}`).toEqual([]);
}

const signedInPages = (s: Seed): Array<[string, string]> => [
	['/', 'home'],
	['/profile', 'profile'],
	['/notifications', 'notifications'],
	[`/trees/${s.treeId}`, 'tree'],
	[`/trees/${s.treeId}/members`, 'members'],
	[`/trees/${s.treeId}/claims`, 'claims'],
	[`/trees/${s.treeId}/claim`, 'find yourself'],
	[`/trees/${s.treeId}/activity`, 'activity'],
	[`/trees/${s.treeId}/media`, 'photos'],
	[`/trees/${s.treeId}/data`, 'import/export'],
	[`/trees/${s.treeId}/settings`, 'settings'],
	[`/persons/${s.personId}`, 'person']
];

for (const scheme of ['light', 'dark'] as const) {
	test(`AT-30: no CSP violations and no axe violations on signed-in pages (${scheme})`, async ({ browser }) => {
		const context = await signedIn(browser);
		await context.addInitScript((s) => {
			try {
				localStorage.setItem('theme', s);
			} catch {
				// ignore
			}
		}, scheme);
		for (const [path, label] of signedInPages(seed)) {
			await checkPage(await context.newPage(), path, `${label} (${scheme})`);
		}
		await context.close();
	});

	test(`AT-30: anonymous pages (${scheme})`, async ({ browser }) => {
		const context = await browser.newContext();
		await context.addInitScript((s) => {
			try {
				localStorage.setItem('theme', s);
			} catch {
				// ignore
			}
		}, scheme);
		for (const [path, label] of [
			['/login', 'login'],
			['/register', 'register'],
			['/forgot', 'forgot password'],
			[`/trees/${seed.publicTreeId}`, 'public tree'],
			[`/persons/${seed.deadId}`, 'public person'],
			['/join/NOPE-ABCDEFGH', 'unavailable code']
		] as const) {
			await checkPage(await context.newPage(), path, `${label} (${scheme})`);
		}
		await context.close();
	});
}

async function axeOpenDialog(page: Page, label: string) {
	await expect(page.getByRole('dialog')).toBeVisible();
	// axe samples colours mid fade-in otherwise (flaky colour-contrast on slow runners).
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
	const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
	const bad = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
	expect.soft(bad, `axe with ${label} open`).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
	test(`AT-30: no axe violations with dialogs open: add person, confirm, onboarding tour (${scheme})`, async ({ browser }) => {
		const context = await signedIn(browser);
		await context.addInitScript((s) => localStorage.setItem('theme', s), scheme);
		const page = await context.newPage();
		await page.goto(`/trees/${seed.treeId}`);
		await page.getByRole('button', { name: 'Add person', exact: true }).click();
		await axeOpenDialog(page, `add person (${scheme})`);
		await page.keyboard.press('Escape');
		await page.goto(`/persons/${seed.personId}`);
		await page.getByRole('button', { name: 'Delete person' }).click();
		await axeOpenDialog(page, `confirm (${scheme})`);
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('heading', { name: 'Asha Rai' })).toBeVisible();
		// The tour shows only to a user with no trees.
		const d = db();
		const loner = insertUser(d, `Tour ${scheme}`);
		d.close();
		const lonely = await signedIn(browser, loner.token);
		await lonely.addInitScript((s) => {
			sessionStorage.setItem('tour-test', '1');
			localStorage.removeItem('onboarded');
			localStorage.setItem('theme', s);
		}, scheme);
		const p2 = await lonely.newPage();
		await p2.goto('/');
		await axeOpenDialog(p2, `onboarding tour (${scheme})`);
		await lonely.close();
		await context.close();
	});
}

test('AT-30: the join link redirects a visitor through login with the way back', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await checkPage(page, `/join/${seed.code}`, 'join redirect', { expectUrl: /\/login\?next=%2Fjoin%2F/ });
	await context.close();
});

test('AT-45: the service worker precaches only the shell; offline shows the fallback page and nothing from the API or photos is cached', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Your trees' })).toBeVisible();
	// wait for the worker to take control
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await page.waitForFunction(() => !!navigator.serviceWorker.controller);
	// data requests while online (never cached)
	await page.goto(`/trees/${seed.treeId}`);
	await page.evaluate(async (id) => {
		await fetch(`/api/trees/${id}`);
		await fetch('/api/notifications');
	}, seed.treeId);
	const keys = await page.evaluate(async () => {
		const out: string[] = [];
		for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
		return out;
	});
	expect(keys.length).toBeGreaterThan(5);
	expect(keys).toContain('/offline.html');
	expect(keys.filter((k) => k.startsWith('/api/') || k.startsWith('/photos/'))).toEqual([]);
	expect(keys.filter((k) => /^\/(trees|persons|join|profile)(\/|$)/.test(k) || k === '/')).toEqual([]); // no HTML pages
	// offline: a page request gets the fallback, not cached data
	await context.setOffline(true);
	await page.goto(`/trees/${seed.treeId}`).catch(() => undefined);
	await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
	await expect(page.getByText('Quality Tree')).toHaveCount(0);
	await context.setOffline(false);
	await context.close();
});
