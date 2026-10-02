<script lang="ts">
	import { dismiss, toasts } from '$lib/toast.svelte.js';
</script>

<div class="fixed right-4 bottom-20 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 sm:bottom-4" aria-live="polite" role="status">
	{#each toasts as t (t.id)}
		<div class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg {t.kind === 'error' ? 'bg-red-700' : 'bg-emerald-700'}">
			<span class="flex-1">{t.text}</span>
			{#if t.action}
				<button
					type="button"
					class="underline"
					style="background: rgb(255 255 255 / 0.15); color: white; padding: 0 12px; min-height: 32px; box-shadow: none"
					onclick={async () => {
						dismiss(t.id);
						await t.action?.run();
					}}>{t.action.label}</button
				>
			{/if}
		</div>
	{/each}
</div>
