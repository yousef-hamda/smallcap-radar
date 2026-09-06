CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`subscription` text NOT NULL,
	`created_at` text NOT NULL,
	`last_success_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `strategy_runs` ADD `notification_sent_at` text;