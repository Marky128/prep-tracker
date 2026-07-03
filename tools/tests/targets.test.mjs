#!/usr/bin/env node
/* Unit tests for js/targets.js. Run: node tools/tests/targets.test.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../../js/targets.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
}
function close(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || '') + ' ' + a + ' !≈ ' + b); }

test('kcalFromMacros 4/4/9', () => {
  eq(T.kcalFromMacros(316, 196, 45), 2453);
  eq(T.kcalFromMacros(0, 0, 0), 0);
});

test('range ±6%', () => {
  eq(T.range(180, 6), { lo: 169, hi: 191 });
  eq(T.range(2700, 6), { lo: 2538, hi: 2862 });
});

test('judge: band / floor / cap / none', () => {
  eq(T.judge(2600, 2700, 6, 'band'), 'in');
  eq(T.judge(2400, 2700, 6, 'band'), 'under');
  eq(T.judge(2900, 2700, 6, 'band'), 'over');
  eq(T.judge(310, 316, 6, 'floor'), 'in');   // ≥297
  eq(T.judge(280, 316, 6, 'floor'), 'under');
  eq(T.judge(46, 45, 6, 'cap'), 'in');       // ≤48
  eq(T.judge(50, 45, 6, 'cap'), 'over');
  eq(T.judge(9999, 2700, 6, 'none'), 'none');
  eq(T.judge(100, null, 6, 'band'), 'none');
});

test('mifflin: reference values', () => {
  close(T.mifflin({ sex: 'm', weightKg: 85, heightCm: 180, age: 25 }), 1855, 1);
  close(T.mifflin({ sex: 'f', weightKg: 60, heightCm: 165, age: 30 }), 1320.25, 1);
});

test('suggestTargets: macros reconcile to kcal within rounding', () => {
  const s = T.suggestTargets({ sex: 'm', weightKg: 85, heightCm: 180, age: 25, activityId: 'moderate', goalId: 'lose' });
  eq(s.p, 170, 'protein 2g/kg');
  close(T.kcalFromMacros(s.p, s.c, s.f), s.kcal, 12, '4/4/9 self-consistency');
  close(s.tdee, 2875, 5);
  close(s.kcal, 2440, 15);
});

test('unit conversions round-trip', () => {
  close(T.toProfileUnits(187.4, 'lbs', 'kg'), 85.0, 0.05);
  close(T.toProfileUnits(85, 'kg', 'lb'), 187.4, 0.05);
  eq(T.toProfileUnits(85, 'kg', 'kg'), 85);
  eq(T.recordUnitFor('lb'), 'lbs');
  eq(T.recordUnitFor('kg'), 'kg');
});

test('trendSeries: EWMA with gaps carried forward', () => {
  const dates = ['d1', 'd2', 'd3', 'd4', 'd5'];
  const w = new Map([['d1', 200], ['d3', 210], ['d5', 210]]);
  const t = T.trendSeries(dates, w, 0.1);
  eq(t.get('d1'), 200);
  eq(t.get('d2'), 200);          // gap: carried
  eq(t.get('d3'), 201);          // 200 + .1(210-200)
  eq(t.get('d4'), 201);
  close(t.get('d5'), 201.9, 0.001);
});

test('estimateExpenditure: flat weight → TDEE = mean intake', () => {
  const entries = [];
  for (let i = 0; i < 21; i++) {
    entries.push({ date: 'd' + i, kcal: 2500, weight: 180 });
  }
  const r = T.estimateExpenditure(entries, 'lb');
  eq(r.eligible, true);
  eq(r.tdee, 2500);
});

test('estimateExpenditure: losing 0.1 lb/day at 2500 intake → TDEE 2850', () => {
  const entries = [];
  for (let i = 0; i < 21; i++) entries.push({ date: 'd' + i, kcal: 2500, weight: 180 - 0.1 * i });
  const r = T.estimateExpenditure(entries, 'lb');
  eq(r.eligible, true);
  eq(r.tdee, 2850, 'regression slope is exact on linear data');
  eq(r.weeklyChange, -0.7);
});

test('estimateExpenditure: gaining 0.05 kg/day at 3000 → TDEE 2615', () => {
  const entries = [];
  for (let i = 0; i < 21; i++) entries.push({ date: 'd' + i, kcal: 3000, weight: 80 + 0.05 * i });
  const r = T.estimateExpenditure(entries, 'kg');
  eq(r.tdee, 3000 - Math.round(0.05 * 7700), 'surplus subtracted');
});

test('estimateExpenditure: noisy weights around a flat line stay ≈ intake', () => {
  const entries = [];
  for (let i = 0; i < 21; i++) entries.push({ date: 'd' + i, kcal: 2500, weight: 180 + (i % 2 ? 0.6 : -0.6) });
  const r = T.estimateExpenditure(entries, 'lb');
  close(r.tdee, 2500, 60);
});

test('estimateExpenditure: not enough intake days → ineligible with count', () => {
  const entries = [];
  for (let i = 0; i < 21; i++) entries.push({ date: 'd' + i, kcal: i < 10 ? 2500 : null, weight: 180 });
  const r = T.estimateExpenditure(entries, 'lb');
  eq(r.eligible, false);
  eq(r.have, 10); eq(r.needed, 14);
});

test('estimateExpenditure: no weigh-in near an end → ineligible', () => {
  const entries = [];
  for (let i = 0; i < 21; i++) entries.push({ date: 'd' + i, kcal: 2500, weight: i > 6 ? 180 : null });
  eq(T.estimateExpenditure(entries, 'lb').eligible, false);
});

process.exit(failures ? 1 : 0);
