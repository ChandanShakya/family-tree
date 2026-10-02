<script lang="ts">
	import type { Orientation } from '$lib/tree/layout.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ArrowDownUp, ArrowRightLeft, Maximize2, Minus, Plus } from '@lucide/svelte';

	let {
		onzoomin,
		onzoomout,
		onreset,
		orientation = $bindable('TB'),
		depth,
		ondepth
	}: {
		onzoomin: () => void;
		onzoomout: () => void;
		onreset: () => void;
		orientation?: Orientation;
		/** Focus-mode depth; shown only when the tree is truncated. */
		depth?: number;
		ondepth?: (d: number) => void;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Tree controls">
	<div class="inline-flex overflow-hidden rounded-lg border bg-card shadow-xs">
		<Button variant="ghost" size="icon" class="rounded-none" onclick={onzoomin} aria-label="Zoom in"><Plus /></Button>
		<Button variant="ghost" size="icon" class="rounded-none border-l" onclick={onzoomout} aria-label="Zoom out"><Minus /></Button>
	</div>
	<Button variant="outline" onclick={onreset} title="Fit the tree to the view"><Maximize2 /> Reset</Button>
	<Button variant="outline" onclick={() => (orientation = orientation === 'TB' ? 'LR' : 'TB')} aria-pressed={orientation === 'LR'}>
		{#if orientation === 'TB'}<ArrowRightLeft /> Left to right{:else}<ArrowDownUp /> Top to bottom{/if}
	</Button>
	{#if depth !== undefined && ondepth}
		<span class="ml-1 text-sm text-muted-foreground">Generations shown: <strong class="text-foreground">{depth}</strong></span>
		<Button variant="outline" onclick={() => ondepth(depth + 1)}>Expand</Button>
		<Button variant="outline" onclick={() => ondepth(Math.max(1, depth - 1))} disabled={depth <= 1}>Collapse</Button>
	{/if}
</div>
