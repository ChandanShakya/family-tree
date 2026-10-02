<script lang="ts">
	import AuthCard from '$lib/components/shared/AuthCard.svelte';
	import { resolve } from '$app/paths';
	let email = $state('');
	let error = $state('');
	let done = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		done = '';
		const res = await fetch('/api/auth/forgot', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email })
		});
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Request failed';
			return;
		}
		done = body.data.message;
	}
</script>

<svelte:head>
	<title>Forgot password · Family Tree</title>
</svelte:head>

<AuthCard title="Forgot password" subtitle="We'll email you a link to set a new password.">
	<form onsubmit={submit} class="flex flex-col gap-4">
		<label>
			Email
			<input type="email" name="email" bind:value={email} required autocomplete="email" />
		</label>
		{#if error}<p class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>{/if}
		{#if done}<p class="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground" role="status">{done}</p>{/if}
		<button type="submit" class="w-full">Send reset link</button>
	</form>
	{#snippet footer()}
		<a href={resolve('/login')}>Back to login</a>
	{/snippet}
</AuthCard>
