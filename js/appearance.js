/* Theme, accent and Today-layout preferences. A tiny inline script in
   <head> applies the localStorage mirror before first paint; this module
   is the owner: IDB setting is the source of truth (it travels with
   export/import), localStorage is just the flash-free boot copy. */
const Appearance = (() => {
  'use strict';

  const THEMES = [
    { id: 'carbon',   name: 'Carbon',   desc: 'Near-black charcoal — the original' },
    { id: 'midnight', name: 'Midnight', desc: 'Deep blue-black' },
    { id: 'slate',    name: 'Slate',    desc: 'Softer graphite' },
    { id: 'paper',    name: 'Paper',    desc: 'Light mode' },
  ];
  const ACCENTS = [ // color = the swatch preview, matches the CSS --accent
    { id: 'cobalt',  name: 'Cobalt',  color: '#2f74d0' },
    { id: 'crimson', name: 'Crimson', color: '#d94f43' },
    { id: 'amber',   name: 'Amber',   color: '#c07f16' },
    { id: 'emerald', name: 'Emerald', color: '#2f8d5b' },
    { id: 'teal',    name: 'Teal',    color: '#1f8e94' },
    { id: 'violet',  name: 'Violet',  color: '#8d6ae8' },
    { id: 'rose',    name: 'Rose',    color: '#d85a8f' },
  ];

  /* Today-page blocks the user can reorder / hide. 'meals' can be moved
     but never hidden — it is the point of the tab. */
  const BLOCKS = [
    { id: 'meals',  name: 'Meals & food log', hideable: false },
    { id: 'habits', name: 'Daily habits',     hideable: true },
    { id: 'weight', name: 'Bodyweight',       hideable: true },
  ];
  const HIDEABLE_EXTRAS = [
    { id: 'weekStrip', name: 'Week strip' },
  ];

  const LS_APPEARANCE = 'pt:appearance';
  const LS_LAYOUT = 'pt:layout';

  let current = { theme: 'carbon', accent: 'cobalt' };
  let layout = normalizeLayout(null);
  const listeners = new Set();

  function validId(id, list, fallback) {
    return list.some(x => x.id === id) ? id : fallback;
  }

  function normalizeLayout(l) {
    const base = l && typeof l === 'object' ? l : {};
    const known = BLOCKS.map(b => b.id);
    let order = Array.isArray(base.order) ? base.order.filter(id => known.includes(id)) : [];
    order = order.concat(known.filter(id => !order.includes(id))); // anything missing keeps default position
    const hide = {};
    for (const b of BLOCKS) if (b.hideable && base.hide && base.hide[b.id]) hide[b.id] = true;
    for (const x of HIDEABLE_EXTRAS) if (base.hide && base.hide[x.id]) hide[x.id] = true;
    return { order, hide };
  }

  function readLS(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeLS(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /* ---------- apply ---------- */
  function applyTheme() {
    const el = document.documentElement;
    if (current.theme === 'carbon') delete el.dataset.theme;
    else el.dataset.theme = current.theme;
    if (current.accent === 'cobalt') delete el.dataset.accent;
    else el.dataset.accent = current.accent;
    // PWA chrome (status bar, task switcher) follows the page background
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const ink = getComputedStyle(el).getPropertyValue('--ink').trim();
      if (ink) meta.content = ink;
    }
    emit();
  }

  function applyLayout() {
    const body = document.body;
    if (!body) return;
    // reorder the actual DOM nodes (not flex `order`) so keyboard focus and
    // VoiceOver reading order track the visual order. The movable blocks are
    // the trailing children of #tab-today; re-appending them in the chosen
    // order keeps the header/week-strip/tracker pinned above.
    const parent = document.getElementById('tab-today');
    const els = {
      meals: ['programMeals', 'customSections'],
      habits: ['habitsBlock', 'customHabits'],
      weight: ['weightBlock'],
    };
    if (parent) {
      layout.order.forEach(id => {
        (els[id] || []).forEach(elId => {
          const el = document.getElementById(elId);
          if (el) parent.appendChild(el);
        });
      });
    }
    body.classList.toggle('hide-weekstrip', !!layout.hide.weekStrip);
    body.classList.toggle('hide-habits', !!layout.hide.habits);
    body.classList.toggle('hide-weight', !!layout.hide.weight);
  }

  /* ---------- persistence ---------- */
  function setAppearance(partial) {
    current = {
      theme: validId(partial.theme != null ? partial.theme : current.theme, THEMES, 'carbon'),
      accent: validId(partial.accent != null ? partial.accent : current.accent, ACCENTS, 'cobalt'),
    };
    applyTheme();
    writeLS(LS_APPEARANCE, current);
    DB.putSetting('appearance', current).catch(() => {});
  }

  function setLayout(next) {
    layout = normalizeLayout(next);
    applyLayout();
    writeLS(LS_LAYOUT, layout);
    DB.putSetting('layout', layout).catch(() => {});
  }

  /* boot: mirror was applied pre-paint by the head script; reconcile with
     IDB in case an import (or a cleared localStorage) changed things */
  async function init() {
    const a = readLS(LS_APPEARANCE);
    if (a) {
      current = { theme: validId(a.theme, THEMES, 'carbon'), accent: validId(a.accent, ACCENTS, 'cobalt') };
    }
    layout = normalizeLayout(readLS(LS_LAYOUT));
    applyTheme();
    applyLayout();
    const dbA = await DB.getSetting('appearance').catch(() => null);
    const dbL = await DB.getSetting('layout').catch(() => null);
    if (dbA && (dbA.theme !== current.theme || dbA.accent !== current.accent)) {
      current = { theme: validId(dbA.theme, THEMES, 'carbon'), accent: validId(dbA.accent, ACCENTS, 'cobalt') };
      applyTheme();
      writeLS(LS_APPEARANCE, current);
    }
    if (dbL) {
      layout = normalizeLayout(dbL);
      applyLayout();
      writeLS(LS_LAYOUT, layout);
    }
  }

  /* charts read the live palette instead of hardcoding hex values */
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    return {
      accent: v('--accent', '#2f74d0'),
      accentSoft: v('--accent-soft', 'rgba(47,116,208,.14)'),
      green: v('--green', '#5aa66a'),
      grid: v('--line', '#33363d'),
      mute: v('--mute', '#9a9da5'),
      bone: v('--bone', '#eceae5'),
      iron: v('--iron', '#1e2024'),
      steel: v('--steel', '#2a2d33'),
    };
  }

  function onChange(fn) { listeners.add(fn); }
  function emit() { listeners.forEach(fn => { try { fn(current); } catch (e) {} }); }

  return {
    THEMES, ACCENTS, BLOCKS, HIDEABLE_EXTRAS,
    init, colors, onChange,
    setAppearance, setLayout,
    get: () => ({ theme: current.theme, accent: current.accent }),
    getLayout: () => JSON.parse(JSON.stringify(layout)),
  };
})();
