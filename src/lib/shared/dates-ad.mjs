// Gregorian (AD) date parsing, plain ESM so the worker threads can use it too (§6.3).

const EN_MONTHS = /** @type {Record<string, number>} */ ({
	january: 1,
	jan: 1,
	february: 2,
	feb: 2,
	march: 3,
	mar: 3,
	april: 4,
	apr: 4,
	may: 5,
	june: 6,
	jun: 6,
	july: 7,
	jul: 7,
	august: 8,
	aug: 8,
	september: 9,
	sep: 9,
	sept: 9,
	october: 10,
	oct: 10,
	november: 11,
	nov: 11,
	december: 12,
	dec: 12
});

const QUALIFIER_RE = /^(about|abt|ca|circa|c\.?|bef|before|aft|after|est|cal)\.?\s+/i;

/** @param {string} s */
function stripQualifier(s) {
	let out = s.trim();
	for (;;) {
		const next = out.replace(QUALIFIER_RE, '');
		if (next === out) return out;
		out = next.trim();
	}
}

/** @param {number} n */
export function pad(n) {
	return String(n).padStart(2, '0');
}

/** @param {number} y @param {number} m @param {number} d */
export function validGregorian(y, m, d) {
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}


/**
 * Gregorian text -> YYYY-MM-DD with 00 for unknown parts, or null (§6.3). Shared by the app and the
 * import worker so both normalise dates identically.
 * @param {string} text
 * @returns {string | null}
 */
export function parseAdDate(text) {
	const s = stripQualifier(text);
	// BET x AND y -> use x
	const bet = /^bet\s+(.+?)\s+and\s+.+$/i.exec(s);
	const t = (bet?.[1] ?? s).trim();
	/** @type {RegExpExecArray | null} */
	let m;
	if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
		const y = Number(m[1]);
		const mo = Number(m[2]);
		const d = Number(m[3]);
		return validGregorian(y, mo, d) ? `${m[1]}-${m[2]}-${m[3]}` : null;
	}
	if ((m = /^(\d{4})-(\d{2})$/.exec(t))) {
		const mo = Number(m[2]);
		return mo >= 1 && mo <= 12 ? `${m[1]}-${m[2]}-00` : null;
	}
	if ((m = /^(\d{4})$/.exec(t))) return `${m[1]}-00-00`;
	if ((m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(t))) {
		const mo = EN_MONTHS[(m[2] ?? '').toLowerCase()];
		if (!mo) return null;
		const d = Number(m[1]);
		const y = Number(m[3]);
		return validGregorian(y, mo, d)
			? `${y}-${pad(mo)}-${pad(d)}`
			: null;
	}
	if ((m = /^([A-Za-z]+)\s+(\d{4})$/.exec(t))) {
		const mo = EN_MONTHS[(m[1] ?? '').toLowerCase()];
		if (!mo) return null;
		return `${m[2]}-${pad(mo)}-00`;
	}
	return null;
}

