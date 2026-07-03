#!/usr/bin/env node
/* Unit tests for js/migrate.js. Run: node tools/tests/migrate.test.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { migrateDay, legacyProfile, SCHEMA } = require('../../js/migrate.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((msg || 'not equal') + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
  }
}

const fullV1 = () => ({
  date: '2026-07-02',
  meals: [true, true, false, true, true],
  swaps: [[['Eggs + whites'], ['2 rice cakes']], [['250g chicken breast'], ['150g potato']], [['300g potato']], [['2 scoops whey isolate'], ['300g potato']], [['Extra lean ground beef'], ['Broccoli', 'Spinach']]],
  habits: { water: true, salt: true, lemon: false, steps: true, cardio: false, supps: true },
  weight: 187.4, weightUnit: 'lbs',
  workout: 'pull',
  macros: { p: 238, c: 114, f: 36 },
  updatedAt: '2026-07-02T21:00:00.000Z',
});

test('full v1 record: fields preserved, v2 fields added', () => {
  const src = fullV1();
  const out = migrateDay(src);
  eq(out.meals, src.meals); eq(out.swaps, src.swaps); eq(out.habits, src.habits);
  eq(out.weight, 187.4); eq(out.weightUnit, 'lbs'); eq(out.workout, 'pull');
  eq(out.macros.p, 238); eq(out.macros.c, 114); eq(out.macros.f, 36);
  eq(out.macros.kcal, 4 * 238 + 4 * 114 + 9 * 36, 'kcal arithmetic');
  eq(out.mode, 'program'); eq(out.programId, 'ethan-prep'); eq(out.schema, SCHEMA);
  eq(out.targetsSnapshot.p, 316);
  eq(out.targetsSnapshot.kcal, 2700, 'official plan kcal');
  eq(out.targetsSnapshot.types.kcal, 'none', 'kcal is display-only, never judged');
  eq(src, fullV1(), 'input not mutated');
});

test('kg-era record (no weightUnit): weight converted once', () => {
  const src = { ...fullV1(), weight: 85.0 };
  delete src.weightUnit;
  const out = migrateDay(src);
  eq(out.weight, 187.4, '85kg → 187.4lbs');
  eq(out.weightUnit, 'lbs');
});

test('kg unit record stays kg (future custom kg users)', () => {
  const src = { ...fullV1(), weight: 85.0, weightUnit: 'kg' };
  const out = migrateDay(src);
  eq(out.weight, 85.0); eq(out.weightUnit, 'kg');
});

test('already-migrated record returns null', () => {
  const out = migrateDay({ ...fullV1(), schema: 2 });
  eq(out, null);
});

test('weight null stays null, no flag invented', () => {
  const src = { ...fullV1(), weight: null };
  delete src.weightUnit;
  const out = migrateDay(src);
  eq(out.weight, null);
  eq('weightUnit' in out, false);
});

test('missing macros: defensively zeroed with kcal 0', () => {
  const src = fullV1();
  delete src.macros;
  const out = migrateDay(src);
  eq(out.macros, { p: 0, c: 0, f: 0, kcal: 0 });
});

test('missing habits/workout survive untouched (absent stays absent)', () => {
  const src = fullV1();
  delete src.habits; delete src.workout;
  const out = migrateDay(src);
  eq('habits' in out, false); eq('workout' in out, false);
});

test('unknown extra field is preserved verbatim', () => {
  const src = { ...fullV1(), someFutureField: { a: [1, 2] } };
  const out = migrateDay(src);
  eq(out.someFutureField, { a: [1, 2] });
});

test('non-record input throws', () => {
  let threw = false;
  try { migrateDay({ nope: true }); } catch (e) { threw = true; }
  eq(threw, true);
});

test('legacyProfile shape', () => {
  const p = legacyProfile();
  eq(p.name, 'Ethan'); eq(p.units, 'lb'); eq(p.activeProgramId, 'ethan-prep');
  eq(p.onboarded, true); eq(p.targets.p, 316); eq(p.targets.kcal, 2700);
});

process.exit(failures ? 1 : 0);
