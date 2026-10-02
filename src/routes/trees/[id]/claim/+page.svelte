<script lang="ts">
	import { resolve } from '$app/paths';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';

	let { data } = $props();
	let q = $state('');
	let hits = $state<Array<{ id: string; firstName: string; lastName?: string | null; lastInitial?: string; birthYear: string | null }>>([]);
	let searched = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	// "Find yourself": scoped, unclaimed people only (§6.5). Typing is a client-driven query like the tree search.
	function search() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (!q.trim()) {
				hits = [];
				return;
			}
			const res = await fetch(`/api/claims/search?${new URLSearchParams({ treeId: data.treeId, q })}`);
			hits = res.ok ? (await res.json()).data : [];
			searched = true;
		}, 250);
	}
</script>

<svelte:head>
	<title>Find yourself · Family Tree</title>
</svelte:head>


<TreeNav treeId={data.treeId} active="tree" />
<div class="page-header">
	<div>
		<h1>Find yourself</h1>
		<p>Search for your own profile in this tree and claim it.</p>
	</div>
</div>

{#if data.hasOwn}
	<div class="section"><p>You are already linked to a person in this tree.</p></div>
{:else}
	<section class="section max-w-2xl">
		<label>Your name <input type="search" bind:value={q} oninput={search} placeholder="Type your first or last name" /></label>
		{#if searched && hits.length === 0}<p class="muted mt-3 text-sm">Nobody unclaimed matches. Ask the owner to add you.</p>{/if}
		<ul class="mt-4 grid gap-2">
			{#each hits as h (h.id)}
				<li class="flex items-center justify-between rounded-lg border px-4 py-3">
					<a href={resolve(`/persons/${h.id}` as '/')} class="font-medium">{h.firstName} {h.lastName ?? (h.lastInitial ? `${h.lastInitial}.` : '')}</a>
					<span class="muted text-sm">{h.birthYear ? `born ${h.birthYear}` : ''}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
