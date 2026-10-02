// GEDCOM 5.5.1 reader and writer (§6.9). Plain ESM, no app imports, so the import and
// export worker threads and the tests all use the same code.
import { parseAdDate } from './dates-ad.mjs';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---------------------------------------------------------------- parsing

/**
 * @typedef {{ level: number, xref: string | null, tag: string, value: string, children: Node[] }} Node
 * @typedef {{
 *   xref: string, firstName: string, lastName: string | null, gender: string,
 *   birthDate: string | null, birthDateNorm: string | null, birthPlace: string | null,
 *   deathDate: string | null, deathDateNorm: string | null, deathPlace: string | null, bio: string | null
 * }} ParsedPerson
 * @typedef {{ type: 'parent' | 'spouse' | 'sibling', a: string, b: string, startDate: string | null }} ParsedLink
 */

/**
 * Lines -> tree. CONC joins without a break, CONT with a newline.
 * @param {string} text
 * @returns {Node[]}
 */
function readTree(text) {
	/** @type {Node[]} */
	const roots = [];
	/** @type {Node[]} */
	const stack = [];
	for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
		const line = raw.trim();
		if (!line) continue;
		const m = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/.exec(line);
		if (!m) continue;
		const level = Number(m[1]);
		const tag = (m[3] ?? '').toUpperCase();
		const value = m[4] ?? '';
		if (tag === 'CONC' || tag === 'CONT') {
			const last = stack[Math.min(stack.length, level) - 1] ?? stack[stack.length - 1];
			if (last) last.value += (tag === 'CONT' ? '\n' : '') + value;
			continue;
		}
		/** @type {Node} */
		const node = { level, xref: m[2] ?? null, tag, value, children: [] };
		stack.length = level;
		const parent = stack[level - 1];
		if (parent) parent.children.push(node);
		else roots.push(node);
		stack[level] = node;
	}
	return roots;
}

/** @param {Node} n @param {string} tag */
const child = (n, tag) => n.children.find((c) => c.tag === tag);
/** @param {Node} n @param {string} tag */
const childValue = (n, tag) => child(n, tag)?.value.trim() || null;

const INDI_KNOWN = new Set(['NAME', 'SEX', 'BIRT', 'DEAT', 'NOTE', 'FAMS', 'FAMC']);
const FAM_KNOWN = new Set(['HUSB', 'WIFE', 'CHIL', 'MARR']);

/** @param {string | null} v @returns {string | null} */
const nonEmpty = (v) => (v && v.trim() ? v.trim() : null);

/**
 * @param {string} text
 * @param {{ maxPersons: number, maxRelationships: number, maxDepth: number }} limits
 * @returns {{
 *   persons: ParsedPerson[], links: ParsedLink[], warnings: string[], unknownTags: number,
 *   error: null | { code: 'IMPORT_LIMIT' | 'IMPORT_INVALID', message: string }
 * }}
 */
