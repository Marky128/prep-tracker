/* My Foods personal library: CRUD over the IDB foods store, scoring for
   local search, quantity→macro scaling. The bundled Canadian database and
   online search plug in beside this (Phases 4 and 8). */
const Foods = (() => {
  'use strict';

  let cache = null;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  async function all() {
    if (!cache) cache = await DB.getAllFoods().catch(() => []);
    return cache;
  }
  function invalidate() { cache = null; }

  async function save(food) {
    const f = Object.assign({}, food);
    if (!f.id) f.id = uuid();
    if (!f.per) f.per = 'serving';
    f.favorite = !!f.favorite;
    f.lastUsed = new Date().toISOString();
    await DB.putFood(f);
    invalidate();
    return f;
  }

  async function touch(id) {
    const f = (await all()).find(x => x.id === id);
    if (f) { f.lastUsed = new Date().toISOString(); await DB.putFood(f); invalidate(); }
  }

  async function toggleFavorite(id) {
    const f = (await all()).find(x => x.id === id);
    if (f) { f.favorite = !f.favorite; await DB.putFood(f); invalidate(); }
    return f;
  }

  async function remove(id) {
    await DB.deleteFood(id);
    invalidate();
  }

  /* simple ranked match: all query tokens must appear; earlier/prefix
     matches score higher. Good enough for a personal library. */
  function score(name, brand, q) {
    const hay = (name + ' ' + (brand || '')).toLowerCase();
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
    let total = 0;
    for (const tok of q.toLowerCase().split(/\s+/).filter(Boolean)) {
      let best = -1;
      if (words.some(w => w.startsWith(tok))) best = 3;
      else if (hay.includes(tok)) best = 1;
      if (best < 0) return -1;
      total += best;
    }
    return total;
  }

  async function search(q) {
    const list = await all();
    const query = (q || '').trim();
    if (!query) {
      return list.slice().sort((a, b) =>
        (b.favorite - a.favorite) || String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')));
    }
    return list
      .map(f => ({ f, s: score(f.name, f.brand, query) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => (b.s - a.s) || (b.f.favorite - a.f.favorite) ||
        String(b.f.lastUsed || '').localeCompare(String(a.f.lastUsed || '')))
      .map(x => x.f);
  }

  /* qty semantics: per '100g' → qty is grams; per 'serving' → qty is servings */
  function macrosFor(food, qty) {
    const factor = food.per === '100g' ? qty / 100 : qty;
    const r1 = v => Math.round(v * factor * 10) / 10;
    return {
      kcal: Math.round((food.macros.kcal || 0) * factor),
      p: r1(food.macros.p || 0),
      c: r1(food.macros.c || 0),
      f: r1(food.macros.f || 0),
    };
  }

  function qtyUnit(food) { return food.per === '100g' ? 'g' : (food.servingName || 'serving'); }
  function defaultQty(food) { return food.per === '100g' ? 100 : 1; }

  return { all, invalidate, save, touch, toggleFavorite, remove, search, score, macrosFor, qtyUnit, defaultQty, uuid };
})();
