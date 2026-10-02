import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { fullName } from '$lib/utils/format.js';
import { DEFAULT_JOIN_ROLE, MATCH_WEIGHTS, MIN_VERIFICATION_QUESTIONS, VERIFY_MAX_ATTEMPTS_PER_24H } from '$lib/config.js';
import { claimAttempts, persons, profileClaims, treeMembers, users, verificationQuestions } from '$lib/db/schema.js';
import { parseDate } from '$lib/utils/dates.js';
import { damerauLevenshtein, normalizeText } from '$lib/utils/fuzzy.js';
import { writeHistory } from './audit.js';
import { findCode, isUsable } from './codes.js';
import { notify, notifyReviewers } from './notifications.js';
import { buildFtsQuery } from './search.js';
import { createLink, type LinkType } from './relations.js';
import { writeTx, type Db, type Handles } from './tx.js';

// §6.5 claiming. Source of truth is persons.userId; every approval is one
// immediate transaction around a null-guarded UPDATE, so exactly one claimant wins.

class Abort extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

// --- Audience (§6.5): active members, or holders of a valid code for that tree ---

export type Audience = 'member' | 'holder';

export function claimAudience(db: Db, userId: string | null, treeId: string, code?: string | null, now = new Date()): Audience | null {
	if (userId) {
		const m = db
			.select({ s: treeMembers.status })
			.from(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)))
			.get();
		if (m?.s === 'active') return 'member';
	}
	if (code) {
		const c = findCode(db, code);
		if (isUsable(c, now) && c.treeId === treeId) return 'holder';
	}
	return null;
}

export interface ClaimCandidate {
	id: string;
	firstName: string;
	lastName?: string | null;
	lastInitial?: string;
	birthYear: string | null;
	birthPlace?: string | null;
}

/** "Find yourself": unclaimed people only. Code holders see first name, last initial and birth year. */
export function claimSearch(h: Handles, treeId: string, q: string, audience: Audience, limit = 20): ClaimCandidate[] {
	const match = buildFtsQuery(q);
	if (!match) return [];
	const rows = h.raw
		.prepare(
			`SELECT v.id, v.firstName, v.lastName, v.birthDateNorm, v.birthPlace
			 FROM persons_fts f JOIN visible_persons v ON v.id = f.personId
			 WHERE f.treeId = ? AND persons_fts MATCH ? AND v.userId IS NULL ORDER BY rank LIMIT ?`
		)
		.all(treeId, match, limit) as Array<{ id: string; firstName: string; lastName: string | null; birthDateNorm: string | null; birthPlace: string | null }>;
	const year = (n: string | null) => (n && n.length >= 4 && !n.startsWith('0000') ? n.slice(0, 4) : null);
	return rows.map((r) =>
		audience === 'member'
			? { id: r.id, firstName: r.firstName, lastName: r.lastName, birthYear: year(r.birthDateNorm), birthPlace: r.birthPlace }
			: { id: r.id, firstName: r.firstName, lastInitial: r.lastName ? [...r.lastName][0] : '', birthYear: year(r.birthDateNorm) }
	);
}

// --- Verification questions ---

function pepper(): string {
	const p = process.env.VERIFICATION_PEPPER;
	if (p) return p;
	if (process.env.NODE_ENV === 'production') throw new Error('VERIFICATION_PEPPER is required in production');
	return 'dev-only-pepper-not-for-production';
}

/** HMAC-SHA256 over the NFKC / trimmed / lower-cased / whitespace-collapsed answer (§5.1). */
export function hashAnswer(answer: string): string {
	return createHmac('sha256', pepper()).update(normalizeText(answer)).digest('hex');
}

function sameHash(a: string, b: string): boolean {
	const x = Buffer.from(a, 'hex');
	const y = Buffer.from(b, 'hex');
	return x.length === y.length && timingSafeEqual(x, y);
}

export function setQuestions(
	h: Handles,
	actorId: string,
	treeId: string,
	personId: string,
	items: Array<{ question: string; answer: string }>
): { count: number } | { error: 'NOT_FOUND' } {
	const p = h.raw.prepare(`SELECT id FROM visible_persons WHERE id = ? AND treeId = ?`).get(personId, treeId);
	if (!p) return { error: 'NOT_FOUND' };
	writeTx(h.db, (tx) => {
		tx.delete(verificationQuestions).where(eq(verificationQuestions.personId, personId)).run();
		const now = new Date().toISOString();
		for (const it of items) {
			tx.insert(verificationQuestions)
				.values({ id: randomUUID(), personId, treeId, createdBy: actorId, question: it.question, answerHash: hashAnswer(it.answer), createdAt: now })
				.run();
		}
	});
	return { count: items.length };
}

