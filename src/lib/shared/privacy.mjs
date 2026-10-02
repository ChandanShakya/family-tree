// Privacy filter (§6.9). Plain ESM: the app routes and the export worker share one definition.

/**
 * Living if `isLiving = 1`, or `isLiving` is unknown with no death date and
 * (born within `years` years, or birth unknown).
 * @param {{ isLiving?: number | boolean | null, deathDate?: string | null, deathDateNorm?: string | null, birthDateNorm?: string | null }} p
 * @param {Date} [now]
 * @param {number} [years]
 */
export function isLiving(p, now = new Date(), years = 110) {
	if (p.isLiving === 1 || p.isLiving === true) return true;
	if (p.isLiving === 0 || p.isLiving === false) return false;
	if (p.deathDate || p.deathDateNorm) return false;
	const y = birthYear(p.birthDateNorm);
	return y === null || now.getUTCFullYear() - y <= years;
}

/** @param {string | null | undefined} norm */
export function birthYear(norm) {
	if (!norm || norm.length < 4 || norm.startsWith('0000')) return null;
	const y = Number(norm.slice(0, 4));
	return Number.isFinite(y) ? y : null;
}

/**
 * A living person keeps only their id and tree: the name is "Living" and every
 * date, place, note, photo, gender and claim link is dropped. Edges are kept by
 * the callers (they only reference ids).
 * @template {Record<string, any>} T
 * @param {T} p
 * @returns {T}
 */
export function anonymisePerson(p) {
	return {
		...p,
		firstName: 'Living',
		middleName: null,
		lastName: null,
		maidenName: null,
		gender: 'U',
		birthDate: null,
		birthDateCal: 'AD',
		birthDateNorm: null,
		deathDate: null,
		deathDateCal: 'AD',
		deathDateNorm: null,
		birthPlace: null,
		deathPlace: null,
		photoUrl: null,
		bio: null,
		isLiving: null,
		userId: null,
		claimedAt: null,
		claimedVia: null,
		createdBy: null,
		lastEditedBy: null
	};
}

/**
 * Apply the filter to a list. Returns the (possibly anonymised) people and the
 * ids whose events/media must be dropped.
 * @template {Record<string, any>} T
 * @param {T[]} people
 * @param {Date} [now]
 * @param {number} [years]
 * @returns {{ people: T[], hidden: Set<string> }}
 */
export function filterPeople(people, now = new Date(), years = 110) {
	/** @type {Set<string>} */
	const hidden = new Set();
	const out = people.map((p) => {
		if (!isLiving(p, now, years)) return p;
		hidden.add(p.id);
		return anonymisePerson(p);
	});
	return { people: out, hidden };
}
