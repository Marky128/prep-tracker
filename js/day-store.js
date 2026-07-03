/* Single owner of the day record being viewed/edited (custom mode; the
   program renderer moves onto this in Phase 5/6). Today is just the
   default date — Phase 6 points this at any past day for editing.
   Emits change events so the tracker/history/dashboard can recompute. */
const DayStore = (() => {
  'use strict';

  const listeners = new Set();
  let cur = null; // { date, rec }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function customSnapshot(profile) {
    return {
      kcal: profile.targets.kcal, p: profile.targets.p, c: profile.targets.c, f: profile.targets.f,
      tolerancePct: profile.tolerancePct == null ? 6 : profile.tolerancePct,
      types: { kcal: 'band', p: 'floor', c: 'band', f: 'cap' },
      mode: 'custom',
    };
  }

  function blankCustom(date, profile) {
    const habits = {};
    (profile.habits || []).forEach(h => { habits[h.id] = false; });
    return {
      date, schema: 2, mode: 'custom', programId: null,
      items: [],
      habits,
      weight: null, workout: null,
      macros: { kcal: 0, p: 0, c: 0, f: 0 },
      targetsSnapshot: null, // stamped on first save
    };
  }

  function computeTotals(rec) {
    const t = (rec.items || []).reduce(
      (a, it) => ({ kcal: a.kcal + (it.macros.kcal || 0), p: a.p + (it.macros.p || 0), c: a.c + (it.macros.c || 0), f: a.f + (it.macros.f || 0) }),
      { kcal: 0, p: 0, c: 0, f: 0 }
    );
    return { kcal: Math.round(t.kcal), p: Math.round(t.p * 10) / 10, c: Math.round(t.c * 10) / 10, f: Math.round(t.f * 10) / 10 };
  }

  async function load(date, profile) {
    const rec = await DB.getDay(date).catch(() => null);
    if (rec && rec.mode === 'custom') {
      if (!Array.isArray(rec.items)) rec.items = [];
      if (!rec.habits) rec.habits = blankCustom(date, profile).habits;
      cur = { date, rec };
    } else if (rec && !(rec.meals || []).some(Boolean)) {
      // program record with no meals checked (weight/habit-only writes):
      // adopt it into custom shape, keeping weight/training
      const blank = blankCustom(date, profile);
      blank.weight = typeof rec.weight === 'number' ? rec.weight : null;
      blank.weightUnit = rec.weightUnit;
      blank.workout = rec.workout || null;
      Object.keys(blank.habits).forEach(h => { if (rec.habits && rec.habits[h]) blank.habits[h] = true; });
      cur = { date, rec: blank };
    } else if (rec) {
      cur = { date, rec }; // program day with entries: rendered by the program view
    } else {
      cur = { date, rec: blankCustom(date, profile) };
    }
    emit();
    return cur.rec;
  }

  function record() { return cur ? cur.rec : null; }
  function date() { return cur ? cur.date : null; }

  function save(profile) {
    const rec = cur.rec;
    rec.macros = computeTotals(rec);
    if (!rec.targetsSnapshot) rec.targetsSnapshot = customSnapshot(profile);
    rec.weightUnit = Targets.recordUnitFor(profile.units);
    rec.updatedAt = new Date().toISOString();
    DB.putDay(JSON.parse(JSON.stringify(rec))).catch(err => console.warn('save failed', err));
    HistoryView.invalidate();
    if (window.PT && window.PT.dayChanged) window.PT.dayChanged();
    emit();
  }

  function mutate(profile, fn) {
    if (!cur) return;
    fn(cur.rec);
    save(profile);
  }

  function onChange(fn) { listeners.add(fn); }
  function emit() { listeners.forEach(fn => { try { fn(cur); } catch (e) {} }); }

  return { todayStr, load, record, date, mutate, onChange, computeTotals, customSnapshot };
})();
