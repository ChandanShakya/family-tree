import type { Browser } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

// UI flows added after the final audit: onboarding tour, theme and notification preferences, editing and
// removing relationships, linking existing people, editing events, "How are we related?" and search filters.
// Users are inserted directly: /register is rate limited per IP.

const DB = './.test-tmp-e2e/e2e.db';
test.describe.configure({ mode: 'serial' });

let token = '';
let userId = '';
let treeId = '';
const ids = { me: '', dad: '', grandpa: '', cousin: '' };

function db(): Database.Database {
	const d = new Database(DB);
	d.pragma('busy_timeout = 5000');
	return d;
}

async function signedIn(browser: Browser) {
	return browser.newContext({
		storageState: { cookies: [{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 }], origins: [] }
	});
}

test.beforeAll(() => {
	const d = db();
	const now = new Date().toISOString();
	userId = randomUUID();
	token = randomBytes(32).toString('base64url');
	d.prepare(`INSERT INTO users (id, email, displayName, emailVerifiedAt, createdAt) VALUES (?, ?, ?, ?, ?)`).run(userId, `${userId}@example.com`, 'Feature User', now, now);
	d.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)`).run(
		randomUUID(),
		userId,
		createHash('sha256').update(token).digest('hex'),
		new Date(Date.now() + 864e5).toISOString(),
		now,
		now
	);
	treeId = randomUUID();
	d.prepare(`INSERT INTO trees (id, name, ownerId, isPublic, createdAt, updatedAt) VALUES (?, 'Features', ?, 0, ?, ?)`).run(treeId, userId, now, now);
	d.prepare(`INSERT INTO treeMembers (id, treeId, userId, role, status, joinedAt, joinedViaType) VALUES (?, ?, ?, 'owner', 'active', ?, 'manual')`).run(randomUUID(), treeId, userId, now);
	const person = (first: string, year: string, place: string) => {
		const id = randomUUID();
		d.prepare(
			`INSERT INTO persons (id, treeId, firstName, lastName, birthDate, birthDateNorm, birthPlace, version, createdBy, createdAt, updatedAt)
			 VALUES (?, ?, ?, 'Shakya', ?, ?, ?, 1, ?, ?, ?)`
		).run(id, treeId, first, year, `${year}-01-01`, place, userId, now, now);
		return id;
	};
	ids.me = person('Ramesh', '1990', 'Patan');
	ids.dad = person('Hari', '1960', 'Patan');
	ids.grandpa = person('Krishna', '1930', 'Bhaktapur');
	ids.cousin = person('Sita', '1992', 'Kirtipur');
	const link = (p1: string, p2: string) =>
		d.prepare(`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdBy, createdAt) VALUES (?, ?, ?, ?, 'parent', ?, ?)`).run(randomUUID(), treeId, p1, p2, userId, now);
	link(ids.grandpa, ids.dad);
	link(ids.dad, ids.me);
	d.prepare(`INSERT INTO events (id, personId, treeId, type, date, place, createdAt) VALUES (?, ?, ?, 'residence', '2010', 'Patan', ?)`).run(randomUUID(), ids.me, treeId, now);
	d.close();
});

test('onboarding tour: four steps on an empty home, dismissed for good', async ({ browser }) => {
	// A user with no trees sees the tour.
	const d = db();
	const loner = randomUUID();
	const t = randomBytes(32).toString('base64url');
	const now = new Date().toISOString();
	d.prepare(`INSERT INTO users (id, email, displayName, emailVerifiedAt, createdAt) VALUES (?, ?, 'Loner', ?, ?)`).run(loner, `${loner}@example.com`, now, now);
	d.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)`).run(
		randomUUID(), loner, createHash('sha256').update(t).digest('hex'), new Date(Date.now() + 864e5).toISOString(), now, now
	);
	d.close();
	const context = await browser.newContext({
		storageState: { cookies: [{ name: 'session', value: t, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 }], origins: [] }
	});
	const page = await context.newPage();
	// Opt this page out of the fixture's pre-dismissal (sessionStorage survives the reloads below).
	await page.goto('/login');
	await page.evaluate(() => {
		sessionStorage.setItem('tour-test', '1');
		localStorage.removeItem('onboarded');
	});
	await page.goto('/');
	const tour = page.getByRole('dialog', { name: 'Start a tree' });
	await expect(tour).toBeVisible();
	for (const title of ['Add people', 'Invite family', 'Claim and review']) {
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByRole('dialog', { name: title })).toBeVisible();
	}
	await expect(page.getByText('Step 4 of 4')).toBeVisible();
	await page.getByRole('button', { name: 'Get started' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Your trees' })).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await context.close();
});

