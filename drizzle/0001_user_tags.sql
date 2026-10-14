CREATE TABLE `user_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_tags_unique` ON `user_tags` (`user_id`,`name`);
--> statement-breakpoint
CREATE INDEX `idx_user_tags_user` ON `user_tags` (`user_id`,`created_at`);
