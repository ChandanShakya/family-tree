-- Combined view follow-ups (D-035): the owner's sharing history and confirmed same-person matches.
CREATE TABLE `combinedViewLog` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`summary` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_cvlog_user` ON `combinedViewLog` (`userId`, `createdAt`);
--> statement-breakpoint
CREATE TABLE `personMatches` (
	`ownerId` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`personAId` text NOT NULL REFERENCES `persons`(`id`) ON DELETE cascade,
	`personBId` text NOT NULL REFERENCES `persons`(`id`) ON DELETE cascade,
	`same` integer NOT NULL,
	`createdAt` text NOT NULL,
	PRIMARY KEY (`ownerId`, `personAId`, `personBId`),
	CHECK (`personAId` < `personBId`)
);
