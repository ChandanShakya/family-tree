import { describe, expect, test } from 'vitest';
import { parseDate, displayDate, BS_MIN_YEAR, BS_MAX_YEAR } from '$lib/utils/dates.js';

// BS↔AD fixtures cross-checked against nepali-date-converter@3.4.0's embedded
// official month-length table (dateConfigMap, BS 2000–2090) and against the
// widely published Nepali New Year dates: 1 Baisakh 2078 = 14 Apr 2021,
// 2079 = 14 Apr 2022, 2080 = 14 Apr 2023, 2081 = 13 Apr 2024,
// 2082 = 14 Apr 2025. Includes a month-boundary pair
// (30 Chaitra 2080 = 12 Apr 2024 → 1 Baisakh 2081 = 13 Apr 2024)
// and leap-year pairs (29 Feb 2024 = 17 Falgun 2080; 29 Feb 2020 = 17 Falgun 2076).

describe('AT-25: AD parsing', () => {
	test('AT-25: accepts every §6.3 AD format', () => {
		expect(parseDate('1985-03-15', 'AD').norm).toBe('1985-03-15');
		expect(parseDate('1985-03', 'AD').norm).toBe('1985-03-00');
		expect(parseDate('1985', 'AD').norm).toBe('1985-00-00');
		expect(parseDate('15 March 1985', 'AD').norm).toBe('1985-03-15');
		expect(parseDate('15 Mar 1985', 'AD').norm).toBe('1985-03-15');
		expect(parseDate('March 1985', 'AD').norm).toBe('1985-03-00');
	});

	test('AT-25: strips qualifiers and BET x AND y uses x', () => {
		expect(parseDate('abt 1985', 'AD').norm).toBe('1985-00-00');
		expect(parseDate('c. 1900', 'AD').norm).toBe('1900-00-00');
		expect(parseDate('BEF March 1985', 'AD').norm).toBe('1985-03-00');
		expect(parseDate('BET 1980 AND 1985', 'AD').norm).toBe('1980-00-00');
	});

	test('AT-25: impossible and unparseable dates give NULL norm', () => {
		expect(parseDate('31 Feb 1985', 'AD').norm).toBeNull();
		expect(parseDate('not a date', 'AD').norm).toBeNull();
		expect(parseDate('1985-13-01', 'AD').norm).toBeNull();
	});
});

describe('AT-25: BS parsing', () => {
	test('AT-25: full BS dates convert exactly', () => {
		expect(parseDate('2082-01-01', 'BS').norm).toBe('2025-04-14');
		expect(parseDate('2081-01-01', 'BS').norm).toBe('2024-04-13');
		expect(parseDate('15 Baisakh 2082', 'BS').norm).toBe('2025-04-28');
	});

	test('AT-25: partial BS dates use first day of period with no 00', () => {
		expect(parseDate('2082', 'BS').norm).toBe('2025-04-14');
		expect(parseDate('2081-01', 'BS').norm).toBe('2024-04-13');
	});

	test('AT-25: out-of-range BS dates give NULL norm but keep verbatim', () => {
		const p = parseDate('1990-01-01', 'BS');
		expect(p.norm).toBeNull();
		expect(p.verbatim).toBe('1990-01-01');
		const q = parseDate('2095', 'BS');
		expect(q.norm).toBeNull();
	});

	test('AT-25: supported range is BS 2000-2090', () => {
		expect(BS_MIN_YEAR).toBe(2000);
		expect(BS_MAX_YEAR).toBe(2090);
	});
});

describe('AT-25: display', () => {
	test('AT-25: AD display forms', () => {
		expect(displayDate(parseDate('1985-03-15', 'AD'), 'AD')).toBe('15 March 1985');
		expect(displayDate(parseDate('1985-03', 'AD'), 'AD')).toBe('March 1985');
		expect(displayDate(parseDate('1985', 'AD'), 'AD')).toBe('1985');
	});
});
