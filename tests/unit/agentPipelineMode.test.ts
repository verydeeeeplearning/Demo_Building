import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getAgentPipelineMode } from '../../server/agent/agentPipelineMode.ts';

void test('agent pipeline mode defaults to legacy', () => {
  assert.equal(getAgentPipelineMode({}), 'legacy');
  assert.equal(getAgentPipelineMode({ H_EDUWARE_AGENT_PIPELINE: '' }), 'legacy');
  assert.equal(getAgentPipelineMode({ H_EDUWARE_AGENT_PIPELINE: 'garbage' }), 'legacy');
});

void test('agent pipeline mode parses shadow and next case-insensitively', () => {
  assert.equal(getAgentPipelineMode({ H_EDUWARE_AGENT_PIPELINE: 'shadow' }), 'shadow');
  assert.equal(getAgentPipelineMode({ H_EDUWARE_AGENT_PIPELINE: '  NEXT  ' }), 'next');
  assert.equal(getAgentPipelineMode({ H_EDUWARE_AGENT_PIPELINE: 'Legacy' }), 'legacy');
});
