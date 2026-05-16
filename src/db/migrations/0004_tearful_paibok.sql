CREATE TABLE `entity_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`alias` text NOT NULL,
	`canonical_node_id` text NOT NULL,
	`source` text DEFAULT 'auto_detected' NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_entity_aliases_lookup` ON `entity_aliases` (`workspace_id`,`alias`);--> statement-breakpoint
CREATE INDEX `idx_entity_aliases_canonical` ON `entity_aliases` (`workspace_id`,`canonical_node_id`);--> statement-breakpoint
CREATE TABLE `graph_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`weight` real DEFAULT 0.5 NOT NULL,
	`computed_by` text NOT NULL,
	`evidence` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_graph_edges_unique` ON `graph_edges` (`workspace_id`,`source_node_id`,`target_node_id`,`relation_type`);--> statement-breakpoint
CREATE INDEX `idx_edges_source_type_weight` ON `graph_edges` (`workspace_id`,`source_node_id`,`relation_type`,`weight`);--> statement-breakpoint
CREATE INDEX `idx_edges_target_type_weight` ON `graph_edges` (`workspace_id`,`target_node_id`,`relation_type`,`weight`);--> statement-breakpoint
CREATE TABLE `graph_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`node_type` text NOT NULL,
	`business_id` text NOT NULL,
	`canonical_key` text,
	`label` text NOT NULL,
	`properties` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_graph_nodes_unique` ON `graph_nodes` (`workspace_id`,`node_type`,`business_id`);--> statement-breakpoint
CREATE INDEX `idx_graph_nodes_workspace_type` ON `graph_nodes` (`workspace_id`,`node_type`);--> statement-breakpoint
ALTER TABLE `videos` ADD `graph_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `graph_error` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `graph_built_at` integer;