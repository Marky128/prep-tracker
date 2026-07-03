/* Bundled offline food database (Canadian Nutrient File) — lazy-loaded
   from data/foods-cnf.json (SW-precached), searched fully in memory.
   Entries: { n name, k kcal/100g, p, c, f, r rank, s [[serving, grams]] }. */
const FoodDB = (() => {
  'use strict';

  let foods = null;
  let loading = null;

  // Canadian/US spelling + common aliases
  const SYNONYMS = {
    yogurt: 'yogourt', yoghurt: 'yogourt',
    donut: 'doughnut', flavor: 'flavour', fiber: 'fibre',
    hamburg: 'hamburger', soda: 'carbonated', pop: 'carbonated',
  };

  function ready() {
    if (foods) return Promise.resolve(foods);
    if (!loading) {
      loading = fetch('data/foods-cnf.json')
        .then(r => { if (!r.ok) throw new Error('food db unavailable'); return r.json(); })
        .then(json => {
          foods = json.foods.map((f, i) => {
            const nl = f.n.toLowerCase();
            return Object.assign({ i, nl, w: nl.split(/[^a-z0-9%]+/).filter(Boolean) }, f);
          });
          return foods;
        })
        .catch(err => { loading = null; throw err; });
    }
    return loading;
  }

  function levLe1(a, b) {
    // edit distance ≤ 1 (bounded, tiny strings)
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++;
      else if (lb > la) j++;
      else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
  }

  function tokenScore(words, tok) {
    let best = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.startsWith(tok)) { best = Math.max(best, 10 - Math.min(i, 5)); if (i === 0) break; }
      else if (w.includes(tok)) best = Math.max(best, 3);
      else if (tok.length >= 5 && levLe1(tok, w.slice(0, tok.length))) best = Math.max(best, 5 - Math.min(i, 4) * 0.5);
    }
    return best;
  }

  /* synchronous — call ready() first (openAdd warms it) */
  function search(q, limit) {
    if (!foods) return [];
    const tokens = (q || '').toLowerCase().split(/\s+/).filter(Boolean)
      .map(t => SYNONYMS[t] || t);
    if (!tokens.length) return [];
    const hits = [];
    for (const f of foods) {
      let total = 0, ok = true;
      for (const tok of tokens) {
        const s = tokenScore(f.w, tok);
        if (!s) { ok = false; break; }
        total += s;
      }
      if (ok) hits.push({ f, s: total + f.r * 0.05 - f.nl.length / 200 });
    }
    hits.sort((a, b) => b.s - a.s);
    return hits.slice(0, limit || 30).map(h => h.f);
  }

  function macrosFor(f, grams) {
    const k = grams / 100;
    const r1 = v => Math.round(v * k * 10) / 10;
    return { kcal: Math.round(f.k * k), p: r1(f.p), c: r1(f.c), f: r1(f.f) };
  }

  function byIndex(i) { return foods ? foods[i] : null; }
  function count() { return foods ? foods.length : 0; }

  return { ready, search, macrosFor, byIndex, count };
})();
