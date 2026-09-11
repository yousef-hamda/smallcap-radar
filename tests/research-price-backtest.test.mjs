import test from 'node:test';
import assert from 'node:assert/strict';
import { completedWeeklyAverage, compareSignals, simulateOutcome } from '../research/free-price-backtest.mjs';

test('completedWeeklyAverage excludes the incomplete signal week', () => {
  const bars = [];
  for (let week = 0; week < 31; week += 1) {
    const monday = new Date(Date.UTC(2024, 0, 1 + week * 7));
    for (let day = 0; day < 5; day += 1) {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + day);
      bars.push({ date: date.toISOString().slice(0, 10), close: 100 + week });
    }
  }
  assert.equal(completedWeeklyAverage(bars, '2024-08-05', 30), 115.5);
});

test('simulateOutcome applies gap fills and stop-first same-bar convention', () => {
  const bars = [
    { date: '2020-01-01', open: 100, high: 100, low: 100, close: 100 },
    { date: '2020-01-02', open: 100, high: 100, low: 100, close: 100 },
    { date: '2020-01-03', open: 45, high: 130, low: 40, close: 105 },
  ];
  const result = simulateOutcome(bars, 0, { target: 0.2, stop: -0.15, expiryMonths: 3 });
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.reason, 'stop');
  assert.equal(result.targetBeforeStop, false);
  assert.equal(result.exit, 45);
});

test('compareSignals is deterministic and measures challenger against baseline and random', () => {
  const signals = Array.from({ length: 6 }, (_, index) => ({
    symbol: `S${index}`,
    index: index * 100,
    signalDate: `201${index}-01-01`,
    reversal: index % 2 === 0,
    outcome: { status: 'OBSERVED', targetBeforeStop: index % 3 !== 0, netReturn: index % 3 !== 0 ? 0.2 : -0.15 },
  }));
  const first = compareSignals(signals, 'test-seed');
  const second = compareSignals(signals, 'test-seed');
  assert.deepEqual(first.metrics, second.metrics);
  assert.equal(first.metrics.challenger.signals, 3);
  assert.equal(first.metrics.challenger.hitRate, 2 / 3);
  assert.equal(first.metrics.random.signals, 3);
});
