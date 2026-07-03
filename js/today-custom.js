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
  let expandedDbId = null;
  let online = { q: null, status: 'idle', results: [], world: false, expanded: null };

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const fmtMacros = m => 'P ' + Math.round(m.p) + ' · C ' + Math.round(m.c) + ' · F ' + Math.round(m.f) + ' · ' + Math.round(m.kcal) + ' kcal';

  function targets() {
    const rec = DayStore.record();
    return (rec && rec.targetsSnapshot) || DayStore.customSnapshot(profile);
  }

  /* ---------- header (same target source as the tracker: the day's
     snapshot when it exists, so mid-day target changes can't disagree) ---------- */
  function renderHeader() {
    const t = targets();
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
    $('#trackerCount').textContent = n + ' item' + (n === 1 ? '' : 's');
    $('.day-flag').textContent = 'In range';
    $('.tracker').classList.toggle('complete', allIn && n > 0);
  }

  /* ---------- habits ---------- */
  function habitDefs() {
    // migrated legacy profiles carry habits:null — fall back to the generic set
    return (profile.habits && profile.habits.length ? profile.habits : Onboarding.GENERIC_HABITS) || [];
  }
  function renderHabits() {
    const rec = DayStore.record();
    const list = $('#customHabitList');
    list.innerHTML = habitDefs().map(h =>
      '<button class="habit' + (rec.habits && rec.habits[h.id] ? ' done' : '') + '" data-chabit="' + h.id + '">' +
        '<span class="check">' + CHECK_SVG + '</span>' +
        '<span class="habit-name">' + esc(h.name) + '</span><span class="habit-meta">' + esc(h.meta || '') + '</span>' +
      '</button>'
    ).join('');
    $('#customHabits').hidden = !habitDefs().length;
  }

  /* ---------- shared controls (weight / training / date) ---------- */
  function renderShared() {
    const rec = DayStore.record();
    const isToday = DayStore.date() === DayStore.todayStr();
    const kg = profile.units === 'kg';
    const wi = $('#weightInput');
    wi.min = kg ? 25 : 50;
    wi.max = kg ? 320 : 700;
    wi.setAttribute('aria-label', 'Bodyweight in ' + (kg ? 'kilograms' : 'pounds'));
    // records store the unit the weight was entered in — display converted
    const disp = rec.weight == null ? null
      : Targets.round1(Targets.toProfileUnits(rec.weight, rec.weightUnit === 'kg' ? 'kg' : 'lbs', profile.units));
    wi.value = disp == null ? '' : String(disp);
    $('#weightStatus').textContent = disp == null
      ? 'optional — trend beats daily noise'
      : 'logged ' + disp.toFixed(1) + ' ' + Targets.unitLabel(profile.units) + (isToday ? ' today' : '');
    $('.weight-unit').textContent = Targets.unitLabel(profile.units);
    $$('#workoutChips .chip').forEach(c => c.classList.toggle('active', c.dataset.workout === rec.workout));
    $('#dateLabel').textContent = new Date(DayStore.date() + 'T12:00:00')
      .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
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
    FoodDB.ready().then(() => renderFoodResults($('#foodSearch').value)).catch(() => {});
    renderFoodResults($('#foodSearch').value);
  }
  function closeAdd() {
    $('#addSheet').classList.remove('open');
    $('#addBackdrop').classList.remove('open');
    expandedDbId = null;
    expandedFoodId = null;
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
    if (qaSaveToFoods && !($('#qaName').value || '').trim()) {
      $('#qaHint').textContent = 'Give it a name to save it to My Foods — or untick the save toggle.';
      return;
    }
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

  function dbRow(f) {
    const expanded = f.i === expandedDbId;
    const servChips = (f.s || []).map(s =>
      '<button class="chip" data-servg="' + s[1] + '">' + esc(s[0]) + ' · ' + s[1] + 'g</button>').join('');
    return '<div class="food-row db-row" data-dbid="' + f.i + '">' +
      '<div class="food-row-main" role="button" tabindex="0">' +
        '<div class="food-info food-info-db"><span class="food-name">' + esc(f.n) + '</span>' +
        '<span class="food-meta">P ' + f.p + ' · C ' + f.c + ' · F ' + f.f + ' · ' + f.k + ' kcal per 100 g</span></div>' +
      '</div>' +
      (expanded
        ? '<div class="food-qty-form db-qty-form">' +
            (servChips ? '<div class="chips serv-chips">' + servChips + '</div>' : '') +
            '<span class="field-input"><input type="number" inputmode="decimal" min="0" step="any" class="food-qty" value="100"><i>g</i></span>' +
            '<button class="btn btn-primary btn-slim" data-dblog="' + f.i + '">Add</button>' +
            '<button class="btn-ghost food-del" data-dbsave="' + f.i + '">Save to My Foods</button>' +
          '</div>'
        : '') +
      '</div>';
  }

  function onlineRow(item, idx) {
    const expanded = online.expanded === idx;
    const m = item.macros;
    return '<div class="food-row db-row" data-online="' + idx + '">' +
      '<div class="food-row-main" role="button" tabindex="0">' +
        '<div class="food-info food-info-db"><span class="food-name">' + esc(item.name) +
          (item.brand ? ' <span class="food-brand">· ' + esc(item.brand) + '</span>' : '') + '</span>' +
        '<span class="food-meta">P ' + m.p + ' · C ' + m.c + ' · F ' + m.f + ' · ' + m.kcal + ' kcal per 100 g</span></div>' +
      '</div>' +
      (expanded
        ? '<div class="food-qty-form db-qty-form">' +
            '<span class="field-input"><input type="number" inputmode="decimal" min="0" step="any" class="food-qty" value="100"><i>g</i></span>' +
            '<button class="btn btn-primary btn-slim" data-onlinelog="' + idx + '">Add</button>' +
            '<p class="note online-note">Adding also saves it to My Foods.</p>' +
          '</div>'
        : '') +
      '</div>';
  }

  function onlineSection(q) {
    if (!q) return '';
    let html = '<div class="res-label">Online · Canada</div>';
    if (!navigator.onLine && online.status !== 'done') {
      return html + '<p class="note">Online search needs a connection — everything above works offline.</p>';
    }
    if (online.status === 'loading') {
      return html + '<div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>';
    }
    if (online.status === 'done' && online.q === q) {
      if (!online.results.length) {
        html += '<p class="note">No packaged foods found' + (online.world ? '' : ' in Canada') + '.</p>';
      } else {
        html += online.results.map(onlineRow).join('');
      }
      if (!online.world) {
        html += '<button class="btn-ghost online-world" id="onlineWorld">Search all countries instead</button>';
      }
      return html;
    }
    if (online.status === 'busy' && online.q === q) {
      return html + '<p class="note">Search is busy right now — give it a minute and try again.</p>' +
        '<button class="btn online-btn" id="onlineGo">Retry online search</button>';
    }
    if (online.status === 'offline' && online.q === q) {
      return html + '<p class="note">Couldn’t reach the food database — check your connection.</p>' +
        '<button class="btn online-btn" id="onlineGo">Retry online search</button>';
    }
    return html + '<button class="btn online-btn" id="onlineGo">Search online for “' + esc(q) + '”</button>' +
      '<p class="note">Branded &amp; packaged foods, via Open Food Facts.</p>';
  }

  async function runOnlineSearch(q, world) {
    online = { q, status: 'loading', results: [], world: !!world, expanded: null };
    renderFoodResults($('#foodSearch').value);
    try {
      const r = await FoodOnline.search(q, { world });
      if (!r) return; // aborted by a newer search
      online.status = 'done';
      online.results = r.results;
    } catch (err) {
      online.status = err.message === 'offline' ? 'offline' : 'busy';
    }
    renderFoodResults($('#foodSearch').value);
  }

  async function renderFoodResults(query) {
    const el = $('#foodResults');
    const q = (query || '').trim();
    if (online.q && online.q !== q) online = { q: null, status: 'idle', results: [], world: false, expanded: null };
    const mine = await Foods.search(q);
    let html = '';
    if (mine.length) {
      html += '<div class="res-label">My foods</div>' +
        mine.slice(0, q ? 6 : 20).map(f => foodRow(f, f.id === expandedFoodId)).join('');
    }
    if (q) {
      const hits = FoodDB.search(q, 24);
      if (hits.length) {
        html += '<div class="res-label">Food database</div>' + hits.map(dbRow).join('');
      } else if (!FoodDB.count()) {
        html += '<p class="note">Loading food database…</p>';
      }
      if (!mine.length && !hits.length && FoodDB.count()) {
        html += '<p class="note">No offline matches — try the online search below, or Quick add.</p>';
      }
      html += onlineSection(q);
    } else if (!mine.length) {
      html += '<p class="note">Search ' + (FoodDB.count() ? FoodDB.count().toLocaleString() + '+' : 'thousands of') +
        ' common foods (Canadian Nutrient File). Foods you save or log land here for quantity-only logging.</p>';
    }
    el.innerHTML = html;
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
    $('#foodSearch').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = $('#foodSearch').value.trim();
        if (q && navigator.onLine && online.status !== 'loading') runOnlineSearch(q, false);
      }
    });

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

      // online search (add sheet only)
      const goBtn = e.target.closest('#onlineGo');
      if (goBtn) { runOnlineSearch($('#foodSearch').value.trim(), false); return; }
      const worldBtn = e.target.closest('#onlineWorld');
      if (worldBtn) { runOnlineSearch($('#foodSearch').value.trim(), true); return; }
      const onlineLog = e.target.closest('[data-onlinelog]');
      if (onlineLog) {
        const item = online.results[+onlineLog.dataset.onlinelog];
        const grams = parseFloat(onlineLog.closest('.food-row').querySelector('.food-qty').value);
        if (item && grams > 0) {
          const displayName = item.brand ? item.name + ' (' + item.brand + ')' : item.name;
          // logging an online result imports it into My Foods permanently
          const saved = await Foods.save({
            name: displayName.slice(0, 70), brand: item.brand, per: '100g',
            macros: item.macros, source: 'off', offCode: item.code,
          });
          DayStore.mutate(profile, rec => {
            rec.items.push({
              id: Foods.uuid(), section: addSection, name: saved.name,
              qty: grams, unit: 'g', macros: FoodOnline.macrosFor(item, grams),
              foodId: saved.id, ts: new Date().toISOString(),
            });
          });
          online.expanded = null;
          closeAdd();
        }
        return;
      }

      // bundled-database rows (add sheet only)
      const servChip = e.target.closest('[data-servg]');
      if (servChip) {
        const input = servChip.closest('.food-qty-form').querySelector('.food-qty');
        input.value = servChip.dataset.servg;
        return;
      }
      const dbLog = e.target.closest('[data-dblog]');
      if (dbLog) {
        const f = FoodDB.byIndex(+dbLog.dataset.dblog);
        const grams = parseFloat(dbLog.closest('.food-row').querySelector('.food-qty').value);
        if (f && grams > 0) {
          DayStore.mutate(profile, rec => {
            rec.items.push({
              id: Foods.uuid(), section: addSection, name: f.n,
              qty: grams, unit: 'g', macros: FoodDB.macrosFor(f, grams),
              foodId: null, ts: new Date().toISOString(),
            });
          });
          expandedDbId = null;
          closeAdd();
        }
        return;
      }
      const dbSave = e.target.closest('[data-dbsave]');
      if (dbSave) {
        const f = FoodDB.byIndex(+dbSave.dataset.dbsave);
        if (f) {
          await Foods.save({
            name: f.n, per: '100g',
            macros: { kcal: f.k, p: f.p, c: f.c, f: f.f },
            servings: (f.s || []).map(s => ({ name: s[0], grams: s[1] })),
            source: 'cnf',
          });
          expandedDbId = null;
          refreshFoodViews(container);
        }
        return;
      }

      const main = e.target.closest('.food-row-main');
      if (main) {
        const row = main.closest('.food-row');
        if (row.dataset.online != null) {
          online.expanded = online.expanded === +row.dataset.online ? null : +row.dataset.online;
          expandedFoodId = null;
          expandedDbId = null;
        } else if (row.dataset.dbid != null) {
          expandedDbId = expandedDbId === +row.dataset.dbid ? null : +row.dataset.dbid;
          expandedFoodId = null;
        } else {
          expandedFoodId = expandedFoodId === row.dataset.fid ? null : row.dataset.fid;
          expandedDbId = null;
        }
        refreshFoodViews(container);
        if (expandedFoodId || expandedDbId != null) {
          const q = document.querySelector('.food-row.expanded .food-qty, .db-row .food-qty');
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
  function setWeight(v) {
    DayStore.mutate(profile, rec => {
      rec.weight = v; // entered in profile units — the unit travels with the value
      if (v == null) delete rec.weightUnit;
      else rec.weightUnit = Targets.recordUnitFor(profile.units);
    });
  }
  function setWorkout(id) {
    DayStore.mutate(profile, rec => { rec.workout = rec.workout === id ? null : id; });
  }
  function toggleSharedHabit() { /* program habit list is hidden in custom mode */ }

  /* ---------- mount / unmount ---------- */
  async function mount(p, date) {
    profile = p;
    wire();
    active = true;
    document.body.classList.add('mode-custom');
    $('#customSections').hidden = false;
    $('#foodsManage').hidden = false;
    $$('.tabbar button[data-tab="plan"] span').forEach(s => { s.textContent = 'Foods'; });
    await DayStore.load(date || DayStore.todayStr(), p);
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

  return { mount, unmount, isActive, setWeight, setWorkout };
})();
