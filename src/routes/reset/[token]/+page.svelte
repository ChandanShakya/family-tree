<script lang="ts">
	import AuthCard from '$lib/components/shared/AuthCard.svelte';
	import { resolve } from '$app/paths';

	let { data } = $props();
	let password = $state('');
	let error = $state('');
	let done = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		done = '';
		const res = await fetch('/api/auth/reset', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: data.token, password })
		});
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Reset failed';
			return;
		}
		done = body.data.message;
		password = '';
	}
</script>

<svelte:head>
	<title>Reset password · Family Tree</title>
</svelte:head>

<AuthCard title="Set a new password" subtitle="Choose a password with at least 10 characters.">
	<form onsubmit={submit} class="flex flex-col gap-4">
		<label>
			New password (10+ characters)
			<input type="password" name="password" bind:value={password} required autocomplete="new-password" />
		</label>
		{#if error}<p class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>{/if}
		{#if done}<p class="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground" role="status">{done}</p>{/if}
		<button type="submit" class="w-full">Reset password</button>
	</form>
	{#snippet footer()}
		<a href={resolve('/login')}>Back to login</a>
	{/snippet}
</AuthCard>
