/* Week strip at the top of Today: Mon–Sun columns of mini macro bars vs
   that day's snapshot targets. Today is boxed; past days are tappable
   (opens the day for editing); future days show faint target ghosts. */
const Dashboard = (() => {
  'use strict';

  const $ = s => document.querySelector(s);
  let profile = null;
  let mounted = false;

  function dstr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function activeSnapshot() {
    if (profile && profile.activeProgramId) return JSON.parse(JSON.stringify(Migrate.ETHAN_SNAPSHOT));
    return DayStore.customSnapshot(profile);
  }

  const BAR_AREA = 44; // px

  async function refresh() {
    if (!mounted || !profile) return;
    const days = await DB.getAllDays().catch(() => []);
    const map = new Map(days.map(r => [r.date, r]));
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const todayKey = dstr(today);
    const dow = (today.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(today); monday.setDate(monday.getDate() - dow);

    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const key = dstr(d);
      const rec = map.get(key) || null;
      const future = key > todayKey;
      const isToday = key === todayKey;
      const snap = (rec && rec.targetsSnapshot) || activeSnapshot();
      const totals = (rec && rec.macros) || { kcal: 0, p: 0, c: 0, f: 0 };

      const bars = ['kcal', 'p', 'c', 'f']
        .filter(k => (snap.types[k] || 'band') !== 'none' && snap[k])
        .map(k => {
          if (future) return '<i class="ws-bar future" style="height:' + BAR_AREA + 'px"></i>';
          const pct = Math.min(110, ((totals[k] || 0) / snap[k]) * 100);
          const verdict = rec
            ? Targets.judge(Math.round(totals[k] || 0), snap[k], snap.tolerancePct, snap.types[k] || 'band')
            : 'none';
          const h = Math.max(3, Math.round((pct / 100) * BAR_AREA));
          return '<i class="ws-bar' + (verdict === 'in' ? ' in' : '') + '" style="height:' + h + 'px"></i>';
        }).join('');

      html += '<button class="ws-day' + (isToday ? ' today' : '') + (future ? ' future' : '') + '"' +
        ' data-date="' + key + '"' + (future ? ' disabled' : '') +
        ' aria-label="' + key + '">' +
        '<span class="ws-lab">' + 'MTWTFSS'[i] + '</span>' +
        '<span class="ws-bars">' + bars + '</span>' +
        '<span class="ws-num">' + d.getDate() + '</span></button>';
    }
    $('#weekStrip').innerHTML = html;
  }

  function mount(p) {
    profile = p;
    if (!mounted) {
      mounted = true;
      $('#weekStrip').addEventListener('click', e => {
        const btn = e.target.closest('.ws-day');
        if (btn && !btn.disabled && window.PT.openDay) window.PT.openDay(btn.dataset.date);
      });
    }
    refresh();
  }

  // both Today views ping this after any persist
  window.PT = window.PT || {};
  window.PT.dayChanged = () => refresh();

  return { mount, refresh };
})();