/** Question texts only, never answers or hashes. */
export function getQuestions(db: Db, personId: string): Array<{ id: string; question: string }> {
	return db
		.select({ id: verificationQuestions.id, question: verificationQuestions.question })
		.from(verificationQuestions)
		.where(eq(verificationQuestions.personId, personId))
		.orderBy(verificationQuestions.createdAt, verificationQuestions.id)
		.all();
}

// --- Matching score (§6.5): deterministic, advisory ---

export function matchScore(
	person: { firstName: string; lastName: string | null; birthDateNorm: string | null; birthPlace: string | null },
	claimed: { firstName?: string | null; lastName?: string | null; birthDate?: string | null; birthPlace?: string | null }
): number {
	const full = (f?: string | null, l?: string | null) => normalizeText(`${f ?? ''} ${l ?? ''}`);
	const a = full(person.firstName, person.lastName);
	const b = full(claimed.firstName, claimed.lastName);
	const longest = Math.max([...a].length, [...b].length);
	const name = longest === 0 ? 0 : Math.min(1, Math.max(0, 1 - damerauLevenshtein(a, b) / longest));

	let date = 0;
	const cn = claimed.birthDate ? parseDate(claimed.birthDate, 'AD').norm : null;
	if (cn && person.birthDateNorm) {
		const len = cn.endsWith('-00-00') ? 4 : cn.endsWith('-00') ? 7 : 10;
		if (cn.slice(0, len) === person.birthDateNorm.slice(0, len)) date = 1;
		else if (cn.slice(0, 4) === person.birthDateNorm.slice(0, 4)) date = 0.5;
	}

	let place = 0;
	const pa = normalizeText(person.birthPlace ?? '');
	const pb = normalizeText(claimed.birthPlace ?? '');
	if (pa && pb) {
		if (pa === pb) place = 1;
		else {
			const ta = new Set(pa.split(' '));
			const tb = new Set(pb.split(' '));
			const inter = [...ta].filter((t) => tb.has(t)).length;
			const union = new Set([...ta, ...tb]).size;
			if (union > 0 && inter / union >= 0.5) place = 0.5;
		}
	}
	return MATCH_WEIGHTS.name * name + MATCH_WEIGHTS.birthDate * date + MATCH_WEIGHTS.birthPlace * place;
}

// --- The atomic claim ---

type ClaimStatus = 'approved' | 'auto_approved';

interface ClaimInput {
	userId: string;
	personId: string;
	treeId: string;
	claimId: string;
	proof: 'verification' | 'matching' | 'manual';
	status: ClaimStatus;
	reviewerId?: string;
}

/**
 * Link `userId` to the person inside the caller's transaction. Returns false
 * (and marks the claim rejected) when somebody else got there first or the
 * user already holds another person in this tree (ux_person_user_per_tree).
 */
