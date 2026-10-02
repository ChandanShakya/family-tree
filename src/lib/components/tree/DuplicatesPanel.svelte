<script lang="ts">
	import { resolve } from '$app/paths';
	import { api } from '$lib/api.js';
	import { fullName } from '$lib/utils/format.js';
	import { ChevronDown } from '@lucide/svelte';

	type Hit = { id: string; firstName: string; middleName?: string | null; lastName: string | null; birthDateNorm: string | null };
	let { treeId }: { treeId: string } = $props();
	let res = $state<{ pairs: Array<{ a: Hit; b: Hit; reason: string }>; truncated: boolean } | null>(null);
	let open = $state(false);

	async function toggle() {
		open = !open;
		if (open && res === null) {
			const r = await api<NonNullable<typeof res>>('GET', `/api/trees/${treeId}/duplicates`);
			if (r.ok) res = r.data;
		}
	}
	const label = (h: Hit) => fullName(h) + (h.birthDateNorm ? ` (${h.birthDateNorm.slice(0, 4)})` : '');
</script>

<section class="section">
	<button type="button" class="panel-toggle" onclick={toggle} aria-expanded={open}>
		<span>Possible duplicates</span><ChevronDown class="transition-transform {open ? 'rotate-180' : ''}" size={18} />
	</button>
	{#if open}
		{#if res?.pairs.length === 0}<p class="muted mt-3 text-sm">None found.</p>{/if}
		<ul class="mt-3 flex max-h-64 flex-col gap-2 overflow-auto text-sm">
			{#each res?.pairs ?? [] as p (p.a.id + p.b.id)}
				<li class="rounded-lg border px-3 py-2">
					<a href={resolve(`/persons/${p.a.id}` as '/')}>{label(p.a)}</a> ↔
					<a href={resolve(`/persons/${p.b.id}` as '/')}>{label(p.b)}</a>
					<span class="muted">· {p.reason === 'birthYear' ? 'similar birth year' : 'same birthplace'}</span>
				</li>
			{/each}
		</ul>
		{#if res?.truncated}<p class="muted mt-2 text-sm">Showing the first matches only.</p>{/if}
		<p class="muted mt-2 text-xs">Advisory only — nothing is merged automatically.</p>
	{/if}
</section>
