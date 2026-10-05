CREATE TABLE `opportunity_rank_versions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`rubric_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `opportunity_rankings` (
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`score` real NOT NULL,
	`evaluation_hash` text NOT NULL,
	`rank_position` integer NOT NULL,
	`rubric_hash` text NOT NULL,
	PRIMARY KEY(`run_id`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `opportunity_rank_position_idx` ON `opportunity_rankings` (`run_id`,`rank_position`);--> statement-breakpoint
CREATE TABLE `opportunity_rating_versions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER opportunity_rating_insert AFTER INSERT ON fundamental_snapshots BEGIN
 INSERT INTO opportunity_rating_versions(run_id,revision) VALUES(NEW.run_id,1) ON CONFLICT(run_id) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER opportunity_rating_update AFTER UPDATE ON fundamental_snapshots BEGIN
 INSERT INTO opportunity_rating_versions(run_id,revision) VALUES(NEW.run_id,1) ON CONFLICT(run_id) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER opportunity_rating_delete AFTER DELETE ON fundamental_snapshots BEGIN
 INSERT INTO opportunity_rating_versions(run_id,revision) VALUES(OLD.run_id,1) ON CONFLICT(run_id) DO UPDATE SET revision=revision+1;
END;
