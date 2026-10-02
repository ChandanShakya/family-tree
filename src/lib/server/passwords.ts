import { compare, hash } from 'bcryptjs';
import { PASSWORD_HASH_CONCURRENCY } from '$lib/config.js';

// bcrypt cost factor per §8.
const COST = 12;

// Lazily created bcrypt hash of a fixed sentinel, used for dummy comparisons
// on unknown emails / OAuth-only accounts so login timing is similar (§6.1).
// Created through the same async queue (async API only, §8).
let dummyHash: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
	if (!dummyHash) dummyHash = limited(() => hash('family-tree-login-dummy-sentinel', COST));
	return dummyHash;
}

let running = 0;
const queue: Array<() => void> = [];

// Visible for tests (AT-36 concurrency cap).
export function _hashQueueDepth(): { running: number; queued: number } {
	return { running, queued: queue.length };
}

function acquire(): Promise<void> {
	if (running < PASSWORD_HASH_CONCURRENCY) {
		running++;
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => queue.push(resolve));
}

function release(): void {
	running--;
	const next = queue.shift();
	if (next) {
		running++;
		next();
	}
}

async function limited<T>(fn: () => Promise<T>): Promise<T> {
	await acquire();
	try {
		return await fn();
	} finally {
		release();
	}
}

/** Async-only bcrypt hash (§8). Rejects passwords over 72 bytes. */
export function hashPassword(password: string): Promise<string> {
	if (Buffer.byteLength(password, 'utf8') > 72) {
		return Promise.reject(new Error('Password must be at most 72 bytes'));
	}
	return limited(() => hash(password, COST));
}

/** Async-only bcrypt compare (§8). */
export function comparePassword(password: string, passwordHash: string): Promise<boolean> {
	return limited(() => compare(password, passwordHash));
}

/** Dummy comparison for unknown emails / passwordless accounts (§6.1). */
export async function dummyCompare(): Promise<boolean> {
	await comparePassword('family-tree-login-dummy-sentinel', await getDummyHash());
	return false;
}
