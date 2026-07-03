#!/usr/bin/env node
/* Search-quality tests for js/food-db.js against the built data file.
   Run: node tools/tests/food-db.test.mjs (after tools/build-food-db.py) */
import { readFileSync } from 'node:fs';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync('data/foods-cnf.json', 'utf8')),
});
eval(readFileSync('js/food-db.js', 'utf8') + '; globalThis.FoodDB = FoodDB;');

await FoodDB.ready();

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + ' — ' + e.message); }
}
const names = q => FoodDB.search(q, 10).map(f => f.n.toLowerCase());
function expectTop(q, needle, within) {
  const hits = names(q);
  const idx = hits.findIndex(n => n.includes(needle));
  if (idx < 0 || idx >= (within || 5)) {
    throw new Error(`"${q}" → "${needle}" not in top ${within || 5}: ${JSON.stringify(hits.slice(0, 5))}`);
  }
}

test('loads a sane number of foods', () => {
  if (FoodDB.count() < 1500 || FoodDB.count() > 4000) throw new Error('count ' + FoodDB.count());
});
test('US spelling: yogurt → yogourt', () => expectTop('greek yogurt', 'yogourt, greek'));
test('chicken breast staples surface', () => expectTop('chicken breast', 'chicken'));
test('banana raw beats compounds', () => expectTop('banana', 'banana, raw', 3));
test('typo tolerance: bananna', () => expectTop('bananna', 'banana'));
test('poutine exists (Ontario approved)', () => expectTop('poutine', 'poutine', 1));
test('brown rice cooked', () => expectTop('brown rice cooked', 'rice, brown'));
test('egg', () => expectTop('egg boiled', 'egg'));
test('empty query returns nothing', () => {
  if (FoodDB.search('', 10).length !== 0) throw new Error('not empty');
});
test('macros scale per gram', () => {
  const f = FoodDB.search('banana raw', 1)[0];
  const m = FoodDB.macrosFor(f, 118); // one medium banana
  if (Math.abs(m.kcal - f.k * 1.18) > 1.2) throw new Error('kcal scale');
});

process.exit(failures ? 1 : 0);
