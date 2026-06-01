// H-eduware brand logo, expressed as inline SVG so it never triggers a network
// request (the e2e harness forbids external fetches). Colors reference the
// design-system palette: near-black primary, coral educational accent, deep
// enterprise green for the circuit motif.
//
// The mark reads as a capital H built from two vertical rails and a crossbar,
// with a coral "signal node" sitting on the crossbar. It nods to a breadboard
// jumper carrying power between two parts, the core idea of the product.

const MARK_VIEWBOX = '0 0 48 48';

function markGeometry({ idPrefix }) {
  const gradientId = `${idPrefix}-rail`;
  return `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1f1f27" />
        <stop offset="1" stop-color="#0c0c11" />
      </linearGradient>
    </defs>
    <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="url(#${gradientId})" />
    <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="none" stroke="#2c2c36" stroke-width="1" />
    <rect x="12" y="11" width="5.4" height="26" rx="2.7" fill="#f4f3ef" />
    <rect x="30.6" y="11" width="5.4" height="26" rx="2.7" fill="#f4f3ef" />
    <rect x="14" y="21.3" width="20" height="5.4" rx="2.7" fill="#ff7759" />
    <circle cx="14.7" cy="13.4" r="2.05" fill="#003c33" />
    <circle cx="33.3" cy="13.4" r="2.05" fill="#003c33" />
    <circle cx="14.7" cy="34.6" r="2.05" fill="#1863dc" />
    <circle cx="33.3" cy="34.6" r="2.05" fill="#1863dc" />
    <circle cx="24" cy="24" r="3.1" fill="#0c0c11" stroke="#ff7759" stroke-width="1.5" />
    <circle cx="24" cy="24" r="1.1" fill="#ffad9b" />
  `;
}

// Compact square mark for the topbar and small placements.
export function createLogoMark({ size = 38, idPrefix = 'heduware-mark', title = 'H-eduware' } = {}) {
  return `
    <svg
      class="heduware-logo-mark"
      data-testid="brand-logo"
      width="${size}"
      height="${size}"
      viewBox="${MARK_VIEWBOX}"
      role="img"
      aria-label="${title}"
      xmlns="http://www.w3.org/2000/svg"
    >
      ${markGeometry({ idPrefix })}
    </svg>
  `;
}

// Full lockup: mark plus wordmark, used on the welcome popup and larger surfaces.
export function createLogoLockup({ idPrefix = 'heduware-lockup' } = {}) {
  return `
    <span class="heduware-logo-lockup" data-testid="brand-lockup">
      ${createLogoMark({ size: 44, idPrefix, title: 'H-eduware logo' })}
      <span class="heduware-wordmark">
        <strong>H-eduware</strong>
        <small>idea to circuit</small>
      </span>
    </span>
  `;
}

// Data-URI favicon so index.html can set an icon without a network request.
export function createFaviconDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">${markGeometry({ idPrefix: 'fav' })}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
