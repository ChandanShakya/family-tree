<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';
	import type { HistoryEntry as HistoryRow } from '$lib/types.js';
	import { Calendar, Image, Link2, Pencil, Plus, RotateCcw, Settings, ShieldCheck, Trash2, Unlink } from '@lucide/svelte';

	let { rows }: { rows: HistoryRow[] } = $props();

	const FIELDS: Record<string, string> = {
		firstName: 'first name',
		middleName: 'middle name',
		lastName: 'last name',
		maidenName: 'maiden name',
		gender: 'gender',
		birthDate: 'birth date',
		birthDateCal: 'birth date calendar',
		birthPlace: 'birth place',
		deathDate: 'death date',
		deathDateCal: 'death date calendar',
		deathPlace: 'death place',
		bio: 'biography',
		isLiving: 'status',
		photoUrl: 'photo',
		type: 'type',
		date: 'date',
		place: 'place',
		description: 'description',
		startDate: 'start date',
		endDate: 'end date',
		notes: 'notes',
		caption: 'caption',
		name: 'name',
		isPublic: 'public',
		allowCrossTree: 'combined family views'
	};
	const GENDER: Record<string, string> = { M: 'Male', F: 'Female', X: 'Other', U: 'Unknown' };

	function show(field: string | null, v: string | null): string {
		if (v === null) return '—';
		let x: unknown = v;
		try {
			x = JSON.parse(v);
		} catch {
			// plain text
		}
		if (x === null || x === '') return '—';
		if (field === 'isLiving') return x === 1 || x === true ? 'Living' : x === 0 || x === false ? 'Deceased' : 'Unknown';
		if (field === 'gender' && typeof x === 'string') return GENDER[x] ?? x;
		if (field === 'photoUrl') return 'changed';
		if (typeof x === 'boolean') return x ? 'Yes' : 'No';
		if (typeof x === 'object') return JSON.stringify(x);
		const s = String(x);
		return s.length > 80 ? `${s.slice(0, 79)}…` : s;
	}

	const fieldName = (r: HistoryRow) => (r.field ? (FIELDS[r.field] ?? r.field) : 'details');
	const ENTITY: Record<string, string> = { person: 'person', relationship: 'link', event: 'event', media: 'photo', tree: 'tree' };

	/** Verb and object for a group, e.g. "added" + "Hari Shakya". */
	function summary(g: HistoryRow[]): { verb: string; what: string | null; extra?: string } {
		const r = g[0]!;
		const subj = r.subject ?? null;
		const ent = ENTITY[r.entityType] ?? r.entityType;
		if (r.action === 'claim') return { verb: 'claimed the profile of', what: subj };
		if (r.entityType === 'tree') {
			if (r.action === 'create') return { verb: 'created the tree', what: subj };
			return { verb: 'changed tree settings', what: null };
		}
		if (r.entityType === 'relationship') {
			if (r.action === 'create') return { verb: 'linked', what: subj };
			if (r.action === 'delete') return { verb: 'removed the link', what: subj };
			if (r.action === 'revert') return { verb: 'reverted a change to the link', what: subj };
			return { verb: 'edited the link', what: subj };
		}
		if (r.entityType === 'event') {
			const e = r.detail ? `${r.detail} event` : 'an event';
			if (r.action === 'create') return { verb: `added ${e} for`, what: subj };
			if (r.action === 'delete') return { verb: `removed ${e} of`, what: subj };
			return { verb: `edited ${e} of`, what: subj };
		}
		if (r.entityType === 'media') {
			if (r.action === 'create') return { verb: subj ? 'added a photo of' : 'added a photo', what: subj };
			if (r.action === 'delete') return { verb: subj ? 'removed a photo of' : 'removed a photo', what: subj };
			return { verb: 'edited a photo', what: subj };
		}
		if (r.action === 'create') return { verb: 'added', what: subj ?? `a ${ent}` };
		if (r.action === 'delete') return { verb: 'removed', what: subj ?? `a ${ent}` };
		if (r.action === 'revert') return { verb: 'reverted changes to', what: subj };
		return { verb: 'edited', what: subj };
	}

	function icon(r: HistoryRow) {
		if (r.action === 'revert') return RotateCcw;
		if (r.action === 'claim') return ShieldCheck;
		if (r.entityType === 'tree') return r.action === 'create' ? Plus : Settings;
		if (r.entityType === 'relationship') return r.action === 'delete' ? Unlink : Link2;
		if (r.entityType === 'event') return Calendar;
		if (r.entityType === 'media') return Image;
		return r.action === 'create' ? Plus : r.action === 'delete' ? Trash2 : Pencil;
	}
	const tone = (r: HistoryRow) => (r.action === 'delete' ? 'text-destructive bg-destructive/10' : r.action === 'create' || r.action === 'claim' ? 'text-accent-foreground bg-accent' : 'text-muted-foreground bg-muted');

	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	function ago(iso: string): string {
		const s = (new Date(iso).getTime() - Date.now()) / 1000;
		for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
			if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
		}
		return 'just now';
	}

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
	const changes = (g: HistoryRow[]) => g.filter((r) => (r.action === 'update' || r.action === 'revert') && r.field);

	async function revert(body: { historyId?: string; batchId?: string }) {
		let r = await api<unknown>('POST', '/api/history/revert', body, { quiet: true });
		if (!r.ok && r.status === 409) {
			const err = (r.body as { error?: { code?: string; message?: string; conflicts?: Array<{ field: string; current: unknown }> } } | null)?.error;
			if (err?.code === 'STALE_REVERT') {
				const fields = (err.conflicts ?? []).map((c) => `${FIELDS[c.field] ?? c.field} is now "${String(c.current)}"`).join('; ');
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

<ol class="flex flex-col">
	{#each groups as g (g[0]!.id)}
		{@const r = g[0]!}
		{@const s = summary(g)}
		{@const Icon = icon(r)}
		<li class="flex gap-3 border-b py-3 last:border-b-0 {r.isReverted ? 'opacity-60' : ''}">
			<span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full {tone(r)}" aria-hidden="true"><Icon size={16} /></span>
			<div class="min-w-0 flex-1">
				<p class="text-sm leading-snug break-words">
					<span class="font-semibold">{r.changedByName ?? 'Deleted user'}</span>
					{s.verb}
					{#if s.what}
						{#if r.subjectId && r.entityType !== 'relationship' && r.action !== 'delete'}<a href={resolve(`/persons/${r.subjectId}` as '/')} class="font-medium">{s.what}</a>{:else}<span class="font-medium">{s.what}</span>{/if}
					{/if}
					{#if r.isReverted}<span class="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">reverted</span>{/if}
				</p>
				{#if changes(g).length}
					<ul class="mt-1.5 flex flex-col gap-1 text-sm">
						{#each changes(g) as c (c.id)}
							<li class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
								<span class="text-muted-foreground">{fieldName(c)}:</span>
								<del class="rounded bg-destructive/10 px-1 text-destructive">{show(c.field, c.oldValue)}</del>
								<span aria-hidden="true" class="text-muted-foreground">→</span>
								<ins class="rounded bg-accent px-1 text-accent-foreground no-underline">{show(c.field, c.newValue)}</ins>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
					<time datetime={r.changedAt} title={new Date(r.changedAt).toLocaleString()}>{ago(r.changedAt)}</time>
					{#if canRevert(g)}
						<button type="button" class="link min-h-8! px-0 text-xs" onclick={() => revert(r.batchId && g.length > 1 ? { batchId: r.batchId } : { historyId: r.id })}>
							Revert{g.length > 1 ? ' all' : ''}
						</button>
					{/if}
				</div>
			</div>
		</li>
	{/each}
</ol>
