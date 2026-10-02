import { Worker } from 'node:worker_threads';
import { resolve as resolvePath } from 'node:path';
import { env } from '$env/dynamic/private';

// Persistent fuzzy-search worker (§3): created on demand, stays alive across
// requests, owns its own DB connection with the same pragmas. Resolved from
// WORKERS_PATH (like MIGRATIONS_PATH) so production does not depend on Vite
// bundle internals.

interface Pending {
	resolve: (v: Array<{ id: string; score: number }>) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function workersDir(): string {
	return env.WORKERS_PATH ?? './src/lib/server/workers';
}

function ensureWorker(): Worker {
	if (worker) return worker;
	const w = new Worker(resolvePath(workersDir(), 'fuzzy.mjs'));
	w.on('message', (msg: { id: number; results?: Array<{ id: string; score: number }>; error?: string }) => {
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		clearTimeout(p.timer);
		if (msg.error) p.reject(new Error(msg.error));
		else p.resolve(msg.results ?? []);
	});
	w.on('error', () => {
		for (const [, p] of [...pending]) {
			clearTimeout(p.timer);
			p.reject(new Error('fuzzy worker error'));
		}
		pending.clear();
		worker = null;
	});
	w.on('exit', () => {
		for (const [, p] of [...pending]) {
			clearTimeout(p.timer);
			p.reject(new Error('fuzzy worker exited'));
		}
		pending.clear();
		worker = null;
	});
	worker = w;
	return w;
}

/** Visible for tests: drop the singleton so each test starts clean. */
export async function closeFuzzyWorker(): Promise<void> {
	for (const [, p] of [...pending]) {
		clearTimeout(p.timer);
		p.reject(new Error('worker closed'));
	}
	pending.clear();
	if (worker) {
		await worker.terminate();
		worker = null;
	}
}

export function fuzzySearchWorker(
	dbPath: string,
	treeId: string,
	q: string,
	limit = 20,
	timeoutMs = 1000
): Promise<Array<{ id: string; score: number }>> {
	const w = ensureWorker();
	const id = ++seq;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error('fuzzy worker timeout'));
		}, timeoutMs);
		pending.set(id, { resolve, reject, timer });
		w.postMessage({ id, dbPath, treeId, q, limit, deadlineMs: 300 });
	});
}
