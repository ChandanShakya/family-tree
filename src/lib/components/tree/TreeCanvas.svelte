<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { select } from 'd3-selection';
	import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
	import { NODE_H, NODE_W, layoutTree, type LayoutResult, type Orientation } from '$lib/tree/layout.js';
	import PersonNode from './PersonNode.svelte';
	import TreeControls from './TreeControls.svelte';
	import { fullName } from '$lib/utils/format.js';

	const WORKER_THRESHOLD = 200;

	type P = { id: string; firstName: string; middleName?: string | null; lastName?: string | null; birthDateNorm?: string | null };
	type R = { person1Id: string; person2Id: string; type: string; startDate?: string | null };

	let {
		persons,
		relationships,
		highlightId = null,
		depth,
		ondepth,
		onselect,
		colorOf
	}: {
		persons: P[];
		relationships: R[];
		highlightId?: string | null;
		depth?: number;
		ondepth?: (d: number) => void;
		onselect: (id: string) => void;
		/** Side-bar colour per person (combined view: which tree they come from). */
		colorOf?: (id: string) => string[] | undefined;
	} = $props();
	let orientation = $state<Orientation>('TB');

	let svg: SVGSVGElement;
	let g: SVGGElement;
	let zb: ZoomBehavior<SVGSVGElement, unknown>;
	let result = $state<LayoutResult | null>(null);

	const nameOf = (p: P) => fullName(p);
	const byId = $derived(new Map(persons.map((p) => [p.id, p])));

	$effect(() => {
		const lp = persons.map((p) => ({ id: p.id, birthDateNorm: p.birthDateNorm ?? null, name: nameOf(p) }));
		const links = relationships;
		// layout+render timing for R-PERF-4 (read by the Playwright render test)
		performance.mark('tree-layout-start');
		const done = (r: LayoutResult) => {
			result = r;
			void tick().then(() => {
				requestAnimationFrame(() => {
					performance.mark('tree-rendered');
					performance.measure('tree-layout-render', 'tree-layout-start', 'tree-rendered');
				});
			});
		};
		if (lp.length <= WORKER_THRESHOLD) {
			done(layoutTree(lp, links, orientation));
			return;
		}
		const w = new Worker(new URL('../../tree/layout.worker.ts', import.meta.url), { type: 'module' });
		w.onmessage = (e) => {
			done({ ...e.data, nodes: new Map(e.data.nodes), unions: new Map(e.data.unions) });
			w.terminate();
		};
		// Props are reactive proxies; the worker needs plain, cloneable data.
		w.postMessage({ persons: lp, links: $state.snapshot(links), orientation });
		return () => w.terminate();
	});

	// Centre the highlighted person (search hit).
	$effect(() => {
		const n = highlightId && result?.nodes.get(highlightId);
		if (!n || !zb) return;
		const { width, height } = svg.getBoundingClientRect();
		select(svg).call(
			zb.transform,
			zoomIdentity.translate(width / 2 - n.x - NODE_W / 2, height / 2 - n.y - NODE_H / 2)
		);
	});

	onMount(() => {
		zb = zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 3])
			.on('zoom', (e) => g.setAttribute('transform', e.transform.toString()));
		select(svg).call(zb);
	});

	const path = (pts: Array<[number, number]>, curved?: boolean) =>
		curved && pts.length === 3
			? `M${pts[0]![0]},${pts[0]![1]} Q${pts[1]![0]},${pts[1]![1]} ${pts[2]![0]},${pts[2]![1]}`
			: 'M' + pts.map((p) => p.join(',')).join(' L');
	const years = (p: P) => (p.birthDateNorm ? p.birthDateNorm.slice(0, 4) : '');

	export function zoomBy(k: number) {
		select(svg).call(zb.scaleBy, k);
	}
	/** Fit the layout into the view (never zoomed in past 1:1): centred across, top-aligned so the oldest generation shows first. */
	export function reset() {
		if (!result || !svg || !zb || result.nodes.size === 0) return;
		let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
		for (const n of result.nodes.values()) {
			x0 = Math.min(x0, n.x);
			y0 = Math.min(y0, n.y);
			x1 = Math.max(x1, n.x + NODE_W);
			y1 = Math.max(y1, n.y + NODE_H);
		}
		const { width, height } = svg.getBoundingClientRect();
		// Narrow screens: fit the width but never shrink below 0.45, so names stay readable; pan for the rest.
		const k = Math.max(width < 640 ? 0.45 : 0.1, Math.min(1, (width - 48) / (x1 - x0), (height - 48) / (y1 - y0)));
		select(svg).call(zb.transform, zoomIdentity.translate((width - (x1 - x0) * k) / 2 - x0 * k, 24 - y0 * k).scale(k));
	}

	// A new layout (data or orientation) is fitted to the view unless a search hit is being centred.
	$effect(() => {
		if (result && !untrack(() => highlightId)) void tick().then(reset);
	});
</script>

<div class="mb-3"><TreeControls onzoomin={() => zoomBy(1.3)} onzoomout={() => zoomBy(1 / 1.3)} onreset={reset} bind:orientation {depth} {ondepth} /></div>
{#if result?.layoutWarning}
	<p role="alert" class="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
		This tree contains a marriage cycle, so generations could not be aligned exactly. The layout is approximate.
	</p>
{/if}
<svg bind:this={svg} class="canvas h-[70vh] min-h-[420px] w-full touch-none rounded-xl border shadow-xs" role="application" aria-label="Family tree">
	<g bind:this={g}>
		{#if result}
			{#each result.edges as e, i (i)}
				<path
					d={path(e.points, e.extra)}
					fill="none"
					class="edge"
					stroke-dasharray={e.dashed ? '6 4' : undefined}
				/>
			{/each}
			{#each [...result.nodes] as [id, n] (id)}
				{@const p = byId.get(id)}
				{#if p}
					<PersonNode
						x={n.x}
						y={n.y}
						name={nameOf(p)}
						years={years(p)}
						highlighted={id === highlightId}
						colors={colorOf?.(id)}
						onselect={() => onselect(id)}
					/>
				{/if}
			{/each}
		{/if}
	</g>
</svg>

<style>
	.canvas {
		background-color: var(--card);
		background-image: radial-gradient(var(--border) 1px, transparent 1px);
		background-size: 20px 20px;
		cursor: grab;
	}
	.canvas:active {
		cursor: grabbing;
	}
	:global(.canvas .edge) {
		stroke: var(--muted-foreground);
		stroke-opacity: 0.55;
		stroke-width: 1.5;
	}
</style>
