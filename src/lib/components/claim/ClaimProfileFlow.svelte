<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api.js';
	import Confetti from '$lib/components/join/Confetti.svelte';
	import { toast } from '$lib/toast.svelte.js';

	let {
		treeId,
		personId,
		personName,
		questions,
		pending,
		isOwner = false
	}: { treeId: string; personId: string; personName: string; questions: Array<{ id: string; question: string }>; pending: boolean; isOwner?: boolean } = $props();

	let answers = $state<Record<string, string>>({});
	let m = $state({ firstName: '', lastName: '', birthDate: '', birthPlace: '' });
	let celebrate = $state(false);

	async function verify(e: SubmitEvent) {
		e.preventDefault();
		const r = await api<{ claimed: boolean }>('PUT', `/api/claims/questions/verify/${personId}`, {
			answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? '' }))
		});
		if (!r.ok) return;
		celebrate = true;
		toast(`You are now linked to ${personName}`);
		await invalidateAll();
	}
	async function submit(proofMethod: 'matching' | 'manual') {
		const body =
			proofMethod === 'matching'
				? { claimedFirstName: m.firstName, claimedLastName: m.lastName, claimedBirthDate: m.birthDate, claimedBirthPlace: m.birthPlace }
				: {};
		const r = await api<{ status: string }>('POST', '/api/claims', { treeId, personId, proofMethod, ...body });
		if (r.ok && r.data.status === 'approved') {
			celebrate = true;
			toast(`You are now linked to ${personName}`);
			await invalidateAll();
		} else if (r.ok) {
			toast('Claim sent for review');
			await invalidateAll();
		}
	}
</script>

{#if celebrate}<Confetti />{/if}
<section class="section border-primary/40 bg-accent/40">
	<h2 class="mt-0">Is this you?</h2>
	{#if isOwner}
		<p class="muted mb-3 text-sm">You own this tree, so no review is needed.</p>
		<button type="button" onclick={() => submit('manual')}>This is me</button>
	{:else if pending}
		<p>Your claim on {personName} is waiting for review.</p>
	{:else}
		{#if questions.length >= 3}
			<h3>Answer questions</h3>
			<form onsubmit={verify} class="grid gap-3">
				{#each questions as q (q.id)}
					<label>{q.question} <input bind:value={answers[q.id]} required autocomplete="off" /></label>
				{/each}
				<button type="submit">Verify and claim</button>
			</form>
		{/if}
		<h3>Tell us about yourself</h3>
		<form onsubmit={(e) => { e.preventDefault(); void submit('matching'); }} class="grid gap-3 sm:grid-cols-2">
			<label>First name <input bind:value={m.firstName} required /></label>
			<label>Last name <input bind:value={m.lastName} /></label>
			<label>Birth date <input bind:value={m.birthDate} /></label>
			<label>Birth place <input bind:value={m.birthPlace} /></label>
			<div class="sm:col-span-2"><button type="submit">Send for review</button></div>
		</form>
		<p class="mt-2"><button type="button" class="link" onclick={() => submit('manual')}>Or just ask the owner to link me</button></p>
	{/if}
</section>
