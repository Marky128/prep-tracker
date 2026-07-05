#!/usr/bin/env node
/* Unit tests for the pure math in js/workouts.js.
   Run: node tools/tests/workouts.test.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../../js/workouts.js');

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
function approx(a, b, msg) {
  if (Math.abs(a - b) > 0.05) throw new Error((msg || 'not close') + ': ' + a + ' ≠ ' + b);
}

const set = (w, r, done = true) => ({ w, r, done });
const session = (id, date, type, exercises, opts = {}) => ({
  id, date, type,
  startedAt: opts.startedAt || date + 'T17:00:00.000Z',
  endedAt: opts.endedAt === null ? null : (opts.endedAt || date + 'T18:00:00.000Z'),
  unit: opts.unit || 'lb',
  exercises,
});

/* ---------- est1RM ---------- */
test('est1RM: Epley at 5 reps', () => approx(W.est1RM(185, 5), 185 * (1 + 5 / 30)));
test('est1RM: 1 rep is just the weight', () => approx(W.est1RM(225, 1), 225 * (1 + 1 / 30)));
test('est1RM: clamps past 15 reps', () => approx(W.est1RM(100, 30), W.est1RM(100, 15)));
test('est1RM: null without weight or reps', () => {
  eq(W.est1RM(null, 5), null);
  eq(W.est1RM(100, 0), null);
  eq(W.est1RM(0, 5), null);
});

/* ---------- sessionStats ---------- */
test('sessionStats sums done sets only', () => {
  const s = session('a', '2026-07-01', 'push', [
    { exId: 'bench-press', name: 'Bench', sets: [set(100, 10), set(100, 8), set(100, 5, false)] },
    { exId: 'cable-fly', name: 'Fly', sets: [set(30, 12)] },
  ]);
  const st = W.sessionStats(s);
  eq(st.volume, 100 * 10 + 100 * 8 + 30 * 12);
  eq(st.sets, 3);
  eq(st.reps, 30);
  eq(st.exercises, 2);
});
test('sessionStats: bodyweight sets count reps, zero volume', () => {
  const s = session('a', '2026-07-01', 'pull', [
    { exId: 'pull-up', name: 'Pull-Up', sets: [set(null, 10)] },
  ]);
  const st = W.sessionStats(s);
  eq(st.volume, 0);
  eq(st.sets, 1);
});

/* ---------- bestSet ---------- */
test('bestSet picks the highest est-1RM', () => {
  const ex = { exId: 'x', name: 'X', sets: [set(100, 10), set(120, 3), set(90, 12)] };
  const b = W.bestSet(ex);
  eq([b.w, b.r], [100, 10]); // e1rm 133.3 beats 132 (120×3) and 126 (90×12)
});
test('bestSet ignores undone sets', () => {
  const ex = { exId: 'x', name: 'X', sets: [set(200, 5, false), set(100, 5)] };
  eq(W.bestSet(ex).w, 100);
});

/* ---------- exerciseHistory ---------- */
const HIST = [
  session('s1', '2026-06-01', 'push', [{ exId: 'bench-press', name: 'Bench', sets: [set(180, 5), set(180, 4)] }]),
  session('s2', '2026-06-08', 'push', [{ exId: 'bench-press', name: 'Bench', sets: [set(185, 5)] }]),
  session('s3', '2026-06-15', 'push', [{ exId: 'squat', name: 'Squat', sets: [set(225, 5)] }]),
];
test('exerciseHistory: one point per session, ordered', () => {
  const h = W.exerciseHistory(HIST, 'bench-press', 'lb');
  eq(h.length, 2);
  eq(h[0].date, '2026-06-01');
  eq(h[1].topW, 185);
  approx(h[1].e1rm, W.round1(185 * (1 + 5 / 30)));
});
test('exerciseHistory: converts kg sessions into lb', () => {
  const kg = [session('k1', '2026-06-01', null, [{ exId: 'x', name: 'X', sets: [set(100, 5)] }], { unit: 'kg' })];
  const h = W.exerciseHistory(kg, 'x', 'lb');
  approx(h[0].topW, 220.5);
});

