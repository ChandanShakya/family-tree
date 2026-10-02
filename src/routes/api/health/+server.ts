import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
const startedAt = Date.now();

// p99 event-loop delay since the previous health call, so a probe reports recent behaviour (R-PERF-7), not startup noise.
export const GET: RequestHandler = async () => {
	const p99 = Math.round(histogram.percentile(99) / 1e6);
	histogram.reset();
	return json({
		data: {
			status: 'ok',
			uptime: Math.floor((Date.now() - startedAt) / 1000),
			version: '0.1.0',
			eventLoopDelayP99Ms: p99
		}
	});
};
