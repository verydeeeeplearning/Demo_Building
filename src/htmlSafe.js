// Single source of truth for HTML escaping across the front-end.
// Untrusted strings (imported/shared snapshot data, AI output, user text)
// MUST pass through this before being interpolated into innerHTML.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
