/* Program-mode Today tab + Plan tab, rendered entirely from a program JSON
   (programs/ethan-prep.json). The HTML builders are pure string functions
   (no DOM access) so the render-parity test can run under node.
   Day state matches the original app exactly: meals checked, swap chips
   (labels are persistence keys), program habits, 3-bar macro tracker. */
const TodayProgram = (() => {
  'use strict';

  const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M2.5 8.5L6 12l7.5-8" stroke="#16171a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHEV_SVG = '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /* ---------- pure HTML builders (parity-tested) ---------- */
  function mealHTML(meal, index, open) {
    const pills = ['p', 'c', 'f'].map(k =>
      '<span class="pill"><b>' + k.toUpperCase() + '</b> ' + meal.macros[k] + 'g</span>').join('\n');
    const groups = meal.swapGroups.map(g =>
      '<div class="swap-lab">' + esc(g.label) + '</div>' +
      '<div class="chips" ' + (g.multi ? 'data-multi' : 'data-group') + '>' +
      g.options.map(o =>
        '<button class="chip' + (g.default.includes(o) ? ' active' : '') + '">' + esc(o) + '</button>').join('') +
      '</div>').join('');
    return '<div class="meal' + (open ? ' open' : '') + '" data-p="' + meal.macros.p + '" data-c="' + meal.macros.c + '" data-f="' + meal.macros.f + '">' +
      '<div class="meal-top" tabindex="0" role="button" aria-expanded="' + !!open + '">' +
        '<button class="check" aria-label="Mark ' + esc(meal.title) + ' complete">' + CHECK_SVG + '</button>' +
        '<div class="meal-title"><div class="num">' + esc(meal.num) + '</div><h2>' + esc(meal.title) + '</h2></div>' +
        CHEV_SVG +
      '</div>' +
      '<div class="meal-body"><div class="meal-inner">' +
        '<ul class="food-list">' + meal.items.map(it => '<li>' + esc(it) + '</li>').join('') + '</ul>' +
        '<div class="macro-row">' + pills + '</div>' +
        groups +
      '</div></div></div>';
  }

  function habitsHTML(habits) {
    return habits.map(h =>
      '<button class="habit" data-habit="' + esc(h.id) + '">' +
        '<span class="check">' + CHECK_SVG + '</span>' +
        '<span class="habit-name">' + esc(h.name) + '</span><span class="habit-meta">' + esc(h.meta || '') + '</span>' +
      '</button>').join('');
  }

  function referenceHTML(reference) {
    return reference.map(block =>
      '<section class="block"><h3>' + esc(block.title).replace(' / ', ' <em>/ ') + (block.title.includes(' / ') ? '</em>' : '') + '</h3>' +
      block.tables.map((t, i) =>
        (i > 0 ? '<div style="height:14px"></div>' : '') +
        '<div class="tbl-wrap"><table>' +
        (t.title ? '<tr><th colspan="2">' + esc(t.title) + '</th></tr>' : '') +
        (t.columns ? '<tr>' + t.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr>' : '') +
        t.rows.map(r =>
          '<tr>' + r.map((c, ci) => '<td' + (ci > 0 ? ' class="mono"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') +
        '</table></div>').join('') +
      '</section>').join('');
  }

  /* ---------- runtime state ---------- */
  let program = null;
  let profile = null;
  let state = null;
  let active = false;
  let wired = false;

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const deepCopy = x => JSON.parse(JSON.stringify(x));

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function loadProgram() {
    if (!program) {
      program = await fetch('programs/ethan-prep.json').then(r => {
        if (!r.ok) throw new Error('program unavailable');
        return r.json();
      });
      // history.js reads these for the program protein target / kcal fallback
      window.PT.PLAN = program.meals.map(m => m.macros);
      window.PT.TOTALS = { p: program.targets.p, c: program.targets.c, f: program.targets.f };
    }
    return program;
  }

  function defaultSwaps() {
    return program.meals.map(m => m.swapGroups.map(g => g.default.slice()));
  }

  function normalizeSwaps(sw) {
    if (!Array.isArray(sw)) return null;
    return program.meals.map((m, mi) =>
      m.swapGroups.map((g, gi) => {
        const v = sw[mi] && sw[mi][gi];
        return Array.isArray(v) ? v.slice() : g.default.slice();
      })
    );
  }

  function snapshot() {
    return {
      p: program.targets.p, c: program.targets.c, f: program.targets.f,
      kcal: program.targets.kcal,
      tolerancePct: profile.tolerancePct == null ? 6 : profile.tolerancePct,
      types: deepCopy(program.targets.types),
      mode: 'program',
    };
  }

  function freshState(date, lastSwaps) {
    return {
      date,
      meals: program.meals.map(() => false),
      swaps: normalizeSwaps(lastSwaps) || defaultSwaps(),
      habits: Object.fromEntries(program.habits.map(h => [h.id, false])),
      weight: null,
      workout: null,
      targetsSnapshot: null,
    };
  }

  function fromRecord(date, rec) {
    return {
      date,
      meals: program.meals.map((_, i) => !!(rec.meals && rec.meals[i])),
      swaps: normalizeSwaps(rec.swaps) || defaultSwaps(),
      habits: Object.fromEntries(program.habits.map(h => [h.id, !!(rec.habits && rec.habits[h.id])])),
      weight: typeof rec.weight === 'number' ? rec.weight : null,
      workout: rec.workout || null,
      targetsSnapshot: rec.targetsSnapshot || null,
    };
  }

  function computeMacros() {
    const m = state.meals.reduce(
      (a, done, i) => {
        if (!done) return a;
        const mm = program.meals[i].macros;
        return { p: a.p + mm.p, c: a.c + mm.c, f: a.f + mm.f };
      },
      { p: 0, c: 0, f: 0 }
    );
    m.kcal = Targets.kcalFromMacros(m.p, m.c, m.f);
    return m;
  }

  function persist() {
    const rec = Object.assign(deepCopy(state), {
      schema: 2,
      mode: 'program',
      programId: program.id,
      macros: computeMacros(),
      targetsSnapshot: state.targetsSnapshot || snapshot(),
      weightUnit: Targets.recordUnitFor(profile.units),
      updatedAt: new Date().toISOString(),
    });
    state.targetsSnapshot = rec.targetsSnapshot;
    DB.putDay(rec).catch(err => console.warn('save failed', err));
    HistoryView.invalidate();
    if (window.PT.dayChanged) window.PT.dayChanged();
  }

  /* ---------- rendering ---------- */
  function refreshTracker() {
    const t = program.targets;
    const done = computeMacros();
    const n = state.meals.filter(Boolean).length;
    $('#barP').style.width = Math.min(100, (done.p / t.p) * 100) + '%';
    $('#barC').style.width = Math.min(100, (done.c / t.c) * 100) + '%';
    $('#barF').style.width = Math.min(100, (done.f / t.f) * 100) + '%';
    $('#labP').textContent = done.p + ' / ' + t.p + 'g';
    $('#labC').textContent = done.c + ' / ' + t.c + 'g';
    $('#labF').textContent = done.f + ' / ' + t.f + 'g';
    $('#mealCount').parentElement.innerHTML = '<span id="mealCount">' + n + '</span>/' + program.meals.length + ' meals';
    ['#wrapP', '#wrapC', '#wrapF'].forEach(s => $(s).classList.remove('in'));
    $('.day-flag').textContent = 'Day complete';
    $('.tracker').classList.toggle('complete', n === program.meals.length);
  }

  function renderShared() {
    const isToday = state.date === todayStr();
    const wi = $('#weightInput');
    wi.value = state.weight == null ? '' : String(state.weight);
    $('#weightStatus').textContent = state.weight == null
      ? 'optional — trend beats daily noise'
      : 'logged ' + state.weight.toFixed(1) + ' ' + Targets.unitLabel(profile.units) + (isToday ? ' today' : '');
    $('.weight-unit').textContent = Targets.unitLabel(profile.units);
    $$('#workoutChips .chip').forEach(c => c.classList.toggle('active', c.dataset.workout === state.workout));
    $('#dateLabel').textContent = new Date(state.date + 'T12:00:00')
      .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
  }

  function render() {
    const mealEls = $$('#programMeals .meal');
    mealEls.forEach((m, i) => m.classList.toggle('done', !!state.meals[i]));

    mealEls.forEach((mealEl, mi) => {
      Array.from(mealEl.querySelectorAll('.chips')).forEach((g, gi) => {
        const selected = state.swaps[mi][gi];
        Array.from(g.querySelectorAll('.chip')).forEach(c =>
          c.classList.toggle('active', selected.includes(c.textContent.trim())));
      });
    });

    $$('#programHabitList .habit').forEach(el =>
      el.classList.toggle('done', !!state.habits[el.dataset.habit]));

    renderShared();
    refreshTracker();
  }

  /* ---------- day loading ---------- */
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

  /* ---------- events (delegated, wired once) ---------- */
  function wire() {
    if (wired) return;
    wired = true;

    $('#programMeals').addEventListener('click', e => {
      const mealEl = e.target.closest('.meal');
      if (!mealEl) return;
      const mealEls = $$('#programMeals .meal');
      const mi = mealEls.indexOf(mealEl);

      const check = e.target.closest('.check');
      if (check) {
        state.meals[mi] = !state.meals[mi];
        mealEl.classList.toggle('done', state.meals[mi]);
        refreshTracker();
        persist();
        return;
      }

      const chip = e.target.closest('.chip');
      if (chip) {
        const g = chip.closest('.chips');
        const gi = Array.from(mealEl.querySelectorAll('.chips')).indexOf(g);
        if (g.hasAttribute('data-multi')) {
          chip.classList.toggle('active');
          state.swaps[mi][gi] = Array.from(g.querySelectorAll('.chip.active')).map(c => c.textContent.trim());
        } else {
          g.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          state.swaps[mi][gi] = [chip.textContent.trim()];
        }
        persist();
        DB.putSetting('lastSwaps', deepCopy(state.swaps)).catch(() => {});
        return;
      }

      const top = e.target.closest('.meal-top');
      if (top) {
        const open = mealEl.classList.toggle('open');
        top.setAttribute('aria-expanded', open);
      }
    });
    $('#programMeals').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('meal-top')) {
        e.preventDefault();
        e.target.click();
      }
    });

    $('#programHabitList').addEventListener('click', e => {
      const btn = e.target.closest('[data-habit]');
      if (!btn) return;
      const h = btn.dataset.habit;
      state.habits[h] = !state.habits[h];
      btn.classList.toggle('done', state.habits[h]);
      persist();
    });
  }

  /* ---------- shared-control mutations (from app.js) ---------- */
  function setWeight(v) { state.weight = v; renderShared(); persist(); }
  function setWorkout(id) {
    state.workout = state.workout === id ? null : id;
    renderShared();
    persist();
  }

  /* ---------- mount / unmount ---------- */
  async function mount(p, date) {
    profile = p;
    await loadProgram();
    wire();
    if (!$('#programMeals').childElementCount) {
      $('#programMeals').innerHTML = program.meals.map((m, i) => mealHTML(m, i, i === 0)).join('');
      $('#programHabitList').innerHTML = habitsHTML(program.habits);
      $('#planReference').innerHTML = referenceHTML(program.reference);
    }
    active = true;
    await loadDay(date || todayStr());
  }

  function unmount() { active = false; }
  function isActive() { return active; }
  function currentDate() { return state ? state.date : null; }

  return {
    mount, unmount, isActive, currentDate, loadProgram, loadDay,
    setWeight, setWorkout,
    html: { meal: mealHTML, habits: habitsHTML, reference: referenceHTML },
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TodayProgram;
