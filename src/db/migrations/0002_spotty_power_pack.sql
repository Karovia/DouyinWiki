DROP INDEX `videos_normalized_url_hash_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_videos_workspace_url` ON `videos` (`workspace_id`,`normalized_url_hash`);