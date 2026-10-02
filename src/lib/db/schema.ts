import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	passwordHash: text('passwordHash'),
	displayName: text('displayName').notNull(),
	avatarUrl: text('avatarUrl'),
	emailVerifiedAt: text('emailVerifiedAt'),
	themePref: text('themePref').notNull().default('system'),
	dateDisplayPref: text('dateDisplayPref').notNull().default('AD'),
	notifyPrefs: text('notifyPrefs'),
	createdAt: text('createdAt').notNull(),
	deletedAt: text('deletedAt')
});

export const oauthAccounts = sqliteTable(
	'oauthAccounts',
	{
		id: text('id').primaryKey(),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		providerUserId: text('providerUserId').notNull()
	},
	(t) => [uniqueIndex('ux_oauth_provider_user').on(t.provider, t.providerUserId)]
);

export const trees = sqliteTable('trees', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	ownerId: text('ownerId').references(() => users.id),
	coverImage: text('coverImage'),
	isPublic: integer('isPublic').notNull().default(0),
	allowCrossTree: integer('allowCrossTree').notNull().default(1),
	createdAt: text('createdAt').notNull(),
	updatedAt: text('updatedAt').notNull()
});

export const persons = sqliteTable(
	'persons',
	{
		id: text('id').primaryKey(),
		treeId: text('treeId')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		userId: text('userId').references(() => users.id, { onDelete: 'set null' }),
		claimedAt: text('claimedAt'),
		claimedVia: text('claimedVia'),
		firstName: text('firstName').notNull(),
		middleName: text('middleName'),
		lastName: text('lastName'),
		maidenName: text('maidenName'),
		birthDate: text('birthDate'),
		birthDateCal: text('birthDateCal').notNull().default('AD'),
		birthDateNorm: text('birthDateNorm'),
		deathDate: text('deathDate'),
		deathDateCal: text('deathDateCal').notNull().default('AD'),
		deathDateNorm: text('deathDateNorm'),
		gender: text('gender').notNull().default('U'),
		birthPlace: text('birthPlace'),
		deathPlace: text('deathPlace'),
		photoUrl: text('photoUrl'),
		bio: text('bio'),
		isLiving: integer('isLiving'),
		createdBy: text('createdBy'),
		lastEditedBy: text('lastEditedBy'),
		version: integer('version').notNull().default(1),
		createdAt: text('createdAt').notNull(),
		updatedAt: text('updatedAt').notNull(),
		deletedAt: text('deletedAt')
	},
	(t) => [
		index('ix_persons_tree_name').on(t.treeId, t.lastName, t.firstName),
		index('ix_persons_tree_deleted').on(t.treeId, t.deletedAt),
		uniqueIndex('ux_person_user_per_tree').on(t.treeId, t.userId).where(sql`${t.userId} IS NOT NULL`)
	]
);

export const treeMembers = sqliteTable(
	'treeMembers',
	{
		id: text('id').primaryKey(),
		treeId: text('treeId')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		personId: text('personId').references(() => persons.id, { onDelete: 'set null' }),
		role: text('role').notNull(),
		status: text('status').notNull(),
		invitedBy: text('invitedBy'),
		joinedAt: text('joinedAt'),
		joinedViaCode: text('joinedViaCode'),
		joinedViaType: text('joinedViaType')
	},
	(t) => [
		uniqueIndex('ux_tree_user').on(t.treeId, t.userId),
		uniqueIndex('ux_one_owner_per_tree').on(t.treeId).where(sql`${t.role} = 'owner'`)
	]
);

