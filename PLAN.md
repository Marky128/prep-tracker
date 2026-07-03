# PLAN.md — v3: General Macro Tracker ("beta product") + Ethan's Plan mode

Refactor the deployed prep tracker into a polished, shareable, MacroFactor-
style macro tracker with two modes — **Custom** (own targets, log any food)
and **Ethan's Plan** (the current plan, verbatim, as a simplified follow-along
program) — while preserving Ethan's real IndexedDB prep history. Static
offline-first PWA on GitHub Pages; vanilla JS; no build step; no accounts;
App-Store-grade polish. This plan already absorbed one adversarial review
round (3 lenses, 26 findings); the material ones are folded in below and
marked ⚑ where they changed a decision.

---

## 0. Decisions that need your eyes before Phase 2 (defaults chosen)

These get baked into migrated history — cheap to change now, expensive later.

1. **⚑ RESOLVED (owner decision 2026-07-03) — program calorie basis.**
   Ethan Mode reflects the original prep plan exactly: the official calorie
   number is **2,700** (profile target + header display + what other users
   get when they activate the program). It is display-only (`types.kcal:
   'none'`) — program-day compliance stays meals-completed with the three
   P/C/F bars, exactly like the original app, so no day is judged against a
   calorie band the meal macros (2,453 by 4/4/9) can't arithmetically meet.
   The 2,453 figure survives only as internal day-intake accounting for the
   expenditure estimate, footnoted there, never shown as a target.
2. **App name:** ① **Intake** (my pick) ② **Fuel Log** ③ **MacroLog**.
3. **Week strip:** calendar **Mon–Sun** (default) vs rolling last-7.
4. **Habits in Custom mode:** spec says habits stay. Your six are prep-
   specific (salt cranks, lemon juice). **Default: habits become a
   profile-level list — Custom users start with a generic set (Water, Steps,
   Cardio, Supplements), editable in Settings (Phase 9); Ethan's Plan
   supplies its six verbatim while active.**
5. **Training log (pull/push/legs/arms):** keep for everyone as an optional
   card (default), or fold into Ethan's Plan only?
6. **Empty past day opened for editing:** opens in the currently active mode
   (default), since it has no recorded mode of its own.

Reply "approved" to take all defaults, or override any by number.

---

## 1. Current state

- Live at `https://marky128.github.io/prep-tracker/`; **Ethan logs daily —
  every phase must leave the deployed app working for him.**
- IndexedDB `prep-tracker` v1: `days` (keyPath `date`) —
  `{date, meals[5], swaps[[labels]], habits{×6}, weight, weightUnit:'lbs',
  workout, macros{p,c,f}, updatedAt}` — and `settings` (`lastSwaps`).
- Meals/swaps/macros hardcoded in `index.html`; `app.js` reads them from the
  DOM. **Swap chip *labels* are the persistence keys** in `swaps` — any label
  drift breaks historic swap rendering. ⚑
- `db.js`: promise wrapper, localStorage fallback + fold-back, per-record
  `weightUnit` migration pattern (proven; we reuse it).
- SW: precache + cache-first with `ignoreSearch:true`, runtime-caches all
  same-origin GETs. `CACHE='prep-tracker-v2'`.

---

## 2. Data model (IndexedDB `prep-tracker` version 1 → 2)

Version 2 adds one store (`foods`). All other changes are **additive fields
on existing records** — no renames, no removals. Readers treat missing
`mode` as `'program'` and missing `kcal` as macro-computed, so any record
that escapes migration still renders.

### 2.1 `settings` store (existing) — profile lives here

```js
// key 'profile'
{ name, units: 'kg'|'lb',
  targets: { kcal, p, c, f },          // the user's OWN custom targets
  tolerancePct: 6,
  activeProgramId: 'ethan-prep'|null,  // null = Custom mode
  habits: [ {id,name,meta} ],          // Custom-mode list (Q4 default)
  onboarded: true,
  estimator: {sex,weightKg,heightCm,age,activity,goal}|null }
// key 'backupV1'  — pre-migration snapshot; WRITE-ONCE, never overwritten ⚑
// key 'lastSwaps' — unchanged
```

