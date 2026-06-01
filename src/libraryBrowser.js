// Part Library browser modal. Lists the full 100+ component library, each entry
// rendered with three.js (via partRenderer) into a thumbnail.

import { PART_LIBRARY, PART_CATEGORIES, getPartsByCategory, searchParts } from './partLibraryData.js';
import { renderThumbnail } from './partRenderer.js';
import { getLocale, t } from './i18n.js';
import { localizeLibraryPart, searchableLibraryText } from './partLibraryLocalization.js';

const thumbnailCache = new Map();

function thumbnailFor(part) {
  if (!thumbnailCache.has(part.id)) {
    thumbnailCache.set(part.id, renderThumbnail(part));
  }
  return thumbnailCache.get(part.id);
}

function partCard(part, locale) {
  const displayPart = localizeLibraryPart(part, locale);
  const pins = part.pins?.length
    ? locale === 'ko'
      ? t('library.pins', { count: part.pins.length }, locale)
      : `${part.pins.length} pin${part.pins.length === 1 ? '' : 's'}`
    : t('library.noPins', {}, locale);

  return `
    <article class="lib-card" data-testid="library-card" data-category="${part.category}">
      <img
        class="lib-thumb"
        data-testid="library3d-thumb"
        data-renderer="three"
        src="${thumbnailFor(part)}"
        alt="${escapeAttr(t('parts.thumbAlt', { label: displayPart.name }, locale))}"
        loading="lazy"
      />
      <div class="lib-card-body">
        <strong>${escapeAttr(displayPart.name)}</strong>
        <p>${escapeAttr(displayPart.description)}</p>
        <span class="lib-meta">${escapeAttr(categoryLabel(part.category, locale))} · ${pins}</span>
      </div>
    </article>
  `;
}

function categoryLabel(id, locale) {
  const localized = t(`library.categories.${id}`, {}, locale);
  if (localized !== `library.categories.${id}`) {
    return localized;
  }
  return PART_CATEGORIES.find((category) => category.id === id)?.label || id;
}

export function mountLibraryBrowser(host, { onClose, locale = getLocale() } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'library-overlay';
  overlay.dataset.testid = 'library-browser';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('library.aria', {}, locale));

  const filters = [
    { id: 'all', label: t('library.all', {}, locale) },
    ...PART_CATEGORIES.map((category) => ({
      ...category,
      label: categoryLabel(category.id, locale)
    }))
  ];

  overlay.innerHTML = `
    <div class="library-panel">
      <header class="library-head">
        <div>
          <div class="panel-kicker">${t('library.kicker', {}, locale)}</div>
          <h2>${t('library.title', { count: PART_LIBRARY.length }, locale)}</h2>
        </div>
        <button class="library-close" type="button" data-testid="library-close" aria-label="${t('library.close', {}, locale)}">&times;</button>
      </header>
      <div class="library-controls">
        <input
          class="library-search"
          type="search"
          data-testid="library-search"
          placeholder="${t('library.searchPlaceholder', {}, locale)}"
          aria-label="${t('library.searchAria', {}, locale)}"
        />
        <div class="library-filters" data-testid="library-filters">
          ${filters.map((filter, index) => `
            <button
              type="button"
              class="library-filter ${index === 0 ? 'is-active' : ''}"
              data-category="${filter.id}"
            >${filter.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="library-count" data-testid="library-count"></div>
      <div class="library-grid" data-testid="library-grid"></div>
    </div>
  `;

  host.append(overlay);
  document.body.classList.add('has-modal');

  const grid = overlay.querySelector('[data-testid="library-grid"]');
  const countLabel = overlay.querySelector('[data-testid="library-count"]');
  const search = overlay.querySelector('[data-testid="library-search"]');

  let activeCategory = 'all';
  let query = '';

  function visibleParts() {
    const normalizedQuery = query.trim().toLowerCase();
    let parts = normalizedQuery
      ? locale === 'ko'
        ? PART_LIBRARY.filter((part) => searchableLibraryText(part, locale).includes(normalizedQuery))
        : searchParts(query)
      : PART_LIBRARY;
    if (activeCategory !== 'all') {
      const inCategory = new Set(getPartsByCategory(activeCategory).map((part) => part.id));
      parts = parts.filter((part) => inCategory.has(part.id));
    }
    return parts;
  }

  function paint() {
    const parts = visibleParts();
    grid.innerHTML = parts.map((part) => partCard(part, locale)).join('');
    countLabel.textContent = t('library.count', { visible: parts.length, total: PART_LIBRARY.length }, locale);
  }

  overlay.querySelectorAll('.library-filter').forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.category;
      overlay.querySelectorAll('.library-filter').forEach((other) => {
        other.classList.toggle('is-active', other === button);
      });
      paint();
    });
  });

  search.addEventListener('input', () => {
    query = search.value;
    paint();
  });

  let disposed = false;
  function close() {
    if (disposed) {
      return;
    }
    disposed = true;
    document.removeEventListener('keydown', onKeydown);
    document.body.classList.remove('has-modal');
    overlay.remove();
    onClose?.();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  overlay.querySelector('[data-testid="library-close"]').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);

  paint();

  return {
    dispose: close
  };
}

function escapeAttr(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
