import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type {
  AgentConversationContext,
  AgentMessageRequest,
  AgentRunResult,
  ContextPacket,
  TutorMessageRequest,
  TutorMessageResponse
} from './schemas.ts';
import { redactSensitiveLogText } from './logRedaction.ts';

type AgentLogLevel = 'silent' | 'info' | 'debug';

type AgentLogEvent =
  | 'agent.request.received'
  | 'context.packet.built'
  | 'context.compose.shadow'
  | 'context.compose.shadow.failed'
  | 'prompt.budget.exceeded'
  | 'requirement.analysis.completed'
  | 'requirement.analysis.recovered'
  | 'requirement.doc.authored'
  | 'requirement.doc.authoring.failed'
  | 'agent.llm.handoff'
  | 'agent.llm.completed'
  | 'agent.structured_output.parsed'
  | 'agent.synthesis.attempt'
  | 'agent.synthesis.structured_output_missing'
  | 'agent.tool.call'
  | 'agent.simulation.compiled'
  | 'agent.validation.completed'
  | 'agent.response.sent'
  | 'agent.request.failed'
  | 'tutor.request.received'
  | 'tutor.llm.completed'
  | 'tutor.live.failed'
  | 'tutor.response.sent'
  | 'tutor.request.failed';

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
  const metadata = contextPacket.metadata;
  return {
    pipelineMode: metadata.pipelineMode,
    contextRouteId: contextPacket.contextRoute.routeId,
    capabilityIds: contextPacket.capabilityMatches.map((capability) => capability.id),
    supportLevels: Object.fromEntries(
      contextPacket.capabilityMatches.map((capability) => [capability.id, capability.supportLevel])
    ),
    selectedBundleIds: metadata.selectedBundleIds,
    candidatePartIds: contextPacket.candidateParts.map((part) => part.id),
    candidateProvenance: metadata.candidateProvenance,
    unknownHardwareMentions: metadata.unknownHardwareMentions.map((mention) => redactSensitiveLogText(mention.phrase) ?? ''),
    fallbackRoute: metadata.fallbackRoute
      ? {
        ...metadata.fallbackRoute,
        reason: redactSensitiveLogText(metadata.fallbackRoute.reason) ?? ''
      }
      : null,
    supportBundleStatus: metadata.supportBundleStatus,
    supportGaps: contextPacket.supportGaps.map((gap) => redactSensitiveLogText(gap) ?? ''),
    unsupportedSignals: contextPacket.unsupportedSignals.map((signal) => redactSensitiveLogText(signal) ?? ''),
    synthesisEligibility: contextPacket.contextCoverage.synthesisEligibility.status,
    synthesisEligibilityReason: redactSensitiveLogText(contextPacket.contextCoverage.synthesisEligibility.reason) ?? '',
    sufficientFor: contextPacket.contextCoverage.sufficientFor,
    contextWarnings: contextPacket.contextCoverage.warnings.map((warning) => redactSensitiveLogText(warning) ?? '')
  };
}

