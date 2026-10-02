import type { Browser, BrowserContext } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const DB = './.test-tmp-e2e/e2e.db';
const BASE = 'http://localhost:4173';
test.describe.configure({ mode: 'serial' });

let state: Awaited<ReturnType<BrowserContext['storageState']>>;
let userId = '';

async function ctx(browser: Browser) {
	return browser.newContext({ storageState: state });
}

// One account for the whole run: register is rate limited per IP.
test.beforeAll(async ({ playwright }) => {
	const api = await playwright.request.newContext({ baseURL: BASE });
	const email = `e2e-${randomUUID()}@example.com`;
	const reg = await api.post('/api/auth/register', { data: { email, password: 'correct horse battery', displayName: 'E2E User' } });
	expect(reg.ok()).toBe(true);
	const login = await api.post('/api/auth/login', { data: { email, password: 'correct horse battery' } });
	expect(login.ok()).toBe(true);
	state = await api.storageState();
	const raw = new Database(DB);
	raw.pragma('busy_timeout = 5000');
	userId = (raw.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;
	raw.prepare('UPDATE users SET emailVerifiedAt = ? WHERE id = ?').run(new Date().toISOString(), userId);
	raw.close();
});

/** Tree via the API, people and parent links via one bulk SQL transaction. */
async function seedTree(browser: Browser, people: number) {
	const c = await ctx(browser);
	const created = await c.request.post('/api/trees', { data: { name: `E2E ${people}` } });
	expect(created.ok()).toBe(true);
	const treeId = (await created.json()).data.tree.id as string;
	await c.close();
	const raw = new Database(DB);
	raw.pragma('journal_mode = WAL');
	raw.pragma('busy_timeout = 5000');
	const now = new Date().toISOString();
	const ids: string[] = [];
	raw.transaction(() => {
		const ins = raw.prepare(
			`INSERT INTO persons (id, treeId, firstName, lastName, birthDate, birthDateNorm, version, createdBy, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
		);
		for (let i = 0; i < people; i++) {
			const id = randomUUID();
			ids.push(id);
			const y = `${1900 + (i % 100)}`;
			ins.run(id, treeId, `Person${i}`, `Fam${i % 7}`, y, `${y}-01-01`, userId, now, now);
		}
		const rel = raw.prepare(
			`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, createdBy, createdAt) VALUES (?, ?, ?, ?, 'parent', ?, ?)`
		);
		for (let i = 0; i < people; i++)
			for (const c2 of [2 * i + 1, 2 * i + 2]) if (c2 < people) rel.run(randomUUID(), treeId, ids[i], ids[c2], userId, now);
	})();
	raw.close();
	return { treeId, ids };
}

test('tree renders, Ctrl+K search highlights a person, Escape clears', async ({ browser }) => {
	const { treeId } = await seedTree(browser, 12);
	const page = await (await ctx(browser)).newPage();
	await page.goto(`/trees/${treeId}`);
	await expect(page.locator('svg g[role=button]')).toHaveCount(12);
	await page.keyboard.press('Control+k');
	await expect(page.getByLabel('Search people')).toBeFocused();
	await page.keyboard.type('Person5');
	const hit = page.locator('li button', { hasText: 'Person5 Fam5' });
	await hit.click();
	await expect(page.locator('svg g[role=button][aria-label="Person5 Fam5"] rect')).toHaveAttribute('stroke-width', '3');
	await page.getByLabel('Search people').focus();
	await page.keyboard.type('x');
	await page.keyboard.press('Escape');
	await expect(page.getByLabel('Search people')).toHaveValue('');
	// Orientation toggle re-lays the tree out left to right.
	const box = async () => (await page.locator('svg g[role=button]').first().boundingBox())!;
	await page.getByRole('button', { name: 'Left to right' }).click();
	await expect(page.getByRole('button', { name: 'Top to bottom' })).toBeVisible();
	await expect(page.locator('svg g[role=button]')).toHaveCount(12);
	expect((await box()).width).toBeGreaterThan(0);
	// Surname + duplicates panels are wired.
	await page.getByRole('button', { name: 'Surnames' }).click();
	await expect(page.getByRole('button', { name: /^Fam0 \(\d+\)$/ })).toBeVisible();
	await page.getByRole('button', { name: 'Possible duplicates' }).click();
	await expect(page.getByText('Advisory only')).toBeVisible();
});

test('500-node tree renders (layout + render under 500 ms, R-PERF-4)', async ({ browser }) => {
	const { treeId } = await seedTree(browser, 500);
	const page = await (await ctx(browser)).newPage();
	page.on('pageerror', (e) => console.log('[pageerror]', e.message));
	await page.goto(`/trees/${treeId}`);
	await expect(page.locator('svg g[role=button]')).toHaveCount(500, { timeout: 30_000 });
	const ms = await page.evaluate(() => performance.getEntriesByName('tree-layout-render').at(-1)?.duration ?? -1);
	console.log(`R-PERF-4 500-node layout+render: ${ms.toFixed(0)} ms`);
	expect(ms).toBeGreaterThan(0);
	// Shared CI runners are slower and noisy; the 500 ms budget is checked on dev hardware (BENCHMARKS.md).
	expect(ms).toBeLessThan(process.env.CI ? 1500 : 500);
});

test('focus mode: over-threshold tree is bounded and says so', async ({ browser }) => {
	const { treeId } = await seedTree(browser, 520);
	const page = await (await ctx(browser)).newPage();
	await page.goto(`/trees/${treeId}`);
	await expect(page.getByText(/Showing \d+ of 520 people/)).toBeVisible();
	await expect(page.locator('svg g[role=button]').first()).toBeAttached();
	const shown = await page.locator('svg g[role=button]').count();
	expect(shown).toBeLessThan(520);
});

test('person flow: add, edit, event, photo upload, delete', async ({ browser }) => {
	const c = await ctx(browser);
	const page = await c.newPage();
	await page.goto('/');
	await page.getByRole('button', { name: 'New tree' }).first().click();
	await page.getByLabel('New tree name').fill('Flow Tree');
	await page.getByRole('button', { name: 'Create tree' }).click();
	await expect(page).toHaveURL(/\/trees\/[0-9a-f-]+\?new=1/);
	// Empty tree prompts to add the first person.
	const dlg = page.getByRole('dialog', { name: /Add person/ });
	await expect(dlg).toBeVisible();
	await dlg.getByLabel('First name').fill('Sita');
	await dlg.getByLabel('Last name').fill('Rai');
	await dlg.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.locator('svg g[role=button][aria-label="Sita Rai"]')).toBeVisible();
	await page.getByRole('link', { name: 'Open' }).click();
	await expect(page.getByRole('heading', { name: 'Sita Rai' })).toBeVisible();
	// The "Is this you?" claim form shares labels; the details form is the one with "More details".
	const details = page.locator('form', { has: page.getByLabel('Middle name') });
	await details.getByLabel('First name').fill('Sita Devi');
	await details.getByRole('button', { name: 'More details' }).click();
	await details.getByLabel('Birth date').fill('12 March 1950');
	await details.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Sita Devi Rai' })).toBeVisible();
	// Display follows dateDisplayPref (default AD).
	await expect(page.getByText('Born 12 March 1950')).toBeVisible();
	await page.getByLabel('Event type').fill('residence');
	await page.getByLabel('Event place').fill('Pokhara');
	await page.getByRole('button', { name: 'Add event' }).click();
	await expect(page.getByText('residence · Pokhara')).toBeVisible();
	const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#2a7' } }).png().toBuffer();
	await page.locator('input[type=file]').first().setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: png });
	await expect(page.locator('img[alt="Photo"]').first()).toBeVisible();
	// Photo bytes load through the authenticated route with private caching.
	const src = await page.locator('img[alt="Photo"]').first().getAttribute('src');
	const res = await c.request.get(src!);
	expect(res.status()).toBe(200);
	expect(res.headers()['cache-control']).toContain('private');
	await page.getByRole('button', { name: 'Delete person' }).click();
	await page.getByRole('dialog', { name: 'Confirm' }).getByRole('button', { name: 'Confirm' }).click();
	await expect(page).toHaveURL(/\/trees\/[0-9a-f-]+$/);
});

test('relationship mapping: implied links and linking two people', async ({ browser }) => {
	const c = await ctx(browser);
	const created = await c.request.post('/api/trees', { data: { name: 'Links' } });
	const treeId = (await created.json()).data.tree.id as string;
	const page = await c.newPage();
	await page.goto(`/trees/${treeId}`);
	const node = (n: string) => page.locator(`svg g[role=button][aria-label="${n}"]`);
	const select = async (n: string) => {
		await node(n).click();
		await expect(page.getByText(`Selected: ${n}`)).toBeVisible();
	};
	const add = async (first: string, rel?: string) => {
		await page.getByRole('button', { name: rel ? 'Add relative' : 'Add person', exact: true }).click();
		const dlg = page.getByRole('dialog', { name: /Add person/ });
		await dlg.getByLabel('First name').fill(first);
		if (rel) await dlg.getByLabel(/Relationship to/).selectOption(rel);
		return {
			dlg,
			// Saving selects the new person; wait so the next click is not overridden.
			save: async () => {
				await dlg.getByRole('button', { name: 'Add', exact: true }).click();
				await expect(page.locator('strong', { hasText: new RegExp(`^${first}$`) })).toBeVisible();
			}
		};
	};
	await (await add('Ram')).save();
	await select('Ram');
	// Kid added to Ram before Ram has a spouse; Sita added as spouse is offered as Kid's parent.
	await (await add('Kid', 'child')).save();
	await select('Ram');
	const sita = await add('Sita', 'spouse');
	await expect(sita.dlg.getByLabel('Sita is also parent of Kid')).toBeChecked();
	await sita.save();
	// A second child of Ram is offered as Sita's child too.
	await select('Ram');
	const gita = await add('Gita', 'child');
	await expect(gita.dlg.getByLabel('Sita is also parent of Gita')).toBeChecked();
	await gita.save();
	// Link two existing people.
	await (await add('Hari')).save();
	await select('Hari');
	await page.getByRole('button', { name: 'Link with…' }).click();
	await node('Kid').click();
	await page.getByLabel('Relationship', { exact: true }).selectOption('sibling');
	await expect(page.getByLabel('Ram is also parent of Hari')).toBeChecked();
	await page.getByRole('button', { name: 'Link', exact: true }).click();
	await expect(page.getByText('Linked')).toBeVisible();
	const view = (await (await c.request.get(`/api/trees/${treeId}`)).json()).data;
	const id = (n: string) => view.persons.find((p: { firstName: string }) => p.firstName === n).id;
	const has = (a: string, b: string, t: string) => view.relationships.some((r: { person1Id: string; person2Id: string; type: string }) => r.type === t && ((r.person1Id === id(a) && r.person2Id === id(b)) || (t !== 'parent' && r.person1Id === id(b) && r.person2Id === id(a))));
	for (const [a, b, t] of [['Ram', 'Kid', 'parent'], ['Sita', 'Kid', 'parent'], ['Sita', 'Gita', 'parent'], ['Ram', 'Sita', 'spouse'], ['Hari', 'Kid', 'sibling'], ['Ram', 'Hari', 'parent']]) {
		expect(has(a!, b!, t!), `${a} ${t} ${b}`).toBe(true);
	}
	await c.close();
});

test('members, activity, media and settings pages load', async ({ browser }) => {
	const { treeId } = await seedTree(browser, 3);
	const page = await (await ctx(browser)).newPage();
	await page.goto(`/trees/${treeId}/members`);
	await expect(page.getByRole('cell', { name: 'E2E User' })).toBeVisible();
	await page.goto(`/trees/${treeId}/activity`);
	await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
	await page.goto(`/trees/${treeId}/media`);
	await expect(page.getByText('No photos yet.')).toBeVisible();
	await page.goto(`/trees/${treeId}/settings`);
	await expect(page.getByText(/^[A-Z0-9]+-[A-Z2-9]{8}$/)).toBeVisible();
	await page.getByLabel('Name', { exact: true }).fill('Renamed');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Renamed' })).toBeVisible();
});

test('collaboration: invite by direct code, join, notification, claim review and undo', async ({ browser, playwright }) => {
	const owner = await ctx(browser);
	const created = await owner.request.post('/api/trees', { data: { name: 'Collab Tree' } });
	const treeId = (await created.json()).data.tree.id as string;
	const person = await owner.request.post('/api/persons', { data: { treeId, firstName: 'Elder', lastName: 'Rai' } });
	const elderId = (await person.json()).data.id as string;
	const op = await owner.newPage();
	await op.goto(`/persons/${elderId}`);
	await op.getByLabel('They are this person\'s').selectOption('child');
	await op.getByRole('button', { name: /Create invite for/ }).click();
	const code = (await op.locator('code').first().innerText()).trim();
	expect(code).toMatch(/^[A-Z0-9]+-[A-Z2-9]{8}$/);

	// Second user registers, logs in, joins from the link.
	const api2 = await playwright.request.newContext({ baseURL: BASE });
	const email2 = `e2e-${randomUUID()}@example.com`;
	expect((await api2.post('/api/auth/register', { data: { email: email2, password: 'correct horse battery', displayName: 'Young Rai' } })).ok()).toBe(true);
	expect((await api2.post('/api/auth/login', { data: { email: email2, password: 'correct horse battery' } })).ok()).toBe(true);
	const joiner = await browser.newContext({ storageState: await api2.storageState() });
	const jp = await joiner.newPage();
	await jp.goto(`/join/${code}`);
	await expect(jp.getByRole('heading', { name: 'Join Collab Tree' })).toBeVisible();
	await expect(jp.getByText('Elder Rai')).toBeVisible();
	await jp.getByLabel('First name').fill('Young');
	await jp.getByLabel('Last name').fill('Rai');
	await jp.getByRole('button', { name: 'Join', exact: true }).click();
	await expect(jp.getByRole('heading', { name: 'Welcome!' })).toBeVisible();
	// The code is single use: the same link is now unavailable, with no hint why.
	await jp.goto(`/join/${code}`);
	await expect(jp.getByRole('heading', { name: 'This code is not available' })).toBeVisible();

	// Owner is notified and sees the new person in the tree.
	await op.goto('/notifications');
	await expect(op.getByText('Young Rai joined your tree')).toBeVisible();
	await op.goto(`/trees/${treeId}`);
	await expect(op.locator('svg g[role=button][aria-label="Young Rai"]')).toBeVisible();

	// Edit with undo: the toast offers Undo for 10 s and reverts through the history endpoint.
	await op.goto(`/persons/${elderId}`);
	const opDetails = op.locator('form', { has: op.getByLabel('Middle name') });
	await opDetails.getByLabel('Last name').fill('Rai-Changed');
	await opDetails.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(op.getByRole('heading', { name: 'Elder Rai-Changed' })).toBeVisible();
	await op.locator('[role=status] > div', { hasText: 'Saved' }).getByRole('button', { name: 'Undo' }).click();
	await expect(op.getByRole('heading', { name: 'Elder Rai', exact: true })).toBeVisible();
	await expect(op.getByText('reverted').first()).toBeVisible();

	// The claim review queue is reachable for the owner and starts empty.
	await op.goto(`/trees/${treeId}/claims`);
	await expect(op.getByText('No pending claims.')).toBeVisible();
});


// --- Users without the rate-limited register endpoint: a user row, a session and an optional membership. ---

async function makeUser(browser: Browser, name: string, treeId?: string, role = 'viewer') {
	const id = randomUUID();
	const token = randomBytes(32).toString('base64url');
	const now = new Date().toISOString();
	const raw = new Database(DB);
	raw.pragma('busy_timeout = 5000');
	raw.prepare(`INSERT INTO users (id, email, displayName, emailVerifiedAt, createdAt) VALUES (?, ?, ?, ?, ?)`).run(id, `${id}@example.com`, name, now, now);
	raw
		.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?)`)
		.run(randomUUID(), id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 864e5).toISOString(), now, now);
	if (treeId) {
		raw
			.prepare(`INSERT INTO treeMembers (id, treeId, userId, role, status, joinedAt, joinedViaType) VALUES (?, ?, ?, ?, 'active', ?, 'manual')`)
			.run(randomUUID(), treeId, id, role, now);
	}
	raw.close();
	const context = await browser.newContext({
		storageState: { cookies: [{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 }], origins: [] }
	});
	return { id, context };
}

async function ownerTree(browser: Browser, name: string) {
	const owner = await ctx(browser);
	const t = await owner.request.post('/api/trees', { data: { name } });
	const treeId = (await t.json()).data.tree.id as string;
	return { owner, treeId };
}

test('claim by answering verification questions', async ({ browser }) => {
	const { owner, treeId } = await ownerTree(browser, 'Quiz Tree');
	const p = await owner.request.post('/api/persons', { data: { treeId, firstName: 'Quiz', lastName: 'Person' } });
	const personId = (await p.json()).data.id as string;
	const set = await owner.request.post(`/api/claims/questions/${personId}`, {
		data: { questions: [1, 2, 3].map((i) => ({ question: `Question ${i}?`, answer: `answer ${i}` })) }
	});
	expect(set.status()).toBe(201);
	const { context } = await makeUser(browser, 'Quizzer', treeId);
	const page = await context.newPage();
	await page.goto(`/persons/${personId}`);
	await expect(page.getByRole('heading', { name: 'Is this you?' })).toBeVisible();
	// wrong answers first: refused, and the form stays
	for (const i of [1, 2, 3]) await page.getByLabel(`Question ${i}?`).fill('wrong');
	await page.getByRole('button', { name: 'Verify and claim' }).click();
	await expect(page.getByText('The answers did not match')).toBeVisible();
	for (const i of [1, 2, 3]) await page.getByLabel(`Question ${i}?`).fill(` ANSWER ${i} `);
	await page.getByRole('button', { name: 'Verify and claim' }).click();
	await expect(page.getByText('You are now linked to Quiz Person')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Is this you?' })).toHaveCount(0);
});

test('matching claim is reviewed by the owner with the score shown; approval links and notifies', async ({ browser }) => {
	const { owner, treeId } = await ownerTree(browser, 'Match Tree');
	const p = await owner.request.post('/api/persons', {
		data: { treeId, firstName: 'Hari', lastName: 'Rai', birthDate: '12 March 1950', birthPlace: 'Pokhara' }
	});
	const personId = (await p.json()).data.id as string;
	const { context } = await makeUser(browser, 'Hari Claimant', treeId);
	const page = await context.newPage();
	await page.goto(`/persons/${personId}`);
	await page.getByLabel('First name').first().fill('Hari');
	const form = page.locator('form', { hasText: 'Send for review' });
	await form.getByLabel('First name').fill('Hari');
	await form.getByLabel('Last name').fill('Rai');
	await form.getByLabel('Birth date').fill('1950-03-12');
	await form.getByLabel('Birth place').fill('Pokhara');
	await form.getByRole('button', { name: 'Send for review' }).click();
	await expect(page.getByText('Your claim on Hari Rai is waiting for review.')).toBeVisible();

	const op = await owner.newPage();
	await op.goto(`/trees/${treeId}/claims`);
	await expect(op.getByText('Match score')).toBeVisible();
	await expect(op.getByText('100%')).toBeVisible(); // advisory only: still waiting for a person to decide
	await op.getByRole('button', { name: 'Approve' }).click();
	await expect(op.getByText('No pending claims.')).toBeVisible();

	await page.goto('/notifications');
	await expect(page.getByText('Your claim was approved')).toBeVisible();
	await page.goto(`/persons/${personId}`);
	await expect(page.getByRole('heading', { name: 'Is this you?' })).toHaveCount(0);
});

test('manual claim can be rejected; "find yourself" lists unclaimed people', async ({ browser }) => {
	const { owner, treeId } = await ownerTree(browser, 'Manual Tree');
	const p = await owner.request.post('/api/persons', { data: { treeId, firstName: 'Mina', lastName: 'Gurung', birthDate: '1988' } });
	const personId = (await p.json()).data.id as string;
	const { context } = await makeUser(browser, 'Manual Claimant', treeId);
	const page = await context.newPage();
	await page.goto(`/trees/${treeId}/claim`);
	await page.getByLabel('Your name').fill('Mina');
	await page.getByRole('link', { name: /Mina Gurung/ }).click();
	await expect(page).toHaveURL(new RegExp(`/persons/${personId}`));
	await page.getByRole('button', { name: 'Or just ask the owner to link me' }).click();
	await expect(page.getByText('Your claim on Mina Gurung is waiting for review.')).toBeVisible();
	const op = await owner.newPage();
	await op.goto(`/trees/${treeId}/claims`);
	await expect(op.getByText('Manual Claimant')).toBeVisible();
	await op.getByRole('button', { name: 'Reject' }).click();
	await expect(op.getByText('No pending claims.')).toBeVisible();
	await page.goto('/notifications');
	await expect(page.getByText('Your claim was declined')).toBeVisible();
});

test('family code: share links, expiry, and the redirect through login for visitors', async ({ browser }) => {
	const { owner, treeId } = await ownerTree(browser, 'Share Tree');
	const op = await owner.newPage();
	await op.goto(`/trees/${treeId}/settings`);
	const wa = op.getByRole('link', { name: 'WhatsApp' });
	await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*join%2F/);
	await expect(op.getByRole('link', { name: 'Email' })).toHaveAttribute('href', /^mailto:/);
	await expect(op.getByRole('button', { name: 'Copy link' })).toBeVisible();
	await op.getByLabel('New code expires (optional)').fill('2099-01-01');
	await op.getByRole('button', { name: 'Regenerate' }).click();
	await op.getByRole('dialog', { name: 'Confirm' }).getByRole('button', { name: 'Confirm' }).click();
	await expect(op.getByText(/^Expires /)).toBeVisible();
	const code = (await op.locator('code').first().innerText()).trim();
	// A visitor without a session is sent through login and gets the link back.
	const anon = await browser.newContext();
	const ap = await anon.newPage();
	await ap.goto(`/join/${code}`);
	await expect(ap).toHaveURL(new RegExp(`/login\\?next=%2Fjoin%2F${code}`));
	// an unknown code does not redirect and says nothing about why
	await ap.goto('/join/NOPE-ABCDEFGH');
	await expect(ap.getByRole('heading', { name: 'This code is not available' })).toBeVisible();
});

test('undo toast covers events and photo captions', async ({ browser }) => {
	test.setTimeout(90_000); // several uploads and reloads
	const { owner, treeId } = await ownerTree(browser, 'Undo Tree');
	const p = await owner.request.post('/api/persons', { data: { treeId, firstName: 'Undo', lastName: 'Me' } });
	const personId = (await p.json()).data.id as string;
	const page = await owner.newPage();
	await page.goto(`/persons/${personId}`);
	await page.getByLabel('Event type').fill('residence');
	await page.getByLabel('Event place').fill('Pokhara');
	await page.getByRole('button', { name: 'Add event' }).click();
	await expect(page.getByText('residence · Pokhara')).toBeVisible();
	const toastFor = (text: string) => page.locator('[role=status] > div', { hasText: text });
	await toastFor('Event added').getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByText('residence · Pokhara')).toHaveCount(0);
	// delete an event, then undo the delete
	await page.getByLabel('Event type').fill('occupation');
	await page.getByRole('button', { name: 'Add event' }).click();
	await expect(page.getByText('occupation')).toBeVisible();
	await page.getByRole('button', { name: 'Delete event occupation' }).click();
	await expect(page.getByText('occupation')).toHaveCount(0);
	await toastFor('Event deleted').getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByText('occupation')).toBeVisible();

	// photo caption: save, then undo restores the previous caption
	const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#a33' } }).png().toBuffer();
	await page.locator('input[type=file]').first().setInputFiles({ name: 'u.png', mimeType: 'image/png', buffer: png });
	await toastFor('Photo added').getByRole('button', { name: 'Undo' }).click(); // undo the upload itself
	await expect(page.getByText('Change undone').last()).toBeVisible();
	await expect(page.locator('img[alt="Photo"]')).toHaveCount(0);
	await page.locator('input[type=file]').first().setInputFiles({ name: 'u.png', mimeType: 'image/png', buffer: png });
	await page.locator('img[alt="Photo"]').first().click();
	await page.getByLabel('Caption').fill('Grandmother');
	await page.getByRole('button', { name: 'Save caption' }).click();
	await toastFor('Caption saved').getByRole('button', { name: 'Undo' }).click();
	// the gallery thumbnail (inside the list, not the lightbox) shows the original, caption-less alt text again
	await page.locator('ul img[alt="Photo"]').first().click();
	await expect(page.getByLabel('Caption')).toHaveValue('');
});
