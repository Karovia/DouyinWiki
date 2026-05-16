CREATE TABLE `ingestion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`video_id` text,
	`share_url` text NOT NULL,
	`normalized_url_hash` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`step` text,
	`progress` integer DEFAULT 0,
	`retry_count` integer DEFAULT 0,
	`max_retries` integer DEFAULT 3,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`platform` text DEFAULT 'douyin' NOT NULL,
	`platform_video_id` text,
	`share_url` text NOT NULL,
	`normalized_url_hash` text NOT NULL,
	`title` text,
	`description` text,
	`author_name` text,
	`author_id` text,
	`cover_url` text,
	`duration` integer,
	`tags` text,
	`ai_summary` text,
	`ai_tags` text,
	`view_count` integer,
	`like_count` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_normalized_url_hash_unique` ON `videos` (`normalized_url_hash`);