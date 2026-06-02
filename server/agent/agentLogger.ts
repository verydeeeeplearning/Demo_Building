import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type {
  AgentConversationContext,
  AgentMessageRequest,
  AgentRunResult,
  ContextPacket
} from './schemas.ts';

type AgentLogLevel = 'silent' | 'info' | 'debug';

type AgentLogEvent =
  | 'agent.request.received'
  | 'context.packet.built'
  | 'context.compose.shadow'
  | 'context.compose.shadow.failed'
  | 'prompt.budget.exceeded'
  | 'requirement.analysis.completed'
  | 'agent.synthesis.attempt'
  | 'agent.validation.completed'
  | 'agent.response.sent'
  | 'agent.request.failed';

type AgentLogPayload = Record<string, unknown>;

export function createAgentTraceId(prefix = 'agent') {
  return `${prefix}-${randomUUID()}`;
}

export function logAgentEvent(
  event: AgentLogEvent,
  payload: AgentLogPayload = {}
) {
  const level = resolveLogLevel();
  if (level === 'silent') {
    return;
  }

  const record = {
    ts: new Date().toISOString(),
    level: event.endsWith('.failed') ? 'error' : 'info',
    event,
    ...payload
  };
  const jsonLine = JSON.stringify(record);

  if (process.env.H_EDUWARE_AGENT_LOG_JSON === 'false') {
    console.log(`[${record.ts}] ${event} ${JSON.stringify(payload)}`);
  } else {
    console.log(jsonLine);
  }

  writeAgentLogFile(jsonLine);
}

export function requestLogSummary(request: AgentMessageRequest) {
  const context = request.conversationContext;
  return {
    sessionId: request.sessionId ?? null,
    locale: request.locale ?? 'ko',
    messagePreview: preview(request.message),
    confirmationPreview: request.confirmation ? preview(request.confirmation) : null,
    recentTurnCount: context?.recentTurns?.length ?? 0,
    lastStudentPreview: preview(lastTurnText(context, 'student')),
    lastAssistantPreview: preview(lastTurnText(context, 'assistant')),
    lastSupportedGoalPreview: preview(context?.lastSupportedGoal),
    awaitingBuildConfirmation: Boolean(context?.awaitingBuildConfirmation),
    currentArtifactTitle: context?.currentArtifact?.title ?? null,
    currentArtifactSource: context?.currentArtifact?.source ?? null
  };
}

export function contextPacketLogSummary(contextPacket: ContextPacket) {
  return {
    contextRouteId: contextPacket.contextRoute.routeId,
    capabilityIds: contextPacket.capabilityMatches.map((capability) => capability.id),
    supportLevels: Object.fromEntries(
      contextPacket.capabilityMatches.map((capability) => [capability.id, capability.supportLevel])
    ),
    candidatePartIds: contextPacket.candidateParts.map((part) => part.id),
    supportGaps: contextPacket.supportGaps,
    unsupportedSignals: contextPacket.unsupportedSignals,
    synthesisEligibility: contextPacket.contextCoverage.synthesisEligibility.status,
    synthesisEligibilityReason: contextPacket.contextCoverage.synthesisEligibility.reason,
    sufficientFor: contextPacket.contextCoverage.sufficientFor,
    contextWarnings: contextPacket.contextCoverage.warnings
  };
}

export function resultLogSummary(result: AgentRunResult) {
  return {
    validationStatus: result.validationReport.status,
    buildRunnableStatus: result.buildRunnableReport.status,
    simulationStatus: result.simulationPlan.status,
    renderPartCount: result.renderPlan.parts.length,
    currentPathCount: result.simulationPlan.currentPaths.length,
    agentEventNames: result.agentEvents.map((event) => event.name),
    supportedAlternativeCount: result.supportedAlternatives.length,
    firstSupportedAlternativeId: result.supportedAlternatives[0]?.id ?? null,
    firstSupportedAlternativeGoalPreview: preview(result.supportedAlternatives[0]?.goal),
    clarificationPreview: preview(result.clarification ?? undefined),
    assistantPreview: preview(result.assistantMessages[0])
  };
}

export function langSmithMetadata({
  traceId,
  request,
  contextPacket
}: {
  traceId: string;
  request: AgentMessageRequest;
  contextPacket: ContextPacket;
}) {
  return {
    traceId,
    ...requestLogSummary(request),
    ...contextPacketLogSummary(contextPacket)
  };
}

function resolveLogLevel(): AgentLogLevel {
  const configured = process.env.H_EDUWARE_AGENT_LOG_LEVEL?.toLowerCase();
  if (configured === 'silent' || configured === 'info' || configured === 'debug') {
    return configured;
  }
  return 'silent';
}

function writeAgentLogFile(jsonLine: string) {
  const logFile = resolveLogFilePath();
  if (!logFile) {
    return;
  }

  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${jsonLine}\n`, 'utf8');
  } catch (error) {
    console.error(
      `[agent-logger] failed to write local log file: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

function resolveLogFilePath() {
  const configured = process.env.H_EDUWARE_AGENT_LOG_FILE;
  if (configured === 'false' || configured === 'off') {
    return null;
  }

  return resolve(configured || '.local/agent-traces/agent-events.jsonl');
}

function lastTurnText(context: AgentConversationContext | undefined, role: 'student' | 'assistant') {
  return [...(context?.recentTurns ?? [])].reverse().find((turn) => turn.role === role)?.text;
}

function preview(value: string | undefined, maxLength = 160) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}