function applyClaim(tx: Db, i: ClaimInput, now: string): { claimed: boolean; reason?: 'ALREADY_CLAIMED' | 'ALREADY_LINKED' } {
	const reject = (reason: 'ALREADY_CLAIMED' | 'ALREADY_LINKED') => {
		tx.update(profileClaims)
			.set({ status: 'rejected', reviewedAt: now, reviewNote: reason === 'ALREADY_CLAIMED' ? 'already claimed' : 'already linked to another person' })
			.where(eq(profileClaims.id, i.claimId))
			.run();
		return { claimed: false, reason } as const;
	};
	let changes: number;
	try {
		changes = tx
			.update(persons)
			.set({ userId: i.userId, claimedAt: now, claimedVia: i.proof })
			.where(and(eq(persons.id, i.personId), sql`${persons.userId} IS NULL`, sql`${persons.deletedAt} IS NULL`))
			.run().changes;
	} catch (e) {
		if (/UNIQUE/.test(String((e as Error).message))) return reject('ALREADY_LINKED');
		throw e;
	}
	if (changes !== 1) return reject('ALREADY_CLAIMED');
	const m = tx.select().from(treeMembers).where(and(eq(treeMembers.treeId, i.treeId), eq(treeMembers.userId, i.userId))).get();
	if (m) {
		tx.update(treeMembers).set({ personId: i.personId }).where(eq(treeMembers.id, m.id)).run();
	} else {
		tx.insert(treeMembers)
			.values({ id: randomUUID(), treeId: i.treeId, userId: i.userId, personId: i.personId, role: DEFAULT_JOIN_ROLE, status: 'active', joinedAt: now, joinedViaType: 'claim' })
			.run();
	}
	tx.update(profileClaims)
		.set({ status: i.status, reviewedBy: i.reviewerId ?? null, reviewedAt: now })
		.where(eq(profileClaims.id, i.claimId))
		.run();
	// First wins: every other pending claim on this person is rejected in the same transaction.
	tx.update(profileClaims)
		.set({ status: 'rejected', reviewedAt: now, reviewNote: 'already claimed' })
		.where(and(eq(profileClaims.personId, i.personId), eq(profileClaims.status, 'pending'), ne(profileClaims.id, i.claimId)))
		.run();
	writeHistory(tx, { treeId: i.treeId, entityType: 'person', entityId: i.personId, changedBy: i.userId, action: 'claim', note: i.proof });
	// A user without an avatar takes the claimed person's photo.
	const photo = tx.select({ url: persons.photoUrl }).from(persons).where(eq(persons.id, i.personId)).get()?.url;
	if (photo) tx.update(users).set({ avatarUrl: photo }).where(and(eq(users.id, i.userId), sql`${users.avatarUrl} IS NULL`)).run();
	return { claimed: true };
}

// --- Verification flow ---

export type VerifyResult =
	| { ok: true; claimed: true; claimId: string }
	| { ok: true; claimed: false; reason: 'ALREADY_CLAIMED' | 'ALREADY_LINKED'; claimId: string }
	| { ok: false; error: 'WRONG' }
	| { ok: false; error: 'LOCKED'; retryAfterSec: number }
	| { ok: false; error: 'NOT_ENOUGH_QUESTIONS' | 'NOT_FOUND' };

const DAY_MS = 24 * 60 * 60 * 1000;

export function verifyAnswers(
	h: Handles,
	userId: string,
	treeId: string,
	personId: string,
	answers: Array<{ questionId: string; answer: string }>,
	now = new Date()
): VerifyResult {
	return writeTx(h.db, (tx): VerifyResult => {
		const person = h.raw.prepare(`SELECT id FROM visible_persons WHERE id = ? AND treeId = ?`).get(personId, treeId);
		if (!person) return { ok: false, error: 'NOT_FOUND' };
		const qs = tx.select().from(verificationQuestions).where(eq(verificationQuestions.personId, personId)).all();
		if (qs.length < MIN_VERIFICATION_QUESTIONS) return { ok: false, error: 'NOT_ENOUGH_QUESTIONS' };

		// Attempts are counted before the answers are looked at, so the 6th try is
		// refused even when it is correct (AT-20), and a wrong try is never free.
		const row = tx.select().from(claimAttempts).where(and(eq(claimAttempts.userId, userId), eq(claimAttempts.personId, personId))).get();
		const fresh = !row || now.getTime() - new Date(row.windowStart).getTime() >= DAY_MS;
		const count = fresh ? 0 : row.count;
		const windowStart = fresh ? now.toISOString() : row.windowStart;
		if (count >= VERIFY_MAX_ATTEMPTS_PER_24H) {
			const retryAfterSec = Math.max(1, Math.ceil((new Date(windowStart).getTime() + DAY_MS - now.getTime()) / 1000));
			return { ok: false, error: 'LOCKED', retryAfterSec };
		}
		if (row) tx.update(claimAttempts).set({ count: count + 1, windowStart }).where(and(eq(claimAttempts.userId, userId), eq(claimAttempts.personId, personId))).run();
		else tx.insert(claimAttempts).values({ userId, personId, count: 1, windowStart }).run();

		const given = new Map(answers.map((a) => [a.questionId, a.answer]));
		// All stored questions must be answered, and all answers must be right.
		const correct = qs.every((q) => {
			const a = given.get(q.id);
			return a !== undefined && sameHash(hashAnswer(a), q.answerHash);
		});
		if (!correct) return { ok: false, error: 'WRONG' };

		const claimId = randomUUID();
		tx.insert(profileClaims).values({ id: claimId, userId, personId, treeId, proofMethod: 'verification', status: 'pending', createdAt: now.toISOString() }).run();
		const r = applyClaim(tx, { userId, personId, treeId, claimId, proof: 'verification', status: 'auto_approved' }, now.toISOString());
		return r.claimed ? { ok: true, claimed: true, claimId } : { ok: true, claimed: false, reason: r.reason!, claimId };
	});
}