export const relationships = sqliteTable(
	'relationships',
	{
		id: text('id').primaryKey(),
		treeId: text('treeId')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		person1Id: text('person1Id')
			.notNull()
			.references(() => persons.id, { onDelete: 'cascade' }),
		person2Id: text('person2Id')
			.notNull()
			.references(() => persons.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		startDate: text('startDate'),
		endDate: text('endDate'),
		notes: text('notes'),
		createdBy: text('createdBy'),
		createdAt: text('createdAt').notNull()
	},
	(t) => [
		uniqueIndex('ux_rel_triple').on(t.person1Id, t.person2Id, t.type),
		index('ix_rel_tree').on(t.treeId),
		index('ix_rel_p1').on(t.person1Id),
		index('ix_rel_p2').on(t.person2Id),
		check('ck_rel_distinct', sql`${t.person1Id} <> ${t.person2Id}`)
	]
);

export const joinCodes = sqliteTable(
	'joinCodes',
	{
	id: text('id').primaryKey(),
	code: text('code').notNull().unique(),
	type: text('type').notNull(),
	treeId: text('treeId')
		.notNull()
		.references(() => trees.id, { onDelete: 'cascade' }),
	createdBy: text('createdBy'),
	linkedPersonId: text('linkedPersonId').references(() => persons.id, { onDelete: 'cascade' }),
	linkedRelationType: text('linkedRelationType'),
	role: text('role').notNull().default('contributor'),
	expiresAt: text('expiresAt'),
	maxUses: integer('maxUses'),
	currentUses: integer('currentUses').notNull().default(0),
	isActive: integer('isActive').notNull().default(1),
	createdAt: text('createdAt').notNull()
	},
	(t) => [
		uniqueIndex('ux_family_code_per_tree').on(t.treeId).where(sql`${t.type} = 'family' AND ${t.isActive} = 1`)
	]
);

export const profileClaims = sqliteTable(
	'profileClaims',
	{
	id: text('id').primaryKey(),
	userId: text('userId').notNull(),
	personId: text('personId').notNull(),
	treeId: text('treeId').notNull(),
	proofMethod: text('proofMethod').notNull(),
	claimedFirstName: text('claimedFirstName'),
	claimedLastName: text('claimedLastName'),
	claimedBirthDate: text('claimedBirthDate'),
	claimedBirthPlace: text('claimedBirthPlace'),
	claimedRelation: text('claimedRelation'),
	matchScore: real('matchScore'),
	status: text('status').notNull(),
	reviewedBy: text('reviewedBy'),
	reviewedAt: text('reviewedAt'),
	reviewNote: text('reviewNote'),
	linkedRelationType: text('linkedRelationType'),
	linkedToPersonId: text('linkedToPersonId'),
	createdAt: text('createdAt').notNull()
	},
	(t) => [
		uniqueIndex('ux_claim_pending').on(t.userId, t.personId).where(sql`${t.status} = 'pending'`)
	]
);

export const verificationQuestions = sqliteTable('verificationQuestions', {
	id: text('id').primaryKey(),
	personId: text('personId')
		.notNull()
		.references(() => persons.id, { onDelete: 'cascade' }),
	treeId: text('treeId')
		.notNull()
		.references(() => trees.id, { onDelete: 'cascade' }),
	createdBy: text('createdBy'),
	question: text('question').notNull(),
	answerHash: text('answerHash').notNull(),
	createdAt: text('createdAt').notNull()
});

export const claimAttempts = sqliteTable(
	'claimAttempts',
	{
		userId: text('userId').notNull(),
		personId: text('personId').notNull(),
		count: integer('count').notNull().default(0),
		windowStart: text('windowStart').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.personId] })]
);

export const changeHistory = sqliteTable(
	'changeHistory',
	{
		id: text('id').primaryKey(),
		treeId: text('treeId')
			.notNull()
			.references(() => trees.id, { onDelete: 'cascade' }),
		entityType: text('entityType').notNull(),
		entityId: text('entityId').notNull(),
		changedBy: text('changedBy').references(() => users.id),
		changedAt: text('changedAt').notNull(),
		action: text('action').notNull(),
		field: text('field'),
		oldValue: text('oldValue'),
		newValue: text('newValue'),
		snapshot: text('snapshot'),
		batchId: text('batchId'),
		note: text('note'),
		revertedFrom: text('revertedFrom'),
		isReverted: integer('isReverted').notNull().default(0),
		revertedBy: text('revertedBy'),
		revertedAt: text('revertedAt')
	},
	(t) => [
		index('ix_hist_entity').on(t.entityType, t.entityId),
		index('ix_hist_tree').on(t.treeId),
		index('ix_hist_by').on(t.changedBy),
		index('ix_hist_at').on(t.changedAt),
		index('ix_hist_batch').on(t.batchId)
	]
);

