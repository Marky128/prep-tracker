/* History tab: Chart.js charts, habit heatmap, streaks and summary stats.
   Reads day records via DB; plan totals come from window.PT (set by app.js). */
const HistoryView = (() => {
  'use strict';

  const $ = s => document.querySelector(s);

  const BLUE = '#2f74d0';
  const BLUE_SOFT = 'rgba(47,116,208,.12)';
  const GREEN = '#5aa66a';
  const GRID = '#33363d';
  const MUTE = '#9a9da5';
  const BONE = '#eceae5';
  const IRON = '#1e2024';
  const MONO = "'IBM Plex Mono', ui-monospace, monospace";
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const HABITS = [
    { id: 'water',  label: 'Water'  },
    { id: 'salt',   label: 'Salt'   },
    { id: 'lemon',  label: 'Lemon'  },
    { id: 'steps',  label: 'Steps'  },
    { id: 'cardio', label: 'Cardio' },
    { id: 'supps',  label: 'Supps'  },
  ];

  const WORKOUTS = [
    { id: 'pull', label: 'Pull' },
    { id: 'push', label: 'Push' },
    { id: 'legs', label: 'Legs' },
    { id: 'arms', label: 'Arms' },
  ];

  let range = 7;
  let cache = null; // Map<dateStr, record>
  let lastKeys = []; // date keys of the current chart range (for tap→edit)
  const charts = {};

  /* ---------- date helpers (local time; noon avoids DST edge cases) ---------- */
  function dstr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function noonToday() { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  async function data() {
    if (!cache) {
      const days = await DB.getAllDays();
      cache = new Map(days.map(r => [r.date, r]));
    }
    return cache;
  }

  function invalidate() { cache = null; }

  /* ---------- record accessors ---------- */
  function mealsDone(rec) {
    if (rec && rec.mode === 'custom') return null; // custom days aren't 0/5 misses
    return rec && Array.isArray(rec.meals) ? rec.meals.filter(Boolean).length : 0;
  }
  function protein(rec) {
    if (!rec) return 0;
    if (rec.macros && typeof rec.macros.p === 'number') return rec.macros.p;
    const plan = window.PT && window.PT.PLAN;
    if (plan && Array.isArray(rec.meals)) {
      return rec.meals.reduce((a, done, i) => a + (done && plan[i] ? plan[i].p : 0), 0);
    }
    return 0;
  }
  function profileUnits() {
    return (window.PT && window.PT.profile && window.PT.profile.units) || 'lb';
  }
  function weightOf(rec) {
    if (!rec || typeof rec.weight !== 'number') return null;
    const u = rec.weightUnit === 'kg' ? 'kg' : 'lbs';
    return Targets.round1(Targets.toProfileUnits(rec.weight, u, profileUnits()));
  }
  function intakeOf(rec) {
    // kcal only for days with actual food logged
    if (!rec) return null;
    const logged = rec.mode === 'custom' ? (rec.items || []).length > 0 : (rec.meals || []).some(Boolean);
    if (!logged) return null;
    if (rec.macros && typeof rec.macros.kcal === 'number') return rec.macros.kcal;
    return rec.macros ? Targets.kcalFromMacros(rec.macros.p, rec.macros.c, rec.macros.f) : null;
  }
  /* compliance as a 0–1 fraction that works across modes */
  function complianceOf(rec) {
    if (!rec) return { v: 0, label: 'Nothing logged', done: false };
    if (rec.mode === 'custom') {
      if (!(rec.items || []).length) return { v: 0, label: 'Nothing logged', done: false };
      const snap = rec.targetsSnapshot || {};
      const verdict = Targets.judge(Math.round((rec.macros || {}).kcal || 0), snap.kcal, snap.tolerancePct, (snap.types || {}).kcal || 'band');
      return verdict === 'in'
        ? { v: 1, label: 'In calorie range', done: true }
        : { v: 0.35, label: 'Logged — outside calorie range', done: false };
    }
    const total = (window.PT && window.PT.PLAN && window.PT.PLAN.length) || 5;
    const n = Array.isArray(rec.meals) ? rec.meals.filter(Boolean).length : 0;
    return { v: n / total, label: n + '/' + total + ' meals', done: n === total };
  }
  function habitDone(rec, id) {
    return !!(rec && rec.habits && rec.habits[id]);
  }
  function workoutOf(rec) {
    return rec && typeof rec.workout === 'string' ? rec.workout : null;
  }
  function proteinTarget() {
    const PT = window.PT || {};
    // custom-mode users chart against their own protein target
    if (PT.profile && !PT.profile.activeProgramId && PT.profile.targets) {
      return PT.profile.targets.p || 316;
    }
    return (PT.TOTALS && PT.TOTALS.p) || 316;
  }

  function avg(vals) {
    const xs = vals.filter(v => v != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  /* ---------- chart plumbing ---------- */
  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: REDUCED ? false : { duration: 350 },
      interaction: { mode: 'nearest', intersect: false },
      onClick: (evt, els) => {
        if (els && els.length && window.PT && window.PT.openDay) {
          window.PT.openDay(lastKeys[els[0].index]);
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: IRON,
          borderColor: GRID,
          borderWidth: 1,
          titleColor: BONE,
          bodyColor: MUTE,
          titleFont: { family: MONO, size: 11 },
          bodyFont: { family: MONO, size: 11 },
          displayColors: false,
          padding: 10,
        },
      },
      scales: {
        x: {
          grid: { color: GRID, drawTicks: false },
          border: { color: GRID },
          ticks: {
            color: MUTE,
            font: { family: MONO, size: 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: range === 7 ? 7 : 6,
          },
        },
        y: {
          grid: { color: GRID },
          border: { color: GRID },
          ticks: { color: MUTE, font: { family: MONO, size: 9 } },
          beginAtZero: true,
        },
      },
    };
  }

  function draw(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($('#' + id), config);
  }

  /* ---------- rebuild everything ---------- */
  async function rebuild() {
    const map = await data();
    const today = noonToday();

    const dates = [];
    for (let i = range - 1; i >= 0; i--) dates.push(addDays(today, -i));
    const keys = dates.map(dstr);
    lastKeys = keys;
    const recs = keys.map(k => map.get(k) || null);
    const firstLogged = map.size ? [...map.keys()].sort()[0] : null;

    $('#histEmpty').hidden = map.size > 0;
    const protH3 = document.querySelector('#tab-history .block h3 em');
    if (protH3) protH3.textContent = '/ ' + proteinTarget() + 'g';
    const protKey = document.querySelector('#protKeyTarget');
    if (protKey) protKey.textContent = 'Target ' + proteinTarget() + 'g';

    const labels = dates.map(d =>
      range === 7
        ? d.toLocaleDateString(undefined, { weekday: 'short' })
        : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    );

    // a day counts as 0 once tracking has started; before that it is a gap
    const counted = keys.map(k => (firstLogged != null && k >= firstLogged));

    /* trailing 7-day series (windows may reach before the visible range) */
    function trail7(getValue) {
      return dates.map(d => {
        const vals = [];
        for (let i = 0; i < 7; i++) {
          const k = dstr(addDays(d, -i));
          if (firstLogged != null && k >= firstLogged) vals.push(getValue(map.get(k) || null));
        }
        return avg(vals);
      });
    }

    /* --- compliance (0–1 fraction; program = meals done, custom = kcal in range) --- */
    const comp = recs.map((r, i) => (counted[i] ? complianceOf(r) : null));
    draw('chartCompliance', {
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            data: trail7(r => complianceOf(r).v),
            borderColor: BONE,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.35,
            spanGaps: true,
            order: 0,
          },
          {
            type: 'bar',
            data: comp.map(c => (c ? c.v : null)),
            backgroundColor: comp.map(c => (c && c.done ? GREEN : BLUE)),
            borderRadius: 4,
            maxBarThickness: 18,
            order: 1,
          },
        ],
      },
      options: (() => {
        const o = baseOptions();
        o.scales.y.max = 1;
        o.scales.y.ticks.display = false;
        o.scales.x.grid.display = false;
        o.plugins.tooltip.callbacks = {
          label: ctx => {
            const c = comp[ctx.dataIndex];
            return c ? c.label : '';
          },
        };
        return o;
      })(),
    });

    /* --- protein --- */
    const prot = recs.map((r, i) => (counted[i] ? protein(r) : null));
    draw('chartProtein', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: prot,
            borderColor: BLUE,
            backgroundColor: BLUE_SOFT,
            fill: true,
            borderWidth: 2,
            pointRadius: range === 7 ? 3 : 0,
            pointBackgroundColor: BLUE,
            tension: 0.3,
            spanGaps: true,
          },
          {
            data: keys.map(() => proteinTarget()),
            borderColor: 'rgba(236,234,229,.45)',
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0,
          },
        ],
      },
      options: (() => {
        const o = baseOptions();
        o.scales.y.suggestedMax = proteinTarget() + 40;
        return o;
      })(),
    });

    /* --- bodyweight: trend line primary, raw weigh-ins as faded dots --- */
    const weights = recs.map(weightOf);
    // trend runs over full history (from the first weigh-in) so the line
    // is warm at the window edge, then is sampled at the visible dates
    const weighed = [...map.values()].filter(r => weightOf(r) != null)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    let trendData = keys.map(() => null);
    if (weighed.length) {
      const allDates = [];
      const start = new Date(weighed[0].date + 'T12:00:00');
      for (let d = new Date(start); ; d.setDate(d.getDate() + 1)) {
        const k = dstr(d);
        allDates.push(k);
        if (k === keys[keys.length - 1]) break;
        if (allDates.length > 3700) break; // ~10y guard
      }
      const wAll = new Map(weighed.map(r => [r.date, weightOf(r)]));
      const trendAll = Targets.trendSeries(allDates, wAll);
      trendData = keys.map(k => {
        const t = trendAll.get(k);
        return t == null ? null : Targets.round1(t);
      });
    }
    draw('chartWeight', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: trendData,
            borderColor: BLUE,
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0.3,
            spanGaps: true,
            order: 0,
          },
          {
            data: weights,
            showLine: false,
            pointRadius: range === 7 ? 3 : 2.5,
            pointBackgroundColor: 'rgba(47,116,208,.35)',
            pointBorderWidth: 0,
            order: 1,
          },
        ],
      },
      options: (() => {
        const o = baseOptions();
        o.scales.y.beginAtZero = false;
        o.scales.y.grace = '10%';
        return o;
      })(),
    });

    // training only became trackable with v2 — its "counts as rest" window
    // starts at the first record that carries a workout field, not firstLogged
    let firstTrain = null;
    for (const [k, r] of map) {
      if (r && 'workout' in r && (firstTrain == null || k < firstTrain)) firstTrain = k;
    }
    const trainCounted = keys.map(k => firstTrain != null && k >= firstTrain);

    renderHeatmap(keys, recs, counted);
    renderTraining(keys, recs, trainCounted);
    renderStreaks(map);
    renderStats(map);
    renderExpenditure(map);
  }

  /* ---------- expenditure estimate (rolling 21 days) ---------- */
  let lastSuggestion = null;
  let expWired = false;

  function renderExpenditure(map) {
    const today = noonToday();
    const entries = [];
    for (let i = 20; i >= 0; i--) {
      const k = dstr(addDays(today, -i));
      const rec = map.get(k) || null;
      entries.push({ date: k, kcal: intakeOf(rec), weight: weightOf(rec) });
    }
    const units = profileUnits();
    const r = Targets.estimateExpenditure(entries, units);
    const val = document.querySelector('#expVal');
    const note = document.querySelector('#expNote');
    const suggest = document.querySelector('#expSuggest');

    if (!r.eligible) {
      val.textContent = '—';
      note.textContent = 'Not enough data yet (' + r.have + '/' + r.needed +
        ' days with food logged in the last 3 weeks, plus weigh-ins near both ends).';
      suggest.hidden = true;
      lastSuggestion = null;
      return;
    }

    const unitLab = units === 'kg' ? 'kg' : 'lb';
    const chg = r.weeklyChange;
    const chgTxt = chg === 0 ? 'held steady'
      : (chg > 0 ? 'trended up ' : 'trended down ') + Math.abs(chg).toFixed(1) + ' ' + unitLab + '/week';
    const hasProgramDays = [...map.values()].some(x => x && x.mode !== 'custom' && intakeOf(x) != null);
    val.textContent = r.tdee.toLocaleString();
    note.textContent = 'Over ' + r.days + ' logged days your intake averaged out while your trend weight ' +
      chgTxt + ' — that puts your estimated daily burn at ' + r.tdee.toLocaleString() + ' kcal.' +
      (hasProgramDays ? ' Program-day calories are computed from meal macros.' : '');

    const profile = window.PT.profile || {};
    const goal = (profile.estimator && profile.estimator.goalId) || 'maintain';
    const goalX = goal === 'lose' ? 0.85 : goal === 'gain' ? 1.10 : 1.0;
    const kcal = Math.round(r.tdee * goalX / 10) * 10;
    const p = (profile.targets && profile.targets.p) || Math.round(kcal * 0.3 / 4);
    const f = Math.round(kcal * 0.25 / 9);
    const c = Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4));
    lastSuggestion = { kcal, p, c, f };
    const goalWord = goal === 'lose' ? 'to keep losing' : goal === 'gain' ? 'to keep gaining' : 'to maintain';
    document.querySelector('#suggestLine').textContent =
      'Suggestion ' + goalWord + ': ' + kcal.toLocaleString() + ' kcal';
    document.querySelector('#suggestMeta').textContent =
      'P' + p + ' · C' + c + ' · F' + f + ' — never applied automatically';
    suggest.hidden = false;

    if (!expWired) {
      expWired = true;
      document.querySelector('#applyTargets').addEventListener('click', () => {
        if (!lastSuggestion || !window.PT.applyTargets) return;
        const s = lastSuggestion;
        if (confirm('Set your targets to ' + s.kcal.toLocaleString() + ' kcal · P' + s.p + ' C' + s.c + ' F' + s.f + '?')) {
          window.PT.applyTargets(s).then(() => rebuild());
        }
      });
    }
  }

  /* ---------- training grid + session counts ---------- */
  function renderTraining(keys, recs, counted) {
    const grid = $('#trainmap');
    grid.innerHTML = '';
    WORKOUTS.forEach(w => {
      const row = document.createElement('div');
      row.className = 'hm-row';
      const lab = document.createElement('span');
      lab.className = 'hm-lab';
      lab.textContent = w.label;
      row.appendChild(lab);
      recs.forEach((rec, i) => {
        const cell = document.createElement('i');
        const hit = workoutOf(rec) === w.id;
        cell.className = 'hm-cell ' + (!counted[i] ? 'blank' : hit ? 'on' : 'off');
        cell.title = keys[i] + ' · ' + w.label + (hit ? ' ✓' : '');
        cell.dataset.date = keys[i];
        row.appendChild(cell);
      });
      grid.appendChild(row);
    });
    grid.scrollLeft = grid.scrollWidth;

    const wrap = $('#trainStats');
    wrap.innerHTML = '';
    const activeRecs = recs.filter((_, i) => counted[i]);
    let sessions = 0;
    WORKOUTS.forEach(w => {
      const n = activeRecs.filter(r => workoutOf(r) === w.id).length;
      sessions += n;
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.innerHTML = '<b>' + w.label.toUpperCase() + '</b> <em>×' + n + '</em>';
      wrap.appendChild(pill);
    });
    const rest = document.createElement('span');
    rest.className = 'pill';
    rest.innerHTML = '<b>REST</b> <em>×' + (activeRecs.length - sessions) + '</em>';
    wrap.appendChild(rest);
  }

  /* ---------- habit heatmap ---------- */
  function renderHeatmap(keys, recs, counted) {
    const wrap = $('#heatmap');
    wrap.innerHTML = '';
    HABITS.forEach(h => {
      const row = document.createElement('div');
      row.className = 'hm-row';
      const lab = document.createElement('span');
      lab.className = 'hm-lab';
      lab.textContent = h.label;
      row.appendChild(lab);
      recs.forEach((rec, i) => {
        const cell = document.createElement('i');
        cell.className = 'hm-cell ' + (!counted[i] ? 'blank' : habitDone(rec, h.id) ? 'on' : 'off');
        cell.title = keys[i] + ' · ' + h.label + (habitDone(rec, h.id) ? ' ✓' : '');
        cell.dataset.date = keys[i];
        row.appendChild(cell);
      });
      wrap.appendChild(row);
    });
    wrap.scrollLeft = wrap.scrollWidth; // newest days visible first
  }

  /* ---------- streaks ---------- */
  function streaks(map) {
    const today = noonToday();
    return HABITS.map(h => {
      let d = new Date(today);
      // an unchecked today shouldn't zero a live streak — start from yesterday
      if (!habitDone(map.get(dstr(d)), h.id)) d = addDays(d, -1);
      let n = 0;
      while (habitDone(map.get(dstr(d)), h.id)) { n++; d = addDays(d, -1); }
      return { ...h, streak: n };
    });
  }

  function renderStreaks(map) {
    const wrap = $('#streaks');
    wrap.innerHTML = '';
    const list = streaks(map);
    const best = Math.max(...list.map(s => s.streak));
    list.forEach(s => {
      const pill = document.createElement('span');
      pill.className = 'pill' + (s.streak > 0 && s.streak === best ? ' best' : '');
      pill.innerHTML = '<b>' + s.label + '</b> <em>' + s.streak + 'd</em>';
      wrap.appendChild(pill);
    });
  }

  /* ---------- summary stat cards ---------- */
  function renderStats(map) {
    const today = noonToday();
    const firstLogged = map.size ? [...map.keys()].sort()[0] : null;

    const last7 = [];
    const prev7 = [];
    for (let i = 0; i < 7; i++) {
      const k = dstr(addDays(today, -i));
      last7.push({ key: k, rec: map.get(k) || null });
    }
    for (let i = 7; i < 14; i++) prev7.push(map.get(dstr(addDays(today, -i))) || null);

    // average over days since tracking started, capped at 7
    const activeDays = last7.filter(x => firstLogged != null && x.key >= firstLogged);
    const denom = activeDays.length;

    const set = (id, text) => { $('#' + id).textContent = text; };

    const mealsLab = $('#statMeals').parentElement.querySelector('.lab');
    if (!denom) {
      set('statMeals', '—');
      set('statProtein', '—');
    } else {
      const mealVals = activeDays.map(x => mealsDone(x.rec)).filter(v => v != null);
      const customDays = activeDays.filter(x => x.rec && x.rec.mode === 'custom');
      if (mealVals.length >= customDays.length && mealVals.length) {
        set('statMeals', (mealVals.reduce((a, v) => a + v, 0) / mealVals.length).toFixed(1) + '/5');
        mealsLab.textContent = 'Avg meals / day · 7d';
      } else if (customDays.length) {
        const inR = customDays.filter(x => complianceOf(x.rec).done).length;
        set('statMeals', inR + '/' + customDays.length);
        mealsLab.textContent = 'Days in range · 7d';
      } else {
        set('statMeals', '—');
      }
      const p = activeDays.reduce((a, x) => a + protein(x.rec), 0) / denom;
      set('statProtein', Math.round(p) + 'g');
    }

    const unitLab = profileUnits() === 'kg' ? 'kg' : 'lb';
    const w1 = avg(last7.map(x => weightOf(x.rec)));
    const w0 = avg(prev7.map(weightOf));
    if (w1 != null && w0 != null) {
      const dw = Math.round((w1 - w0) * 10) / 10; // round first so -0.04 can't print "-0.0"
      set('statWeight', (dw > 0 ? '+' : '') + dw.toFixed(1) + unitLab);
    } else if (w1 != null) {
      set('statWeight', w1.toFixed(1) + unitLab);
    } else {
      set('statWeight', '—');
    }

    const best = streaks(map).sort((a, b) => b.streak - a.streak)[0];
    set('statStreak', best && best.streak > 0 ? best.streak + 'd ' + best.label : '—');
  }

  /* ---------- tap a day cell to open it for editing ---------- */
  ['#heatmap', '#trainmap'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('click', e => {
      const cell = e.target.closest('.hm-cell');
      if (cell && cell.dataset.date && window.PT && window.PT.openDay) {
        window.PT.openDay(cell.dataset.date);
      }
    });
  });

  /* ---------- range toggle ---------- */
  document.querySelectorAll('.range-toggle .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-toggle .chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      range = +btn.dataset.range;
      rebuild();
    });
  });

  return { show: rebuild, invalidate };
})();
