# Intake

A polished, offline-first macro tracker you install from a URL. Set your own
calorie/macro targets (or estimate them), log food from a bundled Canadian
food database, online packaged-food search, or quick entry — and watch
adherence-neutral trends: ranges instead of exact numbers, trend weight
instead of daily noise, an expenditure estimate once there's enough data.

No accounts, no server, no analytics. Everything lives in your device's
browser storage. Vanilla HTML/CSS/JS, no build step.

**Two modes**
- **Custom** (default): your targets, your food log (Breakfast / Lunch /
  Dinner / Snacks), habits, bodyweight, training.
- **Ethan's Plan**: a specific contest-prep program — 5 fixed meals with swap
  options at ~2,700 kcal — tracked by simply checking meals off. Switch modes
  anytime in Settings; every day renders in the mode it was logged in.

## Share the beta

Send someone the URL. On iPhone: open it in **Safari → Share → Add to Home
Screen → Add**. That's the whole install. Each device keeps its own private
data — nothing is shared or uploaded, ever. First launch runs a one-minute
setup (name, targets, mode).

## Structure

```
index.html               app shell: tabs, onboarding, sheets
styles.css               design system
js/
  db.js                  IndexedDB (days/settings/foods) + localStorage fallback
  migrate.js             v1→v2 record transform (additive, per-record flag)
  targets.js             ranges, 4/4/9, Mifflin-St Jeor, trend EWMA, TDEE
  day-store.js           owner of the day record being viewed/edited
  onboarding.js          first-launch stepper / profile editor
  today-program.js       Ethan's Plan renderer (data-driven from JSON)
  today-custom.js        custom log, add-food sheet, My Foods
  foods.js               personal food library
  food-db.js             bundled offline search (fuzzy, instant)
  food-online.js         Open Food Facts search (Canada-first)
  dashboard.js           Mon–Sun week strip
  history.js             charts, heatmaps, streaks, expenditure card
programs/ethan-prep.json the program, extracted verbatim from the original app
data/foods-cnf.json      ~2,600 curated foods (Canadian Nutrient File)
tools/                   build/extract scripts, migration test page, unit tests
sw.js                    service worker — precaches everything for offline
```

## Development

```bash
python3 -m http.server 8080     # service workers need http, not file://
```

Tests (need node): `node tools/tests/<name>.test.mjs` — migrate, targets,
food-db, parity, wiring. Rebuild the food database with
`python3 tools/build-food-db.py`. The one-time v1 migration can be dry-run
against a copy of real data at `tools/migration-test.html`.

**Ship a change:** edit files → **bump `CACHE` in `sw.js`** → commit → push.
Installed apps pick the new version up on the second launch after deploy.

## Deploy (GitHub Pages)

Settings → Pages → Deploy from branch `main` / root. All paths are relative;
works from any repo subpath.

## Data & attribution

- Bundled food data: [Canadian Nutrient File](https://food-nutrition.canada.ca/cnf-fce/)
  © Health Canada, Open Government Licence – Canada.
- Online search: [Open Food Facts](https://world.openfoodfacts.org) (ODbL).
- Backups: Settings → Export writes a JSON of everything (days, foods,
  profile); Import restores it — old-format backups from any previous app
  version import cleanly.

## Path to the App Store (not implemented)

This PWA can be wrapped with [Capacitor](https://capacitorjs.com) for a
native iOS build: the same HTML/JS ships inside a WKWebView shell, IndexedDB
data can be migrated via an import screen, and the service worker is replaced
by bundled assets. That's the intended route if this beta graduates —
no rewrite required.