export const events = sqliteTable('events', {
	id: text('id').primaryKey(),
	personId: text('personId')
		.notNull()
		.references(() => persons.id, { onDelete: 'cascade' }),
	treeId: text('treeId')
		.notNull()
		.references(() => trees.id, { onDelete: 'cascade' }),
	type: text('type').notNull(),
	date: text('date'),
	dateCal: text('dateCal').notNull().default('AD'),
	dateNorm: text('dateNorm'),
	place: text('place'),
	description: text('description'),
	createdAt: text('createdAt').notNull()
});

export const media = sqliteTable('media', {
	id: text('id').primaryKey(),
	personId: text('personId').references(() => persons.id, { onDelete: 'cascade' }),
	treeId: text('treeId')
		.notNull()
		.references(() => trees.id, { onDelete: 'cascade' }),
	uploadedBy: text('uploadedBy'),
	storagePath: text('storagePath').notNull(),
	thumbPath: text('thumbPath'),
	mime: text('mime').notNull(),
	sizeBytes: integer('sizeBytes').notNull(),
	type: text('type').notNull().default('photo'),
	caption: text('caption'),
	createdAt: text('createdAt').notNull()
});

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tokenHash: text('tokenHash').notNull().unique(),
		expiresAt: text('expiresAt').notNull(),
		createdAt: text('createdAt').notNull(),
		lastSeenAt: text('lastSeenAt').notNull(),
		userAgent: text('userAgent')
	},
	(t) => [index('ix_sessions_user').on(t.userId), index('ix_sessions_token').on(t.tokenHash)]
);

export const notifications = sqliteTable(
	'notifications',
	{
		id: text('id').primaryKey(),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		treeId: text('treeId').references(() => trees.id, { onDelete: 'cascade' }),
		actorId: text('actorId').references(() => users.id, { onDelete: 'set null' }),
		personId: text('personId'),
		type: text('type').notNull(),
		title: text('title').notNull(),
		body: text('body'),
		linkUrl: text('linkUrl'),
		isRead: integer('isRead').notNull().default(0),
		createdAt: text('createdAt').notNull()
	},
	(t) => [
		index('ix_notif_user_read').on(t.userId, t.isRead, t.createdAt),
		index('ix_notif_coalesce').on(t.userId, t.type, t.personId, t.actorId, t.createdAt)
	]
);

export const passwordResetTokens = sqliteTable('passwordResetTokens', {
	id: text('id').primaryKey(),
	userId: text('userId')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	tokenHash: text('tokenHash').notNull().unique(),
	expiresAt: text('expiresAt').notNull(),
	usedAt: text('usedAt'),
	createdAt: text('createdAt').notNull()
});

export const emailVerificationTokens = sqliteTable('emailVerificationTokens', {
	id: text('id').primaryKey(),
	userId: text('userId')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	tokenHash: text('tokenHash').notNull().unique(),
	expiresAt: text('expiresAt').notNull(),
	usedAt: text('usedAt'),
	createdAt: text('createdAt').notNull()
});

export const combinedViews = sqliteTable('combinedViews', {
	userId: text('userId')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	share: text('share').notNull().default('me'),
	depth: integer('depth'),
	updatedAt: text('updatedAt').notNull()
});

export const combinedViewViewers = sqliteTable(
	'combinedViewViewers',
	{
		ownerId: text('ownerId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		viewerId: text('viewerId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.ownerId, t.viewerId] })]
);

export const combinedViewLog = sqliteTable(
	'combinedViewLog',
	{
		id: text('id').primaryKey(),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		summary: text('summary').notNull(),
		createdAt: text('createdAt').notNull()
	},
	(t) => [index('ix_cvlog_user').on(t.userId, t.createdAt)]
);

/** A combined-view owner's verdict that two people in different trees are (not) the same. */
export const personMatches = sqliteTable(
	'personMatches',
	{
		ownerId: text('ownerId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		personAId: text('personAId')
			.notNull()
			.references(() => persons.id, { onDelete: 'cascade' }),
		personBId: text('personBId')
			.notNull()
			.references(() => persons.id, { onDelete: 'cascade' }),
		same: integer('same').notNull(),
		createdAt: text('createdAt').notNull()
	},
	(t) => [primaryKey({ columns: [t.ownerId, t.personAId, t.personBId] })]
);
