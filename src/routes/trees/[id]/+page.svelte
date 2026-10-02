<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
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
	import { api, personName } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';
	import { impliedLinks, linkLabel, type Link, type RelKind } from '$lib/utils/family-links.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { UserPlus } from '@lucide/svelte';

	let { data } = $props();
	// Lazy chunk keeps d3 + layout out of the initial bundle (R-PERF-1).
	let Canvas = $state<typeof import('$lib/components/tree/TreeCanvas.svelte').default | null>(null);
	let highlight = $state<string | null>(null);
	let adding = $state(false);
	let searchSeed = $state('');
	// Linking two people already in the tree: pick a second person, choose how they relate.
	let linking = $state(false);
	let secondId = $state<string | null>(null);
	let pairRel = $state<RelKind>('spouse');
	let pairSkipped = $state<string[]>([]);

	const view = $derived(data.view);
	const treeId = $derived(data.treeId);
	const selected = $derived(view.persons.find((p) => p.id === highlight) ?? null);
	const second = $derived(view.persons.find((p) => p.id === secondId) ?? null);
	const nameOf = (id: string) => {
		const p = view.persons.find((x) => x.id === id);
		return p ? personName(p) : '…';
	};
	const linkKey = (l: Link) => `${l.type}:${l.person1Id}:${l.person2Id}`;
	const pairImplied = $derived(selected && second ? impliedLinks(view.relationships, pairRel, selected.id, second.id) : []);

	function choose(id: string) {
		if (linking && highlight && id !== highlight) {
			secondId = id;
			linking = false;
			pairSkipped = [];
			return;
		}
		secondId = null;
		linking = false;
		highlight = id;
	}

	async function linkPair() {
		if (!selected || !second) return;
		// "A is parent/child/spouse/sibling of B"; parent links are stored parent first.
		const [p1, p2] = pairRel === 'child' ? [second.id, selected.id] : [selected.id, second.id];
		const links = [{ person1Id: p1, person2Id: p2, type: pairRel === 'child' ? 'parent' : pairRel }, ...pairImplied.filter((l) => !pairSkipped.includes(linkKey(l)))];
		let ok = true;
		for (const l of links) ok = (await api('POST', '/api/relationships', { treeId, ...l })).ok && ok;
		if (ok) toast('Linked');
		secondId = null;
		await invalidateAll();
	}
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
		{#if data.canEdit}
			<Button size="sm" variant="outline" onclick={() => ((linking = !linking), (secondId = null))}>{linking ? 'Cancel linking' : 'Link with…'}</Button>
			<Button size="sm" onclick={() => (adding = true)}>Add relative</Button>
		{/if}
	</div>
	{#if linking}<p class="mb-3 text-sm text-muted-foreground" role="status">Now select the second person in the tree.</p>{/if}
	{#if second && data.canEdit}
		<div class="section mb-3 flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<strong>{personName(selected)}</strong> is
				<select bind:value={pairRel} class="w-auto!" aria-label="Relationship" onchange={() => (pairSkipped = [])}>
					<option value="spouse">spouse of</option>
					<option value="parent">parent of</option>
					<option value="child">child of</option>
					<option value="sibling">sibling of</option>
				</select>
				<strong>{personName(second)}</strong>
			</div>
			{#each pairImplied as l (linkKey(l))}
				<label class="flex items-center gap-2 text-sm font-normal">
					<input
						type="checkbox"
						checked={!pairSkipped.includes(linkKey(l))}
						onchange={(e) => (pairSkipped = e.currentTarget.checked ? pairSkipped.filter((k) => k !== linkKey(l)) : [...pairSkipped, linkKey(l)])}
					/>
					{linkLabel(l, nameOf)}
				</label>
			{/each}
			<div class="flex justify-end gap-2">
				<Button size="sm" variant="outline" onclick={() => (secondId = null)}>Cancel</Button>
				<Button size="sm" onclick={linkPair}>Link</Button>
			</div>
		</div>
	{/if}
{/if}
{#if Canvas}
	<Canvas
		persons={view.persons}
		relationships={view.relationships}
		highlightId={highlight}
		depth={view.truncated ? depth : undefined}
		ondepth={(d: number) => refocus(highlight, d)}
		onselect={(id: string) => (view.truncated && !linking ? refocus(id).then(() => choose(id)) : choose(id))}
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
	relationships={view.relationships}
	{nameOf}
	oncreated={(id) => {
		highlight = id;
	}}
/>{/if}
{/if}