/* ---------- buckets ---------- */
test('weekStart is Monday-based', () => {
  eq(W.weekStart('2026-07-04'), '2026-06-29'); // Saturday → that week's Monday
  eq(W.weekStart('2026-06-29'), '2026-06-29'); // Monday stays
});
test('weekly buckets group and sum volume', () => {
  const b = W.buckets(HIST, 'week', 'lb');
  eq(b.length, 3); // three different weeks
  eq(b[0].start, '2026-06-01');
  eq(b[0].volume, 180 * 5 + 180 * 4);
  eq(b[0].sets, 2);
});
test('monthly buckets collapse to one month', () => {
  const b = W.buckets(HIST, 'month', 'lb');
  eq(b.length, 1);
  eq(b[0].start, '2026-06-01');
  eq(b[0].sessions, 3);
});

/* ---------- prevEntryFor ---------- */
test('prevEntryFor finds the latest earlier session with the exercise', () => {
  const cur = session('s4', '2026-06-20', 'push', [{ exId: 'bench-press', name: 'Bench', sets: [] }], { endedAt: null });
  const prev = W.prevEntryFor(HIST.concat([cur]), 'bench-press', cur);
  eq(prev.w.id, 's2');
});
test('prevEntryFor: nothing before the first session', () => {
  const first = HIST[0];
  eq(W.prevEntryFor(HIST, 'bench-press', first), null);
});

/* ---------- prFlags ---------- */
test('prFlags: quiet on the first-ever session', () => {
  const f = W.prFlags(HIST, 'bench-press', HIST[0], HIST[0].exercises[0].sets[0], 'lb');
  eq([f.weight, f.e1rm], [false, false]);
});
test('prFlags: heavier top set is a weight PR', () => {
  const cur = session('s5', '2026-06-22', 'push', [{ exId: 'bench-press', name: 'Bench', sets: [set(190, 3)] }], { endedAt: null });
  const f = W.prFlags(HIST.concat([cur]), 'bench-press', cur, cur.exercises[0].sets[0], 'lb');
  eq(f.weight, true);
});
test('prFlags: lighter set is not a PR', () => {
  const cur = session('s6', '2026-06-22', 'push', [{ exId: 'bench-press', name: 'Bench', sets: [set(150, 5)] }], { endedAt: null });
  const f = W.prFlags(HIST.concat([cur]), 'bench-press', cur, cur.exercises[0].sets[0], 'lb');
  eq([f.weight, f.e1rm], [false, false]);
});

/* ---------- malformed-record tolerance (a hand-edited/truncated import
   must never throw mid-render and brick the whole Train tab) ---------- */
test('sessionStats tolerates non-array sets and exercises', () => {
  W.sessionStats({ id: 'x', date: '2026-07-01', exercises: [{ exId: 'a', name: 'A', sets: {} }] });
  W.sessionStats({ id: 'y', date: '2026-07-01', exercises: 'nope' });
});
test('buckets/exerciseHistory/prFlags tolerate malformed sessions', () => {
  const bad = { id: 'y', date: '2026-07-01', unit: 'lb', endedAt: 'z', exercises: 'nope' };
  W.buckets([bad], 'week', 'lb');
  W.exerciseHistory([bad], 'a', 'lb');
  W.prevEntryFor([bad], 'a', { id: 'z', date: '2026-07-02', startedAt: 'z' });
  W.prFlags([bad], 'a', { id: 'z', date: '2026-07-02', startedAt: 'z', unit: 'lb' }, { w: 100, r: 5, done: true }, 'lb');
});

/* ---------- library sanity ---------- */
test('built-in exercises have unique ids and valid groups', () => {
  const ids = new Set();
  for (const e of W.EXERCISES) {
    if (ids.has(e.id)) throw new Error('duplicate id ' + e.id);
    ids.add(e.id);
    if (!W.GROUPS.some(g => g.id === e.grp)) throw new Error(e.id + ' bad group ' + e.grp);
  }
});

process.exit(failures ? 1 : 0);
