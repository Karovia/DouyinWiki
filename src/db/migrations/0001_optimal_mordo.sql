ALTER TABLE `ingestion_jobs` ADD `next_retry_at` integer;--> statement-breakpoint
ALTER TABLE `ingestion_jobs` ADD `last_error_at` integer;--> statement-breakpoint
ALTER TABLE `ingestion_jobs` ADD `attempted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_workspace_url` ON `ingestion_jobs` (`workspace_id`,`normalized_url_hash`);