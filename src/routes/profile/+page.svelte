<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Avatar from '$lib/components/media/Avatar.svelte';
	import UploadButton from '$lib/components/media/UploadButton.svelte';
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';
	import { applyTheme, type ThemePref } from '$lib/theme.js';

	const NOTIFY_TYPES = [
		['join', 'Someone joins a tree I own or edit'],
		['join_approval', 'A join request needs my approval'],
		['claim', 'A profile claim needs my review'],
		['claim_review', 'My claim was approved or rejected'],
		['edit', 'Someone edits my profile'],
		['share', 'Someone shares their combined family view with me']
	] as const;

	let { data } = $props();
	// Local edit drafts, resynced from page data after invalidateAll (§2.1).
	let displayName = $state('');
	let themePref = $state<ThemePref>('system');
	let notifyPrefs = $state<Record<string, boolean>>({});
	let dateDisplayPref = $state('AD');
	$effect(() => {
		displayName = data.profile?.displayName ?? '';
		themePref = (data.profile?.themePref as ThemePref | undefined) ?? 'system';
		notifyPrefs = Object.fromEntries(NOTIFY_TYPES.map(([t]) => [t, data.profile?.notifyPrefs?.[t] !== false]));
		dateDisplayPref = (data.profile?.dateDisplayPref as 'AD' | 'BS' | 'both' | undefined) ?? 'AD';
	});
	let currentPassword = $state('');
	let newPassword = $state('');
	let message = $state('');
	let error = $state('');

	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		message = '';
		const res = await fetch('/api/account', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ displayName, themePref, dateDisplayPref, notifyPrefs })
		});
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Update failed';
			return;
		}
		message = body.data.message;
		applyTheme(themePref);
		await invalidateAll();
	}

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		message = '';
		const res = await fetch('/api/auth/password', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ currentPassword, password: newPassword })
		});
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Password change failed';
			return;
		}
		message = body.data.message;
		currentPassword = '';
		newPassword = '';
	}

	async function resendVerification() {
		error = '';
		message = '';
		const res = await fetch('/api/auth/verify/resend', { method: 'POST' });
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Resend failed';
			return;
		}
		message = body.data.message;
	}

	async function deleteAccount() {
		if (!(await confirmDialog('Delete your account? This cannot be undone.'))) return;
		const res = await fetch('/api/account', { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
			error = body.error?.message ?? 'Deletion failed';
			return;
		}
		await goto(resolve('/register'));
	}

	async function uploadAvatar(file: File) {
		const f = new FormData();
		f.set('file', file);
		if ((await api('POST', '/api/account/avatar', f)).ok) {
			toast('Avatar updated');
			await invalidateAll();
		}
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		await goto(resolve('/login'));
	}
</script>

<svelte:head>
	<title>Profile · Family Tree</title>
</svelte:head>

<div class="page-header">
	<div>
		<h1>Profile</h1>
		<p>Your account, preferences and security.</p>
	</div>
</div>
{#if !data.profile}
	<div class="section"><p>Not signed in. <a href={resolve('/login')}>Log in</a></p></div>
{:else}
	<div class="grid gap-6">
		<section class="section flex flex-wrap items-center gap-4">
			<Avatar src={data.me?.avatarUrl} name={data.profile.displayName} size={72} />
			<div class="min-w-0 flex-1">
				<p class="text-lg font-semibold">{data.profile.displayName}</p>
				<p class="muted flex flex-wrap items-center gap-2 text-sm">
					{data.profile.email}
					<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold {data.profile.emailVerified ? 'bg-accent text-accent-foreground' : 'bg-warning/15 text-warning'}">{data.profile.emailVerified ? 'verified' : 'unverified'}</span>
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<UploadButton label="Change avatar" onfile={uploadAvatar} />
				{#if !data.profile.emailVerified}
					<button onclick={resendVerification} type="button" class="secondary">Resend verification email</button>
				{/if}
			</div>
		</section>

		{#if error || message}
			<p class="rounded-lg px-3 py-2 text-sm {error ? 'bg-destructive/10 text-destructive' : 'bg-accent text-accent-foreground'}" aria-live="polite">{error}{message}</p>
		{/if}

		<section class="section">
			<h2>Preferences</h2>
			<form onsubmit={saveProfile} class="grid gap-4">
				<div class="grid gap-4 sm:grid-cols-3">
					<label>
						Display name
						<input type="text" bind:value={displayName} required />
					</label>
					<label>
						Theme
						<select bind:value={themePref}>
							<option value="system">System</option>
							<option value="light">Light</option>
							<option value="dark">Dark</option>
						</select>
					</label>
					<label>
						Date display
						<select bind:value={dateDisplayPref}>
							<option value="AD">AD</option>
							<option value="BS">BS</option>
							<option value="both">Both</option>
						</select>
					</label>
				</div>
				<fieldset class="grid gap-2 sm:grid-cols-2">
					<legend>Notify me when</legend>
					{#each NOTIFY_TYPES as [type, label] (type)}
						<label class="flex items-center gap-2 font-normal"><input type="checkbox" bind:checked={notifyPrefs[type]} /> {label}</label>
					{/each}
				</fieldset>
				<div><button type="submit">Save profile</button></div>
			</form>
		</section>

		<section class="section">
			<h2>Password</h2>
			<form onsubmit={changePassword} class="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
				<label>
					Current password
					<input type="password" bind:value={currentPassword} required autocomplete="current-password" />
				</label>
				<label>
					New password
					<input type="password" bind:value={newPassword} required autocomplete="new-password" />
				</label>
				<button type="submit">Change password</button>
			</form>
		</section>

		<section class="section border-destructive/40">
			<h2>Session and account</h2>
			<div class="flex flex-wrap gap-2">
				<button onclick={logout} type="button" class="secondary">Log out</button>
				<button onclick={deleteAccount} type="button" class="danger">Delete account</button>
			</div>
		</section>
	</div>
{/if}
