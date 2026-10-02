// WCAG contrast helpers shared by scripts/contrast.ts and the AT-28 test.
// Design tokens per SPECS.md §7.1.
export const TEXT_MIN = 4.5;
export const UI_MIN = 3;

export interface TokenPair {
	name: string;
	fg: string;
	bg: string;
	large?: boolean;
}

export const TOKEN_PAIRS: TokenPair[] = [
	{ name: 'primary/white', fg: '#047857', bg: '#FFFFFF' },
	{ name: 'primary-hover/white', fg: '#065F46', bg: '#FFFFFF' },
	{ name: 'secondary/white', fg: '#6D28D9', bg: '#FFFFFF' },
	{ name: 'text/bg', fg: '#111827', bg: '#FAFAFA' },
	{ name: 'text-secondary/bg', fg: '#4B5563', bg: '#FAFAFA' },
	{ name: 'text/surface', fg: '#111827', bg: '#FFFFFF' },
	{ name: 'success/white', fg: '#047857', bg: '#FFFFFF' },
	{ name: 'error/white', fg: '#B91C1C', bg: '#FFFFFF' },
	{ name: 'warning/white', fg: '#B45309', bg: '#FFFFFF' },
	{ name: 'dark-primary/dark-bg', fg: '#34D399', bg: '#0F172A' },
	{ name: 'dark-text/dark-bg', fg: '#F1F5F9', bg: '#0F172A' },
	{ name: 'dark-text-secondary/dark-bg', fg: '#94A3B8', bg: '#0F172A' },
	{ name: 'dark-text/dark-surface', fg: '#F1F5F9', bg: '#1E293B' },
	{ name: 'white/primary', fg: '#FFFFFF', bg: '#047857' },
	{ name: 'white/secondary', fg: '#FFFFFF', bg: '#6D28D9' },
	{ name: 'dark-bg/dark-primary', fg: '#0F172A', bg: '#34D399' },
	{ name: 'text-secondary/surface', fg: '#4B5563', bg: '#FFFFFF' },
	{ name: 'primary/bg', fg: '#047857', bg: '#FAFAFA' },
	{ name: 'error/bg', fg: '#B91C1C', bg: '#FAFAFA' },
	{ name: 'dark-text-secondary/dark-surface', fg: '#94A3B8', bg: '#1E293B' },
	{ name: 'dark-primary/dark-surface', fg: '#34D399', bg: '#1E293B' },
	{ name: 'dark-error/dark-bg', fg: '#F87171', bg: '#0F172A' },
	{ name: 'dark-primary-hover/dark-bg', fg: '#6EE7B7', bg: '#0F172A' },
	{ name: 'dark-bg/dark-primary-hover', fg: '#0F172A', bg: '#6EE7B7' },
	{ name: 'white/primary-hover', fg: '#FFFFFF', bg: '#065F46' },
	// shadcn-svelte surface tokens (src/app.css)
	{ name: 'muted-text/muted', fg: '#4B5563', bg: '#F3F4F6' },
	{ name: 'text/muted', fg: '#111827', bg: '#F3F4F6' },
	{ name: 'accent-text/accent', fg: '#065F46', bg: '#ECFDF5' },
	{ name: 'primary/accent', fg: '#047857', bg: '#ECFDF5' },
	{ name: 'error/error-tint', fg: '#B91C1C', bg: '#FBEAEA' },
	{ name: 'dark-muted-text/dark-muted', fg: '#94A3B8', bg: '#273449' },
	{ name: 'dark-text/dark-muted', fg: '#F1F5F9', bg: '#273449' },
	{ name: 'dark-accent-text/dark-accent', fg: '#D1FAE5', bg: '#064E3B' },
	{ name: 'dark-primary/dark-accent', fg: '#34D399', bg: '#064E3B', large: true },
	{ name: 'dark-error/dark-surface', fg: '#F87171', bg: '#1E293B' },
	{ name: 'input-border/surface (UI)', fg: '#858D99', bg: '#FFFFFF', large: true },
	{ name: 'dark-input-border/dark-surface (UI)', fg: '#7A889C', bg: '#1E293B', large: true }
];

function channel(c: number): number {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
	const h = hex.replace('#', '');
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg: string, bg: string): number {
	const l1 = relativeLuminance(fg);
	const l2 = relativeLuminance(bg);
	const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
	return (hi + 0.05) / (lo + 0.05);
}
