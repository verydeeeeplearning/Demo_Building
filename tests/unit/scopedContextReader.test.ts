import assert from 'node:assert/strict';
import test from 'node:test';

import { readScopedContextSource } from '../../server/context/scopedContextReader.ts';

test('part capability source returns only the requested part projection', async () => {
  const raw = await readScopedContextSource('registry:part-capabilities:led-5mm', {
    allowedSourceIds: ['registry:part-capabilities:led-5mm']
  });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.sourceId, 'registry:part-capabilities:led-5mm');
  assert.equal(parsed.kind, 'part-capability');
  assert.equal(parsed.item.id, 'led-5mm');
  assert.equal(JSON.stringify(parsed).includes('oled-i2c-096'), false);
});

test('simulation primitive source returns only the requested primitive projection', async () => {
  const raw = await readScopedContextSource('data:simulation-primitives:display_static_text', {
    allowedSourceIds: ['data:simulation-primitives:display_static_text']
  });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.sourceId, 'data:simulation-primitives:display_static_text');
  assert.equal(parsed.kind, 'simulation-primitive');
  assert.equal(parsed.item.id, 'display_static_text');
  assert.equal(JSON.stringify(parsed).includes('digital_on_off'), false);
});

test('unlisted context source is denied before resolving aliases', async () => {
  const raw = await readScopedContextSource('registry:part-capabilities:oled-i2c-096', {
    allowedSourceIds: ['registry:part-capabilities:led-5mm']
  });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.error, 'CONTEXT_DOC_NOT_IN_SCOPE');
});
