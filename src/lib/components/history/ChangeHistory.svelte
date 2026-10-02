<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';
	import type { HistoryEntry as HistoryRow } from '$lib/types.js';

	let { rows }: { rows: HistoryRow[] } = $props();

	const show = (v: string | null): string => {
		if (v === null) return '—';
		try {
			const x = JSON.parse(v);
			return typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x);
		} catch {
			return v;
		}
	};
	const label = (r: HistoryRow): string =>
		r.action === 'update' || r.action === 'revert' ? (r.field ?? r.action) : r.action === 'create' ? `created ${r.entityType}` : r.action === 'delete' ? `deleted ${r.entityType}` : r.action;

	// One request per user action: rows of a batch revert together.
	const groups = $derived.by(() => {
		const out: HistoryRow[][] = [];
		for (const r of rows) {
			const last = out[out.length - 1];
			if (last && r.batchId && last[0]!.batchId === r.batchId) last.push(r);
			else out.push([r]);
		}
		return out;
	});

	async function revert(body: { historyId?: string; batchId?: string }) {
		let r = await api<unknown>('POST', '/api/history/revert', body, { quiet: true });
		if (!r.ok && r.status === 409) {
			const err = (r.body as { error?: { code?: string; message?: string; conflicts?: Array<{ field: string; current: unknown }> } } | null)?.error;
			if (err?.code === 'STALE_REVERT') {
				const fields = (err.conflicts ?? []).map((c) => `${c.field} is now "${String(c.current)}"`).join('; ');
				// Force writes a new revert row over the newer value (§5.1 stale rule).
				if (!(await confirmDialog(`This changed since: ${fields}. Revert anyway?`))) return;
				r = await api('POST', '/api/history/revert', { ...body, force: true }, { quiet: true });
			}
		}
		if (r.ok) toast('Reverted');
		else toast(r.message, 'error');
		await invalidateAll();
	}

	// The server decides who may revert what (contributors: own changes only); the button just asks.
	const canRevert = (g: HistoryRow[]) => g.every((r) => r.action !== 'claim' && r.entityType !== 'tree' && !r.isReverted);
</script>

<ol class="relative ml-2 border-l">
	{#each groups as g (g[0]!.id)}
		<li class="relative mb-4 pl-5 last:mb-0">
			<span class="absolute top-1.5 -left-[5px] size-2.5 rounded-full border-2 border-card {g[0]!.isReverted ? 'bg-muted-foreground' : 'bg-primary'}" aria-hidden="true"></span>
			<div class="text-xs text-muted-foreground">
				{new Date(g[0]!.changedAt).toLocaleString()} · <span class="font-medium text-foreground">{g[0]!.changedByName ?? 'Deleted user'}</span>
				{#if g[0]!.isReverted}· <em>reverted</em>{/if}
			</div>
			{#each g as r (r.id)}
				<div class="mt-1 text-sm break-words">
					<strong class="font-semibold">{label(r)}</strong>
					{#if r.action === 'update' || r.action === 'revert'}
						<del class="rounded bg-destructive/10 px-1 text-destructive">{show(r.oldValue)}</del>
						→ <ins class="rounded bg-accent px-1 text-accent-foreground no-underline">{show(r.newValue)}</ins>
					{/if}
				</div>
			{/each}
			{#if canRevert(g)}
				<button type="button" class="link mt-1 px-0 text-sm" onclick={() => revert(g[0]!.batchId && g.length > 1 ? { batchId: g[0]!.batchId } : { historyId: g[0]!.id })}>
					Revert{g.length > 1 ? ' all' : ''}
				</button>
			{/if}
		</li>
	{/each}
</ol>