export function parseGedcom(text, limits) {
	const roots = readTree(text);
	/** @type {ParsedPerson[]} */
	const persons = [];
	/** @type {ParsedLink[]} */
	const links = [];
	/** @type {string[]} */
	const warnings = [];
	let unknownTags = 0;
	const known = new Set();

	for (const r of roots) {
		if (r.tag !== 'INDI') continue;
		if (persons.length >= limits.maxPersons) {
			return { persons, links, warnings, unknownTags, error: { code: 'IMPORT_LIMIT', message: `More than ${limits.maxPersons} people` } };
		}
		const xref = r.xref ?? `@auto${persons.length}@`;
		known.add(xref);
		const name = child(r, 'NAME');
		let first = name ? childValue(name, 'GIVN') : null;
		let last = name ? childValue(name, 'SURN') : null;
		if (name && !first && !last) {
			const m = /^([^/]*)\/([^/]*)\/?\s*(.*)$/.exec(name.value);
			first = nonEmpty((m ? `${m[1] ?? ''} ${m[3] ?? ''}` : name.value).replace(/\s+/g, ' '));
			last = nonEmpty(m ? (m[2] ?? '') : null);
		}
		if (!first) {
			first = 'Unknown';
			warnings.push(`${xref}: no given name, imported as "Unknown"`);
		}
		const birt = child(r, 'BIRT');
		const deat = child(r, 'DEAT');
		const bd = birt ? childValue(birt, 'DATE') : null;
		const dd = deat ? childValue(deat, 'DATE') : null;
		const sex = (childValue(r, 'SEX') ?? 'U').toUpperCase().slice(0, 1);
		const notes = r.children.filter((c) => c.tag === 'NOTE' && !/^@.*@$/.test(c.value.trim())).map((c) => c.value);
		persons.push({
			xref,
			firstName: first,
			lastName: last,
			gender: ['M', 'F', 'X'].includes(sex) ? sex : 'U',
			birthDate: bd,
			birthDateNorm: bd ? parseAdDate(bd) : null,
			birthPlace: birt ? childValue(birt, 'PLAC') : null,
			deathDate: dd,
			deathDateNorm: dd ? parseAdDate(dd) : null,
			deathPlace: deat ? childValue(deat, 'PLAC') : null,
			bio: notes.length ? notes.join('\n\n') : null
		});
		for (const c of r.children) if (!INDI_KNOWN.has(c.tag)) unknownTags++;
	}

	/** @type {Set<string>} */
	const seen = new Set();
	/** @param {ParsedLink} l */
	const add = (l) => {
		const [a, b] = l.type === 'parent' || l.a <= l.b ? [l.a, l.b] : [l.b, l.a];
		const key = `${l.type}|${a}|${b}`;
		if (seen.has(key)) return;
		seen.add(key);
		links.push({ ...l, a, b });
	};
	for (const r of roots) {
		if (r.tag !== 'FAM') continue;
		const husb = childValue(r, 'HUSB');
		const wife = childValue(r, 'WIFE');
		const kids = r.children.filter((c) => c.tag === 'CHIL').map((c) => c.value.trim());
		const marr = child(r, 'MARR');
		const ok = (/** @type {string | null} */ x) => (x && known.has(x) ? x : null);
		const parents = [ok(husb), ok(wife)].filter(/** @returns {x is string} */ (x) => x !== null);
		if (husb && !ok(husb)) warnings.push(`FAM ${r.xref ?? ''}: unknown person ${husb}`);
		if (wife && !ok(wife)) warnings.push(`FAM ${r.xref ?? ''}: unknown person ${wife}`);
		if (parents.length === 2 && parents[0] !== parents[1]) {
			add({ type: 'spouse', a: parents[0] ?? '', b: parents[1] ?? '', startDate: marr ? childValue(marr, 'DATE') : null });
		}
		for (const k of kids) {
			if (!known.has(k)) {
				warnings.push(`FAM ${r.xref ?? ''}: unknown child ${k}`);
				continue;
			}
			for (const p of parents) if (p !== k) add({ type: 'parent', a: p, b: k, startDate: null });
		}
		// A family with children and no parents: the children are siblings of unknown parents.
		if (parents.length === 0) {
			const ks = kids.filter((k) => known.has(k));
			for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) add({ type: 'sibling', a: ks[i] ?? '', b: ks[j] ?? '', startDate: null });
		}
		for (const c of r.children) if (!FAM_KNOWN.has(c.tag)) unknownTags++;
		if (links.length > limits.maxRelationships) {
			return { persons, links, warnings, unknownTags, error: { code: 'IMPORT_LIMIT', message: `More than ${limits.maxRelationships} relationships` } };
		}
	}
	for (const r of roots) if (!['HEAD', 'TRLR', 'INDI', 'FAM'].includes(r.tag)) unknownTags++;

	const bad = parentGraphProblem(links, limits.maxDepth);
	if (bad) return { persons, links, warnings, unknownTags, error: { code: 'IMPORT_INVALID', message: bad } };
	return { persons, links, warnings, unknownTags, error: null };
}

/**
 * The imported parent graph must be acyclic and no deeper than `maxDepth`
 * generations (the same rules as adding the links one by one, §6.11).
 * @param {ParsedLink[]} links
 * @param {number} maxDepth
 * @returns {string | null}
 */
