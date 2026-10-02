<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PersonDraft } from './draft.js';
	import { parseDate } from '$lib/utils/dates.js';
	import { ChevronDown, CircleHelp } from '@lucide/svelte';

	// Progressive disclosure: names and gender always; dates, places and the rest behind "More details".
	let {
		draft = $bindable(),
		submitLabel = 'Save',
		onsubmit,
		oncancel,
		extra
	}: {
		draft: PersonDraft;
		submitLabel?: string;
		onsubmit: () => void | Promise<void>;
		/** Shows a Cancel button left of the submit button (dialogs). */
		oncancel?: () => void;
		/** Extra fields rendered at the end of the details (e.g. a photo picker). */
		extra?: Snippet;
	} = $props();
	let more = $state(false);
	const CAL_HINT = 'AD or BS (Bikram Sambat). Partial BS dates sort approximately and a BS year alone can show as the previous Gregorian year.';
	const DATE_HELP = 'Accepted formats: a year (1950), year and month (1950-03 or Mar 1950), or a full date (1950-03-12, 12 Mar 1950, 12 March 1950). Choose BS for Bikram Sambat dates (2007-05-02).';

	// Native validity: the browser blocks submit and shows the message on the field.
	function dateValidity(node: HTMLInputElement, cal: () => 'AD' | 'BS') {
		const check = () => {
			const v = node.value.trim();
			node.setCustomValidity(v && !parseDate(v, cal()).norm ? `Unrecognised date. ${DATE_HELP}` : '');
		};
		node.addEventListener('input', check);
		$effect(() => {
			cal();
			check();
		});
		return { destroy: () => node.removeEventListener('input', check) };
	}

	// Errors may sit in the collapsed part: open it so the browser can point at the field.
	function invalid() {
		more = true;
	}
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		void onsubmit();
	}}
	oninvalidcapture={invalid}
	class="grid gap-4"
>
	<div class="grid gap-4 sm:grid-cols-2">
		<label>First name <input bind:value={draft.firstName} required maxlength="100" autocomplete="off" /></label>
		<label>Middle name <input bind:value={draft.middleName} maxlength="100" autocomplete="off" /></label>
		<label>Last name <input bind:value={draft.lastName} maxlength="100" autocomplete="off" /></label>
		<label>Gender
			<select bind:value={draft.gender}>
				<option value="">—</option><option value="M">Male</option><option value="F">Female</option><option value="X">Other</option><option value="U">Unknown</option>
			</select>
		</label>
	</div>
	<div>
		<button type="button" class="secondary" onclick={() => (more = !more)} aria-expanded={more}>
			<ChevronDown size={16} class="transition-transform {more ? 'rotate-180' : ''}" />{more ? 'Fewer details' : 'More details'}
		</button>
	</div>
	{#if more}
		<div class="grid grid-cols-[1fr_auto] gap-3">
			<label>
				<span class="inline-flex items-center gap-1.5">Birth date <span class="help" title={DATE_HELP} aria-label={DATE_HELP} role="img"><CircleHelp size={15} /></span></span>
				<input bind:value={draft.birthDate} placeholder="1950, 1950-03, 12 Mar 1950" title={DATE_HELP} use:dateValidity={() => draft.birthDateCal} />
			</label>
			<label>Calendar
				<select bind:value={draft.birthDateCal} title={CAL_HINT}><option>AD</option><option>BS</option></select>
			</label>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<label>Birth place <input bind:value={draft.birthPlace} maxlength="200" /></label>
			<label>Maiden name <input bind:value={draft.maidenName} maxlength="100" /></label>
			<label>Status
				<select bind:value={draft.isLiving}>
					<option value="unknown">Unknown</option><option value="living">Living</option><option value="deceased">Deceased</option>
				</select>
			</label>
		</div>
		{#if draft.isLiving === 'deceased'}
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<label>
					<span class="inline-flex items-center gap-1.5">Death date <span class="help" title={DATE_HELP} aria-label={DATE_HELP} role="img"><CircleHelp size={15} /></span></span>
					<input bind:value={draft.deathDate} title={DATE_HELP} use:dateValidity={() => draft.deathDateCal} />
				</label>
				<label>Calendar
					<select bind:value={draft.deathDateCal} title={CAL_HINT}><option>AD</option><option>BS</option></select>
				</label>
			</div>
			<label>Death place <input bind:value={draft.deathPlace} maxlength="200" /></label>
		{/if}
		<label>Biography <textarea bind:value={draft.bio} maxlength="5000" rows="4"></textarea></label>
	{/if}
	{#if extra}{@render extra()}{/if}
	<div class="flex justify-end gap-2">
		{#if oncancel}<button type="button" class="secondary" onclick={oncancel}>Cancel</button>{/if}
		<button type="submit">{submitLabel}</button>
	</div>
</form>

<style>
	.help {
		display: inline-flex;
		color: var(--muted-foreground);
		cursor: help;
	}
</style>
