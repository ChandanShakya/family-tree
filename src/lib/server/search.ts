import { DUPLICATE_MAX_PAIRS } from '$lib/config.js';
import { fuzzyMatch, normalizeText } from '$lib/utils/fuzzy.js';
import type { Handles } from './tx.js';

export interface SearchHit {
	id: string;
	firstName: string;
	middleName: string | null;
	lastName: string | null;
	birthDateNorm: string | null;
	birthPlace: string | null;
}

function escapeToken(token: string): string {
	return `"${token.replace(/"/g, '""')}"`;
}

export interface SearchFilters {
	name?: string;
	birthYear?: string;
	place?: string;
}

const tokens = (q: string) => q.split(/\s+/).map((t) => t.trim()).filter(Boolean);

/**
 * FTS5 prefix query from escaped, quoted tokens (§6.8). Free text matches any
 * column; name/birthYear/place filters are column-scoped and ANDed.
 */
export function buildFtsQuery(q: string, f: SearchFilters = {}): string | null {
	const parts: string[] = tokens(q).map((t) => `${escapeToken(t)}*`);
	for (const t of tokens(f.name ?? '')) parts.push(`name : ${escapeToken(t)}*`);
	for (const t of tokens(f.place ?? '')) parts.push(`place : ${escapeToken(t)}*`);
	if (f.birthYear?.trim()) parts.push(`birthYear : ${escapeToken(f.birthYear.trim())}`);
	return parts.length ? parts.join(' AND ') : null;
}

export function ftsSearch(h: Handles, treeId: string, q: string, limit = 20, f: SearchFilters = {}): SearchHit[] {
	const match = buildFtsQuery(q, f);
	if (!match) return [];
	return h.raw
		.prepare(
			`SELECT v.id, v.firstName, v.middleName, v.lastName, v.birthDateNorm, v.birthPlace
			 FROM persons_fts f JOIN visible_persons v ON v.id = f.personId
			 WHERE f.treeId = ? AND persons_fts MATCH ? ORDER BY rank LIMIT ?`
		)
		.all(treeId, match, limit) as SearchHit[];
}

/** Apply birth-year / place filters to fuzzy hits (the fuzzy stage only matches names). */
export function filterHits(h: Handles, ids: string[], f: SearchFilters): SearchHit[] {
	const out: SearchHit[] = [];
	for (const id of ids) {
		const r = h.raw
			.prepare(`SELECT id, firstName, middleName, lastName, birthDateNorm, birthPlace, deathPlace FROM visible_persons WHERE id = ?`)
			.get(id) as (SearchHit & { deathPlace: string | null }) | undefined;
		if (!r) continue;
		if (f.birthYear && !(r.birthDateNorm ?? '').startsWith(f.birthYear.trim())) continue;
		if (f.place) {
			const hay = normalizeText(`${r.birthPlace ?? ''} ${r.deathPlace ?? ''}`);
			if (!tokens(normalizeText(f.place)).every((t) => hay.includes(t))) continue;
		}
		out.push({ id: r.id, firstName: r.firstName, middleName: r.middleName, lastName: r.lastName, birthDateNorm: r.birthDateNorm, birthPlace: r.birthPlace });
	}
	return out;
}

/** Inline fuzzy fallback over (id, normalised name) — same contract as the worker. */
export function fuzzySearchInline(h: Handles, treeId: string, q: string, limit = 20): SearchHit[] {
	const rows = h.raw
		.prepare(
			`SELECT id, trim(firstName || ' ' || coalesce(middleName,'') || ' ' || coalesce(lastName,'') || ' ' || coalesce(maidenName,'')) AS name
			 FROM visible_persons WHERE treeId = ?`
		)
		.all(treeId) as Array<{ id: string; name: string }>;
	const hits = fuzzyMatch(rows, q, limit);
	const out: SearchHit[] = [];
	for (const hit of hits) {
		const full = h.raw.prepare(`SELECT id, firstName, middleName, lastName, birthDateNorm, birthPlace FROM visible_persons WHERE id = ?`).get(hit.id) as SearchHit | undefined;
		if (full) out.push(full);
	}
	return out;
}

export interface SurnameRow {
	lastName: string;
	count: number;
}

export function surnameExplorer(h: Handles, treeId: string): SurnameRow[] {
	return h.raw
		.prepare(
			`SELECT lastName, COUNT(*) AS count FROM visible_persons
			 WHERE treeId = ? AND lastName IS NOT NULL AND lastName != ''
			 GROUP BY lastName ORDER BY count DESC, lastName`
		)
		.all(treeId) as SurnameRow[];
}

export interface DuplicatePair {
	a: SearchHit;
	b: SearchHit;
	reason: 'birthYear' | 'birthPlace';
}

export interface DuplicateResult {
	pairs: DuplicatePair[];
	truncated: boolean;
}

/**
 * Candidate pairs only (no merge): same normalised name with birth years
 * within ±2 or same birth place. Grouped query, never a nested loop (§6.8).
 */
export function duplicateFinder(h: Handles, treeId: string): DuplicateResult {
	const norm = (r: { firstName: string; middleName: string | null; lastName: string | null; maidenName: string | null }): string =>
		normalizeText(`${r.firstName} ${r.middleName ?? ''} ${r.lastName ?? ''} ${r.maidenName ?? ''}`.replace(/\s+/g, ' ').trim());
	const rows = h.raw
		.prepare(
			`SELECT id, firstName, middleName, lastName, maidenName, birthDateNorm, birthPlace FROM visible_persons WHERE treeId = ?`
		)
		.all(treeId) as Array<{
		id: string;
		firstName: string;
		middleName: string | null;
		lastName: string | null;
		maidenName: string | null;
		birthDateNorm: string | null;
		birthPlace: string | null;
	}>;
	const groups = new Map<string, typeof rows>();
	for (const r of rows) {
		const key = norm(r);
		const list = groups.get(key) ?? [];
		list.push(r);
		groups.set(key, list);
	}
	const pairs: DuplicatePair[] = [];
	let truncated = false;
	const yearOf = (n: string | null): number | null => {
		if (!n || n.length < 4 || n.startsWith('0000')) return null;
		const y = Number(n.slice(0, 4));
		return Number.isFinite(y) ? y : null;
	};
	const toHit = (r: (typeof rows)[number]): SearchHit => ({
		id: r.id,
		firstName: r.firstName,
		middleName: r.middleName,
		lastName: r.lastName,
		birthDateNorm: r.birthDateNorm,
		birthPlace: r.birthPlace
	});
	for (const list of groups.values()) {
		if (list.length < 2) continue;
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i] as (typeof rows)[number];
				const b = list[j] as (typeof rows)[number];
				const ya = yearOf(a.birthDateNorm);
				const yb = yearOf(b.birthDateNorm);
				let reason: DuplicatePair['reason'] | null = null;
				if (ya !== null && yb !== null && Math.abs(ya - yb) <= 2) reason = 'birthYear';
				else if (
					a.birthPlace &&
					b.birthPlace &&
					normalizeText(a.birthPlace) === normalizeText(b.birthPlace)
				) {
					reason = 'birthPlace';
				}
				if (!reason) continue;
				if (pairs.length >= DUPLICATE_MAX_PAIRS) {
					truncated = true;
					return { pairs, truncated };
				}
				pairs.push({ a: toHit(a), b: toHit(b), reason });
			}
		}
		if (pairs.length >= DUPLICATE_MAX_PAIRS) {
			truncated = true;
			break;
		}
	}
	return { pairs, truncated };
}
