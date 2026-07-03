/* Promise wrapper over IndexedDB with a transparent localStorage fallback.
   v2 schema: 'days' (keyPath date), 'settings' (out-of-line keys),
   'foods' (keyPath id). Day records carry per-record schema flags; the
   v1→v2 transform itself lives in js/migrate.js (global Migrate). */
const DB = (() => {
  'use strict';

  const NAME = 'prep-tracker';
  const VERSION = 2;
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
      };
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
      try { keys = Object.keys(localStorage).filter(k => k.startsWith(LS) && !k.startsWith(LS + 'vreload')); }
      catch (e) { resolve(); return; }
      if (!keys.length) { resolve(); return; }
      const t = db.transaction(['days', 'settings', 'foods'], 'readwrite');
      const days = t.objectStore('days');
      const settings = t.objectStore('settings');
      const foods = t.objectStore('foods');
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

  /* ---------- backup / restore ---------- */
  async function exportAll() {
    return {
      app: 'prep-tracker',
      version: 3,
      exportedAt: new Date().toISOString(),
      days: await getAllDays(),
      foods: await getAllFoods(),
      settings: {
        profile: await getSetting('profile'),
        lastSwaps: await getSetting('lastSwaps'),
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
    const s = data.settings || {};
    if (s.lastSwaps) await putSetting('lastSwaps', s.lastSwaps);
    if (s.profile && opts.profile === 'replace') await putSetting('profile', s.profile);
    return n;
  }

  return {
    getDay, putDay, getAllDays,
    getSetting, putSetting, deleteSetting,
    getAllFoods, putFood, deleteFood,
    exportAll, importAll,
    usingFallback: () => lsMode,
  };
})();
