// Shared modal focus trap. Keeps Tab/Shift+Tab inside `container`, routes
// Escape to onEscape, and (optionally) restores focus to whatever was focused
// before the trap was created. The wrap math is a pure function so it can be
// unit-tested without a DOM; the thin DOM wiring is covered by e2e.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Pure: given the focusable count, the active element's index within them
// (-1 if focus is outside the trap), and whether Shift is held, return the
// index focus should move to — or -1 to let the browser's default Tab proceed.
export function nextTrapIndex(count, activeIndex, shiftKey) {
  if (count <= 0) {
    return -1;
  }
  const last = count - 1;
  if (shiftKey) {
    // Backwards: wrap to the end from the first element or from outside.
    return activeIndex <= 0 ? last : -1;
  }
  // Forwards: wrap to the start from the last element or from outside.
  return activeIndex === -1 || activeIndex >= last ? 0 : -1;
}

export function createFocusTrap(container, { onEscape } = {}) {
  const previouslyFocused =
    typeof document !== 'undefined' ? document.activeElement : null;

  function focusables() {
    return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      onEscape?.(event);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const items = focusables();
    const activeIndex = items.indexOf(document.activeElement);
    const target = nextTrapIndex(items.length, activeIndex, event.shiftKey);
    if (target >= 0) {
      event.preventDefault();
      items[target].focus();
    }
  }

  // Capture phase so the trap wins even if inner handlers stop propagation.
  document.addEventListener('keydown', onKeydown, true);

  return {
    focusables,
    release({ restoreFocus = true } = {}) {
      document.removeEventListener('keydown', onKeydown, true);
      if (
        restoreFocus &&
        previouslyFocused &&
        previouslyFocused !== document.body &&
        previouslyFocused.isConnected &&
        typeof previouslyFocused.focus === 'function'
      ) {
        previouslyFocused.focus();
      }
    }
  };
}
