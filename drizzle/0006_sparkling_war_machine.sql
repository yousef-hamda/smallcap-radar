CREATE TABLE `portfolio_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`symbol` text NOT NULL,
	`company_name` text NOT NULL,
	`side` text NOT NULL,
	`quantity` real NOT NULL,
	`price` real NOT NULL,
	`fees` real DEFAULT 0 NOT NULL,
	`trade_date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_owner_date` ON `portfolio_transactions` (`owner`,`trade_date`,`id`);--> statement-breakpoint
CREATE INDEX `idx_portfolio_owner_symbol_date` ON `portfolio_transactions` (`owner`,`symbol`,`trade_date`,`id`);