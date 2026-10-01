import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('opportunity coverage audit emits bounded measured counts and identifies its data freshness limits', () => {
  const result = spawnSync(process.execPath, ['research/opportunity-data-coverage.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.universe.listedRows, 7675);
  assert.equal(report.listingIdentity.staticBundleRows, report.universe.listedRows);
  assert.equal(report.listingIdentity.staticRowsWithExplicitClassAndSource, 0, 'old bundle must not be presented as source-backed after the live identity adapter ships');
  assert.equal(report.listingIdentity.liveExchangeAudit.includedRows, 7102);
  assert.ok(report.listingIdentity.liveExchangeAudit.explicitCommonRows + report.listingIdentity.liveExchangeAudit.unresolvedRows <= report.listingIdentity.liveExchangeAudit.includedRows);
  assert.match(report.listingIdentity.liveExchangeAudit.scope, /not the coverage of the older static bundle/);
  assert.ok(report.universe.withPositiveCachedPrice <= report.universe.listedRows);
  assert.ok(report.universe.withPositiveCachedMarketCap <= report.universe.listedRows);
  assert.ok(report.secFacts.matchedListedCiks <= report.secFacts.issuerRecords);
  assert.ok(report.secFacts.matchedListingRows >= report.secFacts.matchedListedCiks);
  for (const field of ['revenue', 'netIncome', 'ocf', 'capex', 'shares', 'cash']) {
    const coverage = report.secFacts.fields[field];
    assert.ok(coverage.listingRows >= 0 && coverage.listingRows <= report.universe.listedRows);
  }
  assert.match(report.warning, /predate this measurement date/);
  assert.match(report.warning, /not evidence that listing identity has been backfilled/);
  assert.ok(report.notMeasuredByThisBundle.includes('valuation methods and fair-value scenarios'));
});
