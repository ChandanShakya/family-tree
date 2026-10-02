<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Avatar from '$lib/components/media/Avatar.svelte';
	import ChangeHistory from '$lib/components/history/ChangeHistory.svelte';
	import ClaimProfileFlow from '$lib/components/claim/ClaimProfileFlow.svelte';
	import QuestionsEditor from '$lib/components/claim/QuestionsEditor.svelte';
	import JoinCodeGenerator from '$lib/components/join/JoinCodeGenerator.svelte';
	import Gallery from '$lib/components/media/Gallery.svelte';
	import UploadButton from '$lib/components/media/UploadButton.svelte';
	import EventList from '$lib/components/person/EventList.svelte';
	import FamilyLinks from '$lib/components/person/FamilyLinks.svelte';
	import PersonCard from '$lib/components/person/PersonCard.svelte';
	import PersonForm from '$lib/components/person/PersonForm.svelte';
	import RelationFinder from '$lib/components/person/RelationFinder.svelte';
	import { draftFromPerson, draftToBody, type PersonDraft } from '$lib/components/person/draft.js';
	import { api, personName } from '$lib/api.js';
	import { confirmDialog } from '$lib/confirm.svelte.js';
	import { toast } from '$lib/toast.svelte.js';
	import { offerUndo } from '$lib/undo.js';
	import { fmtDate } from '$lib/utils/format.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ArrowLeft, Trash2 } from '@lucide/svelte';

	let { data } = $props();
	const person = $derived(data.person);
	// Public and member reads return different row shapes; these two fields are optional in both.
	const extra = $derived(data.person as { birthPlace?: string | null; isLiving?: number | null });
	const pref = $derived(data.me?.dateDisplayPref ?? 'AD');
	// Local edit draft, resynced from page data after invalidateAll (§2.1).
	let draft = $derived<PersonDraft>(draftFromPerson(person));

	const born = $derived(fmtDate(person.birthDate, person.birthDateCal, pref));
	const died = $derived(fmtDate(person.deathDate, person.deathDateCal, pref));
	const groups = $derived([
		['Parent', data.relatives.parents],
		['Spouse', data.relatives.spouses],
		['Sibling', data.relatives.siblings],
		['Child', data.relatives.children]
	] as const);

	async function save() {
		const r = await api<{ batchId: string | null }>('PUT', `/api/persons/${person.id}`, { ...draftToBody(draft, true), version: person.version }, { quiet: true });
		if (r.ok) offerUndo('Saved', r.data.batchId);
		else if (r.status === 409) toast('Someone else changed this person. Reloaded the latest version; re-apply your edit.', 'error');
		else toast(r.message, 'error');
		await invalidateAll();
	}

	async function remove() {
		if (!(await confirmDialog(`Delete ${personName(person)}?`))) return;
		const r = await api<{ batchId: string }>('DELETE', `/api/persons/${person.id}`);
		if (r.ok) {
			offerUndo('Person deleted', r.data.batchId);
			await goto(resolve(`/trees/${person.treeId}` as '/'));
		}
	}

	async function uploadPhoto(file: File) {
		const f = new FormData();
		f.set('treeId', person.treeId);
		f.set('personId', person.id);
		f.set('file', file);
		if (!person.photoUrl) f.set('makePrimary', 'true');
		const r = await api<{ batchId: string }>('POST', '/api/media', f);
		if (r.ok) {
			await invalidateAll();
			offerUndo('Photo added', r.data.batchId);
		}
	}
</script>

<svelte:head>
	<title>{personName(person)} · Family Tree</title>
</svelte:head>


<a href={resolve(`/trees/${person.treeId}` as '/')} class="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"><ArrowLeft size={16} /> Back to tree</a>

