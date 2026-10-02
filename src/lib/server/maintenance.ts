import { env } from '$env/dynamic/private';
import { MAINTENANCE_INTERVAL_HOURS, SOFT_DELETE_PURGE_DAYS } from '$lib/config.js';
import { runWorker } from './run-worker.js';
import { photoRoot } from './storage.js';

// §6.12: once at startup (after migrations and the FTS check), then every MAINTENANCE_INTERVAL_HOURS,
// in a worker thread. A failed pass logs and waits for the next one; it never blocks startup.

interface Report {
	personsPurged: number;
	filesRemoved: number;
	sessions: number;
	tokens: number;
	claimAttempts: number;
	errors: string[];
}

let running = false;

export async function maintenancePass(): Promise<Report | null> {
	if (running) return null;
	running = true;
	try {
		const r = await runWorker<Report>(
			'maintenance-worker.mjs',
			{ dbPath: env.DATABASE_PATH ?? './data/family.db', photoRoot: photoRoot(), purgeDays: SOFT_DELETE_PURGE_DAYS },
			10 * 60_000
		);
		const parts = `purged ${r.personsPurged} people (${r.filesRemoved} files), ${r.sessions} sessions, ${r.tokens} tokens, ${r.claimAttempts} claim attempts`;
		if (r.errors.length) console.warn(`maintenance: ${parts}; failed steps: ${r.errors.join('; ')}`);
		else console.log(`maintenance: ${parts}`);
		return r;
	} catch (e) {
		console.warn('maintenance pass failed, retrying at the next interval:', e);
		return null;
	} finally {
		running = false;
	}
}

/** Schedule without keeping the process alive or delaying the listener. */
export function startMaintenance(): void {
	setTimeout(() => void maintenancePass(), 1000).unref();
	setInterval(() => void maintenancePass(), MAINTENANCE_INTERVAL_HOURS * 3_600_000).unref();
}
