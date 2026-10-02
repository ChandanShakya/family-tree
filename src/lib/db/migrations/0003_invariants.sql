CREATE UNIQUE INDEX `ux_family_code_per_tree` ON `joinCodes` (`treeId`) WHERE "joinCodes"."type" = 'family' AND "joinCodes"."isActive" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_person_user_per_tree` ON `persons` (`treeId`,`userId`) WHERE "persons"."userId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_claim_pending` ON `profileClaims` (`userId`,`personId`) WHERE "profileClaims"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX `ux_one_owner_per_tree` ON `treeMembers` (`treeId`) WHERE "treeMembers"."role" = 'owner';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_relationships` (
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
	FOREIGN KEY (`person2Id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_rel_distinct" CHECK("__new_relationships"."person1Id" <> "__new_relationships"."person2Id")
);
--> statement-breakpoint
INSERT INTO `__new_relationships`("id", "treeId", "person1Id", "person2Id", "type", "startDate", "endDate", "notes", "createdBy", "createdAt") SELECT "id", "treeId", "person1Id", "person2Id", "type", "startDate", "endDate", "notes", "createdBy", "createdAt" FROM `relationships`;--> statement-breakpoint
DROP TABLE `relationships`;--> statement-breakpoint
ALTER TABLE `__new_relationships` RENAME TO `relationships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_rel_triple` ON `relationships` (`person1Id`,`person2Id`,`type`);--> statement-breakpoint
CREATE INDEX `ix_rel_tree` ON `relationships` (`treeId`);--> statement-breakpoint
CREATE INDEX `ix_rel_p1` ON `relationships` (`person1Id`);--> statement-breakpoint
CREATE INDEX `ix_rel_p2` ON `relationships` (`person2Id`);