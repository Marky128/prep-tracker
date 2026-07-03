/* Pure v1→v2 record transforms. No I/O, no fetches, no globals touched —
   shared verbatim by the app boot scan, importAll, and the standalone
   migration test page (tools/migration-test.html). Works as a classic
   browser script (window.Migrate) and under node (module.exports).      */
(function (root) {
  'use strict';

  const SCHEMA = 2;

  // Targets in force for every legacy day (all history predates v2, so all
  // of it was logged under Ethan's program). kcal 2700 is the plan's
  // official number (owner's decision) and is display-only (type 'none'):
  // program-day compliance is meals-completed, exactly like the original
  // app — meal macros sum to 2,453 kcal, the ~2,700 headline includes
  // incidentals, and no day should be judged against a band it can't meet.
  const ETHAN_SNAPSHOT = Object.freeze({
    p: 316, c: 196, f: 45, kcal: 2700,
    tolerancePct: 6,
    types: Object.freeze({ p: 'floor', c: 'band', f: 'cap', kcal: 'none' }),
    mode: 'program',
  });

  const ETHAN_PROFILE = Object.freeze({
    name: 'Ethan',
    units: 'lb',
    targets: Object.freeze({ kcal: 2700, p: 316, c: 196, f: 45 }),
    tolerancePct: 6,
    activeProgramId: 'ethan-prep',
    habits: null, // program supplies habits while active
    onboarded: true,
    estimator: null,
  });

  const LB_PER_KG = 2.20462;

  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /* Transform one day record. Returns the migrated copy, or null when the
     record is already schema 2. Throws (writing nothing) if the transform
     would lose or alter any original field it isn't meant to touch. */
  function migrateDay(rec) {
    if (!rec || typeof rec.date !== 'string') throw new Error('not a day record');
    if (rec.schema >= SCHEMA) return null;

    const out = JSON.parse(JSON.stringify(rec));

    // kg-era weights (records predating the weightUnit flag) → lbs
    if (typeof out.weight === 'number' && out.weightUnit === undefined) {
      out.weight = Math.round(out.weight * LB_PER_KG * 10) / 10;
      out.weightUnit = 'lbs';
    }

    out.mode = 'program';
    out.programId = 'ethan-prep';
    const m = out.macros || {};
    out.macros = {
      p: typeof m.p === 'number' ? m.p : 0,
      c: typeof m.c === 'number' ? m.c : 0,
      f: typeof m.f === 'number' ? m.f : 0,
    };
    out.macros.kcal = 4 * out.macros.p + 4 * out.macros.c + 9 * out.macros.f;
    out.targetsSnapshot = JSON.parse(JSON.stringify(ETHAN_SNAPSHOT));
    out.schema = SCHEMA;

    // Safety gate: every original field must survive unchanged, except the
    // two the transform is explicitly allowed to touch.
    const MAY_CHANGE = new Set(['weight', 'weightUnit', 'macros']);
    for (const key of Object.keys(rec)) {
      if (MAY_CHANGE.has(key)) continue;
      if (!(key in out) || !deepEqual(rec[key], out[key])) {
        throw new Error('migration would alter field "' + key + '" of ' + rec.date);
      }
    }
    // macros may only GAIN kcal; p/c/f must be preserved when they existed
    if (rec.macros) {
      for (const k of ['p', 'c', 'f']) {
        if (typeof rec.macros[k] === 'number' && rec.macros[k] !== out.macros[k]) {
          throw new Error('migration would alter macros.' + k + ' of ' + rec.date);
        }
      }
    }
    return out;
  }

  /* Profile to auto-create for a legacy install (has days, no profile). */
  function legacyProfile() {
    return JSON.parse(JSON.stringify(ETHAN_PROFILE));
  }

  const api = { SCHEMA, ETHAN_SNAPSHOT, migrateDay, legacyProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Migrate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
