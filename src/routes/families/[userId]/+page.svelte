<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { api, personName } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';
	import Skeleton from '$lib/components/shared/Skeleton.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Lock } from '@lucide/svelte';

	let { data } = $props();
	let Canvas = $state<typeof import('$lib/components/tree/TreeCanvas.svelte').default | null>(null);
	let highlight = $state<string | null>(null);
	onMount(async () => {
		Canvas = (await import('$lib/components/tree/TreeCanvas.svelte')).default;
	});

	// One colour per tree, in profile order (readable on light and dark cards).
	const COLORS = ['#059669', '#2563eb', '#c026d3'];
	const view = $derived(data.view);
	const colorOfTree = $derived(Object.fromEntries((view?.sides ?? []).map((s, i) => [s.treeId, COLORS[i % COLORS.length]!])));
	const selected = $derived(view?.persons.find((p) => p.id === highlight) ?? null);
	const DEPTHS = [1, 2, 3, 4, 5, 6, 8, 10];

	function setDepth(v: string) {
		const q = v ? `?depth=${v}` : '';
		void goto(resolve(`/families/${page.params.userId}${q}` as '/'), { keepFocus: true, noScroll: true });
	}

	// Owner settings drafts, resynced after save.
	let share = $state<'me' | 'chosen' | 'members'>('me');
	let maxDepth = $state('');
	let viewers = $state<string[]>([]);
	$effect(() => {
		if (!data.settings) return;
		share = data.settings.share;
		maxDepth = data.settings.depth ? String(data.settings.depth) : '';
		viewers = [...data.settings.viewers];
	});
	async function save(e: SubmitEvent) {
		e.preventDefault();
		const body = { share, depth: maxDepth ? Number(maxDepth) : null, viewers: share === 'chosen' ? viewers : [] };
		if ((await api('PUT', '/api/combined-view', body)).ok) {
			toast('Sharing saved');
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>{data.own ? 'My families' : `${data.ownerName}'s families`} · Family Tree</title>
</svelte:head>

<div class="page-header">
	<div>
		<h1>{data.own ? 'My families' : `${data.ownerName}'s families`}</h1>
		<p>Every tree {data.own ? 'you are' : 'they are'} part of, joined at {data.own ? 'you' : 'them'}. Read-only: edit people in their own tree.</p>
	</div>
	{#if view}
		<label class="w-auto! flex-row! items-center gap-2">
			Generations
			<select class="w-auto!" value={page.url.searchParams.get('depth') ?? ''} onchange={(e) => setDepth(e.currentTarget.value)}>
				<option value="">{view.depth && !page.url.searchParams.get('depth') ? `${view.depth} (limit)` : 'All recorded'}</option>
				{#each DEPTHS as d (d)}<option value={String(d)}>{d}</option>{/each}
			</select>
		</label>
	{/if}
</div>

{#if !view}
	<section class="section">
		<h2>Not available yet</h2>
		<p class="muted">
			This page appears when your profile is claimed in two or more trees, for example your birth family's tree and your spouse's family tree.
			{#if data.profiles.length === 1}You are in <strong>{data.profiles[0]?.treeName}</strong> so far.{/if}
		</p>
	</section>
{:else}
	<ul class="mb-4 flex flex-wrap gap-2" aria-label="Trees">
		{#each view.sides as s (s.treeId)}
			<li class="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm">
				{#if s.visible}
					<span class="size-3 rounded-full" style:background={colorOfTree[s.treeId]} aria-hidden="true"></span>
					<a href={resolve(`/trees/${s.treeId}?focus=${s.personId}` as '/')}>{s.treeName}</a>
					<span class="muted">· {s.count} people</span>
				{:else}
					<Lock size={14} aria-hidden="true" /> {s.treeName} <span class="muted">· not a member; ask for its family code to join</span>
				{/if}
			</li>
		{/each}
	</ul>
	{#if selected}
		<div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-accent px-3 py-2 text-sm text-accent-foreground">
			Selected: <strong>{personName(selected)}</strong>
			<span class="flex-1"></span>
			<Button size="sm" variant="outline" href={resolve(`/persons/${selected.id}` as '/')}>Open</Button>
		</div>
	{/if}
	{#if Canvas}
		<Canvas
			persons={view.persons}
			relationships={view.relationships}
			highlightId={highlight ?? view.centerId}
			colorOf={(id: string) => colorOfTree[view.treeOf[id] ?? '']}
			onselect={(id: string) => (highlight = id)}
		/>
	{:else}
		<div class="flex flex-col gap-2" role="status" aria-label="Loading tree"><Skeleton /><Skeleton /><Skeleton /></div>
	{/if}
{/if}

{#if data.own && data.settings}
	<section class="section mt-6">
		<h2>Who can see this page</h2>
		<p class="muted text-sm">People you share with still see a tree only if they are a member of it.</p>
		<form onsubmit={save} class="mt-3 grid max-w-2xl gap-4">
			<fieldset class="flex flex-col gap-2">
				<legend>Visible to</legend>
				<label class="flex-row! items-center gap-2 font-normal"><input type="radio" bind:group={share} value="me" /> Only me</label>
				<label class="flex-row! items-center gap-2 font-normal"><input type="radio" bind:group={share} value="members" /> Everyone who is a member of at least two of these trees</label>
				<label class="flex-row! items-center gap-2 font-normal"><input type="radio" bind:group={share} value="chosen" /> People I choose</label>
				{#if share === 'chosen'}
					<div class="ml-6 flex flex-col gap-1">
						{#each data.candidates as c (c.id)}
							<label class="flex-row! items-center gap-2 font-normal"><input type="checkbox" bind:group={viewers} value={c.id} /> {c.displayName}</label>
						{:else}
							<p class="muted text-sm">No other members in your trees yet.</p>
						{/each}
					</div>
				{/if}
			</fieldset>
			<label class="max-w-xs">
				Generations shown (limit for everyone)
				<select bind:value={maxDepth}>
					<option value="">All recorded</option>
					{#each DEPTHS as d (d)}<option value={String(d)}>{d}</option>{/each}
				</select>
			</label>
			<div><button type="submit">Save</button></div>
		</form>
	</section>
{/if}
