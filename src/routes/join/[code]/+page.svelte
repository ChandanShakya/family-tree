<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Confetti from '$lib/components/join/Confetti.svelte';
	import PersonForm from '$lib/components/person/PersonForm.svelte';
	import { draftToBody, emptyDraft, type PersonDraft } from '$lib/components/person/draft.js';
	import { api } from '$lib/api.js';

	let { data } = $props();
	let draft = $state<PersonDraft>(emptyDraft());
	let result = $state<{ treeId: string; status: 'pending' | 'active' } | null>(null);
	const self = $derived(data.preview?.relation === 'self');
	const relationText: Record<string, string> = { parent: 'parent', child: 'child', spouse: 'spouse', sibling: 'sibling', self: 'yourself' };

	async function join() {
		const body = self ? {} : draftToBody(draft, false);
		const r = await api<{ treeId: string; status: 'pending' | 'active' }>('POST', `/api/join/${data.code}`, body);
		if (!r.ok) return;
		result = r.data;
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Join a family tree · Family Tree</title>
</svelte:head>

<div class="mx-auto max-w-2xl py-4">
{#if result}
	<Confetti />
	<div class="section py-10 text-center">
		<h1>{result.status === 'pending' ? 'Request sent' : 'Welcome!'}</h1>
		{#if result.status === 'pending'}
			<p class="muted mt-2">The tree owner will review your request. You will get a notification when it is approved.</p>
			<p class="mt-6"><a href={resolve('/')}>Back to your trees</a></p>
		{:else}
			<p class="mt-6"><button type="button" onclick={() => goto(resolve(`/trees/${result!.treeId}` as '/'))}>Open the tree</button></p>
		{/if}
	</div>
{:else if data.status === 'LOCKED' || data.status === 'RATE_LIMITED'}
	<div class="section py-10 text-center">
		<h1>Too many attempts</h1>
		<p class="muted mt-2">Please wait a while before trying again.</p>
	</div>
{:else if !data.preview}
	<div class="section py-10 text-center">
		<h1>This code is not available</h1>
		<p class="muted mt-2">It may be expired, used up or withdrawn. Ask the person who sent it for a new one.</p>
	</div>
{:else}
	<div class="section">
		<h1>Join {data.preview.treeName}</h1>
		{#if data.preview.kind === 'direct' && data.preview.personName}
			<p class="mt-2">
				{#if self}You are invited to claim <strong>{data.preview.personName}</strong>.
				{:else}Join as <strong>{relationText[data.preview.relation ?? '']}</strong> of <strong>{data.preview.personName}</strong>.{/if}
				{#if data.preview.inviter}<span class="muted">Invited by {data.preview.inviter}.</span>{/if}
			</p>
		{:else}
			<p class="muted mt-2">Your request is reviewed by the tree owner before you get access.</p>
		{/if}
		{#if self}
			<div class="mt-6"><button type="button" onclick={join}>Claim this profile</button></div>
		{:else}
			<h2>Your details</h2>
			<PersonForm bind:draft submitLabel={data.preview.kind === 'direct' ? 'Join' : 'Ask to join'} onsubmit={join} />
		{/if}
	</div>
{/if}
</div>
