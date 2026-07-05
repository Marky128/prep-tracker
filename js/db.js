/* Promise wrapper over IndexedDB with a transparent localStorage fallback.
   v3 schema: 'days' (keyPath date), 'settings' (out-of-line keys),
   'foods' (keyPath id), 'workouts' (keyPath id, one record per session).
   Day records carry per-record schema flags; the v1→v2 transform itself
   lives in js/migrate.js (global Migrate). */
const DB = (() => {
  'use strict';

  const NAME = 'prep-tracker';
  const VERSION = 3;
  const LS = 'pt:';

  let dbPromise = null;
  let lsMode = false;

  function open() {
    if (lsMode) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(NAME, VERSION); }
      catch (err) { reject(err); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'date' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('foods')) db.createObjectStore('foods', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' });
      };
      // another same-origin context on the old version is holding the
      // upgrade off. Its onversionchange (below) closes it so this normally
      // clears on its own; surface it if a frozen tab makes it linger.
      req.onblocked = () => { console.warn('IndexedDB upgrade blocked by another open tab — close other copies of the app'); };
      req.onsuccess = () => {
        const db = req.result;
        try { sessionStorage.removeItem('pt:vreload'); } catch (e) {}
        // WebKit can sever the connection while the page lives on; dropping
        // the cached promise lets the next operation reopen transparently
        db.onclose = () => { dbPromise = null; };
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => {
        const err = req.error;
        // A still-cached old client hitting an upgraded DB must reload to
        // pick up current code — NOT silently fall back to localStorage.
        if (err && err.name === 'VersionError') {
          let reloaded = false;
          try { reloaded = !!sessionStorage.getItem('pt:vreload'); } catch (e) {}
          if (!reloaded) {
            try { sessionStorage.setItem('pt:vreload', '1'); } catch (e) {}
            location.reload();
            return; // page is reloading; leave the promise pending
          }
        }
        reject(err || new Error('IndexedDB open failed'));
      };
    }).then(db => migrateFromLS(db).then(() => db, () => db))
      .catch(err => {
        if (err && err.name === 'VersionError') throw err;
        lsMode = true;
        dbPromise = null;
        return null;
      });
    return dbPromise;
  }

  /* records written while a session ran on the localStorage fallback would
     otherwise be stranded there — fold them back in on a successful open */
  function migrateFromLS(db) {
    return new Promise(resolve => {
      let keys;
      // only fallback-store records — pt:appearance / pt:layout mirrors
      // live in localStorage on purpose and must survive
      const prefixes = ['day:', 'set:', 'food:', 'workout:'].map(p => LS + p);
      try { keys = Object.keys(localStorage).filter(k => prefixes.some(p => k.startsWith(p))); }
      catch (e) { resolve(); return; }
      if (!keys.length) { resolve(); return; }
      const t = db.transaction(['days', 'settings', 'foods', 'workouts'], 'readwrite');
      const days = t.objectStore('days');
      const settings = t.objectStore('settings');
      const foods = t.objectStore('foods');
      const workouts = t.objectStore('workouts');
      for (const k of keys) {
        const val = ls.read(k);
        if (val == null) continue;
        if (k.startsWith(LS + 'day:') && val.date) {
          const get = days.get(val.date);
          get.onsuccess = () => {
            const cur = get.result;
            if (!cur || String(cur.updatedAt || '') <= String(val.updatedAt || '')) days.put(val);
          };
        } else if (k.startsWith(LS + 'set:')) {
          settings.put(val, k.slice((LS + 'set:').length));
        } else if (k.startsWith(LS + 'food:') && val.id) {
          foods.put(val);
        } else if (k.startsWith(LS + 'workout:') && val.id) {
          workouts.put(val);
        }
      }
      t.oncomplete = () => {
        try { keys.forEach(k => localStorage.removeItem(k)); } catch (e) {}
        resolve();
      };
      t.onerror = t.onabort = () => resolve();
    });
  }

  function tx(store, mode, fn, retried) {
    return open().then(db => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        let settled = false; // a failed tx fires both onerror and onabort — retry once, not twice
        const retry = err => {
          if (settled) return;
          settled = true;
          if (retried) { reject(err); return; }
          dbPromise = null;
          resolve(tx(store, mode, fn, true));
        };
        let t;
        try { t = db.transaction(store, mode); }
        catch (err) { retry(err); return; }
        const req = fn(t.objectStore(store));
        t.oncomplete = () => { settled = true; resolve(req ? req.result : undefined); };
        t.onerror = () => retry(t.error);
        t.onabort = () => retry(t.error || new Error('transaction aborted'));
      });
    });
  }

  async function useLS() { await open(); return lsMode; }

  const ls = {
    read(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    },
    write(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
    keysWith: prefix => Object.keys(localStorage).filter(k => k.startsWith(prefix)),
  };

  /* ---------- days ---------- */
  async function getDay(date) {
    if (await useLS()) return ls.read(LS + 'day:' + date);
    const rec = await tx('days', 'readonly', s => s.get(date));
    return rec === undefined ? null : rec;
  }
  async function putDay(rec) {
    if (await useLS()) return ls.write(LS + 'day:' + rec.date, rec);
    await tx('days', 'readwrite', s => s.put(rec));
  }
  async function getAllDays() {
    let rows;
    if (await useLS()) rows = ls.keysWith(LS + 'day:').map(k => ls.read(k)).filter(Boolean);
    else rows = (await tx('days', 'readonly', s => s.getAll())) || [];
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /* ---------- settings ---------- */
  async function getSetting(key) {
    if (await useLS()) return ls.read(LS + 'set:' + key);
    const val = await tx('settings', 'readonly', s => s.get(key));
    return val === undefined ? null : val;
  }
  async function putSetting(key, val) {
    if (await useLS()) return ls.write(LS + 'set:' + key, val);
    await tx('settings', 'readwrite', s => s.put(val, key));
  }
  async function deleteSetting(key) {
    if (await useLS()) { try { localStorage.removeItem(LS + 'set:' + key); } catch (e) {} return; }
    await tx('settings', 'readwrite', s => s.delete(key));
  }

  /* ---------- foods ---------- */
  async function getAllFoods() {
    if (await useLS()) return ls.keysWith(LS + 'food:').map(k => ls.read(k)).filter(Boolean);
    return (await tx('foods', 'readonly', s => s.getAll())) || [];
  }
  async function putFood(food) {
    if (await useLS()) return ls.write(LS + 'food:' + food.id, food);
    await tx('foods', 'readwrite', s => s.put(food));
  }
  async function deleteFood(id) {
    if (await useLS()) { try { localStorage.removeItem(LS + 'food:' + id); } catch (e) {} return; }
    await tx('foods', 'readwrite', s => s.delete(id));
  }

  /* ---------- workouts ---------- */
  async function getWorkout(id) {
    if (await useLS()) return ls.read(LS + 'workout:' + id);
    const rec = await tx('workouts', 'readonly', s => s.get(id));
    return rec === undefined ? null : rec;
  }
  async function putWorkout(rec) {
    if (await useLS()) return ls.write(LS + 'workout:' + rec.id, rec);
    await tx('workouts', 'readwrite', s => s.put(rec));
  }
  async function deleteWorkout(id) {
    if (await useLS()) { try { localStorage.removeItem(LS + 'workout:' + id); } catch (e) {} return; }
    await tx('workouts', 'readwrite', s => s.delete(id));
  }
  async function getAllWorkouts() {
    let rows;
    if (await useLS()) rows = ls.keysWith(LS + 'workout:').map(k => ls.read(k)).filter(Boolean);
    else rows = (await tx('workouts', 'readonly', s => s.getAll())) || [];
    // chronological: by date, then start time so same-day order is stable
    // (IDB getAll returns UUID-key order). A total order matters — the tag
    // sync and repeat-last both trust "last element = most recent".
    return rows.sort((a, b) => {
      const ka = String(a.date) + (a.startedAt || '');
      const kb = String(b.date) + (b.startedAt || '');
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  /* ---------- backup / restore ---------- */
  async function exportAll() {
    return {
      app: 'prep-tracker',
      version: 4,
      exportedAt: new Date().toISOString(),
      days: await getAllDays(),
      foods: await getAllFoods(),
      workouts: await getAllWorkouts(),
      settings: {
        profile: await getSetting('profile'),
        lastSwaps: await getSetting('lastSwaps'),
        appearance: await getSetting('appearance'),
        layout: await getSetting('layout'),
        customExercises: await getSetting('customExercises'),
      },
    };
  }

  /* Accepts v1/v2/v3 export files. Every unmigrated day runs through the
     same Migrate transform as boot (incl. the kg-era weight fix), so old
     backups import correctly forever. opts.profile: 'skip' (default) or
     'replace' — the caller decides after confirming with the user. */
  async function importAll(data, opts) {
    opts = opts || {};
    if (!data || data.app !== 'prep-tracker' || !Array.isArray(data.days)) {
      throw new Error('not a recognized backup file');
    }
    let n = 0;
    for (const d of data.days) {
      if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      let rec = d;
      if (!(rec.schema >= 2)) {
        try { rec = Migrate.migrateDay(rec) || rec; }
        catch (e) { continue; } // never import a record the transform can't preserve
      }
      await putDay(rec);
      n++;
    }
    if (Array.isArray(data.foods)) {
      for (const f of data.foods) if (f && f.id && f.name) await putFood(f);
    }
    if (Array.isArray(data.workouts)) {
      for (const w of data.workouts) {
        // sanitize into the shape the renderers assume, so a hand-edited or
        // truncated backup can't poison the Train tab into a permanent crash
        if (!w || typeof w.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date || '')) continue;
        const clean = {
          id: w.id, date: w.date,
          type: typeof w.type === 'string' ? w.type : null,
          startedAt: typeof w.startedAt === 'string' ? w.startedAt : null,
          endedAt: typeof w.endedAt === 'string' ? w.endedAt : null,
          unit: w.unit === 'kg' ? 'kg' : 'lb',
          exercises: (Array.isArray(w.exercises) ? w.exercises : []).map(ex => ({
            exId: String((ex && ex.exId) || ''),
            name: String((ex && ex.name) || ''),
            sets: (ex && Array.isArray(ex.sets) ? ex.sets : []).map(st => ({
              w: st && typeof st.w === 'number' ? st.w : null,
              r: st && typeof st.r === 'number' ? st.r : null,
              done: !!(st && st.done),
            })),
          })).filter(ex => ex.exId),
          updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : new Date().toISOString(),
        };
        await putWorkout(clean);
      }
    }
    const s = data.settings || {};
    if (s.lastSwaps) await putSetting('lastSwaps', s.lastSwaps);
    if (s.appearance) await putSetting('appearance', s.appearance);
    if (s.layout) await putSetting('layout', s.layout);
    if (Array.isArray(s.customExercises)) {
      const clean = s.customExercises
        .filter(e => e && typeof e.id === 'string' && typeof e.name === 'string')
        .map(e => ({ id: e.id, name: e.name, grp: typeof e.grp === 'string' ? e.grp : 'other', custom: true }));
      await putSetting('customExercises', clean);
    }
    if (s.profile && opts.profile === 'replace') await putSetting('profile', s.profile);
    return n;
  }

  return {
    getDay, putDay, getAllDays,
    getSetting, putSetting, deleteSetting,
    getAllFoods, putFood, deleteFood,
    getWorkout, putWorkout, deleteWorkout, getAllWorkouts,
    exportAll, importAll,
    usingFallback: () => lsMode,
  };
})();
