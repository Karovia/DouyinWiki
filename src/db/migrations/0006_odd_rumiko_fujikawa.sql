CREATE TABLE `usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`operation` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`estimated_cost` real,
	`metadata` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_usage_logs_workspace` ON `usage_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_type` ON `usage_logs` (`workspace_id`,`resource_type`,`created_at`);