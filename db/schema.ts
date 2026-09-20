import {sqliteTable,text,integer,real,index,primaryKey} from 'drizzle-orm/sqlite-core';
export const runs=sqliteTable('strategy_runs',{id:text('id').primaryKey(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),status:text('status').notNull(),source:text('source').notNull(),stage:integer('stage').notNull().default(0),offset:integer('offset').notNull().default(0),processed:integer('processed').notNull().default(0),total:integer('total').notNull().default(0),universeTotal:integer('universe_total').notNull().default(0),screenedOut:integer('screened_out').notNull().default(0),failed:integer('failed').notNull().default(0),quoteCoverage:integer('quote_coverage').notNull().default(0),secRequests:integer('sec_requests').notNull().default(0),secSuccess:integer('sec_success').notNull().default(0),secFailed:integer('sec_failed').notNull().default(0),fundamentalCoverage:integer('fundamental_coverage').notNull().default(0),error:text('error'),universe:text('universe'),strategyHash:text('strategy_hash').notNull(),leaseUntil:integer('lease_until').notNull().default(0),retryQueue:text('retry_queue').notNull().default('[]'),notificationSentAt:text('notification_sent_at')});
export const snapshots=sqliteTable('fundamental_snapshots',{id:text('id').primaryKey(),runId:text('run_id').notNull().references(()=>runs.id),symbol:text('symbol').notNull(),asOf:text('as_of').notNull(),payload:text('payload').notNull(),evaluation:text('evaluation').notNull()},t=>[index('snapshot_run_idx').on(t.runId),index('snapshot_symbol_date_idx').on(t.symbol,t.asOf)]);
export const favorites=sqliteTable('watchlist',{symbol:text('symbol').primaryKey(),createdAt:text('created_at').notNull()});
export const personalFavorites=sqliteTable('personal_watchlist',{owner:text('owner').notNull(),symbol:text('symbol').notNull(),createdAt:text('created_at').notNull(),payload:text('payload').notNull()},t=>[primaryKey({columns:[t.owner,t.symbol]})]);
export const cache=sqliteTable('raw_cache',{key:text('key').primaryKey(),source:text('source').notNull(),retrievedAt:text('retrieved_at').notNull(),payload:text('payload').notNull()});
export const diagnostics=sqliteTable('diag',{id:text('id').primaryKey(),runId:text('run_id'),stage:text('stage').notNull(),createdAt:text('created_at').notNull(),message:text('message').notNull()});
export const experiments=sqliteTable('experiment_registry',{id:text('id').primaryKey(),hypothesis:text('hypothesis').notNull(),parameters:text('parameters').notNull(),createdAt:text('created_at').notNull(),datasetVersion:text('dataset_version').notNull(),result:text('result'),pValue:real('p_value'),adjustedP:real('adjusted_p'),status:text('status').notNull()});
export const holdouts=sqliteTable('holdout_sets',{firmId:text('firm_id').primaryKey(),membership:text('membership').notNull(),saltHash:text('salt_hash').notNull(),consumedAt:text('consumed_at')});
export const backtests=sqliteTable('backtest_runs',{id:text('id').primaryKey(),createdAt:text('created_at').notNull(),strategyHash:text('strategy_hash').notNull(),datasetVersion:text('dataset_version').notNull(),parameters:text('parameters').notNull(),metrics:text('metrics').notNull()});
export const pushSubscriptions=sqliteTable('push_subscriptions',{endpoint:text('endpoint').primaryKey(),owner:text('owner').notNull().default(''),subscription:text('subscription').notNull(),createdAt:text('created_at').notNull(),lastSuccessAt:text('last_success_at'),failureCount:integer('failure_count').notNull().default(0)});
export const bulkFundamentals=sqliteTable('bulk_fundamentals',{runId:text('run_id').notNull(),cik:integer('cik').notNull(),payload:text('payload').notNull()});
export const portfolioTransactions=sqliteTable('portfolio_transactions',{
 id:text('id').primaryKey(),
 owner:text('owner').notNull(),
 symbol:text('symbol').notNull(),
 companyName:text('company_name').notNull(),
 side:text('side').notNull(),
 quantity:real('quantity').notNull(),
 price:real('price').notNull(),
 fees:real('fees').notNull().default(0),
 tradeDate:text('trade_date').notNull(),
 note:text('note').notNull().default(''),
 metadata:text('metadata').notNull().default('{}'),
 createdAt:text('created_at').notNull(),
 updatedAt:text('updated_at').notNull(),
},t=>[
 index('idx_portfolio_owner_date').on(t.owner,t.tradeDate,t.id),
 index('idx_portfolio_owner_symbol_date').on(t.owner,t.symbol,t.tradeDate,t.id),
]);
export const portfolioRevisions=sqliteTable('portfolio_revisions',{
 owner:text('owner').primaryKey(),
 revision:integer('revision').notNull().default(0),
});
