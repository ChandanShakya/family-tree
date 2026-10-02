CREATE TABLE `changeHistory` (
	`id` text PRIMARY KEY NOT NULL,
	`treeId` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`changedBy` text,
	`changedAt` text NOT NULL,
	`action` text NOT NULL,
	`field` text,
	`oldValue` text,
	`newValue` text,
	`snapshot` text,
	`batchId` text,
	`note` text,
	`revertedFrom` text,
	`isReverted` integer DEFAULT 0 NOT NULL,
	`revertedBy` text,
	`revertedAt` text,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_hist_entity` ON `changeHistory` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `ix_hist_tree` ON `changeHistory` (`treeId`);--> statement-breakpoint
CREATE INDEX `ix_hist_by` ON `changeHistory` (`changedBy`);--> statement-breakpoint
CREATE INDEX `ix_hist_at` ON `changeHistory` (`changedAt`);--> statement-breakpoint
CREATE INDEX `ix_hist_batch` ON `changeHistory` (`batchId`);--> statement-breakpoint
CREATE TABLE `claimAttempts` (
	`userId` text NOT NULL,
	`personId` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`windowStart` text NOT NULL,
	PRIMARY KEY(`userId`, `personId`)
);
--> statement-breakpoint
CREATE TABLE `emailVerificationTokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` text NOT NULL,
	`usedAt` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emailVerificationTokens_tokenHash_unique` ON `emailVerificationTokens` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`personId` text NOT NULL,
	`treeId` text NOT NULL,
	`type` text NOT NULL,
	`date` text,
	`dateCal` text DEFAULT 'AD' NOT NULL,
	`dateNorm` text,
	`place` text,
	`description` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`personId`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `joinCodes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`treeId` text NOT NULL,
	`createdBy` text,
	`linkedPersonId` text,
	`linkedRelationType` text,
	`role` text DEFAULT 'contributor' NOT NULL,
	`expiresAt` text,
	`maxUses` integer,
	`currentUses` integer DEFAULT 0 NOT NULL,
	`isActive` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linkedPersonId`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `joinCodes_code_unique` ON `joinCodes` (`code`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`personId` text,
	`treeId` text NOT NULL,
	`uploadedBy` text,
	`storagePath` text NOT NULL,
	`thumbPath` text,
	`mime` text NOT NULL,
	`sizeBytes` integer NOT NULL,
	`type` text DEFAULT 'photo' NOT NULL,
	`caption` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`personId`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`treeId` text,
	`actorId` text,
	`personId` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`linkUrl` text,
	`isRead` integer DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_notif_user_read` ON `notifications` (`userId`,`isRead`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ix_notif_coalesce` ON `notifications` (`userId`,`type`,`personId`,`actorId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `oauthAccounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`providerUserId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_oauth_provider_user` ON `oauthAccounts` (`provider`,`providerUserId`);--> statement-breakpoint
CREATE TABLE `passwordResetTokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` text NOT NULL,
	`usedAt` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passwordResetTokens_tokenHash_unique` ON `passwordResetTokens` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`treeId` text NOT NULL,
	`userId` text,
	`claimedAt` text,
	`claimedVia` text,
	`firstName` text NOT NULL,
	`lastName` text,
	`maidenName` text,
	`birthDate` text,
	`birthDateCal` text DEFAULT 'AD' NOT NULL,
	`birthDateNorm` text,
	`deathDate` text,
	`deathDateCal` text DEFAULT 'AD' NOT NULL,
	`deathDateNorm` text,
	`gender` text DEFAULT 'U' NOT NULL,
	`birthPlace` text,
	`deathPlace` text,
	`photoUrl` text,
	`bio` text,
	`isLiving` integer,
	`createdBy` text,
	`lastEditedBy` text,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`deletedAt` text,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_persons_tree_name` ON `persons` (`treeId`,`lastName`,`firstName`);--> statement-breakpoint
CREATE INDEX `ix_persons_tree_deleted` ON `persons` (`treeId`,`deletedAt`);--> statement-breakpoint
CREATE TABLE `profileClaims` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`personId` text NOT NULL,
	`treeId` text NOT NULL,
	`proofMethod` text NOT NULL,
	`claimedFirstName` text,
	`claimedLastName` text,
	`claimedBirthDate` text,
	`claimedBirthPlace` text,
	`claimedRelation` text,
	`matchScore` real,
	`status` text NOT NULL,
	`reviewedBy` text,
	`reviewedAt` text,
	`reviewNote` text,
	`linkedRelationType` text,
	`linkedToPersonId` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`treeId` text NOT NULL,
	`person1Id` text NOT NULL,
	`person2Id` text NOT NULL,
	`type` text NOT NULL,
	`startDate` text,
	`endDate` text,
	`notes` text,
	`createdBy` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person1Id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person2Id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_rel_triple` ON `relationships` (`person1Id`,`person2Id`,`type`);--> statement-breakpoint
CREATE INDEX `ix_rel_tree` ON `relationships` (`treeId`);--> statement-breakpoint
CREATE INDEX `ix_rel_p1` ON `relationships` (`person1Id`);--> statement-breakpoint
CREATE INDEX `ix_rel_p2` ON `relationships` (`person2Id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`lastSeenAt` text NOT NULL,
	`userAgent` text,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_tokenHash_unique` ON `sessions` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `ix_sessions_user` ON `sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `ix_sessions_token` ON `sessions` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `treeMembers` (
	`id` text PRIMARY KEY NOT NULL,
	`treeId` text NOT NULL,
	`userId` text NOT NULL,
	`personId` text,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`invitedBy` text,
	`joinedAt` text,
	`joinedViaCode` text,
	`joinedViaType` text,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`personId`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tree_user` ON `treeMembers` (`treeId`,`userId`);--> statement-breakpoint
CREATE TABLE `trees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`ownerId` text,
	`coverImage` text,
	`isPublic` integer DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`passwordHash` text,
	`displayName` text NOT NULL,
	`avatarUrl` text,
	`emailVerifiedAt` text,
	`themePref` text DEFAULT 'system' NOT NULL,
	`dateDisplayPref` text DEFAULT 'AD' NOT NULL,
	`notifyPrefs` text,
	`createdAt` text NOT NULL,
	`deletedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verificationQuestions` (
	`id` text PRIMARY KEY NOT NULL,
	`personId` text NOT NULL,
	`treeId` text NOT NULL,
	`createdBy` text,
	`question` text NOT NULL,
	`answerHash` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`personId`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`treeId`) REFERENCES `trees`(`id`) ON UPDATE no action ON DELETE cascade
);
