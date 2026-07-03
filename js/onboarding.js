/* First-launch onboarding stepper + "edit profile & targets" re-run.
   Wires the pre-rendered #onboarding markup; pure UI — the caller owns
   persistence via the onDone(profile) callback. */
const Onboarding = (() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const GENERIC_HABITS = [
    { id: 'water',  name: 'Water',       meta: '2–3 L' },
    { id: 'steps',  name: 'Steps',       meta: '8,000+' },
    { id: 'cardio', name: 'Cardio',      meta: '20 min' },
    { id: 'supps',  name: 'Supplements', meta: 'Taken' },
  ];

  let base = null;      // profile being edited (null on first run)
  let onDone = null;
  let units = 'lb';
  let path = null;      // 'direct' | 'estimate'
  let mode = null;      // 'custom' | 'ethan-prep'

  const el = {};
  let wired = false;

  function wire() {
    if (wired) return;
    wired = true;
    el.root = $('#onboarding');
    el.steps = $$('.onb-step');
    el.dots = $$('.onb-progress i');
    el.name = $('#onbName');
    el.unitChips = $$('#onbUnits .chip');
    el.paths = $$('#onbPathCards .mode-card');
    el.estimate = $('#onbEstimate');
    el.numbers = $('#onbNumbers');
    el.sexChips = $$('#onbSex .chip');
    el.weight = $('#onbWeight');
    el.weightUnit = $('#onbWeightUnit');
    el.heightCmField = $('#onbHeightCmField');
    el.heightFtField = $('#onbHeightFtField');
    el.heightCm = $('#onbHeightCm');
    el.heightFt = $('#onbHeightFt');
    el.heightIn = $('#onbHeightIn');
    el.age = $('#onbAge');
    el.activityChips = $$('#onbActivity .chip');
    el.goalChips = $$('#onbGoal .chip');
    el.calc = $('#onbCalc');
    el.estimateNote = $('#onbEstimateNote');
    el.kcal = $('#onbKcal');
    el.p = $('#onbP');
    el.c = $('#onbC');
    el.f = $('#onbF');
    el.macroHint = $('#onbMacroHint');
    el.modeCards = $$('#onbModeCards .mode-card');
    el.finish = $('#onbFinish');

    // step navigation
    $$('.onb-next').forEach(b => b.addEventListener('click', () => {
      const cur = +b.closest('.onb-step').dataset.step;
      if (cur === 1) { goto(2); return; }
      if (cur === 2 && validNumbers()) goto(3);
    }));
    $$('.onb-back').forEach(b => b.addEventListener('click', () => {
      goto(+b.closest('.onb-step').dataset.step - 1);
    }));

    // single-select chip groups
    const single = (chips, fn) => chips.forEach(ch => ch.addEventListener('click', () => {
      chips.forEach(c => c.classList.toggle('active', c === ch));
      fn(ch);
    }));
    single(el.unitChips, ch => { units = ch.dataset.units; applyUnits(); });
    single(el.sexChips, () => {});
    single(el.activityChips, () => {});
    single(el.goalChips, () => {});

    el.paths.forEach(card => card.addEventListener('click', () => {
      path = card.dataset.path;
      el.paths.forEach(c => c.classList.toggle('active', c === card));
      if (path === 'ethan') {
        // shortcut: take the program's targets and jump straight to the
        // mode step with Ethan's Plan preselected
        const t = Migrate.legacyProfile().targets;
        el.kcal.value = t.kcal; el.p.value = t.p; el.c.value = t.c; el.f.value = t.f;
        mode = 'ethan-prep';
        el.modeCards.forEach(c => c.classList.toggle('active', c.dataset.mode === 'ethan-prep'));
        el.finish.disabled = false;
        goto(3);
        return;
      }
      el.estimate.hidden = path !== 'estimate';
      el.numbers.hidden = path !== 'direct' && !hasNumbers();
      if (path === 'direct') el.kcal.focus();
    }));

    el.calc.addEventListener('click', () => {
      const state = estimatorState();
      if (state.missing.length) {
        el.estimateNote.textContent = 'Still needed: ' + state.missing.join(', ') + '.';
        return;
      }
      const s = Targets.suggestTargets(state.est);
      el.kcal.value = s.kcal; el.p.value = s.p; el.c.value = s.c; el.f.value = s.f;
      el.estimateNote.textContent = 'Estimated maintenance ≈ ' + s.tdee.toLocaleString() +
        ' kcal. This is a starting point — edit anything below.';
      el.numbers.hidden = false;
      macroHint();
    });

    [el.kcal, el.p, el.c, el.f].forEach(i => i.addEventListener('input', macroHint));

    el.modeCards.forEach(card => card.addEventListener('click', () => {
      mode = card.dataset.mode;
      el.modeCards.forEach(c => c.classList.toggle('active', c === card));
      el.finish.disabled = false;
    }));

    el.finish.addEventListener('click', finish);
  }

  function goto(n) {
    el.steps.forEach(s => { s.hidden = +s.dataset.step !== n; });
    el.dots.forEach((d, i) => d.classList.toggle('on', i < n));
    window.scrollTo(0, 0);
  }

  function applyUnits() {
    el.weightUnit.textContent = Targets.unitLabel(units);
    el.heightCmField.hidden = units !== 'kg';
    el.heightFtField.hidden = units !== 'lb';
  }

  function hasNumbers() { return !!(el.kcal.value || el.p.value); }

  /* returns { missing: [...names] } or { missing: [], est: {...} } so the
     calc button can say exactly what's still needed */
  function estimatorState() {
    const missing = [];
    const sexChip = $$('#onbSex .chip.active')[0];
    const sex = sexChip ? sexChip.dataset.sex : null;
    if (!sex) missing.push('sex');

    const w = parseFloat(el.weight.value);
    if (!(w > 0)) missing.push('weight');

    let heightCm = null;
    if (units === 'kg') {
      heightCm = parseFloat(el.heightCm.value);
      if (!(heightCm > 0)) { missing.push('height'); heightCm = null; }
    } else {
      const ft = parseFloat(el.heightFt.value);
      const inch = el.heightIn.value === '' ? 0 : parseFloat(el.heightIn.value);
      const totalIn = (Number.isFinite(ft) ? ft : 0) * 12 + (Number.isFinite(inch) ? inch : 0);
      if (!(totalIn > 0)) missing.push('height');
      else heightCm = totalIn * 2.54;
    }

    const age = parseInt(el.age.value, 10);
    if (!(age >= 10 && age <= 100)) missing.push('age');

    const act = ($$('#onbActivity .chip.active')[0] || {}).dataset || {};
    if (!act.activity) missing.push('activity');
    const goal = ($$('#onbGoal .chip.active')[0] || {}).dataset || {};
    if (!goal.goal) missing.push('goal');

    if (missing.length) return { missing };
    return {
      missing: [],
      est: {
        sex,
        weightKg: Targets.toKg(w, units === 'kg' ? 'kg' : 'lb'),
        heightCm, age,
        activityId: act.activity, goalId: goal.goal,
      },
    };
  }
  function readEstimator() { return estimatorState().est || null; }

  function macroHint() {
    const kcal = parseFloat(el.kcal.value);
    const sum = Targets.kcalFromMacros(parseFloat(el.p.value) || 0, parseFloat(el.c.value) || 0, parseFloat(el.f.value) || 0);
    if (!sum) { el.macroHint.textContent = ''; return; }
    let txt = 'P/C/F ≈ ' + Math.round(sum).toLocaleString() + ' kcal by 4/4/9.';
    if (Number.isFinite(kcal) && kcal > 0 && Math.abs(sum - kcal) / kcal > 0.05) {
      txt += ' That’s a little different from your calorie number — both work, adjust whichever you like.';
    }
    el.macroHint.textContent = txt;
  }

  function validNumbers() {
    const kcal = parseFloat(el.kcal.value), p = parseFloat(el.p.value),
          c = parseFloat(el.c.value), f = parseFloat(el.f.value);
    const ok = kcal > 0 && kcal < 10000 && p >= 0 && c >= 0 && f >= 0 && (p + c + f) > 0;
    if (!ok) el.macroHint.textContent = 'Enter your calories and at least one macro to continue.';
    return ok;
  }

  function finish() {
    const profile = Object.assign({}, base || {}, {
      name: (el.name.value || '').trim().slice(0, 24),
      units,
      targets: {
        kcal: Math.round(parseFloat(el.kcal.value)),
        p: Math.round(parseFloat(el.p.value) || 0),
        c: Math.round(parseFloat(el.c.value) || 0),
        f: Math.round(parseFloat(el.f.value) || 0),
      },
      tolerancePct: (base && base.tolerancePct) || 6,
      activeProgramId: mode === 'ethan-prep' ? 'ethan-prep' : null,
      habits: (base && base.habits) || GENERIC_HABITS,
      onboarded: true,
      estimator: readEstimator() || (base && base.estimator) || null,
    });
    el.root.hidden = true;
    document.body.classList.remove('onb-open');
    onDone(profile);
  }

  /* startStep 1 = full run; 2 = "edit targets" from Settings */
  function show(existing, done, startStep) {
    wire();
    base = existing || null;
    onDone = done;
    mode = existing ? (existing.activeProgramId ? 'ethan-prep' : 'custom') : null;
    path = null;

    // prefill
    el.name.value = (existing && existing.name) || '';
    units = (existing && existing.units) || 'lb';
    el.unitChips.forEach(c => c.classList.toggle('active', c.dataset.units === units));
    applyUnits();
    if (existing && existing.targets) {
      el.kcal.value = existing.targets.kcal || '';
      el.p.value = existing.targets.p || '';
      el.c.value = existing.targets.c || '';
      el.f.value = existing.targets.f || '';
    } else {
      el.kcal.value = el.p.value = el.c.value = el.f.value = '';
    }
    const est = existing && existing.estimator;
    if (est) {
      el.age.value = est.age || '';
      $$('#onbSex .chip').forEach(c => c.classList.toggle('active', c.dataset.sex === est.sex));
      $$('#onbActivity .chip').forEach(c => c.classList.toggle('active', c.dataset.activity === est.activityId));
      $$('#onbGoal .chip').forEach(c => c.classList.toggle('active', c.dataset.goal === est.goalId));
    }
    el.paths.forEach(c => c.classList.remove('active'));
    el.estimate.hidden = true;
    el.numbers.hidden = !(existing && existing.targets);
    el.modeCards.forEach(c => c.classList.toggle('active', existing && c.dataset.mode === mode));
    el.finish.disabled = !mode;
    macroHint();

    el.root.hidden = false;
    document.body.classList.add('onb-open');
    goto(startStep || 1);
  }

  return { show, GENERIC_HABITS };
})();
