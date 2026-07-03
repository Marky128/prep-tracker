#!/usr/bin/env node
/* Static wiring check: every element id referenced from JS must exist in
   index.html or be created by a known dynamic renderer.
   Run: node tools/tests/wiring.test.mjs */
import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// ids created at runtime by renderers (not in the static markup)
const DYNAMIC = new Set(['onlineGo', 'onlineWorld']);

let failures = 0;
for (const file of readdirSync('js')) {
  if (!file.endsWith('.js')) continue;
  const src = readFileSync('js/' + file, 'utf8');
  const refs = new Set();
  // $('#id'), $$('#id .child'), querySelector('#id...'), getElementById('id')
  for (const m of src.matchAll(/\$\$?\(\s*'#([A-Za-z][\w-]*)/g)) refs.add(m[1]);
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*'#([A-Za-z][\w-]*)/g)) refs.add(m[1]);
  for (const m of src.matchAll(/getElementById\(\s*'([\w-]+)'\s*\)/g)) refs.add(m[1]);
  for (const id of refs) {
    if (!htmlIds.has(id) && !DYNAMIC.has(id)) {
      console.error(`FAIL  js/${file} references #${id} — not in index.html`);
      failures++;
    }
  }
}

console.log(failures ? failures + ' wiring failure(s)' : 'PASS  all JS-referenced ids exist');
process.exit(failures ? 1 : 0);