⚑ No `schemaVersion` fast-path key: migration status lives per-record only
(rule learned in this repo's kg→lbs review) — the boot scan is cheap and
converges late writes from stale clients.

Unit tokens, pinned in one place (`targets.js`): profile `units` ∈
`'kg'|'lb'`; day-record `weightUnit` ∈ `'kg'|'lbs'` (legacy token `'lbs'`
kept — never rewritten). ⚑ The mapping lives in exactly one function.

### 2.2 Programs — static JSON, generated, never hand-typed ⚑

`programs/ethan-prep.json` is **extracted from the current `index.html` by a
script** (`tools/extract-program.mjs`, run once at dev time) so every meal,
number, swap label, habit and Plan-tab table is verbatim by construction.
The extracted JSON doubles as the **render-parity fixture**: when Phase 5
replaces the markup, a test asserts the JSON-driven DOM contains the exact
same meal titles, item lists, macro numbers and chip labels (labels being
persistence keys). Shape:

```jsonc
{ "id": "ethan-prep", "version": 1, "name": "Ethan's Prep Plan",
  "description": "A specific contest-prep program: 5 fixed meals with swaps.",
  "targets": { "p": 316, "c": 196, "f": 45, "kcalBasis": 2453,   // derived, stored for history
               "display": { "kcal": "~2,700", "p": "300g", "c": "~230g", "f": "≤50g" },
               "types": { "p": "floor", "c": "band", "f": "cap" } },  // no kcal target (Q1)
  "meals": [ { "id","num","title","items":[...],"macros":{p,c,f},
               "swapGroups":[{ "label","multi","options":[...],"default":[...] }] } ],
  "habits": [ ...six, verbatim... ],
  "reference": { ...Plan-tab tables, verbatim... } }
```

Precached by SW; a program update = edit file + bump CACHE.

### 2.3 `foods` store (new) — personal library only

```js
{ id, name, brand: null|'…', per: '100g'|'serving', servingName: null|'…',
  macros: {kcal,p,c,f}, servings: [{name, grams}]|null,
  favorite: false, lastUsed: ISO, source: 'quickadd'|'usda'|'off'|'manual',
  ref: null|'usda:12345'|'off:0123456789' }
```

The bundled USDA database (§4) is a **read-only static file, not in IDB**;
logging from it snapshots macros into the day item (no foreign key needed).
Favoriting/importing copies it into `foods`.

### 2.4 `days` store — extended

```js
{ date, schema: 2,
  mode: 'program'|'custom', programId: 'ethan-prep'|null,
  meals, swaps, habits,                    // program-mode (unchanged shapes)
  items: [ { id, section:'breakfast'|'lunch'|'dinner'|'snacks',
             name, qty, unit:'g'|'serving'|null, macros:{kcal,p,c,f},
             foodId: null|'uuid', ts } ],  // custom-mode
  macros: { kcal, p, c, f },               // day totals; program kcal = 2453-basis
  targetsSnapshot: { p,c,f,kcal|null, tolerancePct, types, mode },  // targets in force THAT day
  weight, weightUnit, workout, updatedAt }
```

**`targetsSnapshot`** (⚑ core correctness idea): history is judged against
the targets active on that day, so editing your targets never rewrites your
past. Migration stamps legacy days with the program snapshot (`kcal: null`
per Q1). Snapshot is written on a day's first write and updated only if the
day is still empty when targets change.

### 2.5 Range semantics (shared, `targets.js`)

`lo=T(1−t/100)`, `hi=T(1+t/100)`; types: `band` (lo≤x≤hi) for kcal+carbs,
`floor` (x≥lo) for protein, `cap` (x≤hi) for fat. In-range ⇒ bar completes
(existing green). Over ⇒ bar stays neutral blue, full, with a `--mute`
"`+120 over`" label. No red exists anywhere in the app.

---

## 3. Migration & verification (the part that cannot go wrong)

### 3.1 Rules

1. **Per-record flag** (`schema:2`), scanned every boot, idempotent,
   converges stale-client writes. No global fast-path. ⚑
2. **Additive only**; readers tolerate unmigrated records indefinitely.
3. **backupV1 write-once** before the first transforming write; Settings
   shows "Pre-migration backup · <date> · download / clear". ⚑
4. **Import = migrate**: `importAll()` runs the same per-record transform
   **including the existing kg→lbs weight conversion** (kg-era backup files
   stay importable forever). ⚑
5. **⚑ Stale-client guard:** a still-cached old client calling
   `indexedDB.open(name, 1)` against an upgraded DB gets `VersionError`.
   Today that would silently fall to localStorage (app looks empty, later
   fold-back could regress a real day). Change `db.js`: `VersionError` ⇒
   one-shot `location.reload()` (the waiting SW then serves current code) —
   only genuine open failures fall back to LS.

### 3.2 Transform (`js/migrate.js` — pure, synchronous, no fetches ⚑)

Per unmigrated day: `mode='program'`, `programId='ethan-prep'`,
`macros.kcal = 4p+4c+9f`, `targetsSnapshot = ETHAN_SNAPSHOT` (constant baked
into migrate.js, not loaded from JSON), `schema=2`; all else untouched.
Profile bootstrap when legacy days exist but no profile: Ethan profile,
units `lb`, program active, `onboarded:true` → you never see onboarding.
Fresh installs → onboarding.

### 3.3 Verification you run on your phone (Phase 2a gate)

`tools/migration-test.html` — standalone, self-contained (does **not** load
app `db.js`, whose open() has write side-effects ⚑); the SW fetch handler
is changed to **ignore `/tools/`** so the page and its copy of `migrate.js`
are always network-fresh, never a stale cached version. ⚑

1. Opens the real DB **at its current version with readonly transactions
   only** (IDB has no read-only open; the page contains zero write calls
   against the real DB ⚑) and snapshots all records.
2. **Guard: 0 day-records ⇒ big visible "NOTHING TO TEST" state, not PASS.** ⚑
3. Copies raw records into scratch DB `prep-tracker-migration-test`, runs
   the real transform there, asserts per record: every v1 field deep-equal;
   `kcal` arithmetic; `mode/programId/targetsSnapshot/schema` present;
   counts equal.
4. Re-reads the real DB and deep-compares against the step-1 snapshot
   (ignoring nothing — you'll be told to **close the app first** so no
   concurrent write can false-FAIL ⚑).
5. PASS/FAIL table in app styling; deletes scratch DB.

**Order within Phase 2: commit 2a ships the test page + unwired migrate.js →
you run it on real data + take a manual Export → commit 2b flips the live
migration.** Fixing a wrong snapshot after 2b means re-migration; that's why
Q1 is decided now.

---

## 4. Food database approach

### 4.1 Bundled offline DB (Phase 4) — Canadian Nutrient File ⚑ (owner decision 2026-07-03)

- **Source:** **Canadian Nutrient File (CNF)** — Health Canada's official
  food composition database (~5,690 foods, Open Government Licence –
  Canada, free to redistribute with attribution). Canadian-market foods
  and nomenclature, which covers Ontario grocery staples. Fallback if the
  CNF bulk download is unavailable at build time: USDA FDC (macros for
  whole foods are equivalent), noted in the commit.
- **Curation script** `tools/build-food-db.py` (dev-time only, committed for
  reproducibility): pulls the CNF CSVs (FOOD NAME / NUTRIENT AMOUNT /
  CONVERSION FACTOR / MEASURE NAME), keeps a curated category whitelist
  (meats, fish, eggs, dairy, produce, grains/pasta/rice, legumes, nuts,
  oils, common prepared items), collapses near-duplicates (prefer raw +
  common cooked forms), cleans names, maps nutrients per 100 g (protein
  203, fat 204, carbs 205, energy 208), attaches 2–3 common household
  servings from the conversion-factor tables, assigns a popularity rank
  (hand-tuned category weights) for result ordering. Output:
  `data/foods-cnf.json`.
- **Budget:** target 1,800–2,500 foods ≈ **350–600 KB raw** (≈ 90–150 KB
  over the wire; GitHub Pages gzips) — comfortably under the 2 MB cap,
  small enough to precache. Hard ceiling enforced by the script: warn >800 KB.
- **Search:** loaded into memory on first use (~ms). In-house fuzzy scorer,
  no deps: normalized token match with prefix > word-start > substring
  tiers, coverage + position scoring, popularity tie-break, typo tolerance
  via 1-edit prefix match on tokens ≥5 chars. Instant per keystroke over
  ~2,500 items; zero network.
- **Attribution:** "Food data: Canadian Nutrient File © Health Canada" in About.

### 4.2 Online search (Phase 8) — Open Food Facts, corrected ⚑

- **Endpoint:** `https://search.openfoodfacts.org/search?q=…&page_size=20`
  (Search-a-licious; the v2 `/api/v2/search` does **not** do free text —
  review-verified). Fallback if needed:
  `/cgi/search.pl?search_terms=…&search_simple=1&action=process&json=1`.
- **⚑ Canadian-market results (owner decision):** results are filtered/
  boosted to products sold in Canada (`countries_tags:canada`), so branded
  matches reflect Ontario retail; a "search all countries" fallback link
  appears when Canadian results are thin.
- **⚑ Rate limits:** OFF allows ~10 search req/min and bans search-as-you-
  type. UX = **search-on-submit** (button / Enter), single in-flight request
  with cancellation. Non-JSON or 429 responses render a neutral "search is
  busy, try again in a minute" state (OFF serves HTML outage pages).
- **Import mapping:** `proteins_100g/carbohydrates_100g/fat_100g` +
  `energy-kcal_100g`, falling back to `energy_100g` (kJ) ÷ 4.184; products
  without per-100g macros are skipped. Endpoint + CORS verified from a
  phone before the phase is built.
- Offline ⇒ section hidden with a small note. SW never caches OFF responses
  (already true: same-origin-only handler).

### 4.3 Quick Add + My Foods (Phase 3)

Quick Add: P/C/F big numeric inputs (`inputmode="decimal"`), auto-computed
*editable* kcal, optional name, one-tap "Save to My Foods". My Foods:
instant local search, favorites → recency ordering, quantity-only logging
(grams or servings). Items: edit qty, move between sections, delete.

---

## 5. Feature design

### Onboarding (first launch; re-runnable from Settings)
3-step full-screen stepper in the design system: ① name + units → ② targets
("I know my numbers": kcal+P/C/F with live 4/4/9 hint (neutral, non-
blocking) · "Help me estimate": Mifflin-St Jeor, activity ×1.2–1.9, goal
lose −15%/maintain/gain +10%, protein 2 g/kg, fat 25% kcal, carbs remainder
— always editable) → ③ mode cards: **Track my own food** (default) /
**Follow Ethan's Prep Plan** (one-line description, "switch anytime in
Settings"). Height in cm, or ft+in when units=lb.

### Mode switching (pinned semantics ⚑)
The toggle updates `activeProgramId` and active targets immediately. A day
**with writes keeps its recorded mode forever** — if today is already
logged, today's screen continues in its mode and the new mode starts with
the first unlogged day; copy: *"Today was logged in <mode> — your new mode
starts with the next day you log."* Custom targets are preserved across
switches. Every day renders in `rec.mode`, so mixed history is first-class.

### Edit any past day (Phase 6)
All day rendering becomes date-parameterized via a new **`js/day-store.js`**
(single owner of load/mutate/save + change events — also fixes the review
finding that today-state ownership was undefined ⚑). Entry points: History
calendar/heatmap taps + week-strip taps. UI: sticky header bar
"**Editing — Tue, Jun 30**" (accent border) + prominent "Back to today";
the edit session is pinned to its date — midnight rollover, which only
moves the live *today* pointer, cannot clobber it. Program days edit
meals/swaps/habits; custom days edit items; both edit weight/habits/
training. Day-store change events invalidate History caches and the week
strip, so aggregates/expenditure recompute on next paint.

### Week strip (Phase 7)
Mon–Sun columns (Q3): 4 mini-bars (kcal/P/C/F as % of that day's
`targetsSnapshot`, capped ~110%; program days show 3 bars per Q1), today
boxed in accent, past days final intake (tap → edit-day), future days faint
target outlines. Reads 7 day-records via the day-store cache — one IDB
`getAll` per rebuild, no per-column queries.

### Trend weight + expenditure (Phase 7)
Trend: EWMA over calendar days (`trend += 0.10 × (w − trend)` on weigh-in
days, carried over gaps), converted to profile units at read. Charts: trend
solid blue primary, raw weigh-ins faded dots, replacing the 7-day MA.
Expenditure: rolling 21-day window; eligible when ≥14 in-window days have
intake logs AND weigh-ins exist in the first and last 5 days.
`TDEE ≈ meanIntake + (trendStart − trendEnd)×(7700/kg | 3500/lb)/windowDays`.
Card: plain-English explanation, "program-day calories are computed from
meal macros" footnote (Q1), suggested target for the profile goal, **Apply**
button (protein g kept, fat 25%, carbs remainder) — never auto-applied.
Below threshold: "Not enough data yet (X/14 days)".

### History with mixed modes
Compliance chart: program days = meals completed (0–5, as today); custom
days = landed in kcal range (rendered as in/out, neutral colors). ⚑ Guard
ships in **Phase 3** (custom days excluded from the 0/5 meals chart until
the full mixed renderer in Phase 7) so mid-refactor history is never wrong.
Protein chart and heatmaps work off day totals/habits regardless of mode.

---

## 6. File structure

```
index.html                 shell: tabs, onboarding, sheets, edit-day header
styles.css
js/
  db.js                    stores, wrapper, LS fallback, VersionError reload ⚑
  migrate.js               pure v1→v2 transform + profile bootstrap (shared w/ test page)
  targets.js               ranges, 4/4/9, Mifflin-St Jeor, EWMA, TDEE, unit tokens
  day-store.js             single owner of day records + change events ⚑
  app.js                   boot, routing (onboarding/app), tabs, settings, mode switch
  today-program.js         JSON-driven program renderer (current meal-card UX)
  today-custom.js          sections, add-food sheet, item editing
  foods.js                 My Foods CRUD, USDA search, OFF client
  dashboard.js             week strip + edit-day entry
  history.js               charts, trend, expenditure, mixed modes
programs/ethan-prep.json   generated by tools/extract-program.mjs
data/foods-usda.json       generated by tools/build-food-db.py
tools/                     extract-program.mjs · build-food-db.py · migration-test.html
                           (SW ignores /tools/ entirely ⚑)
```

Script order (classic scripts, globals): chart.js → db → migrate → targets →
day-store → foods → today-program → today-custom → dashboard → history → app.

---

## 7. Phases (one commit each unless noted; SW CACHE bump + deploy-verify every phase)

**P1 — This document.** Approve §0 to unblock.

**P2 — Migration + profiles + onboarding + settings** *(two commits ⚑)*
2a: `migrate.js` (unwired) + `tools/migration-test.html` + SW `/tools/`
exclusion + `extract-program.mjs` + generated `ethan-prep.json` (data only).
→ **iPhone test 2a:** close the app fully; open `…/tools/migration-test.html`;
expect all-PASS + "real DB untouched" line; do a manual Export.
2b: DB v2 + live boot migration + backupV1 + profile bootstrap + onboarding
stepper + settings sheet v2 (targets/tolerance/units/mode/backup) +
VersionError reload.
→ **iPhone test 2b:** app opens straight to your normal Today; history
intact; Settings shows targets + backup row. Incognito tab → onboarding,
estimator numbers sane, both target paths work.

**P3 — Custom logging core**
Quick Add + My Foods + B/L/D/Snacks sections + 4-bar range-aware tracker
(custom mode) + history guard for custom days ⚑. Your program mode is
visually unchanged.
→ **Test:** incognito: onboard custom, quick-add two foods, save one to My
Foods, re-log it by quantity, edit qty, move section, delete; tracker ranges
complete correctly; your real install unchanged.

**P4 — Bundled USDA database + offline fuzzy search**
`build-food-db.py`, `data/foods-usda.json` (precached), search pane wired
into the add sheet ahead of Quick Add.
→ **Test:** airplane mode: search "chicken breast", "oats", "banana" —
instant results, serving pickers work, logging correct; file size shown in
commit message.

**P5 — Ethan's Plan data-driven + mode switching**
Program renderer from JSON; hardcoded meal markup deleted; render-parity
test vs extracted fixture (titles/items/macros/chip labels identical ⚑);
Settings mode toggle with pinned semantics; mixed-mode day records.
→ **Test:** your Today is pixel-identical (screenshot compare), swaps
persist + carry to next day, toggle to Custom and back mid-day → today stays
program, copy reads right, History unchanged.

**P6 — Edit any past day**
`day-store.js` refactor (today = special case of any date), edit-day header,
entry from History + week-later taps, recompute events, rollover pinning.
→ **Test:** edit yesterday's meals + a weight from last week; charts/streaks
update immediately; leave the editor open across midnight (or fake it by
changing device clock) → no clobber; "Back to today" always lands right.

**P7 — Dashboard week strip + expenditure + chart restyle**
Week strip with mixed-mode bars, trend-primary weight chart, expenditure
card + Apply, mixed-mode compliance chart.
→ **Test:** strip matches your logged week; tap a past day → editor; weight
chart shows trend line over faded dots; expenditure shows a plausible TDEE
(you have the data) and Apply previews correctly (don't confirm unless you
mean it).

**P8 — Open Food Facts online search**
Search-on-submit pane, import→My Foods, kJ fallback, busy/offline states.
→ **Test:** search a branded product on Wi-Fi, log it; airplane mode → pane
shows the note, everything else fully offline; hammer search 11× fast →
neutral "busy" state, no crash.

**P9 — Polish + rename + release**
Pressed/active states, skeleton rows for online search, designed empty
states (first-run Today, empty My Foods, empty History), steppers where
helpful, safe-area audit (incl. edit-day header + sheets), adherence-neutral
copy/color audit (no red, no shaming, generic voice except program content),
manifest rename + regenerated icons/splash with new name, habit-list editor
(Q4), README: "Share the beta" + "Path to the App Store" (Capacitor note,
not implemented), final review pass, deploy.
→ **Test:** full offline pass; install on a second device via URL and
onboard as a stranger; read every screen's copy once as "someone else".

---

## 8. Export/import (pinned ⚑)

`{ version: 3, exportedAt, days: [...], foods: [...],
   settings: { profile, lastSwaps } }` — import accepts v1/v2/v3 files,
runs the per-record migration (incl. kg→lbs weight fix) on days, merges
foods by id, and restores profile only onto a fresh install (never silently
overwrites an active profile without a confirm). Backup story in README and
Settings stays: export regularly; backupV1 downloadable until cleared.