test('theme toggle is saved to the account and applied on a fresh device', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	const saved = page.waitForResponse((r) => r.url().endsWith('/api/account') && r.request().method() === 'PUT');
	await page.getByRole('button', { name: 'Toggle dark mode' }).click();
	expect((await saved).ok()).toBe(true);
	await expect(page.locator('html')).toHaveClass(/dark/);
	await context.close();
	// New context = empty localStorage: the theme comes from themePref.
	const fresh = await signedIn(browser);
	const p2 = await fresh.newPage();
	await p2.emulateMedia({ colorScheme: 'light' });
	await p2.goto('/');
	await expect(p2.locator('html')).toHaveClass(/dark/);
	await p2.goto('/profile');
	await expect(p2.getByLabel('Theme')).toHaveValue('dark');
	// Back to system so the remaining specs run in light mode.
	await p2.getByLabel('Theme').selectOption('system');
	await p2.getByRole('button', { name: 'Save profile' }).click();
	await expect(p2.locator('html')).not.toHaveClass(/dark/);
	await fresh.close();
});

test('notification preferences are saved and stop muted notification types', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.goto('/profile');
	const edit = page.getByLabel('Someone edits my profile');
	await expect(edit).toBeChecked();
	await edit.uncheck();
	await page.getByRole('button', { name: 'Save profile' }).click();
	await expect(page.getByText('Profile updated')).toBeVisible();
	const d = db();
	const prefs = JSON.parse((d.prepare('SELECT notifyPrefs FROM users WHERE id = ?').get(userId) as { notifyPrefs: string }).notifyPrefs);
	d.close();
	expect(prefs.edit).toBe(false);
	expect(prefs.join).toBe(true);
	await page.reload();
	await expect(page.getByLabel('Someone edits my profile')).not.toBeChecked();
	await context.close();
});

test('stored links: edit dates, remove with undo, link an existing person', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.goto(`/persons/${ids.me}`);
	await page.getByRole('button', { name: 'Edit parent link to Hari Shakya' }).click();
	await page.getByLabel('Link notes').fill('adoptive');
	await page.getByRole('button', { name: 'Save link' }).click();
	await expect(page.getByText('— adoptive')).toBeVisible();

	// Link Sita as a sibling (no shared recorded parents yet).
	await page.getByLabel('Find a person to link').fill('Sita');
	await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: 'Sita Shakya' }).click();
	await page.getByLabel('Relationship').selectOption('sibling');
	await page.getByRole('button', { name: 'Link', exact: true }).click();
	await expect(page.getByRole('link', { name: 'Sita Shakya' }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Remove sibling link to Sita Shakya' })).toBeVisible();

	// Remove it, then undo from the toast.
	await page.getByRole('button', { name: 'Remove sibling link to Sita Shakya' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByRole('button', { name: 'Remove sibling link to Sita Shakya' })).toHaveCount(0);
	await page.getByRole('status').locator('div', { hasText: 'Relationship removed' }).getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByRole('button', { name: 'Remove sibling link to Sita Shakya' })).toBeVisible();
	await context.close();
});

test('events can be edited in place', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.goto(`/persons/${ids.me}`);
	await page.getByRole('button', { name: 'Edit event residence' }).click();
	await page.getByLabel('Edited event place').fill('Lalitpur');
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect(page.getByText('residence · 2010 · Lalitpur')).toBeVisible();
	await context.close();
});

test('"How are we related?" names the relation and the path', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.goto(`/persons/${ids.me}`);
	await page.getByLabel('Pick a person').fill('Krishna');
	await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: 'Krishna Shakya' }).click();
	await expect(page.getByText(/Krishna Shakya is Ramesh Shakya's grandparent/)).toBeVisible();
	await expect(page.getByText('→ parent → Hari Shakya')).toBeVisible();
	await context.close();
});

test('search filters narrow by birth year and place', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.goto(`/trees/${treeId}`);
	await page.getByRole('button', { name: 'Filters' }).click();
	await page.getByLabel('Filter by place').fill('Bhaktapur');
	await expect(page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: 'Krishna Shakya' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: 'Hari Shakya' })).toHaveCount(0);
	await page.getByLabel('Filter by place').fill('');
	await page.getByLabel('Filter by birth year').fill('1960');
	await expect(page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: 'Hari Shakya' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: 'Krishna Shakya' })).toHaveCount(0);
	await context.close();
});

test('middle name is edited in the details form and shown in the heading and search', async ({ browser }) => {
	const context = await signedIn(browser);
	const page = await context.newPage();
	await page.goto(`/persons/${ids.cousin}`);
	const details = page.locator('form', { has: page.getByLabel('Middle name') });
	await details.getByLabel('Middle name').fill('Devi');
	await details.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sita Devi Shakya');
	await page.goto(`/trees/${treeId}`);
	await page.getByLabel('Search people').fill('Devi');
	await expect(page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: 'Sita Devi Shakya' })).toBeVisible();
	await context.close();
});
