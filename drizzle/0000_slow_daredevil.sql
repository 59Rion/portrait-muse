CREATE TABLE `inspiration_images` (
	`id` text PRIMARY KEY NOT NULL,
	`inspiration_id` text NOT NULL,
	`user_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_images_inspiration` ON `inspiration_images` (`inspiration_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_images_user` ON `inspiration_images` (`user_id`);--> statement-breakpoint
CREATE TABLE `inspirations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_url` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`primary_tag` text DEFAULT '人像' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`cover_key` text,
	`cover_type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inspirations_user_created` ON `inspirations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inspirations_user_source` ON `inspirations` (`user_id`,`source_url`);--> statement-breakpoint
CREATE TABLE `project_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`inspiration_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_project_items_project` ON `project_items` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_items_unique` ON `project_items` (`project_id`,`inspiration_id`);--> statement-breakpoint
CREATE TABLE `shoot_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_user_created` ON `shoot_projects` (`user_id`,`created_at`);