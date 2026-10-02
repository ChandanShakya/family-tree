// Fuzzy-search worker (§3, §6.8). Plain Node ESM with no app imports beyond the shared core, so the
// production server can run it from WORKERS_PATH without the Vite bundle. Stays alive between queries.
import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { matchNames } from '../../shared/fuzzy-core.mjs';

parentPort.on('message', (msg) => {
	const { id, dbPath, treeId, q, limit, deadlineMs } = msg;
	const deadline = Date.now() + (deadlineMs ?? 300);
	let raw = null;
	try {
		raw = new Database(dbPath, { readonly: true });
		raw.pragma('journal_mode = WAL');
		raw.pragma('foreign_keys = ON');
		raw.pragma('busy_timeout = 5000');
		// (id, name parts) only, read per query and not cached (§6.8). The visible_persons view re-checks membership
		// for every row (about 30 ms on 50 000 people), so live rows are read raw and the few people whose
		// membership is not active are removed by id: the same set, cheaper.
		const live = raw.prepare(`SELECT id, firstName, middleName, lastName, maidenName FROM persons WHERE treeId = ? AND deletedAt IS NULL`).raw(true).all(treeId);
		const hidden = new Set(
			raw
				.prepare(`SELECT personId FROM treeMembers WHERE treeId = ? AND status <> 'active' AND personId IS NOT NULL`)
				.pluck()
				.all(treeId)
		);
		const rows = [];
		for (const [pid, f, mid, l, m] of live) if (!hidden.has(pid)) rows.push({ id: pid, name: `${f} ${mid ?? ''} ${l ?? ''} ${m ?? ''}` });
		raw.close();
		raw = null;
		parentPort.postMessage({ id, results: matchNames(rows, q, deadline, limit ?? 20) });
	} catch (err) {
		parentPort.postMessage({ id, error: String((err && err.message) || err) });
	} finally {
		if (raw) raw.close();
	}
});
