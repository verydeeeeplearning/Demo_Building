import { t } from './i18n.js';
import { createPublicShare } from './shareClient.js';
import { downloadShareCard } from './shareCard.js';
import { createShareMarkdown, createShareSnapshot } from './shareSnapshot.js';

export function mountShareModal(parent, options) {
  const previouslyFocused = document.activeElement;
  const {
    locale,
    projectLoaded,
    title,
    markdown,
    project,
    source
  } = options;

  const snapshot = projectLoaded
    ? createShareSnapshot(project || legacyProject({ title, markdown }), { locale, source, title })
    : null;
  const summary = snapshot ? createShareMarkdown(snapshot, locale) : '';
  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.dataset.testid = 'share-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('share.aria', {}, locale));

  overlay.innerHTML = `
    <section class="share-panel">
      <button class="share-close" type="button" data-testid="share-close" aria-label="${t('share.close', {}, locale)}">&times;</button>
      <div class="panel-kicker">${t('share.kicker', {}, locale)}</div>
      <h2>${projectLoaded ? escapeHtml(title) : t('share.emptyTitle', {}, locale)}</h2>
      <p>${projectLoaded ? t('share.readyBody', {}, locale) : t('share.emptyBody', {}, locale)}</p>
      ${projectLoaded ? `
        <label class="share-summary-label" for="share-summary">${t('share.summaryLabel', {}, locale)}</label>
        <textarea id="share-summary" data-testid="share-summary" readonly rows="8">${escapeHtml(summary)}</textarea>
        <div class="share-actions">
          <button class="primary-action" type="button" data-testid="share-copy">${t('share.copySummary', {}, locale)}</button>
          <button class="secondary-action" type="button" data-testid="share-create-link">${shareText('createLink', 'Create public link', locale)}</button>
          <button class="secondary-action" type="button" data-testid="share-download-card">${shareText('downloadCard', 'Save image', locale)}</button>
          <button class="secondary-action" type="button" data-testid="share-download-json">${shareText('downloadJson', 'Download JSON', locale)}</button>
        </div>
        <div class="share-link-result" data-testid="share-link-result" hidden>
          <label class="share-summary-label" for="share-link">${shareText('linkLabel', 'Public link', locale)}</label>
          <div class="share-link-row">
            <input id="share-link" data-testid="share-link" type="text" readonly value="">
            <button class="secondary-action" type="button" data-testid="share-copy-link">${shareText('copyLink', 'Copy link', locale)}</button>
          </div>
        </div>
      ` : `
        <div class="share-empty-state" data-testid="share-empty-state">
          ${t('share.emptyHint', {}, locale)}
        </div>
      `}
      <p class="share-status" data-testid="share-status" aria-live="polite"></p>
    </section>
  `;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.body.classList.remove('has-modal');
    options.onClose?.();
    if (
      previouslyFocused &&
      previouslyFocused !== document.body &&
      previouslyFocused.isConnected &&
      typeof previouslyFocused.focus === 'function'
    ) {
      previouslyFocused.focus();
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('[data-testid="share-close"]').addEventListener('click', close);
  overlay.querySelector('[data-testid="share-copy"]')?.addEventListener('click', async () => {
    const status = overlay.querySelector('[data-testid="share-status"]');
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available.');
      }
      await navigator.clipboard.writeText(summary);
      status.textContent = t('share.copied', {}, locale);
    } catch (error) {
      const summaryInput = overlay.querySelector('[data-testid="share-summary"]');
      summaryInput.focus();
      summaryInput.select();
      status.textContent = t('share.copyFallback', {}, locale);
    }
  });
  overlay.querySelector('[data-testid="share-create-link"]')?.addEventListener('click', async (event) => {
    const status = overlay.querySelector('[data-testid="share-status"]');
    const button = event.currentTarget;
    button.disabled = true;
    status.textContent = shareText('creatingLink', 'Creating public link...', locale);
    try {
      const result = await (options.createPublicShare || createPublicShare)(snapshot);
      const linkInput = overlay.querySelector('[data-testid="share-link"]');
      const linkResult = overlay.querySelector('[data-testid="share-link-result"]');
      linkInput.value = result.shareUrl;
      linkResult.hidden = false;
      status.textContent = shareText('linkCreated', 'Public link is ready.', locale);
      linkInput.focus();
      linkInput.select();
    } catch (error) {
      button.disabled = false;
      status.textContent = shareText('linkFailed', 'Could not create a public link. The summary and JSON export still work.', locale);
    }
  });
  overlay.querySelector('[data-testid="share-copy-link"]')?.addEventListener('click', async () => {
    const status = overlay.querySelector('[data-testid="share-status"]');
    const linkInput = overlay.querySelector('[data-testid="share-link"]');
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available.');
      }
      await navigator.clipboard.writeText(linkInput.value);
      status.textContent = shareText('linkCopied', 'Link copied.', locale);
    } catch (error) {
      linkInput.focus();
      linkInput.select();
      status.textContent = t('share.copyFallback', {}, locale);
    }
  });
  overlay.querySelector('[data-testid="share-download-json"]')?.addEventListener('click', () => {
    downloadJson(snapshot, `${safeFileName(snapshot?.title || title || 'h-eduware-circuit')}.json`);
    overlay.querySelector('[data-testid="share-status"]').textContent = shareText('jsonReady', 'JSON export prepared.', locale);
  });
  overlay.querySelector('[data-testid="share-download-card"]')?.addEventListener('click', () => {
    downloadShareCard(snapshot, locale, `${safeFileName(snapshot?.title || title || 'h-eduware-circuit')}.png`);
    overlay.querySelector('[data-testid="share-status"]').textContent = shareText('cardReady', 'Image export prepared.', locale);
  });

  parent.appendChild(overlay);
  document.body.classList.add('has-modal');
  overlay.querySelector('[data-testid="share-close"]').focus();

  return { close };
}

function legacyProject({ title, markdown }) {
  return {
    circuit: {
      title,
      runText: '',
      parts: [],
      connections: []
    },
    files: markdown ? [{ kind: 'Markdown', markdown }] : []
  };
}

function shareText(key, fallback, locale) {
  const value = t(`share.${key}`, {}, locale);
  return value === `share.${key}` ? fallback : value;
}

function downloadJson(snapshot, fileName) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'h-eduware-circuit';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
