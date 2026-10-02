<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.svelte.js';
	import { MIN_VERIFICATION_QUESTIONS } from '$lib/config.js';

	let { personId }: { personId: string } = $props();
	let rows = $state(Array.from({ length: MIN_VERIFICATION_QUESTIONS }, () => ({ question: '', answer: '' })));

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const questions = rows.filter((r) => r.question.trim() && r.answer.trim());
		if (questions.length < MIN_VERIFICATION_QUESTIONS) {
			toast(`Add at least ${MIN_VERIFICATION_QUESTIONS} questions with answers`, 'error');
			return;
		}
		if ((await api('POST', `/api/claims/questions/${personId}`, { questions })).ok) {
			toast('Questions saved');
			rows = rows.map(() => ({ question: '', answer: '' }));
			await invalidateAll();
		}
	}
</script>

<details class="mt-4 rounded-lg border p-3">
	<summary class="cursor-pointer text-sm font-semibold">Verification questions (so this person can claim their own profile)</summary>
	<p class="muted mt-2 text-sm">Saving replaces the previous questions. Answers are stored as hashes and cannot be read back.</p>
	<form onsubmit={save} class="mt-3 grid gap-2">
		{#each rows as r, i (i)}
			<div class="grid gap-2 sm:grid-cols-[2fr_1fr]">
				<input bind:value={r.question} placeholder="Question" aria-label="Question {i + 1}" class="flex-1" />
				<input bind:value={r.answer} placeholder="Answer" aria-label="Answer {i + 1}" />
			</div>
		{/each}
		<button type="button" class="link" onclick={() => (rows = [...rows, { question: '', answer: '' }])}>Add another</button>
		<button type="submit">Save questions</button>
	</form>
</details>
