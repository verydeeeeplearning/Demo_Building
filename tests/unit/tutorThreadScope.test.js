import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTutorArtifactFingerprint,
  buildTutorAuthoritySnapshot,
  buildTutorThreadId,
  normalizeTutorSessionId,
  targetScopeId
} from '../../shared/tutorThreadScope.js';

const baseArtifacts = {
  circuitSpec: {
    id: 'demo-led',
    title: 'LED demo',
    components: [{ id: 'led-1', partId: 'led-5mm', label: 'LED' }],
    connections: [{ id: 'c1', from: 'arduino:D9', to: 'led-1:A' }],
    behavior: { runText: 'LED on' }
  },
  validationReport: {
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: ['led-forward-current']
  },
  simulationPlan: {
    status: 'valid',
    runText: 'LED on',
    currentPaths: [{
      id: 'led-forward-current',
      primitiveId: 'digital_on_off',
      through: ['arduino', 'resistor', 'led']
    }]
  },
  buildRunnableReport: { runnable: true, reasons: [] },
  solverGateResult: { status: 'verified' },
  renderPlan: {
    title: 'LED demo',
    parts: [{ id: 'led-1' }],
    connections: [{ id: 'c1' }],
    warnings: []
  },
  contextTrace: [{ sourceId: 'registry:part-capabilities:led-5mm' }]
};

test('artifact fingerprint uses visible tutor authority and sha256 prefix', async () => {
  const first = await buildTutorArtifactFingerprint(baseArtifacts);
  const changedRunText = await buildTutorArtifactFingerprint({
    ...baseArtifacts,
    simulationPlan: { ...baseArtifacts.simulationPlan, runText: 'LED blinking' }
  });
  const changedTrace = await buildTutorArtifactFingerprint({
    ...baseArtifacts,
    contextTrace: [{ sourceId: 'registry:part-capabilities:oled-i2c-096' }]
  });

  assert.match(first, /^afp-[a-f0-9]{16}$/);
  assert.notEqual(changedRunText, first);
  assert.notEqual(changedTrace, first);
});

test('thread id changes by target artifact locale and session', async () => {
  const artifactFingerprint = await buildTutorArtifactFingerprint(baseArtifacts);
  const ledTarget = { id: 'part:led-1', type: 'part', partId: 'led-1' };
  const resistorTarget = { id: 'part:r1', type: 'part', partId: 'r1' };

  const ledKo = buildTutorThreadId({
    sessionId: 'session-main',
    artifactFingerprint,
    targetId: targetScopeId(ledTarget),
    locale: 'ko'
  });
  const ledEn = buildTutorThreadId({
    sessionId: 'session-main',
    artifactFingerprint,
    targetId: targetScopeId(ledTarget),
    locale: 'en'
  });
  const resistorKo = buildTutorThreadId({
    sessionId: 'session-main',
    artifactFingerprint,
    targetId: targetScopeId(resistorTarget),
    locale: 'ko'
  });

  assert.match(ledKo, /^tutor\.session\.session-main\.artifact\.afp-[a-f0-9]{16}\.target\./);
  assert.notEqual(ledKo, ledEn);
  assert.notEqual(ledKo, resistorKo);
});

test('snapshot omits full raw artifact payload fields that are not tutor authority', () => {
  const snapshot = buildTutorAuthoritySnapshot({
    ...baseArtifacts,
    debugPrompt: 'raw prompt must not enter snapshot',
    rawAssistantText: 'raw assistant text must not enter snapshot'
  });
  const encoded = JSON.stringify(snapshot);

  assert.equal(encoded.includes('debugPrompt'), false);
  assert.equal(encoded.includes('rawAssistantText'), false);
  assert.equal(encoded.includes('registry:part-capabilities:led-5mm'), true);
});

test('session and target ids are normalized to safe bounded thread parts', () => {
  assert.equal(normalizeTutorSessionId(' session main!! '), 'session-main');
  assert.equal(targetScopeId({ id: 'part:LED 1', type: 'part' }), 'part-LED-1');
});
