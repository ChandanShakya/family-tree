<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TreeNav from '$lib/components/tree/TreeNav.svelte';
	import { api, personName } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';

	let { data } = $props();
	let relation = $state<Record<string, string>>({});
	let linked = $state<Record<string, string>>({});
	let note = $state<Record<string, string>>({});

	async function decide(id: string, decision: 'approve' | 'reject') {
		const body: Record<string, unknown> = { decision, note: note[id] || undefined };
		if (decision === 'approve' && relation[id] && linked[id]) {
			body.linkedRelationType = relation[id];
			body.linkedToPersonId = linked[id];
		}
		const r = await api('PUT', `/api/claims/${id}`, body);
		if (r.ok) toast(decision === 'approve' ? 'Claim approved' : 'Claim rejected');
		await invalidateAll();
	}
	const score = (s: number | null) => (s === null ? '' : `${Math.round(s * 100)}%`);
</script>

<svelte:head>
	<title>Claims · Family Tree</title>
</svelte:head>


<TreeNav treeId={data.treeId} active="claims" />
<div class="page-header">
	<div>
		<h1>Claims</h1>
		<p>Requests from members who say a profile is them.</p>
	</div>
</div>

{#if data.claims.length === 0}
	<div class="section py-10 text-center"><p class="muted">No pending claims.</p></div>
{/if}
<ul class="grid gap-4">
	{#each data.claims as c (c.id)}
		<li class="section">
			<p><strong>{c.claimant}</strong> claims <a href={resolve(`/persons/${c.personId}` as '/')}>{c.personName}</a> <span class="ml-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{c.proofMethod}</span></p>
			{#if c.proofMethod === 'matching'}
				<p class="muted mt-2 text-sm">
					Match score <strong class="text-foreground">{score(c.matchScore)}</strong> (advisory only) — they entered:
					{[c.claimedFirstName, c.claimedLastName].filter(Boolean).join(' ')}
					{c.claimedBirthDate ? `, born ${c.claimedBirthDate}` : ''}{c.claimedBirthPlace ? `, ${c.claimedBirthPlace}` : ''}
				</p>
			{/if}
			<div class="mt-4 grid gap-3 sm:grid-cols-3">
				<label>Also link as
					<select bind:value={relation[c.id]}>
						<option value="">no relationship</option>
						<option value="child">child of…</option><option value="parent">parent of…</option>
						<option value="spouse">spouse of…</option><option value="sibling">sibling of…</option>
					</select>
				</label>
				{#if relation[c.id]}
					<label>Person
						<select bind:value={linked[c.id]}>
							<option value="">choose…</option>
							{#each data.people.filter((p) => p.id !== c.personId) as p (p.id)}<option value={p.id}>{personName(p)}</option>{/each}
						</select>
					</label>
				{/if}
				<label>Note <input bind:value={note[c.id]} maxlength="1000" /></label>
			</div>
			<div class="mt-4 flex justify-end gap-2">
				<button type="button" class="secondary" onclick={() => decide(c.id, 'reject')}>Reject</button>
				<button type="button" onclick={() => decide(c.id, 'approve')}>Approve</button>
			</div>
		</li>
	{/each}
</ul>
