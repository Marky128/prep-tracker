# Prep Tracker

An installable, fully offline PWA for daily contest-prep tracking: 5 meals with
swap options, macro progress bars, a daily habit checklist, bodyweight logging,
and weekly/monthly progress charts. Vanilla HTML/CSS/JS — no build step, no
accounts, no network calls after first load. All data stays on-device.

## Structure

```
index.html          app shell — Today / History / Plan tabs
styles.css          design system + self-hosted fonts
js/db.js            IndexedDB promise wrapper (localStorage fallback)
js/app.js           today-tab state, midnight rollover, settings sheet
js/history.js       Chart.js charts, habit heatmap, streaks, stat cards
vendor/             Chart.js 4.5.0 (local copy, precached)
fonts/              Barlow Condensed · IBM Plex Mono · Inter (woff2)
icons/              app icons (regenerate with tools/make_icons.py)
manifest.json       PWA manifest
sw.js               service worker — precaches everything for offline use
meal-plan.html      the original single-file page this app was built from
```

## Run locally

Service workers need HTTP (not `file://`):

```bash
cd "Prep Tracker"
python3 -m http.server 8080
```

Open http://localhost:8080. To test offline: load the page once, then stop the
server and reload — it should still work.

## Deploy to GitHub Pages

```bash
git init
git add -A
git commit -m "Prep Tracker PWA"
gh repo create prep-tracker --public --source=. --push
# or: create an empty repo on github.com, then
# git remote add origin https://github.com/<you>/prep-tracker.git
# git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch: `main` / `(root)` → Save.** After a minute the app is live at
`https://<you>.github.io/prep-tracker/`. All paths are relative, so it works
from the repo subpath without configuration.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch **Prep Tracker** from the home screen — it runs standalone,
   fullscreen, and works with no connection.

Tips:
- Data lives in IndexedDB on the device. The app requests persistent storage,
  but **export a JSON backup regularly** (gear icon → Export data) — iOS can
  evict website data if the app is unused for weeks.
- Import restores a backup on a new phone or after a reinstall.

## Updating the app

Edit files, **bump `CACHE` in `sw.js`** (e.g. `prep-tracker-v2`), commit and
push. Installed apps pick up the new version on the second launch after the
deploy.

## Regenerating icons

```bash
pip install pillow
python3 tools/make_icons.py
```
