/* Boot (migration → profile → onboarding/app), tab bar, mode routing
   between TodayProgram (JSON-driven) and TodayCustom, settings sheet,
   export/import. Day rendering lives in the two Today modules. */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // merge — dashboard.js already registered PT.dayChanged on this object
  window.PT = Object.assign(window.PT || {}, { profile: null });

  let profile = null;

  function activeProgram() { return profile && profile.activeProgramId ? profile.activeProgramId : null; }
  function unitLabel() { return Targets.unitLabel(profile ? profile.units : 'lb'); }

  /* header strings from the shipped markup — restored when the program
     view mounts after a stint in custom mode */
  const PROGRAM_HEADER = {
    eyebrow: $('#tab-today header .eyebrow').textContent,
    h1: $('#tab-today h1').innerHTML,
    targets: $$('#tab-today .targets .target').map(el => ({
      val: el.querySelector('.val').textContent,
      lab: el.querySelector('.lab').textContent,
    })),
  };
  function restoreProgramHeader() {
    $('#tab-today header .eyebrow').textContent = PROGRAM_HEADER.eyebrow;
    $('#tab-today h1').innerHTML = PROGRAM_HEADER.h1;
    $$('#tab-today .targets .target').forEach((el, i) => {
      el.querySelector('.val').textContent = PROGRAM_HEADER.targets[i].val;
      el.querySelector('.lab').textContent = PROGRAM_HEADER.targets[i].lab;
    });
  }

  /* ---------- mode routing ---------- */
  function hasEntries(rec) {
    if (!rec) return false;
    if (rec.mode === 'custom') return (rec.items || []).length > 0;
    return (rec.meals || []).some(Boolean);
  }

  let editingDate = null; // set while viewing/editing a past day

  function renderEditBanner() {
    const b = $('#editBanner');
    b.hidden = !editingDate;
    if (editingDate) {
      $('#editDateLabel').textContent = new Date(editingDate + 'T12:00:00')
        .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    }
  }

  /* Mount any date. Pinned semantics: today with entries keeps its recorded
     mode; a past day always renders in the mode it was logged in; an empty
     day follows the active mode. */
  async function mountDay(date) {
    editingDate = date === todayStr() ? null : date;
    renderEditBanner();
    const rec = await DB.getDay(date).catch(() => null);
    let mode;
    if (rec && rec.mode && (editingDate || hasEntries(rec))) mode = rec.mode;
    else mode = activeProgram() ? 'program' : 'custom';
    if (mode === 'custom') {
      TodayProgram.unmount();
      await TodayCustom.mount(profile, date);
    } else {
      TodayCustom.unmount();
      restoreProgramHeader();
      await TodayProgram.mount(profile, date);
    }
    Dashboard.setViewed(date); // highlights the viewed day in the week strip
  }
  function mountToday() { return mountDay(todayStr()); }

  /* history taps land here (charts, heatmaps, later the week strip) */
  window.PT.openDay = async date => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayStr()) return; // the future isn't editable
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'today'));
    Object.entries(tabEls).forEach(([k, el]) => el.classList.toggle('active', k === 'today'));
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
    catch (e) { window.scrollTo(0, 0); }
    await mountDay(date);
  };

  $('#backToToday').addEventListener('click', () => { mountToday(); });

  /* ---------- midnight rollover ---------- */
  async function checkRollover() {
    if (editingDate) return; // an edit session is pinned to its date
    const t = todayStr();
    const cur = TodayCustom.isActive() ? DayStore.date() : TodayProgram.currentDate();
    if (profile && cur && cur !== t) {
      await mountToday(); // yesterday is already saved; a new day may change mode
      if (tabEls.history.classList.contains('active')) HistoryView.show();
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRollover(); });
  window.addEventListener('focus', checkRollover);
  window.addEventListener('pageshow', checkRollover);
  setInterval(checkRollover, 30000);

  /* ---------- shared controls: training + bodyweight ---------- */
  $$('#workoutChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.workout;
      if (TodayCustom.isActive()) TodayCustom.setWorkout(id);
      else TodayProgram.setWorkout(id);
    });
  });

  $('#weightInput').addEventListener('change', () => {
    const v = parseFloat($('#weightInput').value.replace(',', '.'));
    const kg = profile && profile.units === 'kg';
    const lo = kg ? 25 : 50, hi = kg ? 320 : 700;
    const w = Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null;
    if (TodayCustom.isActive()) TodayCustom.setWeight(w);
    else TodayProgram.setWeight(w);
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
    updateSettingsUI();
    HistoryView.invalidate();
    Dashboard.mount(p);
  }

  /* the expenditure card's Apply button lands here; remount so the open
     Today view picks up the new targets immediately */
  window.PT.applyTargets = t =>
    saveProfile(Object.assign({}, profile, { targets: t })).then(mountToday);

  $('#editProfileBtn').addEventListener('click', () => {
    closeSheet();
    Onboarding.show(profile, p => { saveProfile(p).then(mountToday); }, 1);
  });

  $('#modeToggleBtn').addEventListener('click', async () => {
    const next = Object.assign({}, profile, { activeProgramId: activeProgram() ? null : 'ethan-prep' });
    await saveProfile(next);
    const todayRec = await DB.getDay(todayStr()).catch(() => null);
    const note = $('#modeNote');
    const wantMode = activeProgram() ? 'program' : 'custom';
    if (todayRec && todayRec.mode && todayRec.mode !== wantMode && hasEntries(todayRec)) {
      const was = todayRec.mode === 'custom' ? 'Custom' : "Ethan's Plan";
      note.textContent = 'Today was logged in ' + was + ' — your new mode starts with the next day you log.';
    } else {
      note.textContent = 'Switched. Today tracks in ' + (activeProgram() ? "Ethan's Plan" : 'Custom') + ' mode.';
    }
    note.hidden = false;
    await mountToday();
  });

  $('#toleranceInput').addEventListener('change', () => {
    const v = parseInt($('#toleranceInput').value, 10);
    const tol = Number.isFinite(v) ? Math.min(20, Math.max(1, v)) : 6;
    $('#toleranceInput').value = tol;
    saveProfile(Object.assign({}, profile, { tolerancePct: tol })).then(mountToday);
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
      Foods.invalidate();
      HistoryView.invalidate();
      await mountToday();
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
    updateSettingsUI();
    Dashboard.mount(p);
    mountToday();
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
    try { await TodayProgram.loadProgram(); } // sets PT.PLAN/TOTALS for history
    catch (err) { console.warn('program load failed', err); }
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
