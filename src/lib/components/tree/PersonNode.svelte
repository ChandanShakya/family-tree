<script lang="ts">
	import { NODE_H, NODE_W } from '$lib/tree/layout.js';

	let {
		x,
		y,
		name,
		years,
		highlighted = false,
		onselect
	}: {
		x: number;
		y: number;
		name: string;
		years: string;
		highlighted?: boolean;
		onselect: () => void;
	} = $props();
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
	<line x1="2" y1="14" x2="2" y2={NODE_H - 14} class="bar" />
	<text x="16" y="30" class="name">{name.length > 19 ? `${name.slice(0, 18)}…` : name}</text>
	<text x="16" y="52" class="years">{years || '—'}</text>
	<title>{name}</title>
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
	.highlighted .bar {
		opacity: 1;
	}
</style>
