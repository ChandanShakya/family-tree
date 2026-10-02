export interface PersonDraft {
	firstName: string;
	middleName: string;
	lastName: string;
	maidenName: string;
	gender: string;
	birthDate: string;
	birthDateCal: 'AD' | 'BS';
	birthPlace: string;
	deathDate: string;
	deathDateCal: 'AD' | 'BS';
	deathPlace: string;
	bio: string;
	isLiving: string; // 'unknown' | 'living' | 'deceased'
}

export const emptyDraft = (): PersonDraft => ({
	firstName: '',
	middleName: '',
	lastName: '',
	maidenName: '',
	gender: '',
	birthDate: '',
	birthDateCal: 'AD',
	birthPlace: '',
	deathDate: '',
	deathDateCal: 'AD',
	deathPlace: '',
	bio: '',
	isLiving: 'unknown'
});

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function draftFromPerson(p: Row): PersonDraft {
	return {
		firstName: str(p.firstName),
		middleName: str(p.middleName),
		lastName: str(p.lastName),
		maidenName: str(p.maidenName),
		gender: str(p.gender),
		birthDate: str(p.birthDate),
		birthDateCal: p.birthDateCal === 'BS' ? 'BS' : 'AD',
		birthPlace: str(p.birthPlace),
		deathDate: str(p.deathDate),
		deathDateCal: p.deathDateCal === 'BS' ? 'BS' : 'AD',
		deathPlace: str(p.deathPlace),
		bio: str(p.bio),
		// A recorded death means deceased even when the flag was never set, so the death fields stay visible.
		isLiving:
			p.isLiving === 1 || p.isLiving === true
				? 'living'
				: p.isLiving === 0 || p.isLiving === false || str(p.deathDate) || str(p.deathPlace)
					? 'deceased'
					: 'unknown'
	};
}

/** Create drops empty strings; update sends '' to clear text. Empty gender is never sent (enum). */
export function draftToBody(d: PersonDraft, forUpdate: boolean): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const death = ['deathDate', 'deathDateCal', 'deathPlace'];
	for (const [k, v] of Object.entries(d)) {
		if (k === 'isLiving') continue;
		// Death fields are shown only for deceased people: living clears them, unknown leaves them alone.
		if (death.includes(k) && d.isLiving !== 'deceased') {
			if (forUpdate && d.isLiving === 'living' && k !== 'deathDateCal') out[k] = '';
			continue;
		}
		if (v === '' && (!forUpdate || k === 'gender')) continue;
		out[k] = v;
	}
	if (d.isLiving !== 'unknown') out.isLiving = d.isLiving === 'living';
	else if (forUpdate) out.isLiving = null;
	return out;
}