// --- Matching / manual submissions (always reviewed) ---

export interface ClaimSubmission {
	treeId: string;
	personId: string;
	proofMethod: 'matching' | 'manual';
	claimedFirstName?: string;
	claimedLastName?: string;
	claimedBirthDate?: string;
	claimedBirthPlace?: string;
	claimedRelation?: string;
}

export type SubmitResult =
	| { ok: true; claimId: string; matchScore: number | null; approved?: true }
	| { ok: false; error: 'NOT_FOUND' | 'ALREADY_CLAIMED' | 'ALREADY_LINKED' | 'DUPLICATE' };

export function submitClaim(h: Handles, userId: string, input: ClaimSubmission, now = new Date()): SubmitResult {
	return writeTx(h.db, (tx): SubmitResult => {
		const p = h.raw
			.prepare(`SELECT id, firstName, middleName, lastName, birthDateNorm, birthPlace, userId FROM visible_persons WHERE id = ? AND treeId = ?`)
			.get(input.personId, input.treeId) as
			| { id: string; firstName: string; middleName: string | null; lastName: string | null; birthDateNorm: string | null; birthPlace: string | null; userId: string | null }
			| undefined;
		if (!p) return { ok: false, error: 'NOT_FOUND' };
		if (p.userId) return { ok: false, error: 'ALREADY_CLAIMED' };
		const mine = tx.select({ id: persons.id }).from(persons).where(and(eq(persons.treeId, input.treeId), eq(persons.userId, userId))).get();
		if (mine) return { ok: false, error: 'ALREADY_LINKED' };
		const dup = tx
			.select({ id: profileClaims.id })
			.from(profileClaims)
			.where(and(eq(profileClaims.userId, userId), eq(profileClaims.personId, input.personId), eq(profileClaims.status, 'pending')))
			.get();
		if (dup) return { ok: false, error: 'DUPLICATE' };
		// Advisory only: a score, however high, never approves anything (AT-21).
		const score =
			input.proofMethod === 'matching'
				? matchScore(p, { firstName: input.claimedFirstName, lastName: input.claimedLastName, birthDate: input.claimedBirthDate, birthPlace: input.claimedBirthPlace })
				: null;
		const claimId = randomUUID();
		tx.insert(profileClaims)
			.values({
				id: claimId,
				userId,
				personId: input.personId,
				treeId: input.treeId,
				proofMethod: input.proofMethod,
				claimedFirstName: input.claimedFirstName ?? null,
				claimedLastName: input.claimedLastName ?? null,
				claimedBirthDate: input.claimedBirthDate ?? null,
				claimedBirthPlace: input.claimedBirthPlace ?? null,
				claimedRelation: input.claimedRelation ?? null,
				matchScore: score,
				status: 'pending',
				createdAt: now.toISOString()
			})
			.run();
		// The tree owner approves claims, so their own claim is applied at once: no review of themselves.
		const owner = tx.select({ id: treeMembers.id }).from(treeMembers).where(and(eq(treeMembers.treeId, input.treeId), eq(treeMembers.userId, userId), eq(treeMembers.role, 'owner'), eq(treeMembers.status, 'active'))).get();
		if (owner) {
			const r = applyClaim(tx, { userId, personId: input.personId, treeId: input.treeId, claimId, proof: input.proofMethod, status: 'approved', reviewerId: userId }, now.toISOString());
			if (!r.claimed) return { ok: false, error: r.reason ?? 'ALREADY_CLAIMED' };
			return { ok: true, claimId, matchScore: score, approved: true };
		}
		const who = tx.select({ n: users.displayName }).from(users).where(eq(users.id, userId)).get()?.n ?? 'Someone';
		notifyReviewers(tx, input.treeId, { actorId: userId, personId: input.personId, type: 'claim', title: `${who} claims ${fullName(p)}`, linkUrl: `/trees/${input.treeId}/claims` }, userId);
		return { ok: true, claimId, matchScore: score };
	});
}

