import { describe, expect, test } from 'vitest';
import { buildGedcom, gedcomDate, parseGedcom } from '../src/lib/shared/gedcom.mjs';

const LIMITS = { maxPersons: 100, maxRelationships: 100, maxDepth: 30 };

const SAMPLE = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Hari /Rai/
2 GIVN Hari
2 SURN Rai
1 SEX M
1 BIRT
2 DATE 12 MAR 1950
2 PLAC Pokhara
1 NOTE First line
2 CONT second line
2 CONC  continues
1 _CUSTOM ignored
0 @I2@ INDI
1 NAME Sita /Rai/
1 SEX F
1 DEAT
2 DATE ABT 2001
0 @I3@ INDI
1 NAME Mina /Rai/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1 JAN 1975
1 _UNKNOWN x
0 TRLR
`;

describe('GEDCOM reader', () => {
	test('reads people, dates, notes, families, and counts unknown tags', () => {
		const r = parseGedcom(SAMPLE, LIMITS);
		expect(r.error).toBeNull();
		expect(r.persons.map((p) => `${p.firstName} ${p.lastName}`)).toEqual(['Hari Rai', 'Sita Rai', 'Mina Rai']);
		expect(r.persons[0]).toMatchObject({ gender: 'M', birthDate: '12 MAR 1950', birthDateNorm: '1950-03-12', birthPlace: 'Pokhara', bio: 'First line\nsecond line continues' });
		expect(r.persons[1]).toMatchObject({ deathDate: 'ABT 2001', deathDateNorm: '2001-00-00' });
		expect(r.links.map((l) => `${l.type}:${l.a}>${l.b}`).sort()).toEqual(['parent:@I1@>@I3@', 'parent:@I2@>@I3@', 'spouse:@I1@>@I2@']);
		expect(r.links.find((l) => l.type === 'spouse')?.startDate).toBe('1 JAN 1975');
		expect(r.unknownTags).toBe(2);
	});

	test('limits and graph rules: over-cap, cycle and over-deep files are rejected before anything is written', () => {
		expect(parseGedcom(SAMPLE, { ...LIMITS, maxPersons: 2 }).error?.code).toBe('IMPORT_LIMIT');
		expect(parseGedcom(SAMPLE, { ...LIMITS, maxRelationships: 1 }).error?.code).toBe('IMPORT_LIMIT');
		const cycle = `0 @A@ INDI\n1 NAME A\n0 @B@ INDI\n1 NAME B\n0 @F1@ FAM\n1 HUSB @A@\n1 CHIL @B@\n0 @F2@ FAM\n1 HUSB @B@\n1 CHIL @A@\n`;
		expect(parseGedcom(cycle, LIMITS).error?.code).toBe('IMPORT_INVALID');
		const people = Array.from({ length: 6 }, (_, i) => `0 @P${i}@ INDI\n1 NAME P${i}\n`).join('');
		const chain = Array.from({ length: 5 }, (_, i) => `0 @F${i}@ FAM\n1 HUSB @P${i}@\n1 CHIL @P${i + 1}@\n`).join('');
		expect(parseGedcom(people + chain, { ...LIMITS, maxDepth: 3 }).error?.code).toBe('IMPORT_INVALID');
		expect(parseGedcom(people + chain, LIMITS).error).toBeNull();
	});

	test('names without GIVN/SURN, missing names and parentless families', () => {
		const r = parseGedcom(`0 @A@ INDI\n1 NAME Ram Bahadur /Thapa/ Jr\n0 @B@ INDI\n0 @C@ INDI\n1 NAME C\n0 @D@ INDI\n1 NAME D\n0 @F@ FAM\n1 CHIL @C@\n1 CHIL @D@\n`, LIMITS);
		expect(r.persons[0]).toMatchObject({ firstName: 'Ram Bahadur Jr', lastName: 'Thapa' });
		expect(r.persons[1]!.firstName).toBe('Unknown');
		expect(r.warnings.some((w) => w.includes('@B@'))).toBe(true);
		expect(r.links).toEqual([{ type: 'sibling', a: '@C@', b: '@D@', startDate: null }]);
	});
});

describe('GEDCOM writer', () => {
	test('dates, BS note, long notes and family structure; the reader accepts what the writer wrote', () => {
		expect([gedcomDate('1950-03-12'), gedcomDate('1950-03-00'), gedcomDate('1950-00-00'), gedcomDate(null), gedcomDate('0000-00-00')]).toEqual(['12 MAR 1950', 'MAR 1950', '1950', null, null]);
		const long = 'x'.repeat(450) + '\nsecond';
		const text = buildGedcom({
			people: [
				{ id: 'a', firstName: 'Anu', lastName: 'Rai', gender: 'F', birthDate: '2007-05-02', birthDateCal: 'BS', birthDateNorm: '1950-08-17', bio: long },
				{ id: 'b', firstName: 'Bal', lastName: 'Rai', gender: 'M' },
				{ id: 'c', firstName: 'Chhori', lastName: 'Rai' },
				{ id: 'd', firstName: 'Dai', lastName: 'Rai' }
			],
			links: [
				{ person1Id: 'a', person2Id: 'c', type: 'parent' },
				{ person1Id: 'b', person2Id: 'c', type: 'parent' },
				{ person1Id: 'a', person2Id: 'b', type: 'spouse', startDate: '1975-01-01' },
				{ person1Id: 'c', person2Id: 'd', type: 'sibling' }
			],
			events: [{ personId: 'a', type: 'residence', place: 'Pokhara', dateNorm: '1990-00-00' }]
		});
		expect(text).toContain('2 NOTE Original date (BS): 2007-05-02');
		expect(text).toContain('2 DATE 17 AUG 1950');
		expect(text.split('\n').every((l) => l.length < 255)).toBe(true);
		expect(text).toMatch(/1 HUSB @I2@\n1 WIFE @I1@\n1 CHIL @I3@/);
		const r = parseGedcom(text, LIMITS);
		expect(r.error).toBeNull();
		expect(r.persons).toHaveLength(4);
		expect(r.persons[0]!.bio).toBe(long);
		expect(r.links.map((l) => l.type).sort()).toEqual(['parent', 'parent', 'sibling', 'spouse']);
	});
});
