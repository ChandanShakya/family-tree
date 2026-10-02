import { relativeLuminance, contrastRatio, TOKEN_PAIRS, TEXT_MIN, UI_MIN } from '../src/lib/utils/contrast.js';

let failed = 0;
for (const pair of TOKEN_PAIRS) {
	const ratio = contrastRatio(pair.fg, pair.bg);
	const min = pair.large ? UI_MIN : TEXT_MIN;
	const ok = ratio >= min;
	console.log(
		`${ok ? 'PASS' : 'FAIL'} ${pair.name}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1 (min ${min}:1)`
	);
	if (!ok) failed++;
}
console.log(`luminance sample: #047857 -> ${relativeLuminance('#047857').toFixed(4)}`);
if (failed > 0) {
	console.error(`${failed} pairs below minimum`);
	process.exit(1);
}
console.log('all contrast pairs pass');
