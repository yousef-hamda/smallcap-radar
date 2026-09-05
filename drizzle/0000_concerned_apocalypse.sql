CREATE TABLE `backtest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`strategy_hash` text NOT NULL,
	`dataset_version` text NOT NULL,
	`parameters` text NOT NULL,
	`metrics` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raw_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diag` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`stage` text NOT NULL,
	`created_at` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experiment_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`hypothesis` text NOT NULL,
	`parameters` text NOT NULL,
	`created_at` text NOT NULL,
	`dataset_version` text NOT NULL,
	`result` text,
	`p_value` real,
	`adjusted_p` real,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`symbol` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holdout_sets` (
	`firm_id` text PRIMARY KEY NOT NULL,
	`membership` text NOT NULL,
	`salt_hash` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE TABLE `strategy_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`offset` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`universe` text,
	`strategy_hash` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fundamental_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`as_of` text NOT NULL,
	`payload` text NOT NULL,
	`evaluation` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `strategy_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `snapshot_run_idx` ON `fundamental_snapshots` (`run_id`);