<script lang="ts">
	import SearchBar from '$lib/components/tree/SearchBar.svelte';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';
	import { fullName } from '$lib/utils/format.js';

	interface Step {
		from: string;
		to: string;
		link: 'parent' | 'child' | 'spouse' | 'sibling';
	}
	let { personId, personName, treeId }: { personId: string; personName: string; treeId: string } = $props();

	let result = $state<{ other: string; label: string; steps: Array<{ link: string; name: string }> } | null>(null);
	let busy = $state(false);

	async function find(otherId: string, otherName: string) {
		busy = true;
		result = null;
		const r = await api<{ path: Step[]; label: string; truncated: boolean }>('GET', `/api/persons/${personId}/relation?to=${encodeURIComponent(otherId)}`, undefined, { quiet: true });
		if (!r.ok) {
			if (r.status === 404) result = { other: otherName, label: '', steps: [] };
			else toast(r.message, 'error');
		} else {
			// Names along the path: the endpoints are known; intermediate people are fetched (paths are short).
			const names: Record<string, string> = { [personId]: personName, [otherId]: otherName };
			for (const s of r.data.path) {
				if (names[s.to]) continue;
				const p = await api<{ firstName: string; middleName: string | null; lastName: string | null }>('GET', `/api/persons/${s.to}`, undefined, { quiet: true });
				names[s.to] = p.ok ? fullName(p.data) : '…';
			}
			result = { other: otherName, label: r.data.label, steps: r.data.path.map((s) => ({ link: s.link, name: names[s.to] ?? '…' })) };
		}
		busy = false;
	}
</script>

<SearchBar {treeId} label="How are we related? Pick a person" hotkey={false} filters={false} onpick={find} />
<div aria-live="polite">
	{#if busy}
		<p class="muted">Searching…</p>
	{:else if result}
		{#if !result.label}
			<p>{result.other} and {personName} are not connected by any recorded relationship.</p>
		{:else if result.label === 'self'}
			<p>That is {personName}.</p>
		{:else if result.label.startsWith('not connected')}
			<p>{result.other} is {result.label}.</p>
		{:else}
			<p><strong>{result.other}</strong> is {personName}'s <strong>{result.label}</strong>.</p>
		{/if}
		{#if result.steps.length}
			<ol class="muted">
				<li>{personName}</li>
				{#each result.steps as s, i (i)}
					<li>→ {s.link} → {s.name}</li>
				{/each}
			</ol>
		{/if}
	{/if}
</div>
