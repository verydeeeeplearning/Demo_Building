import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  contextPacketLogSummary,
  createAgentTraceId,
  errorLogSummary,
  logAgentEvent,
  requestLogSummary,
  resultLogSummary,
  tutorRequestLogSummary,
  tutorResultLogSummary
} from '../../server/agent/agentLogger.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';

test('agent logger creates stable trace ids and redacted request summaries', () => {
  const traceId = createAgentTraceId();
  const longMessage = 'LED '.repeat(80);
  const summary = requestLogSummary({
    message: longMessage,
    locale: 'ko',
    conversationContext: {
      recentTurns: [
        { role: 'student', text: '조도 센서로 어두우면 LED 켜기' },
        { role: 'assistant', text: '대신 버튼을 누르면 LED가 켜지는 회로로 진행할까요?' }
      ],
      lastSupportedGoal: '버튼 LED',
      awaitingBuildConfirmation: true
    }
  });

  assert.match(traceId, /^agent-[0-9a-f-]+$/);
  assert.equal(summary.recentTurnCount, 2);
  assert.equal(summary.awaitingBuildConfirmation, true);
  assert.match(String(summary.lastAssistantPreview), /버튼을 누르면 LED/);
  assert.ok(String(summary.messagePreview).length <= 160);
  assert.notEqual(summary.messagePreview, longMessage);

  const secretSummary = requestLogSummary({
    message: 'Use sk-testsecret1234567890 sensor to turn on an LED.',
    locale: 'en'
  });
  assert.equal(secretSummary.messagePreview, 'Use [redacted-api-key] sensor to turn on an LED.');
});

test('agent logger emits JSON only when explicitly enabled', () => {
  const previousLevel = process.env.H_EDUWARE_AGENT_LOG_LEVEL;
  const previousJson = process.env.H_EDUWARE_AGENT_LOG_JSON;
  const previousFile = process.env.H_EDUWARE_AGENT_LOG_FILE;
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    delete process.env.H_EDUWARE_AGENT_LOG_LEVEL;
    logAgentEvent('agent.request.received', { traceId: 'agent-test' });
    assert.equal(lines.length, 0);

    process.env.H_EDUWARE_AGENT_LOG_LEVEL = 'debug';
    process.env.H_EDUWARE_AGENT_LOG_JSON = 'true';
    process.env.H_EDUWARE_AGENT_LOG_FILE = 'false';
    logAgentEvent('agent.request.received', { traceId: 'agent-test' });
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).traceId, 'agent-test');
  } finally {
    console.log = originalLog;
    if (previousLevel === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_LEVEL;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_LEVEL = previousLevel;
    }
    if (previousJson === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_JSON;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_JSON = previousJson;
    }
    if (previousFile === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_FILE;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_FILE = previousFile;
    }
  }
});

test('agent logger writes local JSONL logs for later trace lookup', () => {
  const previousLevel = process.env.H_EDUWARE_AGENT_LOG_LEVEL;
  const previousJson = process.env.H_EDUWARE_AGENT_LOG_JSON;
  const previousFile = process.env.H_EDUWARE_AGENT_LOG_FILE;
  const originalLog = console.log;
  const tempDir = mkdtempSync(join(tmpdir(), 'h-eduware-agent-log-'));
  const logFile = join(tempDir, 'agent-events.jsonl');
  console.log = () => {};

  try {
    process.env.H_EDUWARE_AGENT_LOG_LEVEL = 'debug';
    process.env.H_EDUWARE_AGENT_LOG_JSON = 'true';
    process.env.H_EDUWARE_AGENT_LOG_FILE = logFile;

    logAgentEvent('context.packet.built', {
      traceId: 'agent-file-test',
      contextRouteId: 'v2-button-controlled-light-output'
    });

    const lines = readFileSync(logFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.traceId, 'agent-file-test');
    assert.equal(record.event, 'context.packet.built');
    assert.equal(record.contextRouteId, 'v2-button-controlled-light-output');
  } finally {
    console.log = originalLog;
    rmSync(tempDir, { recursive: true, force: true });
    if (previousLevel === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_LEVEL;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_LEVEL = previousLevel;
    }
    if (previousJson === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_JSON;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_JSON = previousJson;
    }
    if (previousFile === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_FILE;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_FILE = previousFile;
    }
  }
});

test('context packet log summary exposes route and capability decisions', async () => {
  const packet = await buildContextPacket({
    message: '버튼을 누르면 LED가 켜지는 회로',
    locale: 'ko'
  });
  const summary = contextPacketLogSummary(packet);

  assert.equal(summary.pipelineMode, 'legacy');
  assert.equal(summary.contextRouteId, 'v2-button-controlled-light-output');
  assert.ok(summary.capabilityIds.includes('button-controlled-light-output'));
  assert.equal(summary.supportLevels['button-controlled-light-output'], 'supported');
  assert.ok(Array.isArray(summary.selectedBundleIds));
  assert.ok(Array.isArray(summary.candidateProvenance));
  assert.equal(summary.candidateProvenance.length, summary.candidatePartIds.length);
  assert.ok(summary.candidateProvenance.some((entry: any) => entry.partId === 'led-5mm'));
  assert.equal(typeof summary.supportBundleStatus, 'object');
  assert.equal(summary.synthesisEligibility, 'eligible');
});

