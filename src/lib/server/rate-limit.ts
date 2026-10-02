export interface RateLimitEntry {
	hits: number[];
	blockedUntil: number;
	failures: number[];
}

const buckets = new Map<string, RateLimitEntry>();

export function getClientIp(request: Request, addressHeader: string | undefined): string {
	if (addressHeader) {
		const v = request.headers.get(addressHeader);
		if (v) return v.split(',')[0]?.trim() || 'unknown';
	}
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
	return 'unknown';
}

function entry(key: string): RateLimitEntry {
	let e = buckets.get(key);
	if (!e) {
		e = { hits: [], blockedUntil: 0, failures: [] };
		buckets.set(key, e);
	}
	return e;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
	const e = entry(key);
	e.hits = e.hits.filter((t) => now - t < windowMs);
	if (e.hits.length >= limit) return false;
	e.hits.push(now);
	return true;
}

export function recordFailure(key: string, tiers: ReadonlyArray<{ failures: number; blockMs: number }>, now = Date.now()): number {
	const e = entry(key);
	const day = 24 * 60 * 60 * 1000;
	e.failures = e.failures.filter((t) => now - t < day);
	e.failures.push(now);
	let blockMs = 0;
	for (const tier of tiers) {
		if (e.failures.length >= tier.failures) blockMs = tier.blockMs;
	}
	if (blockMs > 0) e.blockedUntil = now + blockMs;
	return blockMs;
}

export function isBlocked(key: string, now = Date.now()): number {
	const e = buckets.get(key);
	if (!e) return 0;
	if (e.blockedUntil > now) return e.blockedUntil - now;
	return 0;
}

export function clearAllRateLimits(): void {
	buckets.clear();
}
