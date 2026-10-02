<script lang="ts">
	import AuthCard from '$lib/components/shared/AuthCard.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	let email = $state('');
	let password = $state('');
	let displayName = $state('');
	let error = $state('');
	let done = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		done = '';
		const res = await fetch('/api/auth/register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password, displayName })
		});
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Registration failed';
			return;
		}
		done = body.data.message;
		email = '';
		password = '';
		displayName = '';
	}
</script>

<svelte:head>
	<title>Create account · Family Tree</title>
</svelte:head>

<AuthCard title="Create account" subtitle="Start your family tree and invite relatives.">
	<form onsubmit={submit} class="flex flex-col gap-4">
		<label>
			Email
			<input type="email" name="email" bind:value={email} required autocomplete="email" />
		</label>
		<label>
			Display name
			<input type="text" name="displayName" bind:value={displayName} required autocomplete="name" />
		</label>
		<label>
			Password (10+ characters)
			<input type="password" name="password" bind:value={password} required autocomplete="new-password" />
		</label>
		{#if error}<p class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>{/if}
		{#if done}<p class="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground" role="status">{done}</p>{/if}
		<button type="submit" class="w-full">Register</button>
	</form>
	{#snippet footer()}
		Already have an account? <a href={resolve(`/login${page.url.search}` as '/login')}>Log in</a>
	{/snippet}
</AuthCard>
