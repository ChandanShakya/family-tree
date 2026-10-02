import { LOCKOUT_TIERS, RATE_LIMITS } from '$lib/config.js';
import { checkRateLimit, isBlocked, recordFailure } from './rate-limit.js';

// Code endpoints (§8): 10/min/IP, plus failure lockout tiers per IP + endpoint.
// "Not found" is a failure; success never resets the counter. Shared by the
// /api/join routes and the /join/[code] page load so both count the same way.

export type GuardResult = { ok: true } | { ok: false; status: 429; code: 'LOCKED' | 'RATE_LIMITED'; retryAfter: number };

export function guardCode(ip: string): GuardResult {
	const blocked = isBlocked(`lock:join:${ip}`);
	if (blocked > 0) return { ok: false, status: 429, code: 'LOCKED', retryAfter: Math.ceil(blocked / 1000) };
	if (!checkRateLimit(`join:${ip}`, RATE_LIMITS.join.limit, RATE_LIMITS.join.windowMs)) {
		return { ok: false, status: 429, code: 'RATE_LIMITED', retryAfter: 60 };
	}
	return { ok: true };
}

export function codeFailed(ip: string): void {
	recordFailure(`lock:join:${ip}`, LOCKOUT_TIERS);
}
