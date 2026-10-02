<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';
	import ShareButtons from './ShareButtons.svelte';

	interface Code {
		id: string;
		code: string;
		role: string;
		linkedRelationType: string | null;
		currentUses: number;
		isActive: number;
		expiresAt: string | null;
	}
	let {
		treeId,
		personId,
		personName,
		role,
		codes
	}: { treeId: string; personId: string; personName: string; role: string; codes: Code[] } = $props();

	let relation = $state('child');
	let grant = $state('viewer');
	let expires = $state('');
	const rank: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, owner: 3 };
	// A code cannot grant more than its creator holds (§4).
	const grants = $derived((['viewer', 'contributor', 'editor'] as const).filter((r) => rank[r]! <= rank[role]!));

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const r = await api('POST', '/api/join-codes', { treeId, type: 'direct', linkedPersonId: personId, linkedRelationType: relation, role: grant, ...(expires ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}) });
		if (r.ok) {
			toast('Invite created');
			await invalidateAll();
		}
	}
	async function deactivate(id: string) {
		if (!(await confirmDialog('Deactivate this code?'))) return;
		if ((await api('DELETE', `/api/join-codes/${id}`)).ok) {
			toast('Code deactivated');
			await invalidateAll();
		}
	}
</script>

<form onsubmit={create} class="grid gap-3 sm:grid-cols-2">
	<label>They are this person's
		<select bind:value={relation}>
			<option value="child">child</option><option value="parent">parent</option>
			<option value="spouse">spouse</option><option value="sibling">sibling</option>
			<option value="self">same person (claim this profile)</option>
		</select>
	</label>
	<label>Access
		<select bind:value={grant}>{#each grants as g (g)}<option>{g}</option>{/each}</select>
	</label>
	<label>Expires (optional) <input type="date" bind:value={expires} /></label>
	<div class="sm:col-span-2"><button type="submit">Create invite for {personName}</button></div>
</form>

<ul class="mt-3 grid gap-2">
	{#each codes as c (c.id)}
		<li class="rounded-lg border p-3 text-sm">
			<code class="rounded bg-muted px-2 py-1 font-mono">{c.code}</code>
			<span class="muted ml-1">{c.linkedRelationType} · {c.role} · {c.currentUses > 0 ? 'used' : c.isActive ? 'unused' : 'inactive'}{c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString()}` : ''}</span>
			{#if c.isActive && c.currentUses === 0}
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<ShareButtons code={c.code} />
					<button type="button" class="link" onclick={() => deactivate(c.id)}>Deactivate</button>
				</div>
			{/if}
		</li>
	{/each}
</ul>
