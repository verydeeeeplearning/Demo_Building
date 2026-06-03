/**
 * Security tests for XSS sinks in inspector rendering (Task #6).
 *
 * Tests the render helpers from inspectorView.js.
 * Asserts that hostile labels are escaped — raw < > characters must not appear
 * in HTML output, and attribute breakout sequences must not produce valid
 * HTML attributes when the output is parsed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderConnectionButton, renderInspectorTargetSelector } from '../../src/inspectorView.js';

const HOSTILE_HTML = '<img src=x onerror="alert(1)">';
const HOSTILE_ATTR = '" onmouseover="alert(1)" data-x="';

// Helper: assert a string contains no unescaped < or > (i.e. no raw tags)
function assertNoRawTags(html, context) {
  // Find all < that are NOT part of a known HTML tag from the template itself.
  // Easiest: after escaping, the hostile payload becomes &lt;img...&gt;
  // A raw <img would inject an element. We check the escaped form is present
  // and that the raw unescaped form is absent.
  const rawTagPattern = /<img\s/i;
  assert.ok(
    !rawTagPattern.test(html),
    `${context}: raw <img tag found in output: ${html.slice(0, 300)}`
  );
}

// Helper: assert attribute breakout sequence is fully encoded
function assertNoAttrBreakout(html, context) {
  // After escaping, " becomes &quot; — so the raw `" onmouseover=` sequence
  // should not appear verbatim in the output.
  assert.ok(
    !html.includes('" onmouseover='),
    `${context}: unescaped attribute breakout in output: ${html.slice(0, 300)}`
  );
  assert.ok(
    !html.includes("' onmouseover="),
    `${context}: single-quote attribute breakout in output: ${html.slice(0, 300)}`
  );
}

// ---------------------------------------------------------------------------
// renderConnectionButton — label, title, id, aria-label
// ---------------------------------------------------------------------------

test('renderConnectionButton escapes hostile label — no raw img tag injected', () => {
  const connection = {
    id: 'conn-1',
    color: '#ff0000',
    education: { label: HOSTILE_HTML, title: 'Safe title' }
  };
  const target = { type: 'part' };
  const html = renderConnectionButton(connection, target, 'en');

  assertNoRawTags(html, 'label text content');
  // Verify the escaped form IS present (proves it rendered, not silently dropped)
  assert.ok(html.includes('&lt;img'), `escaped form expected in output`);
});

test('renderConnectionButton escapes hostile title — no raw img tag injected', () => {
  const connection = {
    id: 'conn-2',
    color: '#ff0000',
    education: { label: 'Safe label', title: HOSTILE_HTML }
  };
  const target = { type: 'part' };
  const html = renderConnectionButton(connection, target, 'en');

  assertNoRawTags(html, 'title text content');
  assert.ok(html.includes('&lt;img'), `escaped form expected in output`);
});

test('renderConnectionButton escapes hostile connection.id — no attribute breakout', () => {
  const connection = {
    id: HOSTILE_ATTR,
    color: '#ff0000',
    education: { label: 'Safe label', title: 'Safe title' }
  };
  const target = { type: 'part' };
  const html = renderConnectionButton(connection, target, 'en');

  assertNoAttrBreakout(html, 'data-inspect-id attribute');
});

test('renderConnectionButton escapes hostile label — no attribute breakout in aria-label', () => {
  const connection = {
    id: 'conn-3',
    color: '#ff0000',
    education: { label: HOSTILE_ATTR, title: 'Safe' }
  };
  const target = { type: 'part' };
  const html = renderConnectionButton(connection, target, 'en');

  assertNoAttrBreakout(html, 'aria-label attribute');
});

// ---------------------------------------------------------------------------
// renderInspectorTargetSelector — connection id, label
// ---------------------------------------------------------------------------

test('renderInspectorTargetSelector escapes hostile label — no raw img tag', () => {
  const circuit = {
    connections: [
      {
        id: 'conn-sel-1',
        color: '#0000ff',
        education: { label: HOSTILE_HTML }
      }
    ]
  };
  const html = renderInspectorTargetSelector(circuit, 'en');

  assertNoRawTags(html, 'selector label span');
  assert.ok(html.includes('&lt;img'), `escaped form expected in output`);
});

test('renderInspectorTargetSelector escapes hostile connection.id — no attribute breakout', () => {
  const circuit = {
    connections: [
      {
        id: HOSTILE_ATTR,
        color: '#0000ff',
        education: { label: 'Safe label' }
      }
    ]
  };
  const html = renderInspectorTargetSelector(circuit, 'en');

  assertNoAttrBreakout(html, 'data-target-id attribute');
});
