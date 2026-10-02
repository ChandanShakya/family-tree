<script lang="ts">
	import type { Orientation } from '$lib/tree/layout.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ArrowDownUp, ArrowRightLeft, Expand, Maximize2, Minus, Plus, Shrink } from '@lucide/svelte';

	let {
		onzoomin,
		onzoomout,
		onreset,
		orientation = $bindable('TB'),
		depth,
		ondepth,
		zen = $bindable()
	}: {
		onzoomin: () => void;
		onzoomout: () => void;
		onreset: () => void;
		orientation?: Orientation;
		/** Focus-mode depth; shown only when the tree is truncated. */
		depth?: number;
		ondepth?: (d: number) => void;
		/** Focus view: the chart fills the screen. Undefined hides the button. */
		zen?: boolean;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Tree controls">
	<div class="inline-flex overflow-hidden rounded-lg border bg-card shadow-xs">
		<Button variant="ghost" size="icon" class="rounded-none" onclick={onzoomin} aria-label="Zoom in"><Plus /></Button>
		<Button variant="ghost" size="icon" class="rounded-none border-l" onclick={onzoomout} aria-label="Zoom out"><Minus /></Button>
	</div>
	<Button variant="outline" onclick={onreset} title="Fit the tree to the view" aria-label="Reset"><Maximize2 /> <span class="hidden sm:inline">Reset</span></Button>
	<Button variant="outline" onclick={() => (orientation = orientation === 'TB' ? 'LR' : 'TB')} aria-pressed={orientation === 'LR'} aria-label={orientation === 'TB' ? 'Left to right' : 'Top to bottom'}>
		{#if orientation === 'TB'}<ArrowRightLeft /> <span class="hidden sm:inline">Left to right</span>{:else}<ArrowDownUp /> <span class="hidden sm:inline">Top to bottom</span>{/if}
	</Button>
	{#if zen !== undefined}
		<Button variant="outline" onclick={() => (zen = !zen)} aria-pressed={zen} aria-label={zen ? 'Exit focus view' : 'Focus view'} title={zen ? 'Exit focus view (Esc)' : 'Focus view: fill the screen'}>
			{#if zen}<Shrink /> <span class="hidden sm:inline">Exit focus</span>{:else}<Expand /> <span class="hidden sm:inline">Focus view</span>{/if}
		</Button>
	{/if}
	{#if depth !== undefined && ondepth}
		<span class="ml-1 text-sm text-muted-foreground">Generations shown: <strong class="text-foreground">{depth}</strong></span>
		<Button variant="outline" onclick={() => ondepth(depth + 1)}>Expand</Button>
		<Button variant="outline" onclick={() => ondepth(Math.max(1, depth - 1))} disabled={depth <= 1}>Collapse</Button>
	{/if}
</div>
