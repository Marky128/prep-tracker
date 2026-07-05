/* Workout data layer: exercise library (built-in + custom), session CRUD
   over the DB 'workouts' store, and pure strength math (Epley est-1RM,
   tonnage, per-exercise history, weekly/monthly buckets, PR detection).
   Math is DOM-free and node-testable; the Train page (js/train.js) renders.

   Session shape:
   { id, date:'YYYY-MM-DD', type:'pull'|'push'|'legs'|'arms'|null,
     startedAt, endedAt|null, unit:'lb'|'kg',
     exercises:[{ exId, name, sets:[{ w:number|null, r:number|null, done }] }],
     updatedAt }
   Weights are stored in the session's own unit and converted on read. */
const Workouts = (() => {
  'use strict';

  const GROUPS = [
    { id: 'chest',     name: 'Chest' },
    { id: 'back',      name: 'Back' },
    { id: 'shoulders', name: 'Shoulders' },
    { id: 'biceps',    name: 'Biceps' },
    { id: 'triceps',   name: 'Triceps' },
    { id: 'legs',      name: 'Legs' },
    { id: 'core',      name: 'Core' },
    { id: 'other',     name: 'Other' },
  ];

  const EXERCISES = [
    // chest
    { id: 'bench-press',            name: 'Bench Press (Barbell)',     grp: 'chest' },
    { id: 'bench-press-db',         name: 'Bench Press (Dumbbell)',    grp: 'chest' },
    { id: 'incline-bench',          name: 'Incline Bench (Barbell)',   grp: 'chest' },
    { id: 'incline-bench-db',       name: 'Incline Bench (Dumbbell)',  grp: 'chest' },
    { id: 'chest-press-machine',    name: 'Chest Press (Machine)',     grp: 'chest' },
    { id: 'cable-fly',              name: 'Cable Fly',                 grp: 'chest' },
    { id: 'dumbbell-fly',           name: 'Dumbbell Fly',              grp: 'chest' },
    { id: 'pec-deck',               name: 'Pec Deck',                  grp: 'chest' },
    { id: 'push-up',                name: 'Push-Up',                   grp: 'chest' },
    { id: 'dip-chest',              name: 'Dip (Chest)',               grp: 'chest' },
    // back
    { id: 'deadlift',               name: 'Deadlift',                  grp: 'back' },
    { id: 'pull-up',                name: 'Pull-Up',                   grp: 'back' },
    { id: 'chin-up',                name: 'Chin-Up',                   grp: 'back' },
    { id: 'lat-pulldown',           name: 'Lat Pulldown',              grp: 'back' },
    { id: 'barbell-row',            name: 'Barbell Row',               grp: 'back' },
    { id: 'dumbbell-row',           name: 'Dumbbell Row',              grp: 'back' },
    { id: 'seated-cable-row',       name: 'Seated Cable Row',          grp: 'back' },
    { id: 't-bar-row',              name: 'T-Bar Row',                 grp: 'back' },
    { id: 'chest-supported-row',    name: 'Chest-Supported Row',       grp: 'back' },
    { id: 'machine-row',            name: 'Machine Row',               grp: 'back' },
    { id: 'rack-pull',              name: 'Rack Pull',                 grp: 'back' },
    { id: 'straight-arm-pulldown',  name: 'Straight-Arm Pulldown',     grp: 'back' },
    { id: 'shrug-bb',               name: 'Shrug (Barbell)',           grp: 'back' },
    { id: 'shrug-db',               name: 'Shrug (Dumbbell)',          grp: 'back' },
    { id: 'back-extension',         name: 'Back Extension',            grp: 'back' },
    // shoulders
    { id: 'overhead-press',         name: 'Overhead Press (Barbell)',  grp: 'shoulders' },
    { id: 'overhead-press-db',      name: 'Overhead Press (Dumbbell)', grp: 'shoulders' },
    { id: 'arnold-press',           name: 'Arnold Press',              grp: 'shoulders' },
    { id: 'shoulder-press-machine', name: 'Shoulder Press (Machine)',  grp: 'shoulders' },
    { id: 'lateral-raise',          name: 'Lateral Raise (Dumbbell)',  grp: 'shoulders' },
    { id: 'lateral-raise-cable',    name: 'Lateral Raise (Cable)',     grp: 'shoulders' },
    { id: 'front-raise',            name: 'Front Raise',               grp: 'shoulders' },
    { id: 'rear-delt-fly',          name: 'Rear Delt Fly',             grp: 'shoulders' },
    { id: 'face-pull',              name: 'Face Pull',                 grp: 'shoulders' },
    { id: 'upright-row',            name: 'Upright Row',               grp: 'shoulders' },
    // biceps
    { id: 'barbell-curl',           name: 'Barbell Curl',              grp: 'biceps' },
    { id: 'ez-bar-curl',            name: 'EZ-Bar Curl',               grp: 'biceps' },
    { id: 'dumbbell-curl',          name: 'Dumbbell Curl',             grp: 'biceps' },
    { id: 'hammer-curl',            name: 'Hammer Curl',               grp: 'biceps' },
    { id: 'incline-db-curl',        name: 'Incline Dumbbell Curl',     grp: 'biceps' },
    { id: 'preacher-curl',          name: 'Preacher Curl',             grp: 'biceps' },
    { id: 'cable-curl',             name: 'Cable Curl',                grp: 'biceps' },
    { id: 'concentration-curl',     name: 'Concentration Curl',        grp: 'biceps' },
    // triceps
    { id: 'close-grip-bench',       name: 'Close-Grip Bench Press',    grp: 'triceps' },
    { id: 'skull-crusher',          name: 'Skull Crusher',             grp: 'triceps' },
    { id: 'triceps-pushdown',       name: 'Triceps Pushdown',          grp: 'triceps' },
    { id: 'overhead-triceps-ext',   name: 'Overhead Triceps Extension', grp: 'triceps' },
    { id: 'dip-triceps',            name: 'Dip (Triceps)',             grp: 'triceps' },
    { id: 'triceps-kickback',       name: 'Triceps Kickback',          grp: 'triceps' },
    // legs
    { id: 'squat',                  name: 'Squat (Barbell)',           grp: 'legs' },
    { id: 'front-squat',            name: 'Front Squat',               grp: 'legs' },
    { id: 'hack-squat',             name: 'Hack Squat',                grp: 'legs' },
    { id: 'goblet-squat',           name: 'Goblet Squat',              grp: 'legs' },
    { id: 'leg-press',              name: 'Leg Press',                 grp: 'legs' },
    { id: 'bulgarian-split-squat',  name: 'Bulgarian Split Squat',     grp: 'legs' },
    { id: 'walking-lunge',          name: 'Walking Lunge',             grp: 'legs' },
    { id: 'romanian-deadlift',      name: 'Romanian Deadlift',         grp: 'legs' },
    { id: 'stiff-leg-deadlift',     name: 'Stiff-Leg Deadlift',        grp: 'legs' },
    { id: 'leg-extension',          name: 'Leg Extension',             grp: 'legs' },
    { id: 'leg-curl-lying',         name: 'Leg Curl (Lying)',          grp: 'legs' },
    { id: 'leg-curl-seated',        name: 'Leg Curl (Seated)',         grp: 'legs' },
    { id: 'hip-thrust',             name: 'Hip Thrust',                grp: 'legs' },
    { id: 'glute-kickback',         name: 'Glute Kickback (Cable)',    grp: 'legs' },
    { id: 'calf-raise-standing',    name: 'Calf Raise (Standing)',     grp: 'legs' },
    { id: 'calf-raise-seated',      name: 'Calf Raise (Seated)',       grp: 'legs' },
    { id: 'adductor-machine',       name: 'Adductor (Machine)',        grp: 'legs' },
    { id: 'abductor-machine',       name: 'Abductor (Machine)',        grp: 'legs' },
    // core
    { id: 'plank',                  name: 'Plank',                     grp: 'core' },
    { id: 'crunch',                 name: 'Crunch',                    grp: 'core' },
    { id: 'cable-crunch',           name: 'Cable Crunch',              grp: 'core' },
    { id: 'hanging-leg-raise',      name: 'Hanging Leg Raise',         grp: 'core' },
    { id: 'ab-wheel',               name: 'Ab Wheel Rollout',          grp: 'core' },
    { id: 'russian-twist',          name: 'Russian Twist',             grp: 'core' },
    // other
    { id: 'farmers-carry',          name: "Farmer's Carry",            grp: 'other' },
    { id: 'kettlebell-swing',       name: 'Kettlebell Swing',          grp: 'other' },
  ];

  /* ---------- pure math ---------- */
  const LB_PER_KG = 2.20462;
  function convert(v, fromUnit, toUnit) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    if (fromUnit === toUnit) return v;
    return fromUnit === 'kg' ? v * LB_PER_KG : v / LB_PER_KG;
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  /* Epley: anything past ~15 reps stops predicting 1RM meaningfully, so
     the curve is clamped there instead of growing without bound */
  function est1RM(w, r) {
    if (!(w > 0) || !(r > 0)) return null;
    const reps = Math.min(r, 15);
    return w * (1 + reps / 30);
  }

  // tolerate malformed records (e.g. a hand-edited import where sets/exercises
  // isn't an array) instead of throwing mid-render and bricking the whole tab
  function exercisesOf(w) { return w && Array.isArray(w.exercises) ? w.exercises : []; }
  function doneSets(ex) { return (ex && Array.isArray(ex.sets) ? ex.sets : []).filter(s => s && s.done && (s.r > 0)); }

  function setVolume(s) { return (s.w > 0 && s.r > 0) ? s.w * s.r : 0; }

  /* best done set of an exercise entry by est-1RM (weight breaks ties;
     bodyweight sets — no weight — fall back to most reps) */
  function bestSet(ex) {
    let best = null;
    for (const s of doneSets(ex)) {
      if (!best) { best = s; continue; }
      const a = est1RM(s.w, s.r) || 0;
      const b = est1RM(best.w, best.r) || 0;
      if (a > b || (a === b && (s.w || 0) > (best.w || 0)) ||
          (a === 0 && b === 0 && (s.r || 0) > (best.r || 0))) best = s;
    }
    return best;
  }

  function sessionStats(session) {
    let volume = 0, sets = 0, reps = 0;
    const exs = exercisesOf(session);
    for (const ex of exs) {
      for (const s of doneSets(ex)) {
        volume += setVolume(s);
        sets += 1;
        reps += s.r || 0;
      }
    }
    return { volume: Math.round(volume), sets, reps, exercises: exs.filter(e => doneSets(e).length).length };
  }

  /* per-exercise timeline across sessions (oldest → newest), weights
     converted into `unit`. Each point is one session's best + volume. */
  function exerciseHistory(sessions, exId, unit) {
    const out = [];
    for (const w of sessions) {
      const ex = exercisesOf(w).find(e => e && e.exId === exId);
      if (!ex) continue;
      const done = doneSets(ex);
      if (!done.length) continue;
      const best = bestSet(ex);
      const conv = v => (v == null ? null : convert(v, w.unit || 'lb', unit));
      out.push({
        sessionId: w.id,
        date: w.date,
        topW: best && best.w > 0 ? round1(conv(best.w)) : null,
        topR: best ? best.r : null,
        e1rm: best && est1RM(best.w, best.r) != null ? round1(conv(est1RM(best.w, best.r))) : null,
        volume: Math.round(done.reduce((a, s) => a + setVolume(s), 0) * (conv(1) || 1)),
        sets: done.map(s => ({ w: s.w > 0 ? round1(conv(s.w)) : null, r: s.r })),
      });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /* Monday-based ISO-ish week key for a YYYY-MM-DD date string */
  function weekStart(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - dow);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monthStart(dateStr) { return dateStr.slice(0, 7) + '-01'; }

  /* bucket completed sessions by week or month; weights → `unit`.
     Returns oldest → newest [{ start, sessions, sets, volume }]. */
  function buckets(sessions, mode, unit) {
    const keyOf = mode === 'month' ? monthStart : weekStart;
    const map = new Map();
    for (const w of sessions) {
      if (!w.date) continue;
      const k = keyOf(w.date);
      if (!map.has(k)) map.set(k, { start: k, sessions: 0, sets: 0, volume: 0 });
      const b = map.get(k);
      const st = sessionStats(w);
      const factor = convert(1, w.unit || 'lb', unit) || 1;
      b.sessions += 1;
      b.sets += st.sets;
      b.volume += Math.round(st.volume * factor);
    }
    return [...map.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  }

  /* previous completed session containing exId, strictly before `session`
     (by date, then startedAt for same-day sessions) */
  function prevEntryFor(sessions, exId, session) {
    let best = null;
    for (const w of sessions) {
      if (w.id === session.id || !w.endedAt) continue;
      const cmp = w.date === session.date
        ? String(w.startedAt || '') < String(session.startedAt || '')
        : w.date < session.date;
      if (!cmp) continue;
      const ex = exercisesOf(w).find(e => e && e.exId === exId);
      if (!ex || !doneSets(ex).length) continue;
      if (!best || w.date > best.w.date ||
          (w.date === best.w.date && String(w.startedAt || '') > String(best.w.startedAt || ''))) {
        best = { w, ex };
      }
    }
    return best; // { w: session, ex: entry } | null
  }

  /* PRs: does this set beat everything before `session` for the exercise? */
  function prFlags(sessions, exId, session, set, unit) {
    if (!(set.r > 0)) return { weight: false, e1rm: false };
    const hist = exerciseHistory(sessions.filter(w => w.id !== session.id && w.endedAt &&
      (w.date < session.date || (w.date === session.date && String(w.startedAt || '') < String(session.startedAt || '')))), exId, unit);
    if (!hist.length) return { weight: false, e1rm: false }; // first session: everything is a "PR" — stay quiet
    let maxW = 0, maxE = 0;
    for (const h of hist) {
      if (h.topW > maxW) maxW = h.topW;
      if (h.e1rm > maxE) maxE = h.e1rm;
      for (const s of h.sets) if (s.w > maxW) maxW = s.w;
    }
    const w = set.w > 0 ? convert(set.w, session.unit || 'lb', unit) : null;
    const e = est1RM(set.w, set.r) != null ? convert(est1RM(set.w, set.r), session.unit || 'lb', unit) : null;
    return {
      weight: w != null && w > maxW,
      e1rm: e != null && e > maxE,
    };
  }

  /* ---------- store (browser only) ---------- */
  let cache = null;
  let customCache = null;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* cache the in-flight PROMISE, not just the resolved array: two callers
     that both start while the cache is empty must share one fetch (and one
     set of session objects), else concurrent in-place mutations land on
     separate copies and the last save clobbers the others */
  async function all() {
    if (!cache) cache = DB.getAllWorkouts().catch(() => []);
    return cache;
  }
  // routine saves only drop the session cache; import drops everything
  // (incl. the custom-exercise cache) so a restored backup takes effect
  function invalidate() { cache = null; }
  function invalidateAll() { cache = null; customCache = null; }

  async function save(session) {
    session.updatedAt = new Date().toISOString();
    await DB.putWorkout(JSON.parse(JSON.stringify(session)));
    invalidate();
    return session;
  }
  async function remove(id) {
    await DB.deleteWorkout(id);
    invalidate();
  }

  function blank(date, unit, type) {
    return {
      id: 'w' + uuid(),
      date, type: type || null,
      startedAt: new Date().toISOString(), endedAt: null,
      unit: unit === 'kg' ? 'kg' : 'lb',
      exercises: [],
    };
  }

  /* ---------- exercise library ---------- */
  async function customExercises() {
    if (!customCache) customCache = (await DB.getSetting('customExercises').catch(() => null)) || [];
    return customCache;
  }
  async function addCustomExercise(name, grp) {
    const list = (await customExercises()).slice();
    const ex = { id: 'c' + uuid(), name: String(name).trim().slice(0, 60), grp: GROUPS.some(g => g.id === grp) ? grp : 'other', custom: true };
    list.push(ex);
    await DB.putSetting('customExercises', list);
    customCache = list;
    return ex;
  }
  async function library() {
    return EXERCISES.concat(await customExercises());
  }
  async function exerciseById(id) {
    return (await library()).find(e => e.id === id) || null;
  }

  const api = {
    GROUPS, EXERCISES,
    est1RM, setVolume, bestSet, doneSets, sessionStats,
    exerciseHistory, buckets, weekStart, monthStart,
    prevEntryFor, prFlags, convert, round1,
    all, invalidate, invalidateAll, save, remove, blank,
    library, customExercises, addCustomExercise, exerciseById,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
