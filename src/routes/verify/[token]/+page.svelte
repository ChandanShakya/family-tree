<script lang="ts">
	import AuthCard from '$lib/components/shared/AuthCard.svelte';
	import { resolve } from '$app/paths';

	let { data } = $props();
	let status = $state('Verifying…');

	async function verify() {
		const res = await fetch('/api/auth/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: data.token })
		});
		const body = await res.json();
		status = res.ok ? body.data.message : (body.error?.message ?? 'Verification failed');
	}

	$effect(() => {
		void verify();
	});
</script>

<svelte:head>
	<title>Verify email · Family Tree</title>
</svelte:head>

<AuthCard title="Email verification">
	<p aria-live="polite" class="text-center">{status}</p>
	{#snippet footer()}
		<a href={resolve('/login')}>Back to login</a>
	{/snippet}
</AuthCard>