export function listClaims(db: Db, treeId: string, status = 'pending') {
	return db
		.select({
			id: profileClaims.id,
			userId: profileClaims.userId,
			claimant: users.displayName,
			personId: profileClaims.personId,
			personName: sql<string>`trim(${persons.firstName} || ' ' || coalesce(${persons.lastName}, ''))`,
			proofMethod: profileClaims.proofMethod,
			matchScore: profileClaims.matchScore,
			claimedFirstName: profileClaims.claimedFirstName,
			claimedLastName: profileClaims.claimedLastName,
			claimedBirthDate: profileClaims.claimedBirthDate,
			claimedBirthPlace: profileClaims.claimedBirthPlace,
			claimedRelation: profileClaims.claimedRelation,
			status: profileClaims.status,
			createdAt: profileClaims.createdAt
		})
		.from(profileClaims)
		.leftJoin(users, eq(users.id, profileClaims.userId))
		.leftJoin(persons, eq(persons.id, profileClaims.personId))
		.where(and(eq(profileClaims.treeId, treeId), eq(profileClaims.status, status)))
		.orderBy(desc(profileClaims.createdAt))
		.all();
}

export interface ReviewInput {
	decision: 'approve' | 'reject';
	note?: string;
	linkedRelationType?: 'parent' | 'child' | 'spouse' | 'sibling';
	linkedToPersonId?: string;
}

export type ReviewClaimResult =
	| { ok: true; status: 'approved' | 'rejected' }
	| { ok: false; error: 'NOT_FOUND' | 'NOT_PENDING' | 'ALREADY_CLAIMED' | 'ALREADY_LINKED' | 'LINK_FAILED' };

export function reviewClaim(h: Handles, reviewerId: string, claimId: string, input: ReviewInput, now = new Date()): ReviewClaimResult {
	try {
		return writeTx(h.db, (tx): ReviewClaimResult => {
			const th: Handles = { raw: h.raw, db: tx };
			const c = tx.select().from(profileClaims).where(eq(profileClaims.id, claimId)).get();
			if (!c) return { ok: false, error: 'NOT_FOUND' };
			if (c.status !== 'pending') return { ok: false, error: 'NOT_PENDING' };
			const stamp = now.toISOString();
			const tell = (title: string) =>
				notify(tx, { userId: c.userId, treeId: c.treeId, actorId: reviewerId, personId: c.personId, type: 'claim_review', title, linkUrl: `/persons/${c.personId}` }, now);
			if (input.decision === 'reject') {
				tx.update(profileClaims).set({ status: 'rejected', reviewedBy: reviewerId, reviewedAt: stamp, reviewNote: input.note ?? null }).where(eq(profileClaims.id, claimId)).run();
				tell('Your claim was declined');
				return { ok: true, status: 'rejected' };
			}
			const r = applyClaim(tx, { userId: c.userId, personId: c.personId, treeId: c.treeId, claimId, proof: c.proofMethod as 'verification' | 'matching' | 'manual', status: 'approved', reviewerId }, stamp);
			if (!r.claimed) {
				tell('Your claim could not be approved');
				return { ok: false, error: r.reason! };
			}
			if (input.linkedRelationType && input.linkedToPersonId) {
				tx.update(profileClaims).set({ linkedRelationType: input.linkedRelationType, linkedToPersonId: input.linkedToPersonId, reviewNote: input.note ?? null }).where(eq(profileClaims.id, claimId)).run();
				const rel = input.linkedRelationType;
				const [a, b, type]: [string, string, LinkType] =
					rel === 'parent' ? [c.personId, input.linkedToPersonId, 'parent'] : rel === 'child' ? [input.linkedToPersonId, c.personId, 'parent'] : [c.personId, input.linkedToPersonId, rel];
				const link = createLink(th, reviewerId, c.treeId, { person1Id: a, person2Id: b, type });
				if ('error' in link) throw new Abort('LINK_FAILED');
			} else if (input.note) {
				tx.update(profileClaims).set({ reviewNote: input.note }).where(eq(profileClaims.id, claimId)).run();
			}
			tell('Your claim was approved');
			return { ok: true, status: 'approved' };
		});
	} catch (e) {
		if (e instanceof Abort) return { ok: false, error: 'LINK_FAILED' };
		throw e;
	}
}
