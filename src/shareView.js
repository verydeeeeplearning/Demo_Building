import { t } from './i18n.js';

export function renderShareView(shareView, locale = 'ko') {
  if (shareView.status === 'loading') {
    return `
      <main class="public-share-view" data-testid="public-share-view">
        <section class="public-share-hero">
          <div class="panel-kicker">H-eduware</div>
          <h1>${copy(locale, 'loadingTitle')}</h1>
          <p>${copy(locale, 'loadingBody')}</p>
        </section>
      </main>
    `;
  }

  if (shareView.status === 'error') {
    return `
      <main class="public-share-view" data-testid="public-share-view">
        <section class="public-share-hero">
          <div class="panel-kicker">H-eduware</div>
          <h1>${copy(locale, 'errorTitle')}</h1>
          <p>${escapeHtml(shareView.error || copy(locale, 'errorBody'))}</p>
          <button class="primary-action" type="button" data-action="share-create-own">${copy(locale, 'createOwn')}</button>
        </section>
      </main>
    `;
  }

  const snapshot = shareView.snapshot;
  const parts = snapshot.circuit?.components || [];
  const validation = snapshot.validation?.status || snapshot.status || 'draft';
  const sourceTypes = snapshot.contextEvidence?.sourceTypes || [];

  return `
    <main class="public-share-view" data-testid="public-share-view">
      <section class="public-share-hero">
        <div class="panel-kicker">H-eduware ${copy(locale, 'sharedProject')}</div>
        <h1 data-testid="public-share-title">${escapeHtml(snapshot.title)}</h1>
        <p>${escapeHtml(snapshot.summary || snapshot.circuit?.description || '')}</p>
        <div class="public-share-actions">
          <button class="primary-action" type="button" data-action="share-import" data-testid="share-import">${copy(locale, 'import')}</button>
          <button class="secondary-action" type="button" data-action="share-create-own">${copy(locale, 'createOwn')}</button>
        </div>
      </section>

      <section class="public-share-grid" aria-label="${copy(locale, 'details')}">
        <article>
          <span class="panel-kicker">${copy(locale, 'validation')}</span>
          <strong data-testid="public-share-validation">${escapeHtml(validation)}</strong>
          <p>${validation === 'valid' ? copy(locale, 'validBody') : copy(locale, 'draftBody')}</p>
        </article>
        <article data-testid="public-share-simulation">
          <span class="panel-kicker">${copy(locale, 'simulation')}</span>
          <strong>${snapshot.simulation?.available ? copy(locale, 'simulationAvailable') : copy(locale, 'simulationUnavailable')}</strong>
          <p>${escapeHtml(snapshot.simulation?.explanation || '')}</p>
        </article>
        <article data-testid="public-share-parts">
          <span class="panel-kicker">${copy(locale, 'parts')}</span>
          <ul>
            ${parts.slice(0, 12).map((part) => `
              <li><strong>${escapeHtml(part.name || part.id)}</strong><span>${escapeHtml(part.role || part.type || '')}</span></li>
            `).join('')}
          </ul>
        </article>
        <article>
          <span class="panel-kicker">${copy(locale, 'context')}</span>
          <strong>${escapeHtml(snapshot.contextEvidence?.coverageStatus || 'shared')}</strong>
          <p>${escapeHtml(sourceTypes.join(', ') || copy(locale, 'notAvailable'))}</p>
        </article>
      </section>
    </main>
  `;
}

function copy(locale, key) {
  return t(`publicShare.${key}`, {}, locale);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
