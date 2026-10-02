<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/toast.svelte.js';

	let { code }: { code: string } = $props();

	const link = $derived(`${page.url.origin}/join/${code}`);
	const text = $derived(`Join our family tree: ${link}`);
	const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

	async function copy() {
		try {
			await navigator.clipboard.writeText(link);
			toast('Link copied');
		} catch {
			toast('Could not copy; select the link manually', 'error');
		}
	}
	async function share() {
		try {
			await navigator.share({ title: 'Family tree', text, url: link });
		} catch {
			// the user dismissed the share sheet
		}
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<button type="button" class="secondary" onclick={copy}>Copy link</button>
	<a class="share" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
	<a class="share" href={`mailto:?subject=${encodeURIComponent('Join our family tree')}&body=${encodeURIComponent(text)}`}>Email</a>
	{#if canShare}<button type="button" class="secondary" onclick={share}>Share…</button>{/if}
</div>

<style>
	.share {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid var(--input);
		border-radius: 12px;
		color: var(--foreground);
		font-weight: 600;
		font-size: 15px;
		text-decoration: none;
	}
	.share:hover {
		background: var(--muted);
	}
</style>
