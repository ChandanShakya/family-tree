// Worker thread entry: one maintenance pass, own connection (§3, §6.12).
import { parentPort, workerData } from 'node:worker_threads';
import { runMaintenance } from './maintenance-core.mjs';

try {
	parentPort.postMessage({ ok: true, result: runMaintenance(workerData) });
} catch (e) {
	parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
}
