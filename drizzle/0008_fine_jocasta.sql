CREATE TABLE `recovery_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`claimed_at` text,
	`claimed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_bundles_token_hash_unique` ON `recovery_bundles` (`token_hash`);