/* Train tab: session logging (MacroFactor-style set table with a
   "previous" column, prefilled repeats, PR badges) plus progress
   analytics (per-exercise est-1RM/top-weight/volume trends with
   session-by-session deltas, weekly/monthly tonnage, session history).
   Data + math live in js/workouts.js; this module is rendering + wiring. */
const TrainView = (() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const TYPES = [
    { id: 'pull', name: 'Pull' },
    { id: 'push', name: 'Push' },
    { id: 'legs', name: 'Legs' },
    { id: 'arms', name: 'Arms' },
  ];

  let profile = null;
  let wired = false;
  let openId = null;        // session open in the editor (null = resolve from today)
  let exSelected = null;    // exercise shown in the progress chart
  let metric = 'e1rm';
  let volMode = 'week';
  let pickerGroup = 'all';
  const charts = {};

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function unit() { return profile && profile.units === 'kg' ? 'kg' : 'lb'; }
  function fmtDate(key) {
    return new Date(key + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtShort(key) {
    return new Date(key + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function fmtVol(v, u) {
    if (v >= 10000) return Math.round(v / 1000) + 'k ' + u;
    return v.toLocaleString() + ' ' + u;
  }
  function typeName(t) {
    const x = TYPES.find(y => y.id === t);
    return x ? x.name : null;
  }

  async function sessionById(id) {
    return (await Workouts.all()).find(w => w.id === id) || null;
  }

  /* ---------- day-tag sync (History heatmap reads rec.workout) ---------- */
  async function retagDay(date, deletedType) {
    const sessions = (await Workouts.all()).filter(w => w.date === date && w.endedAt);
    let tag = null;
    for (const w of sessions) if (w.type) tag = w.type; // getAllWorkouts is date-sorted; same-day order is fine
    if (!sessions.length && deletedType === undefined) return;
    if (window.PT && window.PT.tagWorkout) await window.PT.tagWorkout(date, tag);
  }

  /* ================= session card / editor ================= */

  async function resolveOpen() {
    const all = await Workouts.all();
    if (openId) {
      if (all.some(w => w.id === openId)) return openId;
      openId = null;
    }
    // most recent unfinished session, any day — resumes a workout that a
    // mid-session reload (iOS evicts backgrounded PWAs) left in progress
    let active = null;
    for (const w of all) if (!w.endedAt) active = w; // all() is date+start ordered
    return active ? active.id : null;
  }

  async function renderSession() {
    const wrap = $('#trainSession');
    const all = await Workouts.all();
    const id = await resolveOpen();
    if (id) {
      // adopt the resolved id so every mutateOpen/finish/discard keyed off
      // openId actually targets this session (else the editor is inert)
      openId = id;
      const s = all.find(w => w.id === id);
      wrap.innerHTML = await editorHTML(s, all);
      return;
    }
    const todayDone = all.filter(w => w.date === todayStr() && w.endedAt);
    wrap.innerHTML = startHTML(all, todayDone);
  }

  function startHTML(all, todayDone) {
    let html = '';
    if (todayDone.length) {
      html += todayDone.map(s => {
        const st = Workouts.sessionStats(s);
        const mins = s.endedAt && s.startedAt ? Math.max(1, Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000)) : null;
        return '<div class="train-card done-card">' +
          '<div class="swap-lab">Logged today</div>' +
          '<div class="done-main"><b>' + esc(typeName(s.type) || 'Workout') + '</b>' +
          '<span class="done-meta">' + st.sets + ' sets · ' + fmtVol(st.volume, s.unit) + (mins ? ' · ' + mins + ' min' : '') + '</span></div>' +
          '<button class="btn btn-slim" data-act="open-session" data-id="' + s.id + '">Edit</button>' +
          '</div>';
      }).join('');
    }
    const lastByType = {};
    for (const w of all) if (w.type && w.endedAt) lastByType[w.type] = w; // date-sorted → last wins
    html += '<div class="train-card">' +
      '<div class="swap-lab">' + (todayDone.length ? 'Start another session' : "Start today's session") + '</div>' +
      '<div class="type-grid">' +
      TYPES.map(t => {
        const last = lastByType[t.id];
        const sub = last
          ? 'repeats ' + fmtShort(last.date) + ' · ' + (last.exercises || []).length + ' exercises'
          : 'start fresh';
        return '<button class="type-card" data-act="start-type" data-type="' + t.id + '">' +
          '<b>' + t.name + '</b><span>' + esc(sub) + '</span></button>';
      }).join('') +
      '</div>' +
      '<button class="btn" data-act="start-empty">Empty workout</button>' +
      (all.length ? '' : '<p class="note">Pick a session type — the next time you train it, your last numbers show up next to every set.</p>') +
      '</div>';
    return html;
  }

  async function editorHTML(s, all) {
    const editingPast = s.date !== todayStr();
    const finished = !!s.endedAt;
    const u = s.unit;
    const started = new Date(s.startedAt);
    const startLab = isNaN(started) ? '' : started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    let head = '<div class="train-card editor">' +
      '<div class="ed-head">' +
        '<div class="ed-title"><div class="swap-lab">' +
          (finished ? 'Editing session' : 'Active session') + ' · ' + esc(fmtDate(s.date)) + (startLab && !finished ? ' · started ' + startLab : '') +
        '</div>' +
        '<div class="chips ed-type">' +
          TYPES.map(t => '<button class="chip' + (s.type === t.id ? ' active' : '') + '" data-act="set-type" data-type="' + t.id + '">' + t.name + '</button>').join('') +
        '</div></div>' +
      '</div>';

    const lib = await Workouts.library();
    const grpName = id => { const e = lib.find(x => x.id === id); const g = e && Workouts.GROUPS.find(x => x.id === e.grp); return g ? g.name : ''; };

    const cards = (s.exercises || []).map((ex, xi) => {
      const prev = Workouts.prevEntryFor(all, ex.exId, s);
      const prevSets = prev ? Workouts.doneSets(prev.ex) : [];
      const prevU = prev ? (prev.w.unit || 'lb') : u;
      const rows = (ex.sets || []).map((set, si) => {
        const p = prevSets[si] || prevSets[prevSets.length - 1] || null;
        const pw = p && p.w > 0 ? Workouts.round1(Workouts.convert(p.w, prevU, u)) : null;
        const prevLab = p ? ((pw != null ? pw + ' × ' : '') + p.r) : '—';
        let pr = '';
        if (set.done && set.r > 0) {
          const f = Workouts.prFlags(all, ex.exId, s, set, u);
          if (f.weight || f.e1rm) pr = '<i class="pr-pill">PR</i>';
        }
        return '<div class="sr-row' + (set.done ? ' done' : '') + '" data-ex="' + xi + '" data-set="' + si + '">' +
          '<span class="set-n">' + (si + 1) + '</span>' +
          '<button class="set-prev" data-act="prev" data-ex="' + xi + '" data-set="' + si + '"' + (p ? '' : ' disabled') + '>' + prevLab + '</button>' +
          '<input class="set-in in-w" type="number" inputmode="decimal" min="0" step="any" placeholder="' + (pw != null ? pw : '') + '" value="' + (set.w != null ? set.w : '') + '" data-ex="' + xi + '" data-set="' + si + '" aria-label="Weight">' +
          '<span class="rep-cell">' +
            '<input class="set-in in-r" type="number" inputmode="numeric" min="0" step="1" placeholder="' + (p ? p.r : '') + '" value="' + (set.r != null ? set.r : '') + '" data-ex="' + xi + '" data-set="' + si + '" aria-label="Reps">' +
            pr +
          '</span>' +
          '<button class="set-done" data-act="done" data-ex="' + xi + '" data-set="' + si + '" aria-label="Set done">' +
            '<svg viewBox="0 0 16 16" fill="none"><path d="M2.5 8.5L6 12l7.5-8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<button class="set-rm" data-act="rm-set" data-ex="' + xi + '" data-set="' + si + '" aria-label="Remove set">×</button>' +
          '</div>';
      }).join('');
      return '<div class="ex-card">' +
        '<div class="ex-head">' +
          '<div class="ex-name"><b>' + esc(ex.name) + '</b><span>' + esc(grpName(ex.exId)) + '</span></div>' +
          '<button class="set-rm ex-rm" data-act="rm-ex" data-ex="' + xi + '" aria-label="Remove exercise">×</button>' +
        '</div>' +
        '<div class="sr-head"><span>Set</span><span>Prev</span><span>' + u + '</span><span>Reps</span><span></span><span></span></div>' +
        rows +
        '<button class="add-row" data-act="add-set" data-ex="' + xi + '">+ Add set</button>' +
        '</div>';
    }).join('');

    let foot = '<button class="btn add-ex-btn" data-act="add-ex">+ Add exercise</button>';
    if (!finished) {
      foot += '<button class="btn btn-primary" data-act="finish">Finish workout</button>';
    } else {
      foot += '<button class="btn btn-primary" data-act="close-editor">Done' + (editingPast ? ' editing' : '') + '</button>';
    }
    foot += '<button class="btn-ghost" data-act="discard">' + (finished ? 'Delete this session' : 'Discard workout') + '</button>';

    return head + cards + foot + '</div>';
  }

  /* ================= analytics ================= */

  async function renderWeek() {
    const all = (await Workouts.all()).filter(w => Workouts.sessionStats(w).sets > 0 || w.endedAt);
    const block = $('#trainWeekBlock');
    if (!all.length) { block.hidden = true; return; }
    block.hidden = false;
    const u = unit() === 'kg' ? 'kg' : 'lb';
    const thisWk = Workouts.weekStart(todayStr());
    const bks = Workouts.buckets(all, 'week', unit());
    const cur = bks.find(b => b.start === thisWk) || { sessions: 0, sets: 0, volume: 0 };
    const prevKey = (() => {
      const d = new Date(thisWk + 'T12:00:00');
      d.setDate(d.getDate() - 7); // local date math — toISOString would shift across UTC
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const prev = bks.find(b => b.start === prevKey) || null;
    const delta = (a, b) => {
      if (!b) return '';
      const d = a - b;
      if (!d) return '<small>= last wk</small>';
      return '<small class="' + (d > 0 ? 'cap-green' : '') + '">' + (d > 0 ? '+' : '') + d.toLocaleString() + ' vs last wk</small>';
    };
    // PRs this week
    let prs = 0;
    for (const w of all) {
      if (Workouts.weekStart(w.date) !== thisWk) continue;
      for (const ex of w.exercises || []) {
        for (const set of Workouts.doneSets(ex)) {
          const f = Workouts.prFlags(all, ex.exId, w, set, unit());
          if (f.weight || f.e1rm) { prs++; break; } // count each exercise once
        }
      }
    }
    $('#trainWeekStats').innerHTML =
      '<div class="target"><div class="val">' + cur.sessions + ' ' + delta(cur.sessions, prev && prev.sessions) + '</div><div class="lab">Sessions</div></div>' +
      '<div class="target"><div class="val">' + cur.sets + ' ' + delta(cur.sets, prev && prev.sets) + '</div><div class="lab">Sets</div></div>' +
      '<div class="target"><div class="val">' + fmtVol(cur.volume, u) + '</div><div class="lab">Volume ' + (prev ? '· last wk ' + fmtVol(prev.volume, u) : '') + '</div></div>' +
      '<div class="target' + (prs ? ' hot' : '') + '"><div class="val">' + prs + '</div><div class="lab">PR' + (prs === 1 ? '' : 's') + ' this week</div></div>';
  }

  function draw(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($('#' + id), config);
  }

  function chartBase(C) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.iron, borderColor: C.grid, borderWidth: 1,
          titleColor: C.bone, bodyColor: C.mute,
          titleFont: { family: "'IBM Plex Mono', ui-monospace, monospace", size: 11 },
          bodyFont: { family: "'IBM Plex Mono', ui-monospace, monospace", size: 11 },
          displayColors: false, padding: 10,
        },
      },
      scales: {
        x: {
          grid: { color: C.grid, drawTicks: false }, border: { color: C.grid },
          ticks: { color: C.mute, font: { family: "'IBM Plex Mono', ui-monospace, monospace", size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
        },
        y: {
          grid: { color: C.grid }, border: { color: C.grid },
          ticks: { color: C.mute, font: { family: "'IBM Plex Mono', ui-monospace, monospace", size: 10 } },
          beginAtZero: false,
        },
      },
    };
  }

  async function renderProgress() {
    const all = await Workouts.all();
    const block = $('#trainProgressBlock');
    // exercises with at least one completed set, most recently used first
    const seen = new Map();
    for (const w of all) {
      for (const ex of w.exercises || []) {
        if (Workouts.doneSets(ex).length) seen.set(ex.exId, { exId: ex.exId, name: ex.name, date: w.date });
      }
    }
    const used = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!used.length) { block.hidden = true; return; }
    block.hidden = false;
    if (!exSelected || !seen.has(exSelected)) exSelected = used[0].exId;

    $('#trainExChips').innerHTML = used.slice(0, 14).map(e =>
      '<button class="chip' + (e.exId === exSelected ? ' active' : '') + '" data-exsel="' + e.exId + '">' + esc(e.name) + '</button>').join('');
    $$('#trainMetricChips .chip').forEach(c => c.classList.toggle('active', c.dataset.metric === metric));

    const u = unit();
    const hist = Workouts.exerciseHistory(all, exSelected, u);
    const pts = hist.filter(h => (metric === 'volume' ? h.volume > 0 : h[metric] != null));
    const C = Appearance.colors();
    const labels = pts.map(h => fmtShort(h.date));
    const values = pts.map(h => metric === 'volume' ? h.volume : h[metric]);
    const ids = pts.map(h => h.sessionId);

    const base = chartBase(C);
    base.plugins.tooltip.callbacks = {
      title: items => (items.length ? fmtDate(pts[items[0].dataIndex].date) : ''),
      label: ctx => {
        const h = pts[ctx.dataIndex];
        if (metric === 'volume') return h.volume.toLocaleString() + ' ' + u + ' total';
        const top = (h.topW != null ? h.topW + ' × ' : '') + h.topR;
        return (metric === 'e1rm' ? 'est 1RM ' + h.e1rm : 'top ' + h.topW) + ' ' + u + ' (' + top + ')';
      },
    };
    base.onClick = (evt, els) => {
      if (els && els.length) { openId = ids[els[0].index]; renderSession(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    };
    base.scales.y.grace = '10%';
    draw('chartExercise', {
      type: 'line',
      data: { labels, datasets: [{
        data: values,
        borderColor: C.accent, backgroundColor: C.accentSoft, fill: metric === 'volume',
        borderWidth: 2, pointRadius: pts.length > 20 ? 0 : 3.5, pointBackgroundColor: C.accent, tension: 0.3,
      }] },
      options: base,
    });

    const metricLab = { e1rm: 'estimated 1RM', topW: 'top-set weight', volume: 'session volume' }[metric];
    $('#exChartCap').textContent = 'Each point is one session’s ' + metricLab + ' (' + u + '). Tap a point to open that session.';

    // session-by-session list, newest first, with deltas
    const rows = pts.slice(-8).reverse().map((h, i, arr) => {
      const prevH = arr[i + 1] || null;
      const v = metric === 'volume' ? h.volume : h[metric];
      const pv = prevH ? (metric === 'volume' ? prevH.volume : prevH[metric]) : null;
      let d = '';
      if (pv != null && v != null) {
        const diff = Workouts.round1(v - pv);
        d = diff === 0 ? '<span class="delta">=</span>'
          : '<span class="delta ' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '▲ +' : '▼ ') + Math.abs(diff).toLocaleString() + '</span>';
      }
      const top = (h.topW != null ? h.topW + ' × ' : '') + h.topR;
      return '<button class="ex-sess" data-act="open-session" data-id="' + h.sessionId + '">' +
        '<span class="es-date">' + fmtShort(h.date) + '</span>' +
        '<span class="es-top">' + top + '</span>' +
        '<span class="es-val">' + (v != null ? v.toLocaleString() : '—') + ' ' + u + '</span>' + d +
        '</button>';
    }).join('');
    $('#exSessionList').innerHTML = rows;
  }

  async function renderVolume() {
    const all = await Workouts.all();
    const block = $('#trainVolumeBlock');
    const withSets = all.filter(w => Workouts.sessionStats(w).sets > 0);
    if (withSets.length < 2) { block.hidden = true; return; }
    block.hidden = false;
    $$('.vol-toggle .chip').forEach(c => c.classList.toggle('active', c.dataset.vol === volMode));
    const u = unit();
    let bks = Workouts.buckets(withSets, volMode, u);
    bks = bks.slice(-12);
    const curKey = volMode === 'week' ? Workouts.weekStart(todayStr()) : Workouts.monthStart(todayStr());
    const C = Appearance.colors();
    const labels = bks.map(b => volMode === 'week' ? fmtShort(b.start) : new Date(b.start + 'T12:00:00').toLocaleDateString(undefined, { month: 'short' }));
    const base = chartBase(C);
    base.scales.y.beginAtZero = true;
    base.plugins.tooltip.callbacks = {
      title: items => (items.length ? (volMode === 'week' ? 'Week of ' + fmtDate(bks[items[0].dataIndex].start) : labels[items[0].dataIndex]) : ''),
      label: ctx => {
        const b = bks[ctx.dataIndex];
        return b.volume.toLocaleString() + ' ' + u + ' · ' + b.sets + ' sets · ' + b.sessions + ' session' + (b.sessions === 1 ? '' : 's');
      },
    };
    draw('chartVolume', {
      type: 'bar',
      data: { labels, datasets: [{
        data: bks.map(b => b.volume),
        backgroundColor: bks.map(b => b.start === curKey ? C.accentSoft : C.accent),
        borderColor: bks.map(b => b.start === curKey ? C.accent : 'transparent'),
        borderWidth: 1.5,
        borderRadius: 5, maxBarThickness: 26,
      }] },
      options: base,
    });
  }

  async function renderHistory() {
    const all = await Workouts.all();
    const block = $('#trainHistoryBlock');
    if (!all.length) { block.hidden = true; return; }
    block.hidden = false;
    const u2 = s => s.unit || 'lb';
    const rows = all.slice().reverse().slice(0, 30).map(s => {
      const st = Workouts.sessionStats(s);
      const names = (s.exercises || []).map(e => e.name).slice(0, 3).join(', ');
      return '<button class="sess-row" data-act="open-session" data-id="' + s.id + '">' +
        '<div class="sess-main"><b>' + esc(typeName(s.type) || 'Workout') + (s.endedAt ? '' : ' · in progress') + '</b>' +
        '<span class="sess-date">' + fmtShort(s.date) + '</span></div>' +
        '<div class="sess-meta">' + st.sets + ' sets · ' + fmtVol(st.volume, u2(s)) + (names ? ' · ' + esc(names) : '') + '</div>' +
        '</button>';
    }).join('');
    $('#sessionList').innerHTML = rows;
  }

  async function renderAnalytics() {
    await renderWeek();
    await renderProgress();
    await renderVolume();
    await renderHistory();
  }

  /* ================= mutations ================= */

  async function startSession(type) {
    const all = await Workouts.all();
    const s = Workouts.blank(todayStr(), unit(), type);
    if (type) {
      const last = all.filter(w => w.type === type && w.endedAt).pop();
      if (last) {
        s.exercises = (last.exercises || []).map(ex => ({
          exId: ex.exId, name: ex.name,
          sets: Workouts.doneSets(ex).map(() => ({ w: null, r: null, done: false })),
        })).filter(ex => ex.sets.length);
      }
    }
    await Workouts.save(s);
    openId = s.id;
    await renderSession();
    await renderHistory();
  }

  async function mutateOpen(fn, structural) {
    const s = await sessionById(openId);
    if (!s) return;
    fn(s);
    await Workouts.save(s);
    if (structural) await renderSession();
  }

  async function finishSession() {
    const s = await sessionById(openId);
    if (!s) return;
    // drop sets never filled in, then empty exercises
    for (const ex of s.exercises || []) {
      ex.sets = (ex.sets || []).filter(x => x.done || x.w != null || x.r != null);
    }
    s.exercises = (s.exercises || []).filter(ex => ex.sets.length);
    s.endedAt = new Date().toISOString();
    await Workouts.save(s);
    await retagDay(s.date);
    openId = null;
    await renderSession();
    await renderAnalytics();
  }

  async function discardSession() {
    const s = await sessionById(openId);
    if (!s) return;
    const label = s.endedAt ? 'Delete this session? Its sets are gone for good.' : 'Discard this workout?';
    if (!confirm(label)) return;
    await Workouts.remove(s.id);
    await retagDay(s.date, s.type || null);
    openId = null;
    await renderSession();
    await renderAnalytics();
  }

  /* ================= exercise picker ================= */

  function openPicker() {
    pickerGroup = 'all';
    $('#exSearch').value = '';
    $('#exCustom').hidden = true;
    $('#exCustomToggle').hidden = false;
    $('#exSheet').classList.add('open');
    $('#exBackdrop').classList.add('open');
    renderPicker();
  }
  function closePicker() {
    $('#exSheet').classList.remove('open');
    $('#exBackdrop').classList.remove('open');
  }

  async function renderPicker() {
    const q = ($('#exSearch').value || '').trim().toLowerCase();
    $('#exGroups').innerHTML =
      '<button class="chip' + (pickerGroup === 'all' ? ' active' : '') + '" data-grp="all">All</button>' +
      Workouts.GROUPS.map(g => '<button class="chip' + (pickerGroup === g.id ? ' active' : '') + '" data-grp="' + g.id + '">' + g.name + '</button>').join('');

    const lib = await Workouts.library();
    const all = await Workouts.all();
    const match = e =>
      (pickerGroup === 'all' || e.grp === pickerGroup) &&
      (!q || e.name.toLowerCase().includes(q));
    const groupName = id => { const g = Workouts.GROUPS.find(x => x.id === id); return g ? g.name : ''; };
    const row = e => '<div class="food-row"><div class="food-row-main" role="button" tabindex="0" data-pick="' + e.id + '">' +
      '<div class="food-info food-info-db"><span class="food-name">' + esc(e.name) + '</span>' +
      '<span class="food-meta">' + groupName(e.grp) + (e.custom ? ' · custom' : '') + '</span></div></div></div>';

    let html = '';
    if (!q && pickerGroup === 'all') {
      const recent = new Map();
      for (const w of all.slice().reverse()) {
        for (const ex of w.exercises || []) {
          if (!recent.has(ex.exId)) {
            const e = lib.find(x => x.id === ex.exId);
            if (e) recent.set(ex.exId, e);
          }
          if (recent.size >= 6) break;
        }
        if (recent.size >= 6) break;
      }
      if (recent.size) html += '<div class="res-label">Recent</div>' + [...recent.values()].map(row).join('');
      for (const g of Workouts.GROUPS) {
        const list = lib.filter(e => e.grp === g.id);
        if (list.length) html += '<div class="res-label">' + g.name + '</div>' + list.map(row).join('');
      }
    } else {
      const hits = lib.filter(match);
      html = hits.length ? hits.map(row).join('')
        : '<p class="note">No match — create it as a custom exercise below.</p>';
    }
    $('#exResults').innerHTML = html;
  }

  async function addExercise(exId) {
    const e = await Workouts.exerciseById(exId);
    if (!e) return;
    await mutateOpen(s => {
      if (!Array.isArray(s.exercises)) s.exercises = []; // imported sessions may be minimal
      if (s.exercises.some(x => x.exId === exId)) return;
      s.exercises.push({ exId: e.id, name: e.name, sets: [{ w: null, r: null, done: false }, { w: null, r: null, done: false }, { w: null, r: null, done: false }] });
    }, true);
    closePicker();
  }

  /* ================= wiring ================= */

  function wire() {
    if (wired) return;
    wired = true;

    $('#trainSession').addEventListener('click', async e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      const xi = +act.dataset.ex;
      const si = +act.dataset.set;

      if (a === 'start-type') return startSession(act.dataset.type);
      if (a === 'start-empty') return startSession(null);
      if (a === 'open-session') { openId = act.dataset.id; return renderSession(); }
      if (a === 'close-editor') { openId = null; await renderSession(); return renderAnalytics(); }
      if (a === 'finish') return finishSession();
      if (a === 'discard') return discardSession();
      if (a === 'add-ex') return openPicker();
      if (a === 'set-type') {
        const s = await sessionById(openId);
        if (!s) return;
        const next = s.type === act.dataset.type ? null : act.dataset.type;
        await mutateOpen(x => { x.type = next; }, true);
        if (s.endedAt) await retagDay(s.date);
        return;
      }
      if (a === 'rm-ex') {
        return mutateOpen(s => { s.exercises.splice(xi, 1); }, true);
      }
      if (a === 'add-set') {
        return mutateOpen(s => {
          const sets = s.exercises[xi].sets;
          const lastSet = sets[sets.length - 1];
          sets.push(lastSet ? { w: lastSet.w, r: lastSet.r, done: false } : { w: null, r: null, done: false });
        }, true);
      }
      if (a === 'rm-set') {
        return mutateOpen(s => { s.exercises[xi].sets.splice(si, 1); }, true);
      }
      if (a === 'prev') {
        const s = await sessionById(openId);
        if (!s) return;
        const row = act.closest('.sr-row');
        const wIn = row.querySelector('.in-w');
        const rIn = row.querySelector('.in-r');
        wIn.value = wIn.placeholder || '';
        rIn.value = rIn.placeholder || '';
        return mutateOpen(x => {
          const set = x.exercises[xi].sets[si];
          set.w = wIn.value === '' ? null : parseFloat(wIn.value);
          set.r = rIn.value === '' ? null : parseInt(rIn.value, 10);
        }, false);
      }
      if (a === 'done') {
        const row = act.closest('.sr-row');
        const wIn = row.querySelector('.in-w');
        const rIn = row.querySelector('.in-r');
        // checking an empty row adopts the previous session's numbers
        return mutateOpen(x => {
          const set = x.exercises[xi].sets[si];
          if (!set.done) {
            if (wIn.value === '' && wIn.placeholder) wIn.value = wIn.placeholder;
            if (rIn.value === '' && rIn.placeholder) rIn.value = rIn.placeholder;
          }
          set.w = wIn.value === '' ? null : parseFloat(wIn.value);
          set.r = rIn.value === '' ? null : parseInt(rIn.value, 10);
          set.done = !set.done;
        }, true);
      }
    });

    // set inputs save on change (blur / enter)
    $('#trainSession').addEventListener('change', e => {
      const input = e.target.closest('.set-in');
      if (!input) return;
      const xi = +input.dataset.ex;
      const si = +input.dataset.set;
      const isW = input.classList.contains('in-w');
      const v = input.value === '' ? null : (isW ? parseFloat(input.value) : parseInt(input.value, 10));
      mutateOpen(s => {
        const set = s.exercises[xi] && s.exercises[xi].sets[si];
        if (!set) return;
        set[isW ? 'w' : 'r'] = Number.isFinite(v) && v >= 0 ? v : null;
      }, false);
    });

    // analytics controls
    $('#trainExChips').addEventListener('click', e => {
      const c = e.target.closest('[data-exsel]');
      if (c) { exSelected = c.dataset.exsel; renderProgress(); }
    });
    $('#trainMetricChips').addEventListener('click', e => {
      const c = e.target.closest('[data-metric]');
      if (c) { metric = c.dataset.metric; renderProgress(); }
    });
    document.querySelector('.vol-toggle').addEventListener('click', e => {
      const c = e.target.closest('[data-vol]');
      if (c) { volMode = c.dataset.vol; renderVolume(); }
    });
    ['#exSessionList', '#sessionList'].forEach(sel => {
      document.querySelector(sel).addEventListener('click', e => {
        const b = e.target.closest('[data-act="open-session"]');
        if (b) {
          openId = b.dataset.id;
          renderSession();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });

    // picker
    $('#exClose').addEventListener('click', closePicker);
    $('#exBackdrop').addEventListener('click', closePicker);
    $('#exSearch').addEventListener('input', renderPicker);
    $('#exGroups').addEventListener('click', e => {
      const c = e.target.closest('[data-grp]');
      if (c) { pickerGroup = c.dataset.grp; renderPicker(); }
    });
    $('#exResults').addEventListener('click', e => {
      const r = e.target.closest('[data-pick]');
      if (r) addExercise(r.dataset.pick);
    });
    $('#exCustomToggle').addEventListener('click', () => {
      $('#exCustom').hidden = false;
      $('#exCustomToggle').hidden = true;
      $('#exCustomGroup').innerHTML = Workouts.GROUPS.map((g, i) =>
        '<button class="chip' + (i === Workouts.GROUPS.length - 1 ? ' active' : '') + '" data-cgrp="' + g.id + '">' + g.name + '</button>').join('');
      $('#exCustomName').focus();
    });
    $('#exCustomGroup').addEventListener('click', e => {
      const c = e.target.closest('[data-cgrp]');
      if (!c) return;
      $$('#exCustomGroup .chip').forEach(x => x.classList.toggle('active', x === c));
    });
    $('#exCustomAdd').addEventListener('click', async () => {
      const name = ($('#exCustomName').value || '').trim();
      if (!name) { $('#exCustomName').focus(); return; }
      const grpChip = $$('#exCustomGroup .chip.active')[0];
      const ex = await Workouts.addCustomExercise(name, grpChip ? grpChip.dataset.cgrp : 'other');
      $('#exCustomName').value = '';
      await addExercise(ex.id);
    });
  }

  /* ================= mount ================= */

  let lastShownDay = null;

  async function show(p) {
    profile = p || profile;
    wire();
    lastShownDay = todayStr();
    await renderSession();
    await renderAnalytics();
  }

  /* re-render if the calendar day rolled over while the Train tab was the
     visible one (PWA resumed the next morning) — clears a stale "Logged
     today" card and re-buckets this-week stats against the new today */
  function checkRollover() {
    if (!$('#tab-train').classList.contains('active')) { lastShownDay = null; return; }
    const t = todayStr();
    if (lastShownDay && lastShownDay !== t) show(profile);
  }

  return { show, checkRollover };
})();
