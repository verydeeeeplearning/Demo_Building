import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderConnectionButton,
  renderInspectorTargetSelector
} from '../../src/inspectorView.js';

const XSS = '<img src=x onerror=alert(1)>';

function maliciousConnection() {
  return {
    id: `c1${XSS}`,
    color: '#1863dc',
    signal: 'power',
    education: { label: XSS, title: XSS, what: XSS }
  };
}

test('renderConnectionButton escapes connection labels and id', () => {
  const html = renderConnectionButton(
    maliciousConnection(),
    { type: 'connection', connectionId: 'other' },
    'ko'
  );
  assert.ok(!html.includes('<img src=x'), 'raw img tag must not appear in output');
  assert.ok(html.includes('&lt;img'), 'payload must be escaped');
});

test('renderInspectorTargetSelector escapes connection labels', () => {
  const circuit = { connections: [maliciousConnection()] };
  const html = renderInspectorTargetSelector(circuit, 'ko');
  assert.ok(!html.includes('<img src=x'), 'raw img tag must not appear in output');
  assert.ok(html.includes('&lt;img'), 'payload must be escaped');
});

test('renderInspectorTargetSelector returns empty string when no connections', () => {
  assert.equal(renderInspectorTargetSelector({ connections: [] }, 'ko'), '');
});
