// First-visit welcome popup. Shown once per browser (gated by localStorage),
// dismissible via its CTA, the backdrop, the close control, or the Escape key.
// Pure DOM, no network. Built to match the design system: near-black card,
// coral accent chips, pill CTA.

import { createLogoLockup } from './heduwareLogo.js';
import { createFocusTrap } from './focusTrap.js';
import { getLocale, t } from './i18n.js';

const STORAGE_KEY = 'hEduwareWelcomeSeen';

export function hasSeenWelcome(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(STORAGE_KEY) === 'yes';
  } catch (error) {
    return false;
  }
}

export function markWelcomeSeen(storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, 'yes');
  } catch (error) {
    // Private-mode storage failures are non-fatal; the popup just shows again.
  }
}

// Mounts the popup into `host`. Returns a controller with dispose().
// onDismiss fires once when the user closes it.
export function mountWelcomePopup(host, { onDismiss, locale = getLocale() } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'welcome-overlay';
  overlay.dataset.testid = 'welcome-popup';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'welcome-heading');

  overlay.innerHTML = `
    <div class="welcome-card" data-testid="welcome-card">
      <button class="welcome-close" type="button" data-testid="welcome-close" aria-label="${t('welcome.close', {}, locale)}">&times;</button>
      <div class="welcome-brand">${createLogoLockup({ idPrefix: 'welcome' })}</div>
      <div class="panel-kicker">${t('welcome.kicker', {}, locale)}</div>
      <h2 id="welcome-heading">${t('welcome.title', {}, locale)}</h2>
      <p>${t('welcome.body', {}, locale)}</p>
      <ul class="welcome-points">
        ${t('welcome.points', {}, locale).map((point, index) => `
          <li><span class="welcome-step">${String(index + 1).padStart(2, '0')}</span> ${point}</li>
        `).join('')}
      </ul>
      <div class="welcome-actions">
        <button class="primary-action" type="button" data-testid="welcome-dismiss">${t('welcome.start', {}, locale)}</button>
      </div>
    </div>
  `;

  host.append(overlay);
  document.body.classList.add('has-modal');

  let disposed = false;
  let focusTrap = null;

  function close(reason) {
    if (disposed) {
      return;
    }
    disposed = true;
    document.removeEventListener('keydown', onKeydown);
    focusTrap?.release({ restoreFocus: false });
    document.body.classList.remove('has-modal');
    overlay.remove();
    markWelcomeSeen();
    onDismiss?.(reason);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      close('escape');
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close('backdrop');
    }
  });
  overlay.querySelector('[data-testid="welcome-close"]').setAttribute('aria-label', t('welcome.close', {}, locale));
  overlay.querySelector('[data-testid="welcome-close"]').addEventListener('click', () => close('close'));
  overlay.querySelector('[data-testid="welcome-dismiss"]').addEventListener('click', () => close('dismiss'));

  document.addEventListener('keydown', onKeydown);
  focusTrap = createFocusTrap(overlay, {
    onEscape(event) {
      event.preventDefault();
      close('escape');
    }
  });

  // Move focus to the primary action for keyboard users.
  overlay.querySelector('[data-testid="welcome-dismiss"]').focus();

  return {
    dispose() {
      close('dispose');
    }
  };
}
