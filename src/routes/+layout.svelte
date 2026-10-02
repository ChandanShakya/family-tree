<script lang="ts">
	import '../app.css';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Toast from '$lib/components/shared/Toast.svelte';
	import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';
	import AppNav from '$lib/components/shared/AppNav.svelte';
	import Bell from '$lib/components/notifications/Bell.svelte';
	import Avatar from '$lib/components/media/Avatar.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Bell as BellIcon, LogOut, Moon, Sun, TreePine, UserRound } from '@lucide/svelte';
	import { api } from '$lib/api.js';
	import { applyTheme } from '$lib/theme.js';

	let { children, data } = $props();

	// The account's saved theme wins on every device; the inline script in app.html only prevents a flash.
	$effect(() => {
		if (data.me?.themePref) applyTheme(data.me.themePref);
	});

	async function toggleTheme() {
		const pref = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
		applyTheme(pref);
		if (data.me) await api('PUT', '/api/account', { themePref: pref }, { quiet: true });
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		await invalidateAll();
		await goto(resolve('/login'));
	}
</script>

<a href="#main" class="skip-link">Skip to content</a>
<header class="sticky top-0 z-30 border-b bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
	<nav aria-label="Main" class="mx-auto flex h-16 items-center gap-2 px-4 lg:pl-6">
		<a href={resolve('/')} class="flex items-center gap-2 font-bold text-foreground no-underline hover:no-underline">
			<span class="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><TreePine size={20} /></span>
			<span class="text-[17px] tracking-tight">Family Tree</span>
		</a>
		<span class="flex-1"></span>
		<Button variant="ghost" size="icon" onclick={toggleTheme} aria-label="Toggle dark mode">
			<Sun class="hidden dark:block" /><Moon class="dark:hidden" />
		</Button>
		{#if data.me}
			<Bell initial={data.unread} />
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button {...props} type="button" class="user-trigger" aria-label="Account menu for {data.me?.displayName}">
							<Avatar src={data.me?.avatarUrl} name={data.me?.displayName ?? ''} size={34} decorative />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-56">
					<DropdownMenu.Label class="truncate">{data.me.displayName}</DropdownMenu.Label>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => goto(resolve('/profile'))}><UserRound /> Profile</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => goto(resolve('/notifications'))}><BellIcon /> Notifications</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={logout}><LogOut /> Log out</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<Button variant="ghost" href={resolve('/login')}>Log in</Button>
			<Button href={resolve('/register')}>Register</Button>
		{/if}
	</nav>
</header>
<AppNav signedIn={!!data.me} />
<main id="main" class:with-side={!!data.me}>
	<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
		{@render children()}
	</div>
</main>
<Toast />
<ConfirmDialog />

<style>
	.skip-link {
		position: absolute;
		left: -9999px;
	}
	.skip-link:focus {
		left: 16px;
		top: 12px;
		z-index: 50;
		background: var(--card);
		padding: 8px 12px;
		border-radius: 8px;
	}
	.user-trigger {
		background: transparent;
		padding: 0;
		border-radius: 9999px;
		min-height: 44px;
		min-width: 44px;
		box-shadow: none;
	}
	.user-trigger:hover {
		background: var(--muted);
	}
	main {
		padding-bottom: 88px;
	}
	@media (min-width: 640px) {
		main {
			padding-bottom: 0;
		}
	}
	@media (min-width: 1024px) {
		main.with-side {
			margin-left: 240px;
		}
	}
</style>
