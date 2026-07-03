/* Pure shared math: units, macro/kcal arithmetic, target ranges,
   Mifflin-St Jeor estimation, trend-weight EWMA, expenditure estimate.
   Browser global (window.Targets) + node (module.exports) for tests. */
(function (root) {
  'use strict';

  const LB_PER_KG = 2.20462;
  const KCAL_PER_KG = 7700;
  const KCAL_PER_LB = 3500;

  /* ---------- units ----------
     profile units: 'kg' | 'lb'   day-record weightUnit: 'kg' | 'lbs' */
  function recordUnitFor(profileUnits) { return profileUnits === 'kg' ? 'kg' : 'lbs'; }
  function unitLabel(profileUnits) { return profileUnits === 'kg' ? 'kg' : 'lbs'; }
  function toProfileUnits(value, recordUnit, profileUnits) {
    if (typeof value !== 'number') return null;
    const isKg = recordUnit === 'kg';
    if (profileUnits === 'kg') return isKg ? value : value / LB_PER_KG;
    return isKg ? value * LB_PER_KG : value;
  }
  function toKg(value, unit) { return unit === 'kg' ? value : value / LB_PER_KG; }
  function round1(v) { return Math.round(v * 10) / 10; }

  /* ---------- macros ---------- */
  function kcalFromMacros(p, c, f) { return 4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0); }

  /* ---------- target ranges ----------
     types: 'band' lo≤x≤hi · 'floor' x≥lo · 'cap' x≤hi · 'none' never judged */
  function range(target, tolerancePct) {
    const t = (tolerancePct == null ? 6 : tolerancePct) / 100;
    return { lo: Math.round(target * (1 - t)), hi: Math.round(target * (1 + t)) };
  }
  function judge(value, target, tolerancePct, type) {
    if (type === 'none' || target == null) return 'none';
    const { lo, hi } = range(target, tolerancePct);
    if (type === 'floor') return value >= lo ? 'in' : 'under';
    if (type === 'cap') return value <= hi ? 'in' : 'over';
    return value < lo ? 'under' : value > hi ? 'over' : 'in'; // band
  }
  function rangeLabel(target, tolerancePct, type, unit) {
    const { lo, hi } = range(target, tolerancePct);
    const u = unit || '';
    if (type === 'floor') return lo + u + '+';
    if (type === 'cap') return '≤' + hi + u;
    return lo + '–' + hi + u;
  }

  /* ---------- estimation (onboarding) ---------- */
  const ACTIVITY = [
    { id: 'sedentary', label: 'Sedentary', desc: 'desk job, little exercise', x: 1.2 },
    { id: 'light',     label: 'Light',     desc: '1–3 workouts / week',      x: 1.375 },
    { id: 'moderate',  label: 'Moderate',  desc: '3–5 workouts / week',      x: 1.55 },
    { id: 'very',      label: 'Very',      desc: '6–7 workouts / week',      x: 1.725 },
    { id: 'extra',     label: 'Athlete',   desc: 'hard training + active job', x: 1.9 },
  ];
  const GOALS = [
    { id: 'lose',     label: 'Lose',     x: 0.85 },
    { id: 'maintain', label: 'Maintain', x: 1.0 },
    { id: 'gain',     label: 'Gain',     x: 1.10 },
  ];

  function mifflin(opts) {
    // sex 'm'|'f', weightKg, heightCm, age → BMR kcal/day
    const s = opts.sex === 'f' ? -161 : 5;
    return 10 * opts.weightKg + 6.25 * opts.heightCm - 5 * opts.age + s;
  }

  function suggestTargets(opts) {
    // { sex, weightKg, heightCm, age, activityId, goalId }
    const act = ACTIVITY.find(a => a.id === opts.activityId) || ACTIVITY[2];
    const goal = GOALS.find(g => g.id === opts.goalId) || GOALS[1];
    const tdee = mifflin(opts) * act.x;
    const kcal = Math.round(tdee * goal.x / 10) * 10;
    const p = Math.round(2 * opts.weightKg);        // 2 g/kg
    const f = Math.round(kcal * 0.25 / 9);          // 25% of kcal
    const c = Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4));
    return { kcal, p, c, f, tdee: Math.round(tdee) };
  }

  /* ---------- trend weight ----------
     EWMA over calendar days: on weigh-in days trend += α(w − trend);
     gap days carry the trend forward unchanged. Input: Map date→weight
     (already in one consistent unit) + ordered date list. Returns
     Map date→trend for dates from the first weigh-in onward. */
  function trendSeries(dates, weightByDate, alpha) {
    const a = alpha == null ? 0.10 : alpha;
    const out = new Map();
    let trend = null;
    for (const d of dates) {
      const w = weightByDate.get(d);
      if (typeof w === 'number') trend = trend == null ? w : trend + a * (w - trend);
      if (trend != null) out.set(d, trend);
    }
    return out;
  }

  /* ---------- expenditure estimate ----------
     entries: [{date, kcal|null, weight|null}] covering the rolling window,
     oldest→newest, weights in profile units. Weight slope comes from a
     least-squares fit over the window's weigh-ins (EWMA endpoints lag too
     much on a 21-day window and bias TDEE toward intake). Requires
     ≥minDays days with intake and weigh-ins near both ends. */
  function estimateExpenditure(entries, profileUnits, minDays) {
    const need = minDays == null ? 14 : minDays;
    const withIntake = entries.filter(e => typeof e.kcal === 'number' && e.kcal > 0);
    const points = entries
      .map((e, i) => ({ x: i, y: e.weight }))
      .filter(p => typeof p.y === 'number');
    const head = entries.slice(0, 5).some(e => typeof e.weight === 'number');
    const tail = entries.slice(-5).some(e => typeof e.weight === 'number');
    if (withIntake.length < need || !head || !tail || points.length < 4) {
      return { eligible: false, have: withIntake.length, needed: need };
    }
    const n = points.length;
    const mx = points.reduce((a, p) => a + p.x, 0) / n;
    const my = points.reduce((a, p) => a + p.y, 0) / n;
    const slope = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) /
                  points.reduce((a, p) => a + (p.x - mx) * (p.x - mx), 0); // units/day
    const kcalPerUnit = profileUnits === 'kg' ? KCAL_PER_KG : KCAL_PER_LB;
    const meanIntake = withIntake.reduce((a, e) => a + e.kcal, 0) / withIntake.length;
    const tdee = Math.round(meanIntake - slope * kcalPerUnit);
    return {
      eligible: true, tdee,
      meanIntake: Math.round(meanIntake),
      days: withIntake.length, windowDays: entries.length,
      weeklyChange: round1(slope * 7), // profile units per week, signed
    };
  }

  const api = {
    LB_PER_KG, KCAL_PER_KG, KCAL_PER_LB,
    recordUnitFor, unitLabel, toProfileUnits, toKg, round1,
    kcalFromMacros, range, judge, rangeLabel,
    ACTIVITY, GOALS, mifflin, suggestTargets,
    trendSeries, estimateExpenditure,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Targets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
