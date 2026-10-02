// Normalisation and Damerau-Levenshtein fuzzy matching (§6.8). Pure
// functions over NFKC-normalised code points, so non-Latin names work.

/** Lowercase, NFKC, trim, collapse internal whitespace (§6.5, §6.8). */
export function normalizeText(s: string): string {
	return s
		.normalize('NFKC')
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ' ');
}

export function splitTokens(s: string): string[] {
	const t = normalizeText(s);
	return t ? t.split(' ') : [];
}

/** Damerau-Levenshtein over code points (not UTF-16 units). */
export function damerauLevenshtein(a: string, b: string): number {
	const ca = [...normalizeText(a)];
	const cb = [...normalizeText(b)];
	const m = ca.length;
	const n = cb.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const INF = m + n;
	const d: number[][] = Array.from({ length: m + 2 }, () => new Array<number>(n + 2).fill(0));
	d[0]?.fill(INF);
	for (const row of d) row[0] = INF;
	d[1]![1] = 0;
	for (let i = 1; i <= m; i++) {
		d[i + 1]![1] = i;
		d[i + 1]![0] = INF;
	}
	for (let j = 1; j <= n; j++) {
		d[1]![j + 1] = j;
		d[0]![j + 1] = INF;
	}
	const seen = new Map<string, number>();
	for (let i = 1; i <= m; i++) {
		let db = 0;
		for (let j = 1; j <= n; j++) {
			const i1 = seen.get(cb[j - 1] as string) ?? 0;
			const j1 = db;
			const cost = ca[i - 1] === cb[j - 1] ? 0 : 1;
			if (cost === 0) db = j;
			d[i + 1]![j + 1] = Math.min(
				(d[i]![j] as number) + cost,
				(d[i + 1]![j] as number) + 1,
				(d[i]![j + 1] as number) + 1,
				(d[i1]![j1] as number) + (i - i1 - 1) + 1 + (j - j1 - 1)
			);
		}
		seen.set(ca[i - 1] as string, i);
	}
	return d[m + 1]![n + 1] as number;
}

/** Per-token distance budget: 1 for tokens ≤ 5 characters, else 2 (§6.8). */
export function tokenBudget(token: string): number {
	return [...normalizeText(token)].length <= 5 ? 1 : 2;
}

export interface FuzzyHit {
	id: string;
	score: number;
}

/**
 * Every query token must match some name token within budget. Score is the
 * total distance (lower is better). Pure and synchronous; the worker host
 * enforces the 300 ms cap around it.
 */
export function fuzzyMatch(names: Array<{ id: string; name: string }>, query: string, limit = 20): FuzzyHit[] {
	const qtokens = splitTokens(query);
	if (qtokens.length === 0) return [];
	const hits: FuzzyHit[] = [];
	for (const { id, name } of names) {
		const ntokens = splitTokens(name);
		let total = 0;
		let ok = true;
		for (const q of qtokens) {
			let best = Infinity;
			for (const t of ntokens) {
				const d = damerauLevenshtein(q, t);
				if (d < best) best = d;
				if (best === 0) break;
			}
			if (best > tokenBudget(q)) {
				ok = false;
				break;
			}
			total += best;
		}
		if (ok) hits.push({ id, score: total });
	}
	hits.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
	return hits.slice(0, limit);
}
