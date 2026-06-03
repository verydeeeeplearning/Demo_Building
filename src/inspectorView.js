import { t } from './i18n.js';
import { escapeHtml } from './htmlSafe.js';

// Inspector connection renderers. The connection data originates from
// imported/shared snapshots, so every interpolated field is escaped here.
// Extracted from main.js so the escaping is unit-testable in isolation.

export function renderInspectorTargetSelector(circuit, locale = 'ko') {
  const connections = circuit?.connections || [];
  if (!connections.length) {
    return '';
  }

  return `
    <section class="inspector-target-selector" data-testid="inspector-target-selector" aria-label="${escapeHtml(t('inspector.targetSelectorTitle', {}, locale))}">
      <div class="panel-kicker">${escapeHtml(t('inspector.targetSelectorTitle', {}, locale))}</div>
      <div class="inspector-target-list">
        ${connections.map((connection) => `
          <button
            type="button"
            class="target-select-button"
            data-action="select-target"
            data-target-id="connection:${escapeHtml(connection.id)}"
          >
            <span class="connection-signal" style="--wire-color: ${escapeHtml(connection.color || '#1863dc')}"></span>
            <span>${escapeHtml(connection.education.label)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

export function renderConnectionButton(connection, target, locale = 'ko') {
  const isSelected = target.type === 'connection' && target.connectionId === connection.id;
  return `
    <button
      type="button"
      class="connection-item ${isSelected ? 'is-selected' : ''}"
      data-testid="connection-item"
      data-inspect-type="connection"
      data-inspect-id="${escapeHtml(connection.id)}"
      aria-label="${escapeHtml(t('inspector.selectConnection', { label: connection.education.label }, locale))}"
    >
      <span class="connection-signal" style="--wire-color: ${escapeHtml(connection.color || '#1863dc')}"></span>
      <span>
        <strong>${escapeHtml(connection.education.label)}</strong>
        <small>${escapeHtml(connection.education.title)}</small>
      </span>
    </button>
  `;
}
