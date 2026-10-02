-- Combined family view (D-035): a person claimed in several trees sees them joined at themselves.
ALTER TABLE `trees` ADD `allowCrossTree` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE `combinedViews` (
	`userId` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`share` text DEFAULT 'me' NOT NULL CHECK (`share` IN ('me', 'chosen', 'members')),
	`depth` integer,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `combinedViewViewers` (
	`ownerId` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`viewerId` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	PRIMARY KEY (`ownerId`, `viewerId`)
);
