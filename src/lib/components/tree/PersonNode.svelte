<script lang="ts">
	import { NODE_H, NODE_W } from '$lib/tree/layout.js';

	let {
		x,
		y,
		name,
		years,
		highlighted = false,
		colors,
		gender,
		onselect
	}: {
		x: number;
		y: number;
		name: string;
		years: string;
		highlighted?: boolean;
		colors?: string[];
		/** M, F, X or U: colours the side bar and adds a mark (combined views colour by tree instead). */
		gender?: string | null;
		onselect: () => void;
	} = $props();
	const g = $derived(gender === 'M' ? 'male' : gender === 'F' ? 'female' : gender === 'X' ? 'other' : '');
	const mark = $derived(gender === 'M' ? '♂' : gender === 'F' ? '♀' : gender === 'X' ? '⚧' : '');
	const label = $derived(gender === 'M' ? 'male' : gender === 'F' ? 'female' : gender === 'X' ? 'other' : '');
</script>

<g
	transform="translate({x},{y})"
	role="button"
	tabindex="0"
	aria-label={name}
	class="node"
	class:highlighted
	onclick={onselect}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onselect()}
>
	<rect width={NODE_W} height={NODE_H} rx="12" class="box" stroke-width={highlighted ? 3 : 1} />
	{#if colors?.length}
		{#each colors as c, i (i)}<line x1={2 + i * 5} y1="14" x2={2 + i * 5} y2={NODE_H - 14} class="bar" style:stroke={c} style:opacity="1" />{/each}
	{:else}
		<line x1="2" y1="14" x2="2" y2={NODE_H - 14} class="bar {g}" />
	{/if}
	<text x="16" y="30" class="name">{name.length > 17 ? `${name.slice(0, 16)}…` : name}</text>
	{#if mark}<text x={NODE_W - 12} y="26" text-anchor="end" class="mark {g}" aria-hidden="true">{mark}</text>{/if}
	<text x="16" y="52" class="years">{years || '—'}</text>
	<title>{name}{label ? ` (${label})` : ''}</title>
</g>

<style>
	.node {
		cursor: pointer;
		outline: none;
	}
	.box {
		fill: var(--card);
		stroke: var(--border);
		filter: drop-shadow(0 1px 2px rgb(15 23 42 / 0.08));
		transition: stroke 120ms;
	}
	.bar {
		stroke: var(--primary);
		stroke-width: 4;
		stroke-linecap: round;
		opacity: 0.55;
	}
	.name {
		fill: var(--foreground);
		font-size: 14px;
		font-weight: 600;
	}
	.years {
		fill: var(--muted-foreground);
		font-size: 12px;
	}
	.node:hover .box,
	.node:focus-visible .box {
		stroke: var(--primary);
	}
	.highlighted .box {
		fill: var(--accent);
		stroke: var(--primary);
	}
	.bar.male,
	.mark.male {
		stroke: var(--male);
		fill: var(--male);
	}
	.bar.female,
	.mark.female {
		stroke: var(--female);
		fill: var(--female);
	}
	.bar.other,
	.mark.other {
		stroke: var(--other);
		fill: var(--other);
	}
	.mark {
		stroke: none !important;
		font-size: 16px;
		font-weight: 700;
	}
	.bar.male,
	.bar.female,
	.bar.other {
		opacity: 0.9;
	}
	.highlighted .bar {
		opacity: 1;
	}
</style>
