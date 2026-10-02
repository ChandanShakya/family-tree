import { describe, expect, test, beforeEach } from 'vitest';
import {
	checkRateLimit,
	clearAllRateLimits,
	getClientIp,
	isBlocked,
	recordFailure
} from '$lib/server/rate-limit.js';
import { LOCKOUT_TIERS, RATE_LIMITS } from '$lib/config.js';

function reqWith(headers: Record<string, string>): Request {
	return new Request('http://localhost/api/join/ABC', { headers });
}

describe('AT-19: proxy IP isolation', () => {
	beforeEach(() => clearAllRateLimits());

	test('AT-19: different CF-Connecting-IP values are limited independently', () => {
		const header = 'CF-Connecting-IP';
		const a = getClientIp(reqWith({ [header]: '1.1.1.1' }), header);
		const b = getClientIp(reqWith({ [header]: '2.2.2.2' }), header);
		expect(a).toBe('1.1.1.1');
		expect(b).toBe('2.2.2.2');
		// Exhaust A's bucket for the join endpoint (10/min/IP).
		for (let i = 0; i < RATE_LIMITS.join.limit; i++) {
			expect(checkRateLimit(`join:${a}`, RATE_LIMITS.join.limit, RATE_LIMITS.join.windowMs)).toBe(true);
		}
		expect(checkRateLimit(`join:${a}`, RATE_LIMITS.join.limit, RATE_LIMITS.join.windowMs)).toBe(false);
		// B is unaffected.
		expect(checkRateLimit(`join:${b}`, RATE_LIMITS.join.limit, RATE_LIMITS.join.windowMs)).toBe(true);
	});

	test('AT-19: lockout tiers key per IP+endpoint independently', () => {
		const ka = 'join:9.9.9.9';
		const kb = 'join:8.8.8.8';
		for (let i = 0; i < 5; i++) recordFailure(ka, LOCKOUT_TIERS);
		expect(isBlocked(ka)).toBeGreaterThan(0);
		expect(isBlocked(kb)).toBe(0);
	});

	test('AT-19: without ADDRESS_HEADER falls back instead of crashing', () => {
		const ip = getClientIp(reqWith({}), undefined);
		expect(typeof ip).toBe('string');
	});
});
