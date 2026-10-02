import { displayDate, parseDate, type DateDisplayPref } from './dates.js';

/** Render stored date text per the viewer's preference (§6.3). */
export function fmtDate(text: string | null | undefined, cal: string | null | undefined, pref: DateDisplayPref): string {
	if (!text) return '';
	return displayDate(parseDate(text, cal === 'BS' ? 'BS' : 'AD'), pref);
}

/** Display name: first, middle and last name, skipping empty parts. */
export function fullName(p: { firstName: string; middleName?: string | null; lastName?: string | null }): string {
	return [p.firstName, p.middleName, p.lastName].filter((s) => s && s.trim()).join(' ');
}