export function parentGraphProblem(links, maxDepth) {
	/** @type {Map<string, string[]>} */
	const kids = new Map();
	/** @type {Map<string, number>} */
	const indeg = new Map();
	for (const l of links) {
		if (l.type !== 'parent') continue;
		kids.set(l.a, [...(kids.get(l.a) ?? []), l.b]);
		indeg.set(l.b, (indeg.get(l.b) ?? 0) + 1);
		if (!indeg.has(l.a)) indeg.set(l.a, 0);
	}
	/** @type {Map<string, number>} */
	const depth = new Map();
	const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
	for (const id of queue) depth.set(id, 1);
	let seen = 0;
	let deepest = 0;
	while (queue.length) {
		const id = /** @type {string} */ (queue.shift());
		seen++;
		const d = depth.get(id) ?? 1;
		deepest = Math.max(deepest, d);
		for (const k of kids.get(id) ?? []) {
			depth.set(k, Math.max(depth.get(k) ?? 1, d + 1));
			indeg.set(k, (indeg.get(k) ?? 1) - 1);
			if (indeg.get(k) === 0) queue.push(k);
		}
	}
	if (seen < indeg.size) return 'The file contains a parent cycle';
	if (deepest > maxDepth + 1) return `The file has more than ${maxDepth} generations`;
	return null;
}

// ---------------------------------------------------------------- writing

/**
 * `YYYY-MM-DD` with 00 for unknown parts -> GEDCOM `D MON YYYY`, `MON YYYY` or `YYYY`.
 * @param {string | null | undefined} norm
 */
export function gedcomDate(norm) {
	const m = norm ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(norm) : null;
	if (!m || m[1] === '0000') return null;
	const y = m[1];
	const mon = m[2] === '00' ? null : MON[Number(m[2]) - 1];
	if (!mon) return y;
	return m[3] === '00' ? `${mon} ${y}` : `${Number(m[3])} ${mon} ${y}`;
}

/** @param {number} level @param {string} tag @param {string | null | undefined} value @param {string[]} out */
function line(level, tag, value, out) {
	if (value === null || value === undefined || value === '') {
		out.push(`${level} ${tag}`);
		return;
	}
	// Free text: newlines become CONT, long lines CONC (GEDCOM lines stay under 255 chars).
	const parts = String(value).split(/\r\n|\n|\r/);
	parts.forEach((p, i) => {
		let rest = p;
		let first = true;
		do {
			const chunk = rest.slice(0, 200);
			rest = rest.slice(200);
			if (i === 0 && first) out.push(`${level} ${tag} ${chunk}`);
			else out.push(`${level + 1} ${first ? 'CONT' : 'CONC'} ${chunk}`);
			first = false;
		} while (rest.length);
	});
}

/**
 * @typedef {{ id: string, firstName: string, middleName?: string | null, lastName?: string | null, gender?: string | null,
 *   birthDate?: string | null, birthDateCal?: string | null, birthDateNorm?: string | null, birthPlace?: string | null,
 *   deathDate?: string | null, deathDateCal?: string | null, deathDateNorm?: string | null, deathPlace?: string | null, bio?: string | null }} ExportPerson
 * @typedef {{ person1Id: string, person2Id: string, type: string, startDate?: string | null }} ExportLink
 * @typedef {{ personId: string, type: string, date?: string | null, dateCal?: string | null, dateNorm?: string | null, place?: string | null, description?: string | null }} ExportEvent
 */

/**
 * @param {{ people: ExportPerson[], links: ExportLink[], events?: ExportEvent[], treeName?: string }} m
 * @returns {string}
 */
