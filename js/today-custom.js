/* Custom-mode Today tab: day log sections (Breakfast/Lunch/Dinner/Snacks),
   quick add + My Foods add sheet, range-aware 4-bar tracker, profile
   habits, and the My Foods management view on the third tab.
   State lives in DayStore; this module is rendering + interaction. */
const TodayCustom = (() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const SECTIONS = [
    { id: 'breakfast', num: 'Log 01', title: 'Breakfast' },
    { id: 'lunch',     num: 'Log 02', title: 'Lunch' },
    { id: 'dinner',    num: 'Log 03', title: 'Dinner' },
    { id: 'snacks',    num: 'Log 04', title: 'Snacks' },
  ];
  const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M2.5 8.5L6 12l7.5-8" stroke="#16171a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let profile = null;
  let wired = false;
  let active = false;          // custom view currently mounted
  let addSection = 'breakfast';
  let qaKcalDirty = false;
  let qaSaveToFoods = false;
  let editItemId = null;
  let expandedFoodId = null;

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const fmtMacros = m => 'P ' + Math.round(m.p) + ' · C ' + Math.round(m.c) + ' · F ' + Math.round(m.f) + ' · ' + Math.round(m.kcal) + ' kcal';

  function targets() {
    const rec = DayStore.record();
    return (rec && rec.targetsSnapshot) || DayStore.customSnapshot(profile);
  }

  /* ---------- header ---------- */
  function renderHeader() {
    const t = profile.targets;
    $('#tab-today header .eyebrow').textContent = 'Daily Nutrition · Custom';
    $('#tab-today h1').innerHTML = 'Today <span>/ ' + t.kcal.toLocaleString() + '</span>';
    const vals = $$('#tab-today .targets .target');
    const set = (el, val, lab) => { el.querySelector('.val').textContent = val; el.querySelector('.lab').textContent = lab; };
    set(vals[0], t.kcal.toLocaleString(), 'Calories');
    set(vals[1], t.p + 'g', 'Protein');
    set(vals[2], t.c + 'g', 'Carbs');
    set(vals[3], t.f + 'g', 'Fat');
  }

  /* ---------- sections ---------- */
  function renderSections() {
    const rec = DayStore.record();
    const wrap = $('#customSections');
    const openState = {};
    $$('#customSections .log-sec').forEach(el => { openState[el.dataset.sec] = el.classList.contains('open'); });

    wrap.innerHTML = SECTIONS.map(sec => {
      const items = (rec.items || []).filter(it => it.section === sec.id);
      const kcal = Math.round(items.reduce((a, it) => a + (it.macros.kcal || 0), 0));
      const open = openState[sec.id] != null ? openState[sec.id] : true;
      const rows = items.map(it => {
        const qty = it.unit === 'g' ? Math.round(it.qty) + 'g'
          : it.qty === 1 ? '' : (it.qty + ' × ');
        return '<li class="item" data-id="' + it.id + '" tabindex="0" role="button">' +
          '<div class="item-main"><span class="item-name">' + esc(it.name) + '</span>' +
          (qty ? '<span class="item-qty">' + esc(qty) + '</span>' : '') + '</div>' +
          '<span class="item-macros">' + fmtMacros(it.macros) + '</span></li>';
      }).join('');
      return '<div class="meal log-sec' + (open ? ' open' : '') + '" data-sec="' + sec.id + '">' +
        '<div class="meal-top" tabindex="0" role="button" aria-expanded="' + open + '">' +
          '<div class="meal-title"><div class="num">' + sec.num + '</div><h2>' + sec.title + '</h2></div>' +
          (kcal ? '<span class="sec-kcal">' + kcal.toLocaleString() + ' kcal</span>' : '') +
          '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</div>' +
        '<div class="meal-body"><div class="meal-inner">' +
          (rows ? '<ul class="item-list">' + rows + '</ul>' : '<p class="note sec-empty">Nothing logged yet.</p>') +
          '<button class="add-row" data-sec="' + sec.id + '">+ Add food</button>' +
        '</div></div></div>';
    }).join('');
  }

  /* ---------- tracker ---------- */
  function renderTracker() {
    const rec = DayStore.record();
    const t = targets();
    const tot = rec.macros || { kcal: 0, p: 0, c: 0, f: 0 };
    const tol = t.tolerancePct;

    const bars = [
      { key: 'kcal', bar: '#barK', lab: '#labK', wrap: '.bar-kcal', unit: '' },
      { key: 'p', bar: '#barP', lab: '#labP', wrap: '#wrapP', unit: 'g' },
      { key: 'c', bar: '#barC', lab: '#labC', wrap: '#wrapC', unit: 'g' },
      { key: 'f', bar: '#barF', lab: '#labF', wrap: '#wrapF', unit: 'g' },
    ];
    let allIn = true;
    bars.forEach(b => {
      const val = Math.round(tot[b.key]);
      const target = t[b.key];
      const type = t.types[b.key] || 'band';
      const verdict = Targets.judge(val, target, tol, type);
      if (verdict !== 'in') allIn = false;
      $(b.bar).style.width = Math.min(100, target ? (val / target) * 100 : 0) + '%';
      const over = verdict === 'over' ? ' · +' + (val - Targets.range(target, tol).hi) + ' over' : '';
      $(b.lab).textContent = val.toLocaleString() + ' / ' + Targets.rangeLabel(target, tol, type, b.unit) + over;
      $(b.wrap).classList.toggle('in', verdict === 'in');
    });

    const n = (rec.items || []).length;
    $('#mealCount').parentElement.textContent = n + ' item' + (n === 1 ? '' : 's');
    $('.day-flag').textContent = 'In range';
    $('.tracker').classList.toggle('complete', allIn && n > 0);
  }

  /* ---------- habits ---------- */
  function renderHabits() {
    const rec = DayStore.record();
    const list = $('#customHabitList');
    list.innerHTML = (profile.habits || []).map(h =>
      '<button class="habit' + (rec.habits && rec.habits[h.id] ? ' done' : '') + '" data-chabit="' + h.id + '">' +
        '<span class="check">' + CHECK_SVG + '</span>' +
        '<span class="habit-name">' + esc(h.name) + '</span><span class="habit-meta">' + esc(h.meta || '') + '</span>' +
      '</button>'
    ).join('');
    $('#customHabits').hidden = !(profile.habits || []).length;
  }

  /* ---------- shared controls (weight / training / date) ---------- */
  function renderShared() {
    const rec = DayStore.record();
    const wi = $('#weightInput');
    wi.value = rec.weight == null ? '' : String(rec.weight);
    $('#weightStatus').textContent = rec.weight == null
      ? 'optional — trend beats daily noise'
      : 'logged ' + rec.weight.toFixed(1) + ' ' + Targets.unitLabel(profile.units) + ' today';
    $('.weight-unit').textContent = Targets.unitLabel(profile.units);
    $$('#workoutChips .chip').forEach(c => c.classList.toggle('active', c.dataset.workout === rec.workout));
    $('#dateLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
  }

  function renderAll() {
    if (!active) return;
    renderHeader();
    renderSections();
    renderTracker();
    renderHabits();
    renderShared();
  }

  /* ---------- add sheet ---------- */
  function openAdd(section) {
    addSection = section || 'breakfast';
    const sec = SECTIONS.find(s => s.id === addSection);
    $('#qaAdd').textContent = 'Add to ' + sec.title;
    $('#addSheet').classList.add('open');
    $('#addBackdrop').classList.add('open');
    renderFoodResults($('#foodSearch').value);
  }
  function closeAdd() {
    $('#addSheet').classList.remove('open');
    $('#addBackdrop').classList.remove('open');
  }

  function qaMacros() {
    return {
      p: parseFloat($('#qaP').value) || 0,
      c: parseFloat($('#qaC').value) || 0,
      f: parseFloat($('#qaF').value) || 0,
    };
  }
  function qaRefreshKcal() {
    if (qaKcalDirty) return;
    const m = qaMacros();
    const kcal = Math.round(Targets.kcalFromMacros(m.p, m.c, m.f));
    $('#qaKcal').value = kcal || '';
  }
  function resetQuickAdd() {
    ['#qaName', '#qaP', '#qaC', '#qaF', '#qaKcal'].forEach(s => { $(s).value = ''; });
    qaKcalDirty = false;
    qaSaveToFoods = false;
    $('#qaSave').classList.remove('done');
  }

  async function submitQuickAdd() {
    const m = qaMacros();
    const kcal = parseFloat($('#qaKcal').value) || Math.round(Targets.kcalFromMacros(m.p, m.c, m.f));
    if (!kcal && !m.p && !m.c && !m.f) { $('#qaHint').textContent = 'Enter at least one number.'; return; }
    const name = ($('#qaName').value || '').trim() || 'Quick add';
    const macros = { kcal: Math.round(kcal), p: m.p, c: m.c, f: m.f };
    let foodId = null;
    if (qaSaveToFoods && name !== 'Quick add') {
      const food = await Foods.save({ name, per: 'serving', macros });
      foodId = food.id;
    }
    DayStore.mutate(profile, rec => {
      rec.items.push({ id: Foods.uuid(), section: addSection, name, qty: 1, unit: 'serving', macros, foodId, ts: new Date().toISOString() });
    });
    resetQuickAdd();
    closeAdd();
  }

  /* ---------- my foods pane + manage view ---------- */
  function foodRow(f, expanded) {
    const per = f.per === '100g' ? 'per 100 g' : 'per ' + (f.servingName || 'serving');
    return '<div class="food-row' + (expanded ? ' expanded' : '') + '" data-fid="' + f.id + '">' +
      '<div class="food-row-main" role="button" tabindex="0">' +
        '<button class="star' + (f.favorite ? ' on' : '') + '" data-star="' + f.id + '" aria-label="Favorite">' +
          '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor"/></svg></button>' +
        '<div class="food-info"><span class="food-name">' + esc(f.name) + '</span>' +
        '<span class="food-meta">' + fmtMacros(f.macros) + ' · ' + per + '</span></div>' +
      '</div>' +
      (expanded
        ? '<div class="food-qty-form">' +
            '<span class="field-input"><input type="number" inputmode="decimal" min="0" step="any" class="food-qty" value="' + Foods.defaultQty(f) + '"><i>' + esc(Foods.qtyUnit(f)) + '</i></span>' +
            '<button class="btn btn-primary btn-slim" data-log="' + f.id + '">Add</button>' +
            '<button class="btn-ghost food-del" data-del="' + f.id + '">Delete from My Foods</button>' +
          '</div>'
        : '') +
      '</div>';
  }

  async function renderFoodResults(query) {
    const list = await Foods.search(query || '');
    const el = $('#foodResults');
    if (!list.length) {
      el.innerHTML = '<p class="note">' + ((await Foods.all()).length
        ? 'No matches.'
        : 'Nothing saved yet — quick-adds with a name can be saved here, and logged search results land here automatically.') + '</p>';
      return;
    }
    el.innerHTML = list.slice(0, 40).map(f => foodRow(f, f.id === expandedFoodId)).join('');
  }

  async function renderManage(query) {
    const list = await Foods.search(query || '');
    const el = $('#manageResults');
    el.innerHTML = list.length
      ? list.map(f => foodRow(f, f.id === expandedFoodId)).join('')
      : '<p class="note">No saved foods yet. Anything you save from Quick add or log from search shows up here.</p>';
  }

  async function logFood(fid, qty, container) {
    const f = (await Foods.all()).find(x => x.id === fid);
    if (!f || !(qty > 0)) return;
    const macros = Foods.macrosFor(f, qty);
    DayStore.mutate(profile, rec => {
      rec.items.push({
        id: Foods.uuid(), section: addSection, name: f.name,
        qty, unit: f.per === '100g' ? 'g' : 'serving',
        macros, foodId: f.id, ts: new Date().toISOString(),
      });
    });
    Foods.touch(fid);
    expandedFoodId = null;
    if (container === 'manage') renderManage($('#manageSearch').value);
    else closeAdd();
  }

  /* ---------- edit item sheet ---------- */
  function openItem(id) {
    const rec = DayStore.record();
    const it = rec.items.find(x => x.id === id);
    if (!it) return;
    editItemId = id;
    $('#itemName').textContent = it.name;
    $('#itemMacros').textContent = fmtMacros(it.macros);
    $('#itemQty').value = it.qty;
    $('#itemUnit').textContent = it.unit === 'g' ? 'g' : '×';
    $$('#itemSections .chip').forEach(c => c.classList.toggle('active', c.dataset.sec === it.section));
    $('#itemSheet').classList.add('open');
    $('#itemBackdrop').classList.add('open');
  }
  function closeItem() {
    editItemId = null;
    $('#itemSheet').classList.remove('open');
    $('#itemBackdrop').classList.remove('open');
  }

  async function saveItem() {
    const rec = DayStore.record();
    const it = rec.items.find(x => x.id === editItemId);
    if (!it) { closeItem(); return; }
    const qty = parseFloat($('#itemQty').value);
    const sec = ($$('#itemSections .chip.active')[0] || {}).dataset || {};
    const food = it.foodId ? (await Foods.all()).find(x => x.id === it.foodId) : null;
    DayStore.mutate(profile, r => {
      const item = r.items.find(x => x.id === editItemId);
      if (!item) return;
      if (qty > 0 && qty !== item.qty) {
        item.macros = food ? Foods.macrosFor(food, qty) : scale(item.macros, qty / item.qty);
        item.qty = qty;
      }
      if (sec.sec) item.section = sec.sec;
    });
    closeItem();
  }
  function scale(m, k) {
    const r1 = v => Math.round(v * k * 10) / 10;
    return { kcal: Math.round((m.kcal || 0) * k), p: r1(m.p || 0), c: r1(m.c || 0), f: r1(m.f || 0) };
  }

  /* ---------- wiring (once) ---------- */
  function wire() {
    if (wired) return;
    wired = true;

    // section open/close + add + item taps (delegated)
    $('#customSections').addEventListener('click', e => {
      const add = e.target.closest('.add-row');
      if (add) { openAdd(add.dataset.sec); return; }
      const item = e.target.closest('.item');
      if (item) { openItem(item.dataset.id); return; }
      const top = e.target.closest('.meal-top');
      if (top) {
        const card = top.closest('.log-sec');
        const open = card.classList.toggle('open');
        top.setAttribute('aria-expanded', open);
      }
    });

    // habits (delegated)
    $('#customHabitList').addEventListener('click', e => {
      const btn = e.target.closest('[data-chabit]');
      if (!btn) return;
      DayStore.mutate(profile, rec => {
        rec.habits[btn.dataset.chabit] = !rec.habits[btn.dataset.chabit];
      });
    });

    // add sheet
    $('#addClose').addEventListener('click', closeAdd);
    $('#addBackdrop').addEventListener('click', closeAdd);
    $$('#addTabs .chip').forEach(ch => ch.addEventListener('click', () => {
      $$('#addTabs .chip').forEach(c => c.classList.toggle('active', c === ch));
      $('#paneQuick').hidden = ch.dataset.pane !== 'quick';
      $('#paneFoods').hidden = ch.dataset.pane !== 'foods';
      if (ch.dataset.pane === 'foods') $('#foodSearch').focus();
    }));
    ['#qaP', '#qaC', '#qaF'].forEach(s => $(s).addEventListener('input', qaRefreshKcal));
    $('#qaKcal').addEventListener('input', () => { qaKcalDirty = $('#qaKcal').value !== ''; });
    $('#qaSave').addEventListener('click', () => {
      qaSaveToFoods = !qaSaveToFoods;
      $('#qaSave').classList.toggle('done', qaSaveToFoods);
    });
    $('#qaAdd').addEventListener('click', submitQuickAdd);
    $('#foodSearch').addEventListener('input', () => renderFoodResults($('#foodSearch').value));

    // food rows (shared handler for add-sheet pane + manage view)
    const foodsHandler = container => async e => {
      const star = e.target.closest('[data-star]');
      if (star) { await Foods.toggleFavorite(star.dataset.star); refreshFoodViews(container); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (confirm('Delete this food from My Foods? Logged history keeps its numbers.')) {
          await Foods.remove(del.dataset.del);
          expandedFoodId = null;
          refreshFoodViews(container);
        }
        return;
      }
      const log = e.target.closest('[data-log]');
      if (log) {
        const row = log.closest('.food-row');
        const qty = parseFloat(row.querySelector('.food-qty').value);
        await logFood(log.dataset.log, qty, container);
        return;
      }
      const main = e.target.closest('.food-row-main');
      if (main) {
        const row = main.closest('.food-row');
        expandedFoodId = expandedFoodId === row.dataset.fid ? null : row.dataset.fid;
        refreshFoodViews(container);
        if (expandedFoodId) {
          const q = document.querySelector('.food-row.expanded .food-qty');
          if (q) { q.focus(); q.select(); }
        }
      }
    };
    $('#foodResults').addEventListener('click', foodsHandler('sheet'));
    $('#manageResults').addEventListener('click', foodsHandler('manage'));
    $('#manageSearch').addEventListener('input', () => renderManage($('#manageSearch').value));

    // item sheet
    $('#itemClose').addEventListener('click', closeItem);
    $('#itemBackdrop').addEventListener('click', closeItem);
    $$('#itemSections .chip').forEach(ch => ch.addEventListener('click', () => {
      $$('#itemSections .chip').forEach(c => c.classList.toggle('active', c === ch));
    }));
    $('#itemSave').addEventListener('click', saveItem);
    $('#itemDelete').addEventListener('click', () => {
      DayStore.mutate(profile, rec => {
        rec.items = rec.items.filter(x => x.id !== editItemId);
      });
      closeItem();
    });

    DayStore.onChange(() => renderAll());
  }

  function refreshFoodViews(container) {
    if (container === 'manage') renderManage($('#manageSearch').value);
    else renderFoodResults($('#foodSearch').value);
  }

  /* ---------- shared-control mutations (called from app.js) ---------- */
  function setWeight(v) { DayStore.mutate(profile, rec => { rec.weight = v; }); }
  function setWorkout(id) {
    DayStore.mutate(profile, rec => { rec.workout = rec.workout === id ? null : id; });
  }
  function toggleSharedHabit() { /* program habit list is hidden in custom mode */ }

  /* ---------- mount / unmount ---------- */
  async function mount(p) {
    profile = p;
    wire();
    active = true;
    document.body.classList.add('mode-custom');
    $('#customSections').hidden = false;
    $('#foodsManage').hidden = false;
    $$('.tabbar button[data-tab="plan"] span').forEach(s => { s.textContent = 'Foods'; });
    await DayStore.load(DayStore.todayStr(), p);
    renderAll();
    renderManage('');
  }

  function unmount() {
    active = false;
    document.body.classList.remove('mode-custom');
    $('#customSections').hidden = true;
    $('#customHabits').hidden = true;
    $('#foodsManage').hidden = true;
    $$('.tabbar button[data-tab="plan"] span').forEach(s => { s.textContent = 'Plan'; });
  }

  function isActive() { return active; }
  async function checkRollover() {
    const t = DayStore.todayStr();
    if (active && DayStore.date() !== t) {
      await DayStore.load(t, profile);
      renderAll();
    }
  }

  return { mount, unmount, isActive, checkRollover, setWeight, setWorkout };
})();
