import { describe, expect, test } from 'vitest';
import { damerauLevenshtein, fuzzyMatch } from '$lib/utils/fuzzy.js';
import { dlBounded, matchNames } from '../src/lib/shared/fuzzy-core.mjs';

const cps = (s: string) => [...s];

describe('AT-26: fuzzy core parity', () => {
	test('AT-26: Damerau-Levenshtein known values (substitution costs 1, an adjacent swap costs 1)', () => {
		const cases: Array<[string, string, number]> = [
			['kitten', 'sitting', 3],
			['abc', 'abd', 1],
			['ab', 'ba', 1],
			['ca', 'abc', 2],
			['ramesh', 'rmaesh', 1],
			['नेपाल', 'नीपाल', 1],
			['', 'abc', 3],
			['same', 'same', 0]
		];
		for (const [a, b, d] of cases) expect(damerauLevenshtein(a, b), `${a} ~ ${b}`).toBe(d);
	});

	test('AT-26: the bounded distance equals the unbounded one whenever it is within the budget (incl. transpositions and Devanagari)', () => {
		const words = ['ramesh', 'rames', 'ramsh', 'rmaesh', 'sita', 'siata', 'stia', 'bishnu', 'bishnoo', 'ab', 'ba', 'abc', 'ca', 'नेपाल', 'नीपाल', 'नपाल', 'थापा', 'थपा', 'श्रेष्ठ', 'श्रेष्', 'a', ''];
		for (const a of words) {
			for (const b of words) {
				const full = damerauLevenshtein(a, b);
				for (const k of [1, 2]) {
					const got = dlBounded(cps(a), cps(b), k);
					expect(got <= k ? got : k + 1, `${a} ~ ${b} (k=${k})`).toBe(full <= k ? full : k + 1);
				}
			}
		}
	});

	test('AT-26: matchNames returns the same hits and order as fuzzyMatch, and honours the deadline', () => {
		const names = [
			{ id: 'a', name: 'Ramesh Sharma' },
			{ id: 'b', name: 'Rames Sharman' },
			{ id: 'c', name: 'Sita Rai' },
			{ id: 'd', name: 'नेपाल थापा' },
			{ id: 'e', name: 'Bishnu Rai' }
		];
		for (const q of ['Ramesh Sharma', 'Rammesh Sharmaa', 'Sitta', 'नीपाल थापा', 'bishno rai', 'zzz']) {
			expect(matchNames(names, q, Date.now() + 1000, 20), q).toEqual(fuzzyMatch(names, q, 20));
		}
		const many = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), name: `Name${i} Fam${i}` }));
		const t0 = Date.now();
		matchNames(many, 'Nime', t0 - 1, 20); // deadline already passed: stops at the first clock check
		expect(Date.now() - t0).toBeLessThan(200);
	});
});