export function resultLogSummary(result: AgentRunResult) {
  return {
    servingStatus: result.servingStatus ?? null,
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

export function tutorRequestLogSummary(request: TutorMessageRequest) {
  const artifacts = request.artifacts;
  return {
    sessionId: request.sessionId ?? null,
    artifactFingerprint: request.artifactFingerprint ?? null,
    targetScopeId: request.targetScopeId ?? null,
    locale: request.locale ?? 'ko',
    running: request.running,
    questionChars: request.question.length,
    questionHash: stableHash(request.question),
    targetId: request.target.id,
    targetType: request.target.type,
    targetPartId: request.target.partId ?? null,
    targetConnectionId: request.target.connectionId ?? null,
    targetSignal: request.target.signal ?? null,
    targetLabelPreview: preview(request.target.label),
    circuitTitlePreview: preview(request.circuitTitle),
    validationStatus: artifacts.validationReport.status,
    simulationStatus: artifacts.simulationPlan.status,
    buildRunnableStatus: artifacts.buildRunnableReport?.status ?? null,
    solverGateMode: artifacts.solverGateResult?.mode ?? null,
    solverGateBuildReady: artifacts.solverGateResult?.buildReady ?? null,
    synthesisEligibility: artifacts.contextCoverage?.synthesisEligibility.status ?? null,
    contextSourceIds: artifacts.contextTrace.map((entry) => entry.sourceId),
    contextSourceTypes: artifacts.contextTrace.map((entry) => entry.sourceType),
    componentCount: artifacts.circuitSpec.components.length,
    currentPathCount: artifacts.simulationPlan.currentPaths.length
  };
}

export function tutorResultLogSummary(result: TutorMessageResponse) {
  return {
    sessionId: result.sessionId,
    mode: result.mode,
    servingStatus: result.servingStatus ?? null,
    runtimeMode: result.runtimeMode ?? null,
    liveConfigured: result.liveConfigured ?? null,
    liveAttempted: result.liveAttempted ?? null,
    fallbackCategory: result.fallbackCategory ?? null,
    fallbackReasonPreview: preview(redactSensitiveLogText(result.fallbackReason)),
    structuredOutputStatus: result.structuredOutputStatus ?? tutorStructuredOutputStatus(result),
    tutorThreadIdHash: result.tutorThreadId ? stableHash(result.tutorThreadId) : null,
    artifactFingerprint: result.artifactFingerprint ?? null,
    targetScopeId: result.targetScopeId ?? null,
    groundingCount: result.grounding.length,
    groundingPreview: result.grounding.slice(0, 8),
    suggestedQuestionCount: result.suggestedQuestions.length,
    messageChars: result.message.length,
    messageHash: stableHash(result.message)
  };
}

export function errorLogSummary(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: redactSensitiveLogText(error instanceof Error ? error.message : 'Unknown server error')
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

export function llmHandoffLogSummary({
  stage,
  agentName,
  runName,
  threadId,
  inputKind,
  systemPrompt,
  userPrompt,
  contextPacket,
  attempt,
  previousErrors = [],
  requirementRoute,
  toolNames = [],
  subagentNames = []
}: {
  stage: string;
  agentName: string;
  runName: string;
  threadId: string;
  inputKind: 'messages' | 'command-resume';
  systemPrompt: string;
  userPrompt: string;
  contextPacket: ContextPacket;
  attempt?: number;
  previousErrors?: string[];
  requirementRoute?: string;
  toolNames?: string[];
  subagentNames?: string[];
}) {
  const promptChars = [systemPrompt, userPrompt].join('\n\n').length;
  return {
    stage,
    agentName,
    runName,
    threadId,
    inputKind,
    attempt: attempt ?? null,
    requirementRoute: requirementRoute ?? null,
    contextRouteId: contextPacket.contextRoute.routeId,
    capabilityIds: contextPacket.capabilityMatches.map((capability) => capability.id),
    candidatePartIds: contextPacket.candidateParts.map((part) => part.id),
    toolNames,
    subagentNames,
    previousErrorCount: previousErrors.length,
    previousErrors: previousErrors.slice(0, 8).map((error) => preview(error, 120)),
    prompt: {
      systemChars: systemPrompt.length,
      userChars: userPrompt.length,
      totalChars: promptChars,
      contextBlockChars: contextPacket.promptBlock.length,
      maxChars: contextPacket.retrievalPlan.maxPromptChars,
      remainingChars: contextPacket.retrievalPlan.maxPromptChars - promptChars,
      systemHash: stableHash(systemPrompt),
      userHash: stableHash(userPrompt)
    }
  };
}

export function llmOutputLogSummary(output: unknown) {
  const record = output && typeof output === 'object' ? output as Record<string, unknown> : {};
  const structured = record.structuredResponse ?? record.structured_response;
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const assistantText = latestAssistantText(messages);
  return {
    hasStructuredResponse: structured !== undefined && structured !== null,
    structuredResponseKeys: structured && typeof structured === 'object'
      ? Object.keys(structured as Record<string, unknown>).sort()
      : [],
    messageCount: messages.length,
    toolCallNames: uniqueToolCallNames(messages),
    assistantTextChars: assistantText?.length ?? 0,
    assistantTextHash: assistantText ? stableHash(assistantText) : null
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

  const normalized = (redactSensitiveLogText(value) ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function stableHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function tutorStructuredOutputStatus(result: TutorMessageResponse) {
  if (result.servingStatus === 'live_tutor_answer') {
    return 'parsed';
  }
  if (result.servingStatus === 'live_tutor_fallback') {
    return 'fallback';
  }
  return 'not_used';
}

function uniqueToolCallNames(messages: unknown[]) {
  const names = new Set<string>();
  for (const message of messages) {
    for (const call of toolCallsForMessage(message)) {
      if (call.name) {
        names.add(call.name);
      }
    }
  }
  return [...names];
}

function latestAssistantText(messages: unknown[]) {
  for (const message of [...messages].reverse()) {
    if (toolCallsForMessage(message).length > 0) {
      continue;
    }
    const text = messageContentText(message);
    if (text) {
      return text;
    }
  }
  return null;
}

function toolCallsForMessage(message: unknown): Array<{ name?: string; args?: unknown }> {
  const record = message && typeof message === 'object' ? message as Record<string, unknown> : {};
  const kwargs = record.kwargs && typeof record.kwargs === 'object' ? kwargsRecord(record.kwargs) : {};
  const calls = record.tool_calls ?? kwargs.tool_calls;
  return Array.isArray(calls) ? calls as Array<{ name?: string; args?: unknown }> : [];
}

function messageContentText(message: unknown) {
  const record = message && typeof message === 'object' ? message as Record<string, unknown> : {};
  const kwargs = record.kwargs && typeof record.kwargs === 'object' ? kwargsRecord(record.kwargs) : {};
  const content = record.content ?? kwargs.content;

  if (typeof content === 'string') {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
        ? (part as Record<string, string>).text
        : '')
      .join('\n')
      .trim();
    return text || null;
  }
  return null;
}

function kwargsRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
