<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { DEFAULT_FOCUS_DEPTH } from '$lib/config.js';
	import SearchBar from '$lib/components/tree/SearchBar.svelte';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';
	import SurnamePanel from '$lib/components/tree/SurnamePanel.svelte';
	import DuplicatesPanel from '$lib/components/tree/DuplicatesPanel.svelte';
	import AddPersonSheet from '$lib/components/person/AddPersonSheet.svelte';
	import { personName } from '$lib/api.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { UserPlus } from '@lucide/svelte';

	let { data } = $props();
	// Lazy chunk keeps d3 + layout out of the initial bundle (R-PERF-1).
	let Canvas = $state<typeof import('$lib/components/tree/TreeCanvas.svelte').default | null>(null);
	let highlight = $state<string | null>(null);
	let adding = $state(false);
	let searchSeed = $state('');

	const view = $derived(data.view);
	const treeId = $derived(data.treeId);
	const selected = $derived(view.persons.find((p) => p.id === highlight) ?? null);
	const depth = $derived(Number(page.url.searchParams.get('depth')) || DEFAULT_FOCUS_DEPTH);

	onMount(async () => {
		Canvas = (await import('$lib/components/tree/TreeCanvas.svelte')).default;
		if (page.url.searchParams.get('new') === '1' && view.persons.length === 0) adding = true;
	});

	/** Focus mode: a new focus/depth is a new load (the load calls the same bounded service). */
	function refocus(focus: string | null, d = depth) {
		const q = [focus ? `focus=${focus}` : '', view.truncated ? `depth=${d}` : ''].filter(Boolean).join('&');
		return goto(resolve(`/trees/${treeId}${q ? `?${q}` : ''}` as '/'), { keepFocus: true, noScroll: true });
	}

	async function pick(id: string) {
		if (view.truncated && !view.persons.some((p) => p.id === id)) await refocus(id);
		highlight = id;
	}
</script>

<svelte:head>
	<title>{view.tree.name} · Family Tree</title>
</svelte:head>


{#if !data.publicView}<TreeNav {treeId} active="tree" />{/if}
<div class="page-header">
	<div>
		<h1>{view.tree.name}</h1>
		{#if view.tree.description}<p>{view.tree.description}</p>{/if}
		<p>
			{view.totalPersons} {view.totalPersons === 1 ? 'person' : 'people'}
			{#if data.publicView}· Public tree — living people are shown as “Living”.{/if}
		</p>
	</div>
	{#if data.canEdit}
		<Button onclick={() => (adding = true)}><UserPlus /> Add person</Button>
	{/if}
</div>
{#if !data.publicView}
	<div class="mb-4 max-w-xl"><SearchBar {treeId} onpick={pick} seed={searchSeed} /></div>
	{#if view.persons.length === 0}
		<div class="section mb-4 flex flex-col items-center gap-2 py-10 text-center">
			<p class="text-base font-semibold">This tree is empty</p>
			{#if data.canEdit}<p class="muted">Add the first person — perhaps yourself.</p>{/if}
		</div>
	{/if}
{/if}
{#if view.truncated}
	<p class="mb-3 text-sm text-muted-foreground">Showing {view.persons.length} of {view.totalPersons} people. Search or select a person to refocus.</p>
{/if}
{#if selected}
	<div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-accent px-3 py-2 text-sm text-accent-foreground">
		Selected: <strong>{personName(selected)}</strong>
		<span class="flex-1"></span>
		<Button size="sm" variant="outline" href={resolve(`/persons/${selected.id}` as '/')}>Open</Button>
		{#if data.canEdit}<Button size="sm" onclick={() => (adding = true)}>Add relative</Button>{/if}
	</div>
{/if}
{#if Canvas}
	<Canvas
		persons={view.persons}
		relationships={view.relationships}
		highlightId={highlight}
		depth={view.truncated ? depth : undefined}
		ondepth={(d: number) => refocus(highlight, d)}
		onselect={(id: string) => (view.truncated ? refocus(id).then(() => (highlight = id)) : (highlight = id))}
	/>
{:else}
	<div class="flex flex-col gap-2" role="status" aria-label="Loading tree"><Skeleton /><Skeleton /><Skeleton /></div>
{/if}
{#if !data.publicView}
<div class="mt-6 grid gap-4 md:grid-cols-2">
	<SurnamePanel {treeId} onsearch={(q) => (searchSeed = q)} />
	<DuplicatesPanel {treeId} />
</div>
{#if data.canEdit}<AddPersonSheet
	{treeId}
	anchor={selected ? { id: selected.id, name: personName(selected) } : null}
	bind:open={adding}
	oncreated={(id) => {
		highlight = id;
	}}
/>{/if}
{/if}
