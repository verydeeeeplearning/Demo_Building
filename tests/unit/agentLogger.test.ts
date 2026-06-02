import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  contextPacketLogSummary,
  createAgentTraceId,
  logAgentEvent,
  requestLogSummary
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

  assert.equal(summary.contextRouteId, 'v2-button-controlled-light-output');
  assert.ok(summary.capabilityIds.includes('button-controlled-light-output'));
  assert.equal(summary.supportLevels['button-controlled-light-output'], 'supported');
  assert.equal(summary.synthesisEligibility, 'eligible');
});
