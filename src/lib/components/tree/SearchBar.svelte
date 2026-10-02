<script lang="ts">
	import { fullName } from '$lib/utils/format.js';
	import { SlidersHorizontal } from '@lucide/svelte';
	interface Hit {
		id: string;
		firstName: string;
		middleName?: string | null;
		lastName: string | null;
	}
	let {
		treeId,
		onpick,
		seed = '',
		label = 'Search people',
		hotkey = true,
		filters = true
	}: {
		treeId: string;
		onpick: (id: string, name: string) => void;
		seed?: string;
		label?: string;
		hotkey?: boolean;
		filters?: boolean;
	} = $props();
	let q = $state('');
	let birthYear = $state('');
	let place = $state('');
	let showFilters = $state(false);
	let hits = $state<Hit[]>([]);
	let searched = $state(false);
	let input: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout>;

	// A surname chosen elsewhere seeds the box and runs the search.
	$effect(() => {
		if (seed) {
			q = seed;
			search();
		}
	});

	function search() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const year = /^\d{1,4}$/.test(birthYear.trim()) ? birthYear.trim() : '';
			if (!q.trim() && !year && !place.trim()) {
				hits = [];
				searched = false;
				return;
			}
			const params: Record<string, string> = { q, treeId };
			if (year) params.birthYear = year;
			if (place.trim()) params.place = place.trim();
			const res = await fetch(`/api/search?${new URLSearchParams(params)}`);
			hits = res.ok ? (await res.json()).data.hits : [];
			searched = true;
		}, 200);
	}

	function clear() {
		q = '';
		hits = [];
		searched = false;
	}

	function onkey(e: KeyboardEvent) {
		if (!hotkey) return;
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			input.focus();
		}
	}
</script>

<svelte:window onkeydown={onkey} />
<div class="relative">
	<div class="flex gap-2">
		<input
			bind:this={input}
			bind:value={q}
			oninput={search}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					clear();
					input.blur();
				}
			}}
			type="search"
			placeholder={hotkey ? `${label} (Ctrl/Cmd+K)` : label}
			aria-label={label}
		/>
		{#if filters}
			<button type="button" class="secondary" aria-expanded={showFilters} onclick={() => (showFilters = !showFilters)}><SlidersHorizontal size={16} /> Filters</button>
		{/if}
	</div>
	{#if filters && showFilters}
		<div class="mt-1 flex flex-wrap gap-2">
			<input bind:value={birthYear} oninput={search} inputmode="numeric" maxlength="4" placeholder="Birth year" aria-label="Filter by birth year" />
			<input bind:value={place} oninput={search} placeholder="Place" aria-label="Filter by place" />
		</div>
	{/if}
	{#if hits.length}
		<ul aria-label="Search results" class="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
			{#each hits as h (h.id)}
				<li>
					<button
						type="button"
						class="w-full justify-start rounded-md bg-transparent px-3 text-left font-normal text-foreground shadow-none hover:bg-muted"
						onclick={() => {
							onpick(h.id, fullName(h));
							hits = [];
							searched = false;
						}}>{fullName(h)}</button
					>
				</li>
			{/each}
		</ul>
	{:else if searched}
		<p class="muted mt-1 text-sm" aria-live="polite">No matches</p>
	{/if}
</div>