test('context packet log summary includes unknown hardware and fallback provenance', async () => {
  const unknownPacket = await buildContextPacket({
    message: 'Use a tachyon sensor to turn on an LED.',
    locale: 'en'
  });
  const unknownSummary = contextPacketLogSummary(unknownPacket);

  assert.ok(unknownSummary.unknownHardwareMentions.includes('tachyon sensor'));
  assert.equal(unknownSummary.synthesisEligibility, 'ineligible');
  assert.ok(unknownSummary.supportGaps.some((gap: string) => gap.includes('tachyon')));

  const secretUnknownPacket = await buildContextPacket({
    message: 'Use sk-testsecret1234567890 sensor to turn on an LED.',
    locale: 'en'
  });
  const secretUnknownSummary = contextPacketLogSummary(secretUnknownPacket);
  const serializedSecretSummary = JSON.stringify(secretUnknownSummary);

  assert.doesNotMatch(serializedSecretSummary, /sk-testsecret1234567890/);
  assert.match(serializedSecretSummary, /\[redacted-api-key\]/);

  const fallbackPacket = await buildContextPacket({
    message: 'Use an Arduino and breadboard with jumper wires for a safe classroom circuit.',
    locale: 'en'
  });
  const fallbackSummary = contextPacketLogSummary(fallbackPacket);

  if (fallbackSummary.contextRouteId === 'supported-hardware-general') {
    assert.equal(fallbackSummary.fallbackRoute?.routeId, 'supported-hardware-general');
    assert.match(fallbackSummary.fallbackRoute.reason, /cannot authorize validated synthesis/i);
  }
});

test('agent result log summary includes serving status without full answer text', () => {
  const summary = resultLogSummary({
    servingStatus: 'needs_clarification',
    validationReport: { status: 'invalid' },
    buildRunnableReport: { status: 'blocked' },
    simulationPlan: { status: 'invalid', currentPaths: [] },
    renderPlan: { parts: [] },
    agentEvents: [],
    supportedAlternatives: [],
    clarification: 'Need a supported sensor.',
    assistantMessages: ['Use sk-testsecret1234567890 sensor?']
  } as any);

  assert.equal(summary.servingStatus, 'needs_clarification');
  assert.equal(summary.assistantPreview, 'Use [redacted-api-key] sensor?');
});

test('tutor log summaries expose serving state without raw tutor answers or secrets', () => {
  const requestSummary = tutorRequestLogSummary({
    sessionId: 'tutor-session',
    locale: 'ko',
    question: '이 연결을 어떻게 확인해? '.repeat(20),
    running: true,
    circuitTitle: 'Button LED',
    target: {
      id: 'conn-button-signal',
      type: 'connection',
      label: 'BUTTON INPUT',
      title: 'BUTTON INPUT',
      summary: 'button signal',
      why: 'It links the button to Arduino D2.',
      missing: 'No signal.',
      signal: 'button-input',
      connectionId: 'conn-button-signal',
      questions: []
    },
    artifacts: {
      circuitSpec: { components: [{}] },
      validationReport: { status: 'valid' },
      simulationPlan: { status: 'ready', currentPaths: [{}] },
      buildRunnableReport: { status: 'runnable' },
      solverGateResult: {
        mode: 'verified_build_simulation',
        buildReady: true
      },
      contextCoverage: { synthesisEligibility: { status: 'eligible' } },
      contextTrace: [{
        sourceId: 'agent-context/v2/routes.json',
        sourceType: 'data',
        reason: 'route-selected',
        usedFields: ['routeId']
      }]
    }
  } as any);

  assert.equal(requestSummary.targetId, 'conn-button-signal');
  assert.equal(requestSummary.targetType, 'connection');
  assert.equal(requestSummary.validationStatus, 'valid');
  assert.equal(requestSummary.solverGateMode, 'verified_build_simulation');
  assert.equal(requestSummary.synthesisEligibility, 'eligible');
  assert.equal(requestSummary.questionChars, 300);
  assert.match(String(requestSummary.questionHash), /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(requestSummary, 'questionPreview'), false);

  const responseSummary = tutorResultLogSummary({
    sessionId: 'tutor-session',
    mode: 'live',
    servingStatus: 'live_tutor_fallback',
    runtimeMode: 'auto',
    liveConfigured: true,
    liveAttempted: true,
    fallbackCategory: 'live-failure',
    fallbackReason: 'OPENAI_API_KEY=sk-testsecret1234567890 failed',
    tutorThreadId: 'tutor.session.session-main.artifact.afp-test.target.conn.locale.ko',
    artifactFingerprint: 'afp-test',
    targetScopeId: 'conn',
    structuredOutputStatus: 'failed',
    message: 'This is the full answer that should be hashed instead of logged.',
    grounding: ['validation-report', 'simulation-plan'],
    suggestedQuestions: ['What flows here?']
  });

  assert.equal(responseSummary.structuredOutputStatus, 'failed');
  assert.match(String(responseSummary.tutorThreadIdHash), /^[0-9a-f]{64}$/);
  assert.equal(responseSummary.artifactFingerprint, 'afp-test');
  assert.equal(responseSummary.targetScopeId, 'conn');
  assert.equal(responseSummary.runtimeMode, 'auto');
  assert.equal(responseSummary.liveConfigured, true);
  assert.equal(responseSummary.liveAttempted, true);
  assert.equal(responseSummary.fallbackCategory, 'live-failure');
  assert.equal(responseSummary.messageChars, 64);
  assert.match(responseSummary.messageHash, /^[0-9a-f]{64}$/);
  assert.equal(responseSummary.fallbackReasonPreview, '[redacted-config]=[redacted] failed');
});

test('error log summary redacts API-key shaped values', () => {
  const summary = errorLogSummary(new Error('request failed with api_key=sk-testsecret1234567890'));

  assert.equal(summary.errorName, 'Error');
  assert.equal(summary.errorMessage, 'request failed with api_key=[redacted]');
});
