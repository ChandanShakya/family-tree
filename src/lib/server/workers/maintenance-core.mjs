// Maintenance passes (§6.12). Plain ESM, own DB connection, used by the worker thread and by tests.
import { existsSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';

const DAY = 24 * 60 * 60 * 1000;
const BATCH = 200;

/** @param {string} root @param {string} rel */
function safe(root, rel) {
	const full = resolve(root, rel);
	return full.startsWith(resolve(root) + sep) ? full : null;
}

/**
 * @param {{ dbPath: string, photoRoot: string, purgeDays: number, now?: Date }} o
 * @returns {{ personsPurged: number, filesRemoved: number, sessions: number, tokens: number, claimAttempts: number, errors: string[] }}
 */
export function runMaintenance(o) {
	const now = o.now ?? new Date();
	const db = new Database(o.dbPath, { fileMustExist: true });
	for (const p of ['journal_mode = WAL', 'synchronous = NORMAL', 'foreign_keys = ON', 'busy_timeout = 5000', 'temp_store = MEMORY']) db.pragma(p);
	const report = { personsPurged: 0, filesRemoved: 0, sessions: 0, tokens: 0, claimAttempts: 0, errors: /** @type {string[]} */ ([]) };
	/** @param {string} name @param {() => void} fn */
	const step = (name, fn) => {
		try {
			fn();
		} catch (e) {
			// A failed step logs and waits for the next pass; the others still run.
			report.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	};
	try {
		step('purge persons', () => {
			const cutoff = new Date(now.getTime() - o.purgeDays * DAY).toISOString();
			const pick = db.prepare(`SELECT id, treeId FROM persons WHERE deletedAt IS NOT NULL AND deletedAt < ? LIMIT ${BATCH}`);
			const media = db.prepare(`SELECT storagePath, thumbPath FROM media WHERE personId = ?`);
			const delClaims = db.prepare(`DELETE FROM profileClaims WHERE personId = ?`);
			const delAttempts = db.prepare(`DELETE FROM claimAttempts WHERE personId = ?`);
			const delPerson = db.prepare(`DELETE FROM persons WHERE id = ?`);
			// History keeps who/when/what-kind for the audit trail, but no longer the purged person's data:
			// their own rows and any event/link/photo row whose values mention them lose values and snapshot.
			// ponytail: LIKE scan of the tree's history per purged person; index-backed lookups if purges get big.
			const redact = db.prepare(
				`UPDATE changeHistory SET oldValue = NULL, newValue = NULL, snapshot = NULL
				 WHERE treeId = ? AND (entityId = ? OR snapshot LIKE ? OR oldValue LIKE ? OR newValue LIKE ?)`
			);
			for (;;) {
				const rows = /** @type {Array<{ id: string, treeId: string }>} */ (pick.all(cutoff));
				if (rows.length === 0) break;
				/** @type {string[]} */
				const files = [];
				// One short transaction per batch; files go only after it commits (§6.7).
				db.transaction(() => {
					for (const r of rows) {
						for (const m of /** @type {Array<{ storagePath: string, thumbPath: string | null }>} */ (media.all(r.id))) {
							files.push(m.storagePath);
							if (m.thumbPath) files.push(m.thumbPath);
						}
						delClaims.run(r.id);
						delAttempts.run(r.id);
						delPerson.run(r.id); // events, relationships, media rows, questions and codes cascade
						const like = `%${r.id}%`;
						redact.run(r.treeId, r.id, like, like, like);
					}
				}).immediate();
				report.personsPurged += rows.length;
				for (const rel of files) {
					const full = safe(o.photoRoot, rel);
					if (!full || !existsSync(full)) continue;
					rmSync(full, { force: true });
					report.filesRemoved++;
					try {
						rmdirSync(dirname(full)); // only succeeds when the person's folder is empty
					} catch {
						// not empty: leave it
					}
				}
			}
		});
		step('expired sessions', () => {
			report.sessions = db.prepare(`DELETE FROM sessions WHERE expiresAt < ?`).run(now.toISOString()).changes;
		});
		step('old tokens', () => {
			const iso = now.toISOString();
			const old = new Date(now.getTime() - DAY).toISOString();
			for (const t of ['passwordResetTokens', 'emailVerificationTokens']) {
				report.tokens += db.prepare(`DELETE FROM ${t} WHERE (expiresAt < ? OR usedAt IS NOT NULL) AND createdAt < ?`).run(iso, old).changes;
			}
		});
		step('claim attempts', () => {
			// the window is 24 h long: it "ended more than 24 h ago" 48 h after it started
			const ended = new Date(now.getTime() - 2 * DAY).toISOString();
			report.claimAttempts = db.prepare(`DELETE FROM claimAttempts WHERE windowStart < ?`).run(ended).changes;
		});
	} finally {
		db.close();
	}
	return report;
}
