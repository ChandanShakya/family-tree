// Worker entry point: plain Node, own DB connection (§3, §6.9).
import { randomUUID, randomBytes } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { parseGedcom } from '../../shared/gedcom.mjs';

// One BEGIN IMMEDIATE transaction with prepared statements: all or nothing, and short
// enough to fit inside other writers' busy_timeout (R-PERF-8).
function run({ dbPath, treeId, userId, text, preview, limits }) {
	const parsed = parseGedcom(text, limits);
	if (parsed.error) return { error: parsed.error };
	const counts = {
		persons: parsed.persons.length,
		relationships: parsed.links.length,
		warnings: parsed.warnings,
		unknownTags: parsed.unknownTags
	};
	if (preview || parsed.persons.length === 0) return { counts, imported: false };

	const db = new Database(dbPath, { fileMustExist: true });
	for (const p of ['journal_mode = WAL', 'synchronous = NORMAL', 'foreign_keys = ON', 'busy_timeout = 5000', 'temp_store = MEMORY']) db.pragma(p);
	try {
		const now = new Date().toISOString();
		const batchId = randomBytes(16).toString('hex');
		const ids = new Map(parsed.persons.map((p) => [p.xref, randomUUID()]));
		const insPerson = db.prepare(
			`INSERT INTO persons (id, treeId, firstName, lastName, birthDate, birthDateCal, birthDateNorm, deathDate, deathDateCal, deathDateNorm,
			   gender, birthPlace, deathPlace, bio, isLiving, createdBy, lastEditedBy, version, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, 'AD', ?, ?, 'AD', ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)`
		);
		const insRel = db.prepare(
			`INSERT INTO relationships (id, treeId, person1Id, person2Id, type, startDate, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insHist = db.prepare(
			`INSERT INTO changeHistory (id, treeId, entityType, entityId, changedBy, changedAt, action, batchId, note) VALUES (?, ?, ?, ?, ?, ?, 'create', ?, 'gedcom import')`
		);
		db.transaction(() => {
			for (const p of parsed.persons) {
				const id = ids.get(p.xref);
				insPerson.run(id, treeId, p.firstName, p.lastName, p.birthDate, p.birthDateNorm, p.deathDate, p.deathDateNorm, p.gender, p.birthPlace, p.deathPlace, p.bio, userId, userId, now, now);
				insHist.run(randomUUID(), treeId, 'person', id, userId, now, batchId);
			}
			for (const l of parsed.links) {
				const id = randomUUID();
				insRel.run(id, treeId, ids.get(l.a), ids.get(l.b), l.type, l.startDate, userId, now);
				insHist.run(randomUUID(), treeId, 'relationship', id, userId, now, batchId);
			}
		}).immediate();
		return { counts, imported: true, batchId };
	} finally {
		db.close();
	}
}

try {
	parentPort.postMessage({ ok: true, result: run(workerData) });
} catch (e) {
	parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
}
