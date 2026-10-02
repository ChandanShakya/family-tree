// Worker entry point: plain Node, own DB connection (§3).
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { buildGedcom } from '../../shared/gedcom.mjs';
import { filterPeople } from '../../shared/privacy.mjs';

// Account ids never leave the server in an export.
const STRIP = ['userId', 'createdBy', 'lastEditedBy', 'claimedAt', 'claimedVia'];

function csvCell(v) {
	if (v === null || v === undefined) return '';
	let s = String(v);
	// Spreadsheet formula injection: a leading = + - @ becomes text.
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function run({ dbPath, treeId, format, filtered, now, livingYears }) {
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	db.pragma('busy_timeout = 5000');
	try {
		const tree = db.prepare('SELECT id, name, description FROM trees WHERE id = ?').get(treeId);
		if (!tree) return { error: 'NOT_FOUND' };
		let people = db.prepare('SELECT * FROM visible_persons WHERE treeId = ? ORDER BY createdAt, id').all(treeId);
		let hidden = new Set();
		if (filtered) ({ people, hidden } = filterPeople(people, new Date(now), livingYears));
		const ids = new Set(people.map((p) => p.id));
		const links = db
			.prepare('SELECT id, person1Id, person2Id, type, startDate, endDate, notes FROM relationships WHERE treeId = ? ORDER BY createdAt, id')
			.all(treeId)
			.filter((l) => ids.has(l.person1Id) && ids.has(l.person2Id))
			// notes can hold personal text about a living person
			.map((l) => (hidden.has(l.person1Id) || hidden.has(l.person2Id) ? { ...l, startDate: null, endDate: null, notes: null } : l));
		const events = db
			.prepare('SELECT * FROM events WHERE treeId = ? ORDER BY createdAt, id')
			.all(treeId)
			.filter((e) => ids.has(e.personId) && !hidden.has(e.personId));
		const clean = people.map((p) => {
			const c = { ...p };
			for (const k of STRIP) delete c[k];
			return c;
		});
		if (format === 'gedcom') {
			return { mime: 'application/x-gedcom; charset=utf-8', ext: 'ged', body: buildGedcom({ people: clean, links, events, treeName: tree.name }) };
		}
		if (format === 'json') {
			const media = filtered
				? []
				: db.prepare('SELECT id, personId, storagePath, thumbPath, mime, sizeBytes, caption, createdAt FROM media WHERE treeId = ?').all(treeId);
			return {
				mime: 'application/json; charset=utf-8',
				ext: 'json',
				body: JSON.stringify({ tree, filtered, exportedAt: now, persons: clean, relationships: links, events, media }, null, 2)
			};
		}
		// csv: one row per person; relationships as id lists
		const parents = new Map();
		const spouses = new Map();
		for (const l of links) {
			if (l.type === 'parent') parents.set(l.person2Id, [...(parents.get(l.person2Id) ?? []), l.person1Id]);
			if (l.type === 'spouse') {
				spouses.set(l.person1Id, [...(spouses.get(l.person1Id) ?? []), l.person2Id]);
				spouses.set(l.person2Id, [...(spouses.get(l.person2Id) ?? []), l.person1Id]);
			}
		}
		const cols = ['id', 'firstName', 'middleName', 'lastName', 'maidenName', 'gender', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'isLiving', 'bio'];
		const rows = [[...cols, 'parentIds', 'spouseIds'].join(',')];
		for (const p of clean) {
			rows.push([...cols.map((c) => csvCell(p[c])), csvCell((parents.get(p.id) ?? []).join(';')), csvCell((spouses.get(p.id) ?? []).join(';'))].join(','));
		}
		return { mime: 'text/csv; charset=utf-8', ext: 'csv', body: rows.join('\r\n') + '\r\n' };
	} finally {
		db.close();
	}
}

try {
	parentPort.postMessage({ ok: true, result: run(workerData) });
} catch (e) {
	parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
}
