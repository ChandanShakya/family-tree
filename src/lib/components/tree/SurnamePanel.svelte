<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { api } from '$lib/api.js';

	let { treeId, onsearch }: { treeId: string; onsearch: (surname: string) => void } = $props();
	let rows = $state<Array<{ lastName: string; count: number }> | null>(null);
	let open = $state(false);

	async function toggle() {
		open = !open;
		if (open && rows === null) {
			const r = await api<Array<{ lastName: string; count: number }>>('GET', `/api/trees/${treeId}/surnames`);
			if (r.ok) rows = r.data;
		}
	}
</script>

<section class="section">
	<button type="button" class="panel-toggle" onclick={toggle} aria-expanded={open}>
		<span>Surnames</span><ChevronDown class="transition-transform {open ? 'rotate-180' : ''}" size={18} />
	</button>
	{#if open}
		{#if rows?.length === 0}<p class="muted mt-3 text-sm">No surnames yet.</p>{/if}
		<ul class="mt-3 flex max-h-64 flex-wrap gap-2 overflow-auto">
			{#each rows ?? [] as r (r.lastName)}
				<li>
					<button type="button" class="chip" onclick={() => onsearch(r.lastName)}>{r.lastName} <span class="muted">({r.count})</span></button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
