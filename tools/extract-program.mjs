#!/usr/bin/env node
/* Generates programs/ethan-prep.json by extracting the meal plan verbatim
   from index.html — every number, item and swap label is taken from the
   markup so nothing can drift in transcription. Swap-chip labels are
   persistence keys for historical `swaps` data; this file is the fixture
   the Phase 5 render-parity test asserts against.

   Run: node tools/extract-program.mjs   (from the repo root)            */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
if (!html.includes('<!-- MEAL 1 -->')) {
  console.error('The hardcoded meal markup was removed in Phase 5 — the committed\n' +
    'programs/ethan-prep.json is canonical now. Edit that file directly\n' +
    '(and bump CACHE in sw.js) to change the program.');
  process.exit(1);
}
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/* ---------- meals ---------- */
const mealBlocks = [];
{
  const re = /<!-- MEAL (\d) -->/g;
  const marks = [];
  let m;
  while ((m = re.exec(html))) marks.push({ n: +m[1], at: m.index });
  const end = html.indexOf('<!-- TRAINING -->');
  if (marks.length !== 5 || end < 0) throw new Error('expected 5 MEAL markers + TRAINING marker');
  marks.forEach((mk, i) => mealBlocks.push(html.slice(mk.at, i < 4 ? marks[i + 1].at : end)));
}

const meals = mealBlocks.map((block, i) => {
  const attrs = block.match(/data-p="(\d+)" data-c="(\d+)" data-f="(\d+)"/);
  const num = block.match(/<div class="num">([^<]+)<\/div>/);
  const title = block.match(/<h2>([^<]+)<\/h2>/);
  if (!attrs || !num || !title) throw new Error(`meal ${i + 1}: missing attrs/num/title`);

  const items = [...block.matchAll(/<li>([^<]+)<\/li>/g)].map(x => decode(x[1]));
  if (!items.length) throw new Error(`meal ${i + 1}: no food items`);

  // macro pills must agree with the data attributes
  const pills = [...block.matchAll(/<span class="pill"><b>([PCF])<\/b>\s*(\d+)g<\/span>/g)];
  const pillMap = Object.fromEntries(pills.map(x => [x[1].toLowerCase(), +x[2]]));
  const macros = { p: +attrs[1], c: +attrs[2], f: +attrs[3] };
  for (const k of ['p', 'c', 'f']) {
    if (pillMap[k] !== macros[k]) throw new Error(`meal ${i + 1}: pill ${k}=${pillMap[k]} ≠ data-${k}=${macros[k]}`);
  }

  const swapGroups = [];
  const segs = block.split('<div class="swap-lab">').slice(1);
  for (const seg of segs) {
    const label = decode(seg.slice(0, seg.indexOf('</div>')));
    const chipsTag = seg.match(/<div class="chips" (data-group|data-multi)>/);
    if (!chipsTag) throw new Error(`meal ${i + 1}: swap-lab "${label}" has no chips container`);
    const chipsHtml = seg.slice(seg.indexOf(chipsTag[0]), seg.indexOf('</div>', seg.indexOf(chipsTag[0])));
    const chips = [...chipsHtml.matchAll(/<button class="chip( active)?">([^<]+)<\/button>/g)];
    if (!chips.length) throw new Error(`meal ${i + 1}: swap group "${label}" has no chips`);
    swapGroups.push({
      label,
      multi: chipsTag[1] === 'data-multi',
      options: chips.map(c => decode(c[2])),
      default: chips.filter(c => !!c[1]).map(c => decode(c[2])),
    });
  }

  return { id: 'm' + (i + 1), num: decode(num[1]), title: decode(title[1]), items, macros, swapGroups };
});

/* ---------- habits ---------- */
const habitsSection = html.slice(html.indexOf('<!-- DAILY HABITS -->'), html.indexOf('<!-- BODYWEIGHT -->'));
const habits = [...habitsSection.matchAll(
  /<button class="habit" data-habit="(\w+)">[\s\S]*?<span class="habit-name">([^<]+)<\/span><span class="habit-meta">([^<]+)<\/span>/g
)].map(m => ({ id: m[1], name: decode(m[2]), meta: decode(m[3]) }));

