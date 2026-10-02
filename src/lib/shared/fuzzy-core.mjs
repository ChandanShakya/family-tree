// Fuzzy matching core (§6.8): plain ESM shared by the worker thread and the tests.
// Matching mirrors src/lib/utils/fuzzy.ts (NFKC code points, Damerau-Levenshtein), bounded by the budget.

/** @param {string} s */
export function normalizeText(s) {
	// NFKC only matters outside ASCII; the common all-ASCII name skips it
	// eslint-disable-next-line no-control-regex
	const t = /^[\x00-\x7f]*$/.test(s) ? s : s.normalize('NFKC');
	return t.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** @param {string} s */
export function splitTokens(s) {
	const t = normalizeText(s);
	return t ? t.split(' ') : [];
}

/**
 * Damerau-Levenshtein distance over code points, but only up to `k`: returns k + 1 as soon as the
 * distance cannot be <= k (length gap, or two consecutive rows whose minimum exceeds k). Results <= k
 * equal the unbounded distance of src/lib/utils/fuzzy.ts, which the tests compare.
 * @param {string[]} a @param {string[]} b @param {number} k
 */
export function dlBounded(a, b, k) {
	const m = a.length;
	const n = b.length;
	if (Math.abs(m - n) > k) return k + 1;
	if (m === 0) return n;
	if (n === 0) return m;
	const INF = m + n;
	const w = n + 2;
	// one reused matrix: this runs hundreds of thousands of times per query
	const need = (m + 2) * w;
	if (need > scratch.length) scratch = new Int32Array(need * 2);
	const d = /** @type {any} */ (scratch);
	for (let i = 0; i <= m + 1; i++) {
		d[i * w] = INF;
		d[i * w + 1] = i === 0 ? INF : i - 1;
	}
	for (let j = 0; j <= n + 1; j++) {
		d[j] = INF;
		d[w + j] = j === 0 ? INF : j - 1;
	}
	d[w + 1] = 0;
	// last row in which each character of `a` was seen (tokens are short: parallel arrays beat a Map)
	const seenCh = /** @type {string[]} */ ([]);
	const seenRow = /** @type {number[]} */ ([]);
	let prevMin = 0;
	for (let i = 1; i <= m; i++) {
		let db = 0;
		let rowMin = INF;
		for (let j = 1; j <= n; j++) {
			const bj = /** @type {string} */ (b[j - 1]);
			let i1 = 0;
			for (let x = 0; x < seenCh.length; x++) {
				if (seenCh[x] === bj) {
					i1 = /** @type {number} */ (seenRow[x]);
					break;
				}
			}
			const j1 = db;
			const cost = a[i - 1] === bj ? 0 : 1;
			if (cost === 0) db = j;
			const v = Math.min(
				d[i * w + j] + cost,
				d[(i + 1) * w + j] + 1,
				d[i * w + j + 1] + 1,
				d[i1 * w + j1] + (i - i1 - 1) + 1 + (j - j1 - 1)
			);
			d[(i + 1) * w + j + 1] = v;
			if (v < rowMin) rowMin = v;
		}
		const ai = /** @type {string} */ (a[i - 1]);
		const at = seenCh.indexOf(ai);
		if (at >= 0) seenRow[at] = i;
		else {
			seenCh.push(ai);
			seenRow.push(i);
		}
		// a transposition looks two rows back, so both of the last two rows must exceed k
		if (Math.min(rowMin, prevMin) > k) return k + 1;
		prevMin = rowMin;
	}
	return d[(m + 1) * w + n + 1];
}

let scratch = new Int32Array(1024);

/** @param {string} token */
export function budget(token) {
	return [...token].length <= 5 ? 1 : 2;
}


/**
 * Every query token must match some name token within its budget; the score is the total distance.
 * Stops at `deadline` (epoch ms) and returns what it has, checking the clock every 256 rows.
 * @param {Iterable<{ id: string, name: string | null }>} rows
 * @param {string} q
 * @param {number} deadline
 * @param {number} limit
 * @returns {Array<{ id: string, score: number }>}
 */
export function matchNames(rows, q, deadline, limit) {
	const qtokens = splitTokens(q).map((t) => ({ cps: [...t], k: budget(t) }));
	/** @type {Array<{ id: string, score: number }>} */
	const hits = [];
	// Names repeat heavily (a few hundred given names across 50 000 people): the distance of one name token
	// to one query token is computed once per query. This lives only for the call; nothing is kept between queries.
	/** @type {Map<string, number>[]} */
	const memo = qtokens.map(() => new Map());
	let n = 0;
	for (const { id, name } of rows) {
		if ((++n & 255) === 0 && Date.now() > deadline) break;
		const ntokens = splitTokens(name ?? '');
		let total = 0;
		let ok = qtokens.length > 0;
		for (let qi = 0; qi < qtokens.length; qi++) {
			const query = /** @type {{ cps: string[], k: number }} */ (qtokens[qi]);
			const cache = /** @type {Map<string, number>} */ (memo[qi]);
			let best = query.k + 1;
			for (const t of ntokens) {
				let dist = cache.get(t);
				if (dist === undefined) {
					dist = /** @type {number} */ (dlBounded(query.cps, [...t], query.k));
					cache.set(t, dist);
				}
				if (dist < best) best = dist;
				if (best === 0) break;
			}
			if (best > query.k) {
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
