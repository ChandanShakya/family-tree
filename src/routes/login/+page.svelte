<script lang="ts">
	import AuthCard from '$lib/components/shared/AuthCard.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { safeNext } from '$lib/utils/next.js';

	let { data } = $props();

	let email = $state('');
	let password = $state('');
	let error = $state(page.url.searchParams.get('error') === 'oauth' ? 'Google sign-in failed. Try again.' : '');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		const res = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password })
		});
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Login failed';
			return;
		}
		await goto(resolve(safeNext(page.url.searchParams.get('next')) as '/'), { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>Log in · Family Tree</title>
</svelte:head>

<AuthCard title="Log in" subtitle="Welcome back to your family tree.">
	<form onsubmit={submit} class="flex flex-col gap-4">
		<label>
			Email
			<input type="email" name="email" bind:value={email} required autocomplete="email" />
		</label>
		<label>
			<span class="flex items-center justify-between">Password <a href={resolve('/forgot')} class="text-xs font-normal">Forgot password?</a></span>
			<input type="password" name="password" bind:value={password} required autocomplete="current-password" />
		</label>
		{#if error}<p class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>{/if}
		<button type="submit" class="w-full">Log in</button>
	</form>
	{#if data.googleEnabled}
		<div class="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span class="h-px flex-1 bg-border"></span>or<span class="h-px flex-1 bg-border"></span></div>
		<!-- Full navigation (not client routing): the server redirects to Google. -->
		<a href={resolve('/api/auth/google')} data-sveltekit-reload class="google">Continue with Google</a>
	{/if}
	{#snippet footer()}
		No account? <a href={resolve(`/register${page.url.search}` as '/register')}>Register</a>
	{/snippet}
</AuthCard>

<style>
	.google {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		border: 1px solid var(--input);
		border-radius: 12px;
		color: var(--foreground);
		font-weight: 600;
		text-decoration: none;
	}
	.google:hover {
		background: var(--muted);
	}
</style>
