/* Today tab state, persistence, midnight rollover, tabs and settings sheet.
   The meal markup is the source of truth for macros (data-p/c/f) and for
   the default swap selections (.chip.active in the shipped HTML). */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const deepCopy = x => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- static plan, read from the markup ---------- */
  const mealEls = $$('#tab-today .meal');
  const PLAN = mealEls.map(m => ({ p: +m.dataset.p, c: +m.dataset.c, f: +m.dataset.f }));
  const TOTALS = PLAN.reduce((a, x) => ({ p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { p: 0, c: 0, f: 0 });
  window.PT = { PLAN, TOTALS };

  const chipGroups = mealEls.map(m => Array.from(m.querySelectorAll('.chips')));
  const chipLabel = c => c.textContent.trim();
  const DEFAULT_SWAPS = chipGroups.map(gs =>
    gs.map(g => Array.from(g.querySelectorAll('.chip.active')).map(chipLabel))
  );

  const habitEls = $$('.habit');
  const HABITS = habitEls.map(el => el.dataset.habit);

  const weightInput = $('#weightInput');
  const weightStatus = $('#weightStatus');
  const WEIGHT_HINT = weightStatus.textContent;

  let state = null;

  /* ---------- state shape ---------- */
  function normalizeSwaps(sw) {
    if (!Array.isArray(sw)) return null;
    return chipGroups.map((gs, mi) =>
      gs.map((g, gi) => {
        const v = sw[mi] && sw[mi][gi];
        return Array.isArray(v) ? v.slice() : DEFAULT_SWAPS[mi][gi].slice();
      })
    );
  }

  function freshState(date, lastSwaps) {
    return {
      date,
      meals: PLAN.map(() => false),
      swaps: normalizeSwaps(lastSwaps) || deepCopy(DEFAULT_SWAPS),
      habits: Object.fromEntries(HABITS.map(h => [h, false])),
      weight: null,
    };
  }

  function fromRecord(date, rec) {
    return {
      date,
      meals: PLAN.map((_, i) => !!(rec.meals && rec.meals[i])),
      swaps: normalizeSwaps(rec.swaps) || deepCopy(DEFAULT_SWAPS),
      habits: Object.fromEntries(HABITS.map(h => [h, !!(rec.habits && rec.habits[h])])),
      weight: typeof rec.weight === 'number' ? rec.weight : null,
    };
  }

  function computeMacros() {
    return state.meals.reduce(
      (a, done, i) => (done ? { p: a.p + PLAN[i].p, c: a.c + PLAN[i].c, f: a.f + PLAN[i].f } : a),
      { p: 0, c: 0, f: 0 }
    );
  }

  function persist() {
    const rec = Object.assign(deepCopy(state), {
      macros: computeMacros(),
      updatedAt: new Date().toISOString(),
    });
    DB.putDay(rec).catch(err => console.warn('save failed', err));
    HistoryView.invalidate();
  }

  /* ---------- rendering ---------- */
  const barP = $('#barP'), barC = $('#barC'), barF = $('#barF');
  const labP = $('#labP'), labC = $('#labC'), labF = $('#labF');
  const mealCount = $('#mealCount');
  const trackerEl = $('.tracker');

  function refreshTracker() {
    const done = computeMacros();
    const n = state.meals.filter(Boolean).length;
    barP.style.width = Math.min(100, (done.p / TOTALS.p) * 100) + '%';
    barC.style.width = Math.min(100, (done.c / TOTALS.c) * 100) + '%';
    barF.style.width = Math.min(100, (done.f / TOTALS.f) * 100) + '%';
    labP.textContent = done.p + ' / ' + TOTALS.p + 'g';
    labC.textContent = done.c + ' / ' + TOTALS.c + 'g';
    labF.textContent = done.f + ' / ' + TOTALS.f + 'g';
    mealCount.textContent = n;
    trackerEl.classList.toggle('complete', n === PLAN.length);
  }

  function renderWeight() {
    weightInput.value = state.weight == null ? '' : String(state.weight);
    weightStatus.textContent = state.weight == null ? WEIGHT_HINT : 'logged ' + state.weight.toFixed(1) + ' kg today';
  }

  function renderDate() {
    $('#dateLabel').textContent = new Date()
      .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
      .toUpperCase();
  }

  function render() {
    mealEls.forEach((m, i) => m.classList.toggle('done', !!state.meals[i]));

    chipGroups.forEach((gs, mi) =>
      gs.forEach((g, gi) => {
        const selected = state.swaps[mi][gi];
        const chips = Array.from(g.querySelectorAll('.chip'));
        chips.forEach(c => c.classList.toggle('active', selected.includes(chipLabel(c))));
        // a single-select group must always have a selection
        if (g.hasAttribute('data-group') && !chips.some(c => c.classList.contains('active'))) {
          state.swaps[mi][gi] = DEFAULT_SWAPS[mi][gi].slice();
          chips.forEach(c => c.classList.toggle('active', state.swaps[mi][gi].includes(chipLabel(c))));
        }
      })
    );

    habitEls.forEach(el => el.classList.toggle('done', !!state.habits[el.dataset.habit]));
    renderWeight();
    refreshTracker();
    renderDate();
  }

  /* ---------- day loading & midnight rollover ---------- */
  async function loadDay(date) {
    const rec = await DB.getDay(date).catch(() => null);
    if (rec) {
      state = fromRecord(date, rec);
    } else {
      const lastSwaps = await DB.getSetting('lastSwaps').catch(() => null);
      state = freshState(date, lastSwaps);
    }
    render();
  }

  async function checkRollover() {
    const t = todayStr();
    if (state && state.date !== t) {
      await loadDay(t); // yesterday is already saved
      if (tabEls.history.classList.contains('active')) HistoryView.show();
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRollover(); });
  window.addEventListener('focus', checkRollover);
  window.addEventListener('pageshow', checkRollover);
  setInterval(checkRollover, 30000);

  /* ---------- meal cards ---------- */
  mealEls.forEach((m, i) => {
    const top = m.querySelector('.meal-top');
    const check = m.querySelector('.check');

    top.addEventListener('click', e => {
      if (e.target.closest('.check')) return;
      const open = m.classList.toggle('open');
      top.setAttribute('aria-expanded', open);
    });
    top.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); top.click(); }
    });
    check.addEventListener('click', e => {
      e.stopPropagation();
      state.meals[i] = !state.meals[i];
      m.classList.toggle('done', state.meals[i]);
      refreshTracker();
      persist();
    });
  });

  /* ---------- swap chips ---------- */
  chipGroups.forEach((gs, mi) =>
    gs.forEach((g, gi) => {
      g.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        if (g.hasAttribute('data-multi')) {
          chip.classList.toggle('active');
          state.swaps[mi][gi] = Array.from(g.querySelectorAll('.chip.active')).map(chipLabel);
        } else {
          g.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          state.swaps[mi][gi] = [chipLabel(chip)];
        }
        persist();
        DB.putSetting('lastSwaps', deepCopy(state.swaps)).catch(() => {});
      });
    })
  );

  /* ---------- habits ---------- */
  habitEls.forEach(el => {
    el.addEventListener('click', () => {
      const h = el.dataset.habit;
      state.habits[h] = !state.habits[h];
      el.classList.toggle('done', state.habits[h]);
      persist();
    });
  });

  /* ---------- bodyweight ---------- */
  weightInput.addEventListener('change', () => {
    const v = parseFloat(weightInput.value.replace(',', '.'));
    state.weight = Number.isFinite(v) && v >= 20 && v <= 400 ? Math.round(v * 10) / 10 : null;
    renderWeight();
    persist();
  });

  /* ---------- tabs ---------- */
  const tabEls = { today: $('#tab-today'), history: $('#tab-history'), plan: $('#tab-plan') };
  $$('.tabbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      $$('.tabbar button').forEach(b => b.classList.toggle('active', b === btn));
      Object.entries(tabEls).forEach(([k, el]) => el.classList.toggle('active', k === tab));
      // html has scroll-behavior:smooth — a tab switch must jump, not glide
      try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
      catch (e) { window.scrollTo(0, 0); }
      if (tab === 'history') HistoryView.show();
    });
  });

  /* ---------- settings sheet ---------- */
  const sheet = $('#sheet');
  const backdrop = $('#sheetBackdrop');

  async function updateStorageInfo() {
    const el = $('#storageInfo');
    try {
      const days = await DB.getAllDays();
      let persisted = false;
      if (navigator.storage && navigator.storage.persisted) {
        persisted = await navigator.storage.persisted().catch(() => false);
      }
      el.textContent =
        days.length + ' day' + (days.length === 1 ? '' : 's') + ' logged · ' +
        (DB.usingFallback() ? 'localStorage' : 'IndexedDB') + ' · ' +
        'persistent: ' + (persisted ? 'yes' : 'no');
    } catch (e) {
      el.textContent = 'storage status unavailable';
    }
  }

  function openSheet() {
    sheet.classList.add('open');
    backdrop.classList.add('open');
    updateStorageInfo();
  }
  function closeSheet() {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
  }
  $('#settingsBtn').addEventListener('click', openSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);

  /* ---------- export / import ---------- */
  $('#exportBtn').addEventListener('click', async () => {
    try {
      const json = JSON.stringify(await DB.exportAll(), null, 2);
      const name = 'prep-tracker-' + todayStr() + '.json';
      const file = new File([json], name, { type: 'application/json' });
      // share sheet saves to Files on iOS; fall back to a download link
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Prep Tracker export' });
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  });

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const count = Array.isArray(data.days) ? data.days.length : 0;
      if (!confirm('Import ' + count + ' day(s)? Existing days with the same date will be overwritten.')) return;
      const n = await DB.importAll(data);
      HistoryView.invalidate();
      await loadDay(todayStr());
      updateStorageInfo();
      alert('Imported ' + n + ' day(s).');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  });

  /* ---------- boot ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  loadDay(todayStr());
})();