export function buildGedcom(m) {
	/** @type {string[]} */
	const out = [];
	out.push('0 HEAD', '1 SOUR family-tree', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8');
	if (m.treeName) line(1, 'NOTE', `Exported from ${m.treeName}`, out);
	const idx = new Map(m.people.map((p, i) => [p.id, `@I${i + 1}@`]));

	// Families: one per distinct set of parents; spouse links join the same family; sibling links get their own.
	/** @type {Map<string, { parents: string[], kids: string[], marr: string | null }>} */
	const fams = new Map();
	/** @param {string[]} parents */
	const fam = (parents) => {
		const key = [...parents].sort().join('|');
		let f = fams.get(key);
		if (!f) fams.set(key, (f = { parents: [...parents].sort(), kids: [], marr: null }));
		return f;
	};
	/** @type {Map<string, Set<string>>} */
	const parentsOf = new Map();
	for (const l of m.links) {
		if (l.type !== 'parent') continue;
		const s = parentsOf.get(l.person2Id) ?? new Set();
		s.add(l.person1Id);
		parentsOf.set(l.person2Id, s);
	}
	for (const [kid, ps] of parentsOf) fam([...ps]).kids.push(kid);
	for (const l of m.links) {
		if (l.type === 'spouse') {
			const f = fam([l.person1Id, l.person2Id]);
			f.marr = l.startDate ?? f.marr;
		}
	}
	/** @type {ExportLink[]} */
	const sibs = m.links.filter((l) => l.type === 'sibling');
	const famList = [...fams.values()];
	/** @type {Map<string, string[]>} */
	const fams_of = new Map();
	/** @type {Map<string, string[]>} */
	const famc_of = new Map();
	famList.forEach((f, i) => {
		const id = `@F${i + 1}@`;
		for (const p of f.parents) fams_of.set(p, [...(fams_of.get(p) ?? []), id]);
		for (const k of f.kids) famc_of.set(k, [...(famc_of.get(k) ?? []), id]);
	});
	sibs.forEach((s, i) => {
		const id = `@F${famList.length + i + 1}@`;
		for (const k of [s.person1Id, s.person2Id]) famc_of.set(k, [...(famc_of.get(k) ?? []), id]);
	});

	const events = m.events ?? [];
	for (const p of m.people) {
		out.push(`0 ${idx.get(p.id)} INDI`);
		// GEDCOM keeps all given names together; an import puts them back into firstName.
		const given = [p.firstName, p.middleName].filter(Boolean).join(' ');
		out.push(`1 NAME ${given} /${p.lastName ?? ''}/`);
		line(2, 'GIVN', given, out);
		if (p.lastName) line(2, 'SURN', p.lastName, out);
		if (p.gender === 'M' || p.gender === 'F') out.push(`1 SEX ${p.gender}`);
		for (const [tag, text, norm, cal, place] of /** @type {const} */ ([
			['BIRT', p.birthDate, p.birthDateNorm, p.birthDateCal, p.birthPlace],
			['DEAT', p.deathDate, p.deathDateNorm, p.deathDateCal, p.deathPlace]
		])) {
			if (!text && !place) continue;
			out.push(`1 ${tag}`);
			const g = gedcomDate(norm);
			if (g) line(2, 'DATE', g, out);
			else if (text && cal !== 'BS') line(2, 'DATE', text, out);
			if (place) line(2, 'PLAC', place, out);
			// GEDCOM 5.5.1 has no Bikram Sambat calendar: the Gregorian value goes in DATE, the original in a NOTE.
			if (text && cal === 'BS') line(2, 'NOTE', `Original date (BS): ${text}`, out);
		}
		if (p.bio) line(1, 'NOTE', p.bio, out);
		for (const e of events.filter((x) => x.personId === p.id)) {
			out.push('1 EVEN');
			line(2, 'TYPE', e.type, out);
			const g = gedcomDate(e.dateNorm);
			if (g) line(2, 'DATE', g, out);
			if (e.place) line(2, 'PLAC', e.place, out);
			const notes = [e.description, e.date && e.dateCal === 'BS' ? `Original date (BS): ${e.date}` : null].filter(Boolean).join('\n');
			if (notes) line(2, 'NOTE', notes, out);
		}
		for (const f of fams_of.get(p.id) ?? []) out.push(`1 FAMS ${f}`);
		for (const f of famc_of.get(p.id) ?? []) out.push(`1 FAMC ${f}`);
	}
	const gender = new Map(m.people.map((p) => [p.id, p.gender]));
	famList.forEach((f, i) => {
		out.push(`0 @F${i + 1}@ FAM`);
		// HUSB/WIFE follow the recorded gender; unknown genders fill the free slot.
		const husb = f.parents.find((p) => gender.get(p) === 'M') ?? f.parents.find((p) => gender.get(p) !== 'F');
		const wife = f.parents.find((p) => p !== husb);
		if (husb) out.push(`1 HUSB ${idx.get(husb)}`);
		if (wife) out.push(`1 WIFE ${idx.get(wife)}`);
		for (const k of f.kids) out.push(`1 CHIL ${idx.get(k)}`);
		const g = gedcomDate(f.marr && /^\d{4}-\d{2}-\d{2}$/.test(f.marr) ? f.marr : parseAdDate(f.marr ?? ''));
		if (f.marr) {
			out.push('1 MARR');
			if (g) line(2, 'DATE', g, out);
		}
	});
	sibs.forEach((s, i) => {
		out.push(`0 @F${famList.length + i + 1}@ FAM`, `1 CHIL ${idx.get(s.person1Id)}`, `1 CHIL ${idx.get(s.person2Id)}`);
	});
	out.push('0 TRLR');
	return out.join('\n') + '\n';
}
