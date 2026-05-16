CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`content_type` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`start_time_ms` integer,
	`end_time_ms` integer,
	`created_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chunks_video_type_idx` ON `chunks` (`video_id`,`content_type`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`chunk_id` text NOT NULL,
	`video_id` text NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`model_name` text NOT NULL,
	`dimension` integer NOT NULL,
	`embedding` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_embeddings_chunk_model` ON `embeddings` (`chunk_id`,`model_name`);--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`workspace_id` text DEFAULT 'default' NOT NULL,
	`source` text NOT NULL,
	`model_name` text,
	`language` text DEFAULT 'zh',
	`segments` text,
	`raw_text` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transcripts_video_source` ON `transcripts` (`video_id`,`source`);