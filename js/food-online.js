/* Open Food Facts online search (Search-a-licious API), Canada-first.
   Search-on-submit only — OFF rate-limits search (~10/min) and bans
   search-as-you-type. Non-JSON responses (outage pages) and 429s render
   as a neutral "busy" state, offline as an offline note. */
const FoodOnline = (() => {
  'use strict';

  const ENDPOINT = 'https://search.openfoodfacts.org/search';
  const FIELDS = 'product_name,brands,code,nutriments';
  let inflight = null;

  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const r1 = v => (v == null ? 0 : Math.round(v * 10) / 10);

  function normalize(hit) {
    const name = (hit.product_name || '').trim();
    if (!name) return null;
    const n = hit.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (kcal == null) {
      const kj = num(n['energy_100g']); // some products only carry kJ
      kcal = kj != null ? kj / 4.184 : null;
    }
    const p = num(n['proteins_100g']);
    const c = num(n['carbohydrates_100g']);
    const f = num(n['fat_100g']);
    if (kcal == null && p == null && c == null && f == null) return null; // no per-100g data
    return {
      name: name.slice(0, 70),
      brand: (Array.isArray(hit.brands) ? hit.brands[0] : hit.brands) || null,
      code: hit.code || null,
      macros: { kcal: Math.round(kcal || 0), p: r1(p), c: r1(c), f: r1(f) }, // per 100 g
    };
  }

  /* returns {results} — or throws Error('offline'|'busy'); null if aborted */
  async function search(q, opts) {
    opts = opts || {};
    const query = q.trim() + (opts.world ? '' : ' countries_tags:"en:canada"');
    const url = ENDPOINT + '?q=' + encodeURIComponent(query) + '&page_size=20&fields=' + FIELDS;
    if (inflight) inflight.abort();
    inflight = new AbortController();
    let res;
    try {
      res = await fetch(url, { signal: inflight.signal });
    } catch (err) {
      if (err.name === 'AbortError') return null;
      throw new Error('offline');
    }
    if (!res.ok) throw new Error('busy');
    let data;
    try { data = await res.json(); }
    catch (err) { throw new Error('busy'); }
    return { results: (data.hits || []).map(normalize).filter(Boolean) };
  }

  function macrosFor(item, grams) {
    const k = grams / 100;
    return {
      kcal: Math.round(item.macros.kcal * k),
      p: r1(item.macros.p * k),
      c: r1(item.macros.c * k),
      f: r1(item.macros.f * k),
    };
  }

  return { search, macrosFor };
})();