/* ---------- header target display strings ---------- */
const display = {};
for (const m of html.matchAll(/<div class="target(?: hot)?"><div class="val">([^<]+)<\/div><div class="lab">([^<]+)<\/div>/g)) {
  display[decode(m[2]).toLowerCase().replace('calories', 'kcal').replace('protein', 'p').replace('carbs', 'c').replace('fat', 'f')] = decode(m[1]);
}

/* ---------- Plan-tab reference tables ---------- */
function extractBlock(startMark, endMark) {
  const seg = html.slice(html.indexOf(startMark), html.indexOf(endMark));
  const title = decode(seg.match(/<h3>([\s\S]*?)<\/h3>/)[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const tables = [...seg.matchAll(/<table>([\s\S]*?)<\/table>/g)].map(t => {
    const rows = [...t[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(r =>
      [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => decode(c[1].replace(/<[^>]+>/g, '')))
    );
    const table = {};
    if (rows[0].length === 1) table.title = rows[0][0];
    else table.columns = rows[0];
    table.rows = rows.slice(1);
    return table;
  });
  return { title, tables };
}
const reference = [
  extractBlock('<!-- DAILY PROTOCOL -->', '<!-- DAILY TOTALS -->'),
  extractBlock('<!-- DAILY TOTALS -->', '<!-- PORTION GUIDE -->'),
  extractBlock('<!-- PORTION GUIDE -->', '<footer>'),
];

/* ---------- assemble + assert ---------- */
const sum = meals.reduce((a, m) => ({ p: a.p + m.macros.p, c: a.c + m.macros.c, f: a.f + m.macros.f }), { p: 0, c: 0, f: 0 });
const kcalBasis = 4 * sum.p + 4 * sum.c + 9 * sum.f;

const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); };
assert(meals.length === 5, 'meal count');
assert(sum.p === 316 && sum.c === 196 && sum.f === 45, `macro sums ${JSON.stringify(sum)}`);
assert(kcalBasis === 2453, 'kcal basis');
assert(habits.length === 6, `habit count ${habits.length}`);
assert(display.kcal === '~2,700' && display.p === '300g' && display.c === '~230g' && display.f === '≤50g', 'display targets');
for (const meal of meals) {
  for (const g of meal.swapGroups) {
    for (const d of g.default) assert(g.options.includes(d), `${meal.id} default "${d}" not in options`);
    assert(g.multi || g.default.length === 1, `${meal.id} single-select group "${g.label}" needs exactly one default`);
  }
}
assert(meals.reduce((n, m) => n + m.swapGroups.length, 0) === 9, 'swap group count');
assert(reference.length === 3 && reference[0].tables.length === 2 && reference[2].tables.length === 2, 'reference tables');

const program = {
  id: 'ethan-prep',
  version: 1,
  name: "Ethan's Prep Plan",
  description: 'A specific contest-prep program: 5 fixed meals with swap options, tracked by checking meals off.',
  targets: {
    // kcal 2700 is the plan's official calorie number (display + profile
    // target when this program is active); it is never a compliance band —
    // program compliance is meals-completed. kcalBasis is the 4/4/9 sum of
    // the meal macros, used only for day-intake accounting (expenditure).
    kcal: 2700,
    p: sum.p, c: sum.c, f: sum.f,
    kcalBasis,
    display,
    types: { kcal: 'none', p: 'floor', c: 'band', f: 'cap' },
  },
  meals,
  habits,
  reference,
};

mkdirSync('programs', { recursive: true });
writeFileSync('programs/ethan-prep.json', JSON.stringify(program, null, 2) + '\n');
console.log(`programs/ethan-prep.json written: ${meals.length} meals, ${habits.length} habits, P${sum.p}/C${sum.c}/F${sum.f}, kcalBasis ${kcalBasis}`);
