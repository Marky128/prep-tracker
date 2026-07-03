#!/usr/bin/env node
/* Render-parity test: the JSON-driven program renderer must contain every
   meal title, item, macro number, swap-chip label (persistence keys!),
   default selection, habit and reference cell from programs/ethan-prep.json
   — which was itself extracted verbatim from the original markup.
   Run: node tools/tests/parity.test.mjs */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const TodayProgram = require('../../js/today-program.js');
const program = JSON.parse(readFileSync('programs/ethan-prep.json', 'utf8'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + ' — ' + e.message); }
}
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function mustContain(html, needle, what) {
  if (!html.includes(needle)) throw new Error('missing ' + what + ': ' + JSON.stringify(needle));
}

test('program invariants', () => {
  if (program.meals.length !== 5) throw new Error('meal count');
  const sum = program.meals.reduce((a, m) => ({ p: a.p + m.macros.p, c: a.c + m.macros.c, f: a.f + m.macros.f }), { p: 0, c: 0, f: 0 });
  if (sum.p !== 316 || sum.c !== 196 || sum.f !== 45) throw new Error('macro sums ' + JSON.stringify(sum));
  if (program.targets.kcal !== 2700) throw new Error('official kcal');
  if (program.targets.types.kcal !== 'none') throw new Error('kcal must be display-only');
  if (program.habits.length !== 6) throw new Error('habit count');
});

program.meals.forEach((meal, i) => {
  test('meal ' + (i + 1) + ' renders verbatim (' + meal.title + ')', () => {
    const html = TodayProgram.html.meal(meal, i, i === 0);
    mustContain(html, '<h2>' + esc(meal.title) + '</h2>', 'title');
    mustContain(html, '>' + esc(meal.num) + '<', 'num');
    mustContain(html, 'data-p="' + meal.macros.p + '" data-c="' + meal.macros.c + '" data-f="' + meal.macros.f + '"', 'data attrs');
    for (const k of ['p', 'c', 'f']) {
      mustContain(html, '<b>' + k.toUpperCase() + '</b> ' + meal.macros[k] + 'g', 'macro pill ' + k);
    }
    for (const it of meal.items) mustContain(html, '<li>' + esc(it) + '</li>', 'food item');
    for (const g of meal.swapGroups) {
      mustContain(html, esc(g.label), 'swap label');
      mustContain(html, g.multi ? 'data-multi' : 'data-group', 'group kind');
      for (const o of g.options) {
        // chip labels are the persistence keys for historical swap data
        mustContain(html, '>' + esc(o) + '</button>', 'chip label');
      }
      for (const d of g.default) {
        mustContain(html, 'class="chip active">' + esc(d) + '</button>', 'default chip');
      }
    }
  });
});

test('all 9 swap groups render, one per markup group', () => {
  const html = program.meals.map((m, i) => TodayProgram.html.meal(m, i, false)).join('');
  const groups = (html.match(/class="chips" data-(group|multi)/g) || []).length;
  if (groups !== 9) throw new Error('group count ' + groups);
});

test('habits render verbatim', () => {
  const html = TodayProgram.html.habits(program.habits);
  for (const h of program.habits) {
    mustContain(html, 'data-habit="' + h.id + '"', 'habit id');
    mustContain(html, '>' + esc(h.name) + '<', 'habit name');
    mustContain(html, '>' + esc(h.meta) + '<', 'habit meta');
  }
});

test('reference tables render every cell', () => {
  const html = TodayProgram.html.reference(program.reference);
  for (const block of program.reference) {
    for (const t of block.tables) {
      if (t.title) mustContain(html, esc(t.title), 'table title');
      for (const row of t.rows) for (const cell of row) {
        mustContain(html, '>' + esc(cell) + '</td>', 'cell');
      }
    }
  }
  mustContain(html, 'Daily Totals <em>/ Approx.</em>', 'em-styled heading');
});

process.exit(failures ? 1 : 0);
