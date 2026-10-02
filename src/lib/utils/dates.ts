import NepaliDate from 'nepali-date-converter';
import { pad, parseAdDate } from '$lib/shared/dates-ad.mjs';

export type DateCal = 'AD' | 'BS';

export interface ParsedDate {
	verbatim: string;
	cal: DateCal;
	norm: string | null;
}

// Supported BS year range verified against nepali-date-converter@3.4.0
// (dateConfigMap keys; constructor throws outside it). Recorded in DECISIONS.md D-007c.
export const BS_MIN_YEAR = 2000;
export const BS_MAX_YEAR = 2090;

const BS_MONTHS: Record<string, number> = {
	baisakh: 1,
	jestha: 2,
	jeth: 2,
	ashadh: 3,
	ashad: 3,
	asar: 3,
	shrawan: 4,
	sawan: 4,
	bhadra: 5,
	bhado: 5,
	ashwin: 6,
	aswin: 6,
	kartik: 7,
	kattik: 7,
	mangsir: 8,
	manshir: 8,
	marg: 8,
	poush: 9,
	push: 9,
	magh: 10,
	falgun: 11,
	phagun: 11,
	chaitra: 12,
	chait: 12
};

function bsToAd(y: number, m: number, d: number): string | null {
	try {
		const ad = new NepaliDate(y, m - 1, d).getAD();
		return `${ad.year}-${pad(ad.month + 1)}-${pad(ad.date)}`;
	} catch {
		return null;
	}
}

function adToBs(iso: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return null;
	try {
		// Local-midnight construction: the library reads local YMD fields,
		// so this is exact in every timezone.
		const bs = new NepaliDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getBS();
		return `${bs.year}-${pad(bs.month + 1)}-${pad(bs.date)}`;
	} catch {
		return null;
	}
}

function parseBs(text: string): string | null {
	const s = text.trim();
	let m: RegExpExecArray | null;
	if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
		return bsToAd(Number(m[1]), Number(m[2]), Number(m[3]));
	}
	if ((m = /^(\d{4})-(\d{2})$/.exec(s))) {
		const y = Number(m[1]);
		const mo = Number(m[2]);
		if (mo < 1 || mo > 12) return null;
		// Partial BS: Norm is Gregorian conversion of first day of the period,
		// written complete with no 00 placeholders (§6.3).
		return bsToAd(y, mo, 1);
	}
	if ((m = /^(\d{4})$/.exec(s))) {
		return bsToAd(Number(m[1]), 1, 1);
	}
	if ((m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s))) {
		const mo = BS_MONTHS[m[2]!.toLowerCase()];
		if (!mo) return null;
		return bsToAd(Number(m[3]), mo, Number(m[1]));
	}
	return null;
}

export function parseDate(verbatim: string, cal: DateCal): ParsedDate {
	const norm = cal === 'BS' ? parseBs(verbatim) : parseAdDate(verbatim);
	return { verbatim, cal, norm };
}

const EN_MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export function formatGregorian(norm: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(norm);
	if (!m) return norm;
	const [, y, mo, d] = m as unknown as [string, string, string, string];
	if (mo === '00') return y;
	if (d === '00') return `${EN_MONTH_NAMES[Number(mo) - 1]} ${y}`;
	return `${Number(d)} ${EN_MONTH_NAMES[Number(mo) - 1]} ${y}`;
}

export type DateDisplayPref = 'AD' | 'BS' | 'both';

export function displayDate(parsed: ParsedDate, pref: DateDisplayPref): string {
	if (parsed.cal === 'AD') {
		if (!parsed.norm) return parsed.verbatim;
		if (pref === 'BS') {
			const bs = adToBs(parsed.norm.replace(/-00/g, '-01'));
			if (parsed.norm.endsWith('-00-00')) return parsed.verbatim;
			return bs ?? formatGregorian(parsed.norm);
		}
		if (pref === 'both') {
			const base = formatGregorian(parsed.norm);
			const bs = /00/.test(parsed.norm) ? null : adToBs(parsed.norm);
			return bs ? `${base} (${bs} BS)` : base;
		}
		return formatGregorian(parsed.norm);
	}
	// BS input: show stored text unless a full Gregorian norm converts cleanly.
	if (pref === 'AD') {
		if (parsed.norm && !/00/.test(parsed.norm)) {
			return formatGregorian(parsed.norm);
		}
		return parsed.verbatim;
	}
	if (pref === 'both' && parsed.norm) {
		return `${parsed.verbatim} (${formatGregorian(parsed.norm)} AD)`;
	}
	return parsed.verbatim;
}
