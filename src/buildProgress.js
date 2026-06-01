// Center build progress popup. The step model and percent helper are pure and
// unit-tested; the mount adds the timer-driven DOM updates around them.

import { getLocale, t } from './i18n.js';

export const BUILD_STEPS = t('build.steps', {}, 'en');
export const PHASE_LABELS = t('build.phases', {}, 'en');

// Percent complete given how many steps are done. Clamped to 0..100 integers.
export function buildPercent(completedCount, total = BUILD_STEPS.length) {
  if (total <= 0) {
    return 0;
  }
  const ratio = Math.min(Math.max(completedCount, 0), total) / total;
  return Math.round(ratio * 100);
}

export function phasesInOrder() {
  const seen = [];
  for (const step of BUILD_STEPS) {
    if (!seen.includes(step.phase)) {
      seen.push(step.phase);
    }
  }
  return seen;
}

const STEP_INTERVAL_MS = 420;

// Mounts the live popup. onComplete(reason) fires once when the build is opened
// or skipped. Returns a controller with dispose().
export function mountBuildProgress(host, { onComplete, stepIntervalMs = STEP_INTERVAL_MS, locale = getLocale(), steps: customSteps } = {}) {
  const steps = Array.isArray(customSteps) && customSteps.length ? customSteps : t('build.steps', {}, locale);
  const phaseLabels = t('build.phases', {}, locale);
  const overlay = document.createElement('div');
  overlay.className = 'build-overlay';
  overlay.dataset.testid = 'build-progress';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('build.aria', {}, locale));

  overlay.innerHTML = `
    <div class="build-card">
      <div class="panel-kicker" data-testid="build-phase">${phaseLabels[steps[0].phase]}</div>
      <h2 class="build-title">${t('build.title', {}, locale)}</h2>
      <div
        class="build-bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
      >
        <div class="build-bar-head">
          <span class="build-log" data-testid="build-log">${t('build.starting', {}, locale)}</span>
          <strong data-testid="build-progress-value">0%</strong>
        </div>
        <div class="build-bar-track"><div class="build-bar-fill" data-testid="build-bar-fill" style="width: 0%"></div></div>
      </div>
      <ol class="build-steps" data-testid="build-steps">
        ${steps.map((step) => `
          <li class="build-step is-pending" data-testid="build-step" data-step-id="${step.id}">
            <span class="build-step-mark" aria-hidden="true"></span>
            <span class="build-step-label">${step.label}</span>
          </li>
        `).join('')}
      </ol>
      <div class="build-actions">
        <button class="button-outline" type="button" data-testid="build-progress-pause">${t('build.pause', {}, locale)}</button>
        <button class="button-outline" type="button" data-testid="build-progress-skip">${t('build.skip', {}, locale)}</button>
        <button class="primary-action build-open is-hidden" type="button" data-testid="build-progress-open">${t('build.open', {}, locale)}</button>
      </div>
    </div>
  `;

  host.append(overlay);
  document.body.classList.add('has-modal');

  const fill = overlay.querySelector('[data-testid="build-bar-fill"]');
  const valueLabel = overlay.querySelector('[data-testid="build-progress-value"]');
  const bar = overlay.querySelector('.build-bar');
  const logLine = overlay.querySelector('[data-testid="build-log"]');
  const phaseLabel = overlay.querySelector('[data-testid="build-phase"]');
  const stepEls = [...overlay.querySelectorAll('[data-testid="build-step"]')];
  const pauseButton = overlay.querySelector('[data-testid="build-progress-pause"]');
  const skipButton = overlay.querySelector('[data-testid="build-progress-skip"]');
  const openButton = overlay.querySelector('[data-testid="build-progress-open"]');

  let completed = 0;
  let paused = false;
  let finished = false;
  let disposed = false;
  let timer = 0;

  function paint() {
    const percent = buildPercent(completed, steps.length);
    fill.style.width = `${percent}%`;
    valueLabel.textContent = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));

    stepEls.forEach((el, index) => {
      el.classList.toggle('is-done', index < completed);
      el.classList.toggle('is-active', index === completed && !finished);
      el.classList.toggle('is-pending', index > completed);
    });

    const current = steps[Math.min(completed, steps.length - 1)];
    if (current) {
      phaseLabel.textContent = phaseLabels[current.phase];
      if (!finished) {
        logLine.textContent = current.log;
      }
    }
  }

  function tick() {
    if (paused || finished) {
      return;
    }
    completed += 1;
    if (completed >= steps.length) {
      completed = steps.length;
      finish();
      return;
    }
    paint();
  }

  function start() {
    timer = setInterval(tick, stepIntervalMs);
  }

  function finish() {
    finished = true;
    completed = steps.length;
    clearInterval(timer);
    timer = 0;
    paint();
    logLine.textContent = t('build.ready', {}, locale);
    pauseButton.classList.add('is-hidden');
    skipButton.classList.add('is-hidden');
    openButton.classList.remove('is-hidden');
    openButton.focus();
  }

  function complete(reason) {
    if (disposed) {
      return;
    }
    disposed = true;
    clearInterval(timer);
    document.body.classList.remove('has-modal');
    overlay.remove();
    onComplete?.(reason);
  }

  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? t('build.resume', {}, locale) : t('build.pause', {}, locale);
    overlay.classList.toggle('is-paused', paused);
  });

  skipButton.addEventListener('click', () => {
    finish();
    complete('skip');
  });

  openButton.addEventListener('click', () => complete('open'));

  paint();
  start();

  return {
    dispose() {
      complete('dispose');
    }
  };
}
