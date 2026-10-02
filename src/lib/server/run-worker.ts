import { Worker } from 'node:worker_threads';
import { resolve as resolvePath } from 'node:path';
import { env } from '$env/dynamic/private';

// Heavy work (export, GEDCOM import) runs in a worker thread with its own DB connection (§3).
// Workers are created per job and exit when done; WORKERS_PATH keeps production off bundle internals.

export function workersDir(): string {
	return env.WORKERS_PATH ?? './src/lib/server/workers';
}

export function runWorker<T>(file: string, data: unknown, timeoutMs = 30_000): Promise<T> {
	return new Promise((resolve, reject) => {
		const w = new Worker(resolvePath(workersDir(), file), { workerData: data });
		const timer = setTimeout(() => {
			void w.terminate();
			reject(new Error(`${file} timed out`));
		}, timeoutMs);
		w.once('message', (m: { ok: boolean; result?: T; error?: string }) => {
			clearTimeout(timer);
			void w.terminate();
			if (m.ok) resolve(m.result as T);
			else reject(new Error(m.error ?? 'worker failed'));
		});
		w.once('error', (e) => {
			clearTimeout(timer);
			reject(e);
		});
		w.once('exit', (code) => {
			clearTimeout(timer);
			if (code !== 0) reject(new Error(`${file} exited with ${code}`));
		});
	});
}
