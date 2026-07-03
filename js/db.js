/* Tiny promise wrapper over IndexedDB with a transparent localStorage
   fallback (private browsing / IDB failures). Day records are keyed by
   local date "YYYY-MM-DD"; settings are keyed by name. */
const DB = (() => {
  'use strict';

  const NAME = 'prep-tracker';
  const VERSION = 1;
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
      };
      req.onsuccess = () => {
        const db = req.result;
        // WebKit can sever the connection while the page lives on; dropping
        // the cached promise lets the next operation reopen transparently
        db.onclose = () => { dbPromise = null; };
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    }).then(db => migrateFromLS(db).then(() => db, () => db))
      .catch(() => {
        lsMode = true;
        dbPromise = null;
        return null;
      });
    return dbPromise;
  }

  /* days logged while a session ran on the localStorage fallback would
     otherwise be stranded there — fold them back in on a successful open */
  function migrateFromLS(db) {
    return new Promise(resolve => {
      let keys;
      try { keys = Object.keys(localStorage).filter(k => k.startsWith(LS)); }
      catch (e) { resolve(); return; }
      if (!keys.length) { resolve(); return; }
      const t = db.transaction(['days', 'settings'], 'readwrite');
      const days = t.objectStore('days');
      const settings = t.objectStore('settings');
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
    getDay: date => ls.read(LS + 'day:' + date),
    putDay: rec => localStorage.setItem(LS + 'day:' + rec.date, JSON.stringify(rec)),
    allDays: () => Object.keys(localStorage)
      .filter(k => k.startsWith(LS + 'day:'))
      .map(k => ls.read(k))
      .filter(Boolean),
    getSetting: key => ls.read(LS + 'set:' + key),
    putSetting: (key, val) => localStorage.setItem(LS + 'set:' + key, JSON.stringify(val)),
  };

  async function getDay(date) {
    if (await useLS()) return ls.getDay(date);
    const rec = await tx('days', 'readonly', s => s.get(date));
    return rec === undefined ? null : rec;
  }

  async function putDay(rec) {
    if (await useLS()) return ls.putDay(rec);
    await tx('days', 'readwrite', s => s.put(rec));
  }

  async function getAllDays() {
    let rows;
    if (await useLS()) rows = ls.allDays();
    else rows = (await tx('days', 'readonly', s => s.getAll())) || [];
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async function getSetting(key) {
    if (await useLS()) return ls.getSetting(key);
    const val = await tx('settings', 'readonly', s => s.get(key));
    return val === undefined ? null : val;
  }

  async function putSetting(key, val) {
    if (await useLS()) return ls.putSetting(key, val);
    await tx('settings', 'readwrite', s => s.put(val, key));
  }

  async function exportAll() {
    return {
      app: 'prep-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      days: await getAllDays(),
      settings: { lastSwaps: await getSetting('lastSwaps') },
    };
  }

  async function importAll(data) {
    if (!data || data.app !== 'prep-tracker' || !Array.isArray(data.days)) {
      throw new Error('not a Prep Tracker export file');
    }
    let n = 0;
    for (const d of data.days) {
      if (d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
        await putDay(d);
        n++;
      }
    }
    if (data.settings && data.settings.lastSwaps) {
      await putSetting('lastSwaps', data.settings.lastSwaps);
    }
    return n;
  }

  return { getDay, putDay, getAllDays, getSetting, putSetting, exportAll, importAll, usingFallback: () => lsMode };
})();
