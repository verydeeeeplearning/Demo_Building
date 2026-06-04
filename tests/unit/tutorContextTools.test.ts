import assert from 'node:assert/strict';
import test from 'node:test';

import { createTutorContextTools } from '../../server/agent/tutorContextTools.ts';

test('tutor tools list selected-target scoped source ids and read projections', async () => {
  const tools = createTutorContextTools({
    allowedSourceIds: ['registry:part-capabilities:led-5mm'],
    componentPartIds: ['led-5mm'],
    simulationPrimitiveIds: []
  });

  const listTool = tools.find((tool) => tool.name === 'list_tutor_context_sources');
  const readTool = tools.find((tool) => tool.name === 'read_tutor_context_doc');
  assert.ok(listTool);
  assert.ok(readTool);

  const index = JSON.parse(await listTool.invoke({}));
  assert.deepEqual(index.allowedSourceIds, ['registry:part-capabilities:led-5mm']);

  const allowed = JSON.parse(await readTool.invoke({ id: 'registry:part-capabilities:led-5mm' }));
  assert.equal(allowed.item.id, 'led-5mm');

  const denied = JSON.parse(await readTool.invoke({ id: 'registry:part-capabilities:oled-i2c-096' }));
  assert.equal(denied.error, 'CONTEXT_DOC_NOT_IN_SCOPE');
});
