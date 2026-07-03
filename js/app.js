/* Boot (migration → profile → onboarding/app), tabs, program-mode Today,
   settings sheet, mode switching, export/import.
   The meal markup remains the source of truth for the program renderer
   until Phase 5 makes it JSON-driven. */
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
  window.PT = { PLAN, TOTALS, profile: null };

  const chipGroups = mealEls.map(m => Array.from(m.querySelectorAll('.chips')));
  const chipLabel = c => c.textContent.trim();
  const DEFAULT_SWAPS = chipGroups.map(gs =>
    gs.map(g => Array.from(g.querySelectorAll('.chip.active')).map(chipLabel))
  );

  const habitEls = $$('.habit');
  const HABITS = habitEls.map(el => el.dataset.habit);

  const workoutChips = $$('#workoutChips .chip');
  const WORKOUT_IDS = workoutChips.map(c => c.dataset.workout);

  const weightInput = $('#weightInput');
  const weightStatus = $('#weightStatus');
  const WEIGHT_HINT = weightStatus.textContent;

  let profile = null;
  let state = null;

  function activeProgram() { return profile && profile.activeProgramId ? profile.activeProgramId : null; }

  /* ---------- state shape (program mode) ---------- */
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
      workout: null,
      targetsSnapshot: null,
    };
  }

  function fromRecord(date, rec) {
    return {
      date,
      meals: PLAN.map((_, i) => !!(rec.meals && rec.meals[i])),
      swaps: normalizeSwaps(rec.swaps) || deepCopy(DEFAULT_SWAPS),
      habits: Object.fromEntries(HABITS.map(h => [h, !!(rec.habits && rec.habits[h])])),
      weight: typeof rec.weight === 'number' ? rec.weight : null,
      workout: WORKOUT_IDS.includes(rec.workout) ? rec.workout : null,
      targetsSnapshot: rec.targetsSnapshot || null,
    };
  }

  function computeMacros() {
    const m = state.meals.reduce(
      (a, done, i) => (done ? { p: a.p + PLAN[i].p, c: a.c + PLAN[i].c, f: a.f + PLAN[i].f } : a),
      { p: 0, c: 0, f: 0 }
    );
    m.kcal = Targets.kcalFromMacros(m.p, m.c, m.f);
    return m;
  }

  function persist() {
    const rec = Object.assign(deepCopy(state), {
      schema: 2,
      mode: 'program',
      programId: 'ethan-prep',
      macros: computeMacros(),
      targetsSnapshot: state.targetsSnapshot || deepCopy(Migrate.ETHAN_SNAPSHOT),
      weightUnit: Targets.recordUnitFor(profile ? profile.units : 'lb'),
      updatedAt: new Date().toISOString(),
    });
    state.targetsSnapshot = rec.targetsSnapshot;
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

  function unitLabel() { return Targets.unitLabel(profile ? profile.units : 'lb'); }

  function renderWeight() {
    weightInput.value = state.weight == null ? '' : String(state.weight);
    weightStatus.textContent = state.weight == null ? WEIGHT_HINT : 'logged ' + state.weight.toFixed(1) + ' ' + unitLabel() + ' today';
    $('.weight-unit').textContent = unitLabel();
  }

  function renderWorkout() {
    workoutChips.forEach(c => c.classList.toggle('active', c.dataset.workout === state.workout));
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
        if (g.hasAttribute('data-group') && !chips.some(c => c.classList.contains('active'))) {
          state.swaps[mi][gi] = DEFAULT_SWAPS[mi][gi].slice();
          chips.forEach(c => c.classList.toggle('active', state.swaps[mi][gi].includes(chipLabel(c))));
        }
      })
    );

    habitEls.forEach(el => el.classList.toggle('done', !!state.habits[el.dataset.habit]));
    renderWorkout();
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

  /* ---------- training ---------- */
  workoutChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.workout;
      state.workout = state.workout === id ? null : id; // re-tap deselects
      renderWorkout();
      persist();
    });
  });

  /* ---------- bodyweight ---------- */
  weightInput.addEventListener('change', () => {
    const v = parseFloat(weightInput.value.replace(',', '.'));
    const kg = profile && profile.units === 'kg';
    const lo = kg ? 25 : 50, hi = kg ? 320 : 700;
    state.weight = Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null;
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

  function fmtTargets(t) {
    return t.kcal.toLocaleString() + ' kcal · P' + t.p + ' · C' + t.c + ' · F' + t.f;
  }

  function updateSettingsUI() {
    if (!profile) return;
    $('#profileSummary').textContent = (profile.name || 'You') + ' · ' + unitLabel();
    $('#targetsSummary').textContent = 'Your targets: ' + fmtTargets(profile.targets);
    $('#modeSummary').textContent = activeProgram() ? "Ethan's Prep Plan" : 'Custom — your own food & targets';
    $('#modeToggleBtn').textContent = activeProgram() ? 'Use Custom' : "Use Ethan's Plan";
    $('#toleranceInput').value = profile.tolerancePct == null ? 6 : profile.tolerancePct;
  }

  async function updateStorageInfo() {
    const el = $('#storageInfo');
    try {
      const days = await DB.getAllDays();
      const foods = await DB.getAllFoods();
      let persisted = false;
      if (navigator.storage && navigator.storage.persisted) {
        persisted = await navigator.storage.persisted().catch(() => false);
      }
      el.textContent =
        days.length + ' day' + (days.length === 1 ? '' : 's') + ' · ' +
        foods.length + ' saved food' + (foods.length === 1 ? '' : 's') + ' · ' +
        (DB.usingFallback() ? 'localStorage' : 'IndexedDB') + ' · persistent: ' + (persisted ? 'yes' : 'no');
    } catch (e) {
      el.textContent = 'storage status unavailable';
    }
  }

  async function updateBackupRow() {
    const backup = await DB.getSetting('backupV1').catch(() => null);
    $('#backupRow').hidden = !backup;
    if (backup) {
      const n = Array.isArray(backup.days) ? backup.days.length : 0;
      $('#backupMeta').textContent = n + ' days · taken ' + String(backup.createdAt || '').slice(0, 10);
    }
  }

  function openSheet() {
    sheet.classList.add('open');
    backdrop.classList.add('open');
    updateSettingsUI();
    updateStorageInfo();
    updateBackupRow();
  }
  function closeSheet() {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    $('#modeNote').hidden = true;
  }
  $('#settingsBtn').addEventListener('click', openSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  backdrop.addEventListener('click', closeSheet);

  async function saveProfile(p) {
    profile = p;
    window.PT.profile = p;
    await DB.putSetting('profile', p).catch(() => {});
    document.body.classList.toggle('mode-custom', !activeProgram());
    $('#customToday').hidden = !!activeProgram();
    updateSettingsUI();
    HistoryView.invalidate();
  }

  $('#editProfileBtn').addEventListener('click', () => {
    closeSheet();
    Onboarding.show(profile, p => { saveProfile(p).then(() => loadDay(todayStr())); }, 1);
  });

  $('#modeToggleBtn').addEventListener('click', async () => {
    const next = Object.assign({}, profile, { activeProgramId: activeProgram() ? null : 'ethan-prep' });
    await saveProfile(next);
    const todayRec = await DB.getDay(todayStr()).catch(() => null);
    const hasEntries = todayRec && ((todayRec.meals || []).some(Boolean) || (todayRec.items || []).length);
    const note = $('#modeNote');
    if (hasEntries) {
      const was = todayRec.mode === 'custom' ? 'Custom' : "Ethan's Plan";
      note.textContent = 'Today was logged in ' + was + ' — your new mode starts with the next day you log.';
      note.hidden = false;
    } else {
      note.textContent = 'Switched. Today will track in ' + (activeProgram() ? "Ethan's Plan" : 'Custom') + ' mode.';
      note.hidden = false;
      loadDay(todayStr());
    }
  });

  $('#toleranceInput').addEventListener('change', () => {
    const v = parseInt($('#toleranceInput').value, 10);
    const tol = Number.isFinite(v) ? Math.min(20, Math.max(1, v)) : 6;
    $('#toleranceInput').value = tol;
    saveProfile(Object.assign({}, profile, { tolerancePct: tol }));
  });

  /* ---------- export / import / backup download ---------- */
  async function downloadJSON(obj, name) {
    const json = JSON.stringify(obj, null, 2);
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  $('#exportBtn').addEventListener('click', async () => {
    try { await downloadJSON(await DB.exportAll(), 'macro-tracker-' + todayStr() + '.json'); }
    catch (err) { alert('Export failed: ' + err.message); }
  });

  $('#backupDownloadBtn').addEventListener('click', async () => {
    const backup = await DB.getSetting('backupV1').catch(() => null);
    if (backup) downloadJSON(backup, 'pre-migration-backup.json');
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
      let profileMode = 'skip';
      if (data.settings && data.settings.profile) {
        if (!profile) profileMode = 'replace';
        else if (confirm('This backup includes profile & targets. Replace yours with it?')) profileMode = 'replace';
      }
      const n = await DB.importAll(data, { profile: profileMode });
      if (profileMode === 'replace') {
        const p = await DB.getSetting('profile');
        if (p) await saveProfile(p);
      }
      HistoryView.invalidate();
      await loadDay(todayStr());
      updateStorageInfo();
      alert('Imported ' + n + ' day(s).');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  });

  /* ---------- boot: migrate → profile → onboarding or app ---------- */
  async function bootMigrate() {
    const days = await DB.getAllDays();
    const unmigrated = days.filter(d => !(d.schema >= 2));
    if (unmigrated.length) {
      // write-once rollback artifact BEFORE the first transforming write
      const existing = await DB.getSetting('backupV1').catch(() => null);
      if (!existing) {
        await DB.putSetting('backupV1', {
          app: 'prep-tracker', version: 1,
          createdAt: new Date().toISOString(),
          days,
          settings: { lastSwaps: await DB.getSetting('lastSwaps').catch(() => null) },
        }).catch(() => {});
      }
      for (const d of unmigrated) {
        try {
          const m = Migrate.migrateDay(d);
          if (m) await DB.putDay(m);
        } catch (err) {
          console.warn('migration skipped', d.date, err); // record left as-is; readers tolerate it
        }
      }
      HistoryView.invalidate();
    }
    let p = await DB.getSetting('profile').catch(() => null);
    if (!p && days.length) {
      p = Migrate.legacyProfile(); // existing install = Ethan; skips onboarding
      await DB.putSetting('profile', p).catch(() => {});
    }
    return p;
  }

  function startApp(p) {
    profile = p;
    window.PT.profile = p;
    document.body.classList.toggle('mode-custom', !activeProgram());
    $('#customToday').hidden = !!activeProgram();
    updateSettingsUI();
    loadDay(todayStr());
  }

  async function boot() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    let p = null;
    try { p = await bootMigrate(); }
    catch (err) { console.warn('boot migration failed', err); }
    if (!p) {
      Onboarding.show(null, np => { saveProfile(np).then(() => startApp(np)); });
      return;
    }
    startApp(p);
  }

  boot();
})();
