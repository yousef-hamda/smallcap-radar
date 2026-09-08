CREATE TABLE `personal_watchlist` (
 `owner` text NOT NULL,
 `symbol` text NOT NULL,
 `created_at` text NOT NULL,
 `payload` text NOT NULL,
 PRIMARY KEY(`owner`, `symbol`)
);
