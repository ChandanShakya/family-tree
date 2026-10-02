import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Parses the §12 acceptance table from SPECS.md and requires, for every AT
// whose phase is <= the requested phase, at least one test title in tests/**
// starting with that ID. Fails on skipped/todo/only markers.
// Plain Node ESM, no dependencies (SPECS §0.1.9, §14).
const PHASE_ORDER = ['1a', '1b', '2', '3', '4', '5', '6'];

/**
 * @param {string} id
 * @returns {number}
 */
function phaseIndex(id) {
	const base = id.replace(/,.*$/, '').trim();
	return PHASE_ORDER.indexOf(base);
}

/**
 * @param {string} specsText
 * @returns {Array<{ id: string, phase: string }>}
 */
export function parseAts(specsText) {
	/** @type {Array<{ id: string, phase: string }>} */
	const rows = [];
	const re = /\|\s*(AT-\d+)\s*\|\s*([^|]+)\|/g;
	let m;
	while ((m = re.exec(specsText)) !== null) {
		const phaseCell = (m[2] ?? '').trim().split(/\s+/)[0] ?? '';
		rows.push({ id: m[1] ?? '', phase: phaseCell });
	}
	return rows;
}

/**
 * @param {string} dir
 * @param {Array<{ id: string, file: string }>} [files]
 * @returns {Array<{ id: string, file: string }>}
 */
export function collectTestTitles(dir, files = []) {
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, name.name);
		if (name.isDirectory()) collectTestTitles(full, files);
		else if (/\.(test|spec)\.(ts|js|mjs)$/.test(name.name)) {
			const text = readFileSync(full, 'utf8');
			const re = /(?:test|it)\s*\(\s*['"`](AT-\d+)[^'"`]*['"`]/g;
			let m;
			while ((m = re.exec(text)) !== null) files.push({ id: m[1] ?? '', file: full });
			const banned = /\.(skip|todo|only)\s*\(|xit\s*\(|xdescribe\s*\(|fixme/i.test(text);
			if (banned) files.push({ id: '__BANNED__', file: full });
		}
	}
	return files;
}

function main() {
	const args = process.argv.slice(2);
	const at = args.indexOf('--phase');
	const phase = at >= 0 ? (args[at + 1] ?? '') : '';
	if (!phase || !PHASE_ORDER.includes(phase)) {
		console.error(`usage: check-traceability.mjs --phase <${PHASE_ORDER.join('|')}>`);
		process.exit(2);
	}
	const specs = readFileSync(new URL('../docs/project/SPECS.md', import.meta.url), 'utf8');
	const ats = parseAts(specs);
	const inScope = ats.filter((r) => phaseIndex(r.phase) >= 0 && phaseIndex(r.phase) <= phaseIndex(phase));
	const titles = collectTestTitles(new URL('../tests', import.meta.url).pathname);
	const banned = titles.filter((t) => t.id === '__BANNED__');
	if (banned.length > 0) {
		for (const b of banned) console.error(`banned marker in ${b.file}`);
		process.exit(1);
	}
	const have = new Set(titles.map((t) => t.id));
	let failed = 0;
	for (const row of inScope) {
		if (!have.has(row.id)) {
			console.error(`missing test for ${row.id} (phase ${row.phase})`);
			failed++;
		}
	}
	if (failed > 0) process.exit(1);
	console.log(`traceability ok: ${inScope.length} ATs in scope for phase ${phase}, all covered`);
}

const __isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (__isMain) main();
