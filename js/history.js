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
  function weightOf(rec) {
    return rec && typeof rec.weight === 'number' ? rec.weight : null;
  }
  function habitDone(rec, id) {
    return !!(rec && rec.habits && rec.habits[id]);
  }
  function workoutOf(rec) {
    return rec && typeof rec.workout === 'string' ? rec.workout : null;
  }
  function proteinTarget() {
    return (window.PT && window.PT.TOTALS && window.PT.TOTALS.p) || 316;
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
    const recs = keys.map(k => map.get(k) || null);
    const firstLogged = map.size ? [...map.keys()].sort()[0] : null;

    $('#histEmpty').hidden = map.size > 0;

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

    /* --- compliance --- */
    const meals = recs.map((r, i) => (counted[i] ? mealsDone(r) : null));
    draw('chartCompliance', {
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            data: trail7(r => mealsDone(r)),
            borderColor: BONE,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.35,
            spanGaps: true,
            order: 0,
          },
          {
            type: 'bar',
            data: meals,
            backgroundColor: meals.map(v => (v === 5 ? GREEN : BLUE)),
            borderRadius: 4,
            maxBarThickness: 18,
            order: 1,
          },
        ],
      },
      options: (() => {
        const o = baseOptions();
        o.scales.y.max = 5;
        o.scales.y.ticks.stepSize = 1;
        o.scales.x.grid.display = false;
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

    /* --- bodyweight --- */
    const weights = recs.map(weightOf);
    const ma = trail7(weightOf);
    const hasWeights = weights.some(v => v != null);
    draw('chartWeight', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: weights,
            borderColor: BLUE,
            borderWidth: 2,
            pointRadius: range === 7 ? 3 : 2,
            pointBackgroundColor: BLUE,
            tension: 0.2,
            spanGaps: true,
          },
          {
            data: hasWeights ? ma : [],
            borderColor: GREEN,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
            spanGaps: true,
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

    if (!denom) {
      set('statMeals', '—');
      set('statProtein', '—');
    } else {
      const mealVals = activeDays.map(x => mealsDone(x.rec)).filter(v => v != null);
      set('statMeals', mealVals.length
        ? (mealVals.reduce((a, v) => a + v, 0) / mealVals.length).toFixed(1) + '/5'
        : '—');
      const p = activeDays.reduce((a, x) => a + protein(x.rec), 0) / denom;
      set('statProtein', Math.round(p) + 'g');
    }

    const w1 = avg(last7.map(x => weightOf(x.rec)));
    const w0 = avg(prev7.map(weightOf));
    if (w1 != null && w0 != null) {
      const dw = Math.round((w1 - w0) * 10) / 10; // round first so -0.04 can't print "-0.0"
      set('statWeight', (dw > 0 ? '+' : '') + dw.toFixed(1) + 'lb');
    } else if (w1 != null) {
      set('statWeight', w1.toFixed(1) + 'lb');
    } else {
      set('statWeight', '—');
    }

    const best = streaks(map).sort((a, b) => b.streak - a.streak)[0];
    set('statStreak', best && best.streak > 0 ? best.streak + 'd ' + best.label : '—');
  }

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
