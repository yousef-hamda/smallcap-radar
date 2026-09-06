CREATE TABLE IF NOT EXISTS `bulk_fundamentals` (
	`run_id` text NOT NULL,
	`cik` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`run_id`, `cik`)
);
--> statement-breakpoint
ALTER TABLE `strategy_runs` ADD `quote_coverage` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `strategy_runs` ADD `sec_requests` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `strategy_runs` ADD `sec_success` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `strategy_runs` ADD `sec_failed` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `strategy_runs` ADD `fundamental_coverage` integer DEFAULT 0 NOT NULL;
