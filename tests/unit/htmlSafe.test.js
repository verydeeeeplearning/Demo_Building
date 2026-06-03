import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml } from '../../src/htmlSafe.js';

test('escapeHtml neutralizes HTML metacharacters', () => {
  assert.equal(
    escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"q" \'s\''), '&quot;q&quot; &#039;s&#039;');
});

test('escapeHtml stringifies null/undefined/number safely', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('escapeHtml defuses an img-onerror payload', () => {
  const out = escapeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'), 'raw <img must not survive');
  assert.ok(out.includes('&lt;img'), 'payload must be escaped');
});