<header class="section mb-6 flex flex-wrap items-center gap-4">
	<Avatar src={person.photoUrl} name={personName(person)} size={72} />
	<div class="min-w-48 flex-1">
		<h1 class="break-words">{personName(person)}</h1>
		<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
			{#if born}<span>Born {born}{extra.birthPlace ? ` · ${extra.birthPlace}` : ''}</span>{/if}
			{#if died}<span>· Died {died}</span>{/if}
			{#if person.userId}<Badge variant="secondary">Claimed profile</Badge>{/if}
			{#if extra.isLiving === 0}<Badge variant="outline">Deceased</Badge>{:else if extra.isLiving === 1}<Badge variant="outline">Living</Badge>{/if}
		</div>
	</div>
	{#if !data.publicView && data.canDelete}
		<div class="w-full sm:w-auto"><Button variant="destructive" onclick={remove}><Trash2 /> Delete person</Button></div>
	{/if}
</header>

{#snippet family()}
	{#if groups.some(([, list]) => list.length)}
		<ul class="grid gap-2 sm:grid-cols-2">
			{#each groups as [label, list] (label)}
				{#each list as rid (rid)}
					<li><PersonCard id={rid} name={data.names[rid] ?? '…'} photoUrl={data.photos[rid]} sub={label} /></li>
				{/each}
			{/each}
		</ul>
	{:else}
		<p class="muted text-sm">No relatives recorded yet.</p>
	{/if}
{/snippet}

{#if data.publicView}
	<p class="muted mb-4 text-sm">Public view: living people are hidden.</p>
	<div class="grid gap-6 lg:grid-cols-2">
		<section class="section">
			<h2>Family</h2>
			{@render family()}
		</section>
		<section class="section">
			<h2>Events</h2>
			{#if person.events.length}
				<ul class="flex flex-col gap-2 text-sm">
					{#each person.events as e (e.id)}
						<li>{e.type}{e.date ? ` · ${fmtDate(e.date, e.dateCal, pref)}` : ''}{e.place ? ` · ${e.place}` : ''}{e.description ? ` — ${e.description}` : ''}</li>
					{/each}
				</ul>
			{:else}<p class="muted text-sm">No events.</p>{/if}
		</section>
		{#if person.media.length}
			<section class="section lg:col-span-2">
				<h2>Photos</h2>
				<Gallery items={person.media} readonly onchange={() => {}} />
			</section>
		{/if}
	</div>
{:else}
	{#if data.claimable}
		<div class="mb-6"><ClaimProfileFlow treeId={person.treeId} personId={person.id} personName={personName(person)} questions={data.questions} pending={data.pendingClaim} isOwner={data.role === 'owner'} /></div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
		<div class="flex min-w-0 flex-col gap-6">
			<section class="section">
				<h2>Details</h2>
				<PersonForm bind:draft onsubmit={save} readonly={!data.canEdit} />
			</section>
			<section class="section">
				<h2>Events</h2>
				<EventList personId={person.id} treeId={person.treeId} events={person.events} {pref} readonly={!data.canEdit} />
			</section>
			<section class="section">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="my-0">Photos</h2>
					{#if data.canEdit}<UploadButton label="Add photo" onfile={uploadPhoto} />{/if}
				</div>
				<div class="mt-4"><Gallery items={person.media} canPrimary readonly={!data.canEdit} onchange={invalidateAll} /></div>
			</section>
			<section class="section">
				<h2>History</h2>
				<ChangeHistory rows={data.history} />
			</section>
		</div>
		<div class="flex min-w-0 flex-col gap-6">
			<section class="section">
				<h2>Family</h2>
				{@render family()}
				<h3 class="mt-6">Stored links</h3>
				<FamilyLinks personId={person.id} treeId={person.treeId} links={data.links} names={data.names} canEdit={data.canEdit} />
			</section>
			<section class="section">
				<h2>How are we related?</h2>
				<RelationFinder personId={person.id} personName={personName(person)} treeId={person.treeId} />
			</section>
			{#if data.canInvite || data.canSetQuestions}
				<section class="section">
					<h2>Invite and verify</h2>
					{#if data.canInvite}
						<JoinCodeGenerator treeId={person.treeId} personId={person.id} personName={personName(person)} role={data.role} codes={data.directCodes} />
					{/if}
					{#if data.canSetQuestions && !person.userId}<QuestionsEditor personId={person.id} />{/if}
				</section>
			{/if}
		</div>
	</div>
{/if}
