import { createHash } from 'node:crypto';

import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph';
import { createDeepAgent } from 'deepagents';
import { providerStrategy, toolStrategy } from 'langchain';
import { z } from 'zod';

import { errorLogSummary, llmOutputLogSummary, logAgentEvent } from './agentLogger.ts';
import { createTutorContextTools } from './tutorContextTools.ts';
import {
  classifyTutorQuestionIntent,
  isLedVoltageSafetyIntent,
  ledVoltageSafetyAnswer
} from '../../src/tutorQuestionIntent.js';
import { buildTutorAuthoritySnapshot } from '../../shared/tutorThreadScope.js';
import {
  TutorMessageResponseSchema,
  type TutorMessageRequest,
  type TutorMessageResponse
} from './schemas.ts';
import {
  resolveTutorThreadScope,
  type ResolvedTutorThreadScope
} from './tutorThreadScope.ts';

const LiveTutorDraftSchema = z.object({
  message: z.string().min(1),
  suggestedQuestions: z.array(z.string().min(1)).default([])
});

type LiveTutorDraft = z.infer<typeof LiveTutorDraftSchema>;
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type TutorRuntimeMode = 'auto' | 'live' | 'local';
type TutorStructuredOutputStatus =
  | 'native'
  | 'recovered_tool_call'
  | 'recovered_json_text'
  | 'recovered_assistant_text'
  | 'not_used'
  | 'failed';
type TutorRuntimeResolution = {
  runtimeMode: TutorRuntimeMode;
  liveConfigured: boolean;
  liveDefault: boolean;
  liveRequired: boolean;
  fallbackAllowed: boolean;
};
type TutorAgentOptions = {
  liveDraftProvider?: (input: {
    request: TutorMessageRequest;
    localResponse: TutorMessageResponse;
    traceId?: string;
    runName?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) => Promise<LiveTutorDraft>;
  traceId?: string;
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  deps?: {
    checkpointer?: unknown;
    deepAgentFactory?: typeof createDeepAgent;
  };
};

const tutorConversationCheckpointer = new MemorySaver();

export function resolveTutorRuntimeMode(env: NodeJS.ProcessEnv = process.env): TutorRuntimeResolution {
  const configuredMode = String(env.H_EDUWARE_TUTOR_MODE ?? 'auto').toLowerCase();
  const runtimeMode: TutorRuntimeMode = configuredMode === 'local' || configuredMode === 'live'
    ? configuredMode
    : 'auto';
  const liveConfigured = Boolean(env.OPENAI_API_KEY && env.H_EDUWARE_AGENT_MODEL);
  const liveRequired = runtimeMode === 'live';
  const liveDefault = runtimeMode === 'auto' ? liveConfigured : runtimeMode === 'live' && liveConfigured;

  return {
    runtimeMode,
    liveConfigured,
    liveDefault,
    liveRequired,
    fallbackAllowed: true
  };
}

export function tutorRuntimeHealth() {
  const resolution = resolveTutorRuntimeMode();
  return {
    tutor: {
      serverAvailable: true,
      runtimeMode: resolution.runtimeMode,
      liveConfigured: resolution.liveConfigured,
      liveDefault: resolution.liveDefault,
      liveRequired: resolution.liveRequired,
      fallbackAllowed: resolution.fallbackAllowed
    }
  };
}

export async function runTutorAgent(
  request: TutorMessageRequest,
  options: TutorAgentOptions = {}
): Promise<TutorMessageResponse> {
  const tutorScope = await resolveTutorThreadScope(request);
  const localResponse = buildLocalTutorResponse(request, tutorScope);
  const runtime = resolveTutorRuntimeMode();
  if (runtime.runtimeMode === 'local') {
    return withTutorRuntime(localResponse, runtime, { liveAttempted: false });
  }
  if (!runtime.liveConfigured) {
    if (!runtime.liveRequired) {
      return withTutorRuntime(localResponse, runtime, { liveAttempted: false });
    }
    return TutorMessageResponseSchema.parse({
      ...localResponse,
      servingStatus: 'live_tutor_fallback',
      fallbackReason: 'live tutor configuration unavailable [redacted]',
      runtimeMode: runtime.runtimeMode,
      liveConfigured: runtime.liveConfigured,
      liveAttempted: false,
      fallbackCategory: 'configuration',
      structuredOutputStatus: 'failed'
    });
  }

  try {
    const draftResult = options.liveDraftProvider
      ? {
        draft: await options.liveDraftProvider({
        request,
        localResponse,
        traceId: options.traceId,
        runName: options.runName,
        tags: options.tags,
        metadata: options.metadata
      }),
        structuredOutputStatus: 'native' as TutorStructuredOutputStatus
      }
      : await runLiveTutorDraft(request, localResponse, tutorScope, options);
    const parsed = LiveTutorDraftSchema.parse(draftResult.draft);
    return TutorMessageResponseSchema.parse({
      ...localResponse,
      mode: 'live',
      servingStatus: 'live_tutor_answer',
      runtimeMode: runtime.runtimeMode,
      liveConfigured: runtime.liveConfigured,
      liveAttempted: true,
      structuredOutputStatus: draftResult.structuredOutputStatus,
      message: parsed.message,
      grounding: uniqueStrings([...localResponse.grounding, 'live-deepagents-tutor']),
      suggestedQuestions: parsed.suggestedQuestions.length > 0
        ? parsed.suggestedQuestions
        : localResponse.suggestedQuestions
    });
  } catch (error) {
    logAgentEvent('tutor.live.failed', {
      traceId: options.traceId ?? null,
      sessionId: request.sessionId ?? null,
      tutorThreadIdHash: stableHash(tutorScope.tutorThreadId),
      artifactFingerprint: tutorScope.artifactFingerprint,
      targetScopeId: tutorScope.targetScopeId,
      clientArtifactFingerprintMismatch: tutorScope.clientArtifactFingerprintMismatch,
      clientTargetScopeIdMismatch: tutorScope.clientTargetScopeIdMismatch,
      runtimeMode: runtime.runtimeMode,
      liveConfigured: runtime.liveConfigured,
      liveAttempted: true,
      targetId: request.target.id,
      targetType: request.target.type,
      fallbackCategory: tutorLiveFallbackCategory(error),
      ...errorLogSummary(error)
    });
    return TutorMessageResponseSchema.parse({
      ...localResponse,
      servingStatus: 'live_tutor_fallback',
      fallbackReason: redactTutorFallbackReason(error),
      runtimeMode: runtime.runtimeMode,
      liveConfigured: runtime.liveConfigured,
      liveAttempted: true,
      fallbackCategory: tutorLiveFallbackCategory(error),
      structuredOutputStatus: 'failed'
    });
  }
}

function withTutorRuntime(
  response: TutorMessageResponse,
  runtime: TutorRuntimeResolution,
  options: { liveAttempted: boolean; fallbackCategory?: string }
) {
  return TutorMessageResponseSchema.parse({
    ...response,
    runtimeMode: runtime.runtimeMode,
    liveConfigured: runtime.liveConfigured,
    liveAttempted: options.liveAttempted,
    fallbackCategory: options.fallbackCategory,
    structuredOutputStatus: response.structuredOutputStatus ?? 'not_used'
  });
}

function buildLocalTutorResponse(
  request: TutorMessageRequest,
  tutorScope: ResolvedTutorThreadScope
): TutorMessageResponse {
  const locale = request.locale === 'en' ? 'en' : 'ko';
  const target = request.target;
  const artifacts = request.artifacts;
  const flags = classifyTutorQuestion(request.question);
  const intent = classifyTutorQuestionIntent(request.question, { target });
  const useLedVoltageSafetyAnswer = isLedVoltageSafetyIntent(intent);
  const message = useLedVoltageSafetyAnswer
    ? ledVoltageSafetyAnswer(locale)
    : locale === 'ko'
      ? koreanResponse(target, artifacts, flags)
      : englishResponse(target, artifacts, flags);
  const grounding = [
    target.id,
    target.type,
    target.signal,
    ...(target.endpoints ?? []),
    ...artifactGrounding(artifacts),
    ...(useLedVoltageSafetyAnswer ? ledGroundingForArtifacts(artifacts) : [])
  ].filter((value): value is string => Boolean(value));

  return TutorMessageResponseSchema.parse({
    sessionId: tutorScope.sessionId,
    tutorThreadId: tutorScope.tutorThreadId,
    artifactFingerprint: tutorScope.artifactFingerprint,
    targetScopeId: tutorScope.targetScopeId,
    structuredOutputStatus: 'not_used',
    mode: 'local',
    servingStatus: 'local_tutor_answer',
    message,
    grounding: uniqueStrings(grounding),
    suggestedQuestions: target.questions
  });
}

function classifyTutorQuestion(question: string) {
  const lowerQuestion = question.toLowerCase();
  return {
    wantsMissing: /missing|remove|without|빠지면|빠졌|없으면|빼면|분리되면|누락|연결이 안/.test(lowerQuestion),
    wantsCurrent: /current|flow|전류|흐름|흘러|흐르|전원 경로/.test(lowerQuestion),
    wantsCheck: /check|test|verify|확인|검증|맞게|정상|테스트/.test(lowerQuestion)
  };
}

async function runLiveTutorDraft(
  request: TutorMessageRequest,
  localResponse: TutorMessageResponse,
  tutorScope: ResolvedTutorThreadScope,
  options: TutorAgentOptions = {}
): Promise<{ draft: LiveTutorDraft; structuredOutputStatus: TutorStructuredOutputStatus }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.H_EDUWARE_AGENT_MODEL;
  if (!apiKey || !modelName) {
    throw new Error('Live tutor mode requires OPENAI_API_KEY and H_EDUWARE_AGENT_MODEL.');
  }

  const model = new ChatOpenAI({
    model: modelName,
    apiKey,
    ...modelGenerationOptions(modelName)
  });

  const capabilities = tutorModelCapabilities(modelName);
  if (!capabilities.providerStructuredOutput && !capabilities.toolCalling) {
    throw new Error(`TUTOR_MODEL_CAPABILITY_UNKNOWN: ${modelName} is not in the tutor structured-output/tool-calling capability table.`);
  }

  const tutorTools = capabilities.toolCalling
    ? createTutorContextTools({
      allowedSourceIds: uniqueStrings(request.artifacts.contextTrace.map((entry) => entry.sourceId)),
      componentPartIds: uniqueStrings(request.artifacts.circuitSpec.components
        .map((component) => component.partId)
        .filter((partId): partId is string => Boolean(partId))),
      simulationPrimitiveIds: uniqueStrings(request.artifacts.simulationPlan.currentPaths
        .map((path) => path.primitiveId)
        .filter((primitiveId): primitiveId is string => Boolean(primitiveId)))
    })
    : [];
  const responseStrategy = tutorResponseFormatStrategy(tutorTools.length > 0, capabilities);
  const agentFactory = options.deps?.deepAgentFactory ?? createDeepAgent;

  // The system prompt includes current artifact authority. Do not cache agent instances across
  // different tutor scopes/current artifacts, otherwise this prompt and tool allowlist can go stale.
  const agent = agentFactory({
    model,
    tools: tutorTools,
    responseFormat: responseStrategy.responseFormat,
    systemPrompt: buildLiveTutorSystemPrompt(request),
    checkpointer: options.deps?.checkpointer ?? tutorConversationCheckpointer,
    name: 'h-eduware-tutor-deepagent'
  } as never);

  const output = await agent.invoke({
    messages: [{
      role: 'user',
      content: buildLiveTutorUserPrompt(request, localResponse)
    }]
  }, {
    runName: options.runName ?? 'h-eduware-circuit-tutor',
    tags: options.tags ?? ['workflow:tutor'],
    metadata: {
      ...(options.metadata ?? {}),
      traceId: options.traceId,
      workflow: 'tutor',
      structuredOutputStrategy: responseStrategy.strategy,
      tutorThreadId: tutorScope.tutorThreadId,
      artifactFingerprint: tutorScope.artifactFingerprint,
      targetScopeId: tutorScope.targetScopeId,
      targetType: request.target.type,
      targetSignal: request.target.signal ?? null,
      selectedTargetId: request.target.id
    },
    configurable: {
      thread_id: tutorScope.tutorThreadId
    }
  });
  const parsedOutput = parseLiveTutorDraftWithStatus(output);
  logAgentEvent('tutor.llm.completed', {
    traceId: options.traceId ?? null,
    sessionId: request.sessionId ?? null,
    tutorThreadIdHash: stableHash(tutorScope.tutorThreadId),
    artifactFingerprint: tutorScope.artifactFingerprint,
    targetScopeId: tutorScope.targetScopeId,
    structuredOutputStatus: parsedOutput.structuredOutputStatus,
    ...llmOutputLogSummary(output)
  });

  return parsedOutput;
}

export function parseLiveTutorDraft(output: unknown): LiveTutorDraft {
  return parseLiveTutorDraftWithStatus(output).draft;
}

export function parseLiveTutorDraftWithStatus(output: unknown): {
  draft: LiveTutorDraft;
  structuredOutputStatus: TutorStructuredOutputStatus;
} {
  const candidate = output && typeof output === 'object'
    ? (output as Record<string, unknown>).structuredResponse ?? (output as Record<string, unknown>).structured_response
    : null;

  if (candidate) {
    return {
      draft: LiveTutorDraftSchema.parse(candidate),
      structuredOutputStatus: 'native'
    };
  }

  const recovered = recoverTutorDraftFromAgentMessages(output);
  if (!recovered) {
    throw new Error('Deepagents tutor did not return structured output.');
  }
  return {
    draft: LiveTutorDraftSchema.parse(recovered.draft),
    structuredOutputStatus: recovered.structuredOutputStatus
  };
}

function recoverTutorDraftFromAgentMessages(output: unknown) {
  const messages = output && typeof output === 'object' && Array.isArray((output as Record<string, unknown>).messages)
    ? (output as Record<string, unknown>).messages as unknown[]
    : [];
  if (messages.length === 0) {
    return null;
  }

  const toolDraft = latestTutorDraftFromToolCalls(messages);
  if (toolDraft) {
    return {
      draft: toolDraft,
      structuredOutputStatus: 'recovered_tool_call' as TutorStructuredOutputStatus
    };
  }

  const assistantText = latestAssistantText(messages);
  if (!assistantText) {
    return null;
  }

  const jsonDraft = tryParseTutorDraftText(assistantText);
  if (jsonDraft) {
    return {
      draft: jsonDraft,
      structuredOutputStatus: 'recovered_json_text' as TutorStructuredOutputStatus
    };
  }

  return {
    draft: {
      message: assistantText,
      suggestedQuestions: []
    },
    structuredOutputStatus: 'recovered_assistant_text' as TutorStructuredOutputStatus
  };
}

function latestTutorDraftFromToolCalls(messages: unknown[]) {
  for (const message of [...messages].reverse()) {
    for (const call of [...toolCallsForMessage(message)].reverse()) {
      const parsed = LiveTutorDraftSchema.safeParse(call.args);
      if (parsed.success) {
        return parsed.data;
      }
    }
  }
  return null;
}

function tryParseTutorDraftText(text: string) {
  const trimmed = unwrapJsonFence(text);
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = LiveTutorDraftSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function unwrapJsonFence(text: string) {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
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
  const kwargs = record.kwargs && typeof record.kwargs === 'object' ? record.kwargs as Record<string, unknown> : {};
  const calls = record.tool_calls ?? kwargs.tool_calls;
  return Array.isArray(calls) ? calls as Array<{ name?: string; args?: unknown }> : [];
}

function messageContentText(message: unknown) {
  const record = message && typeof message === 'object' ? message as Record<string, unknown> : {};
  const kwargs = record.kwargs && typeof record.kwargs === 'object' ? record.kwargs as Record<string, unknown> : {};
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

function buildLiveTutorSystemPrompt(request: TutorMessageRequest) {
  const language = request.locale === 'en' ? 'English' : 'Korean';
  return [
    'You are the H-eduware circuit tutor for a student inspecting a simulated circuit.',
    `Answer in ${language}.`,
    'Use only the selected target, current artifact authority snapshot, validation report, simulation plan, context trace, and scoped tutor context tools.',
    'Do not invent wiring, pins, current paths, supported hardware, or simulation behavior.',
    'If validation or simulation is not valid, explain the blocker instead of describing current as flowing.',
    'Keep the answer short, concrete, and student-facing. Avoid internal terms such as canonical context, trace, artifact, structured output, or tool call.',
    '',
    'Current artifact authority snapshot:',
    JSON.stringify(buildTutorAuthoritySnapshot(request.artifacts), null, 2)
  ].join('\n');
}

function buildLiveTutorUserPrompt(
  request: TutorMessageRequest,
  localResponse: TutorMessageResponse
) {
  return JSON.stringify({
    question: request.question,
    running: request.running,
    selectedTarget: request.target,
    deterministicBaseline: {
      message: localResponse.message,
      grounding: localResponse.grounding,
      suggestedQuestions: localResponse.suggestedQuestions
    },
    requiredOutput: {
      message: 'student-facing answer grounded only in the provided target and artifacts',
      suggestedQuestions: '0-3 short follow-up questions'
    }
  });
}

function tutorResponseFormatStrategy(
  hasTools: boolean,
  capabilities: ReturnType<typeof tutorModelCapabilities>
) {
  if (!hasTools && capabilities.providerStructuredOutput) {
    return {
      strategy: 'provider_without_tools',
      responseFormat: providerStrategy(LiveTutorDraftSchema)
    };
  }
  if (hasTools && capabilities.providerStructuredOutput) {
    return {
      strategy: 'provider_with_tools',
      responseFormat: providerStrategy(LiveTutorDraftSchema)
    };
  }
  return {
    strategy: 'tool_strategy_with_tools',
    responseFormat: toolStrategy(LiveTutorDraftSchema)
  };
}

function tutorModelCapabilities(modelName: string) {
  const supportsOpenAiStructuredTools = /^(gpt-5|gpt-4\.1|gpt-4o)/i.test(modelName);
  return {
    providerStructuredOutput: supportsOpenAiStructuredTools,
    toolCalling: supportsOpenAiStructuredTools
  };
}

function stableHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function redactTutorFallbackReason(error: unknown) {
  const raw = error instanceof Error ? error.message : 'live tutor failed';
  if (error instanceof z.ZodError) {
    return 'malformed live tutor response';
  }
  if (/OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL|sk-[A-Za-z0-9_-]+/.test(raw)) {
    return 'live tutor configuration unavailable [redacted]';
  }
  return 'live tutor failed';
}

function tutorLiveFallbackCategory(error: unknown) {
  if (error instanceof z.ZodError) {
    return 'structured-output';
  }
  if (
    error instanceof Error
    && error.message.startsWith('TUTOR_MODEL_CAPABILITY_UNKNOWN:')
  ) {
    return 'capability-unknown';
  }
  return 'live-failure';
}

function modelGenerationOptions(modelName: string) {
  if (modelName.startsWith('gpt-5')) {
    return {
      useResponsesApi: true,
      reasoning: {
        effort: resolveReasoningEffort()
      }
    };
  }

  return { temperature: 0 };
}

function resolveReasoningEffort(): ReasoningEffort {
  const configured = process.env.H_EDUWARE_AGENT_REASONING_EFFORT;
  const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  return allowed.includes(configured as ReasoningEffort)
    ? configured as ReasoningEffort
    : 'low';
}

function koreanResponse(
  target: TutorMessageRequest['target'],
  artifacts: TutorMessageRequest['artifacts'],
  flags: { wantsMissing: boolean; wantsCurrent: boolean; wantsCheck: boolean }
) {
  if (flags.wantsMissing) {
    return `검증된 회로 기준으로 ${target.label} 연결이 빠지면 ${koreanMissingEffect(target)}`;
  }
  if (flags.wantsCurrent) {
    if (!hasValidatedSimulation(artifacts)) {
      const reason = simulationBlockReason(artifacts);
      return `${target.label}의 전류 흐름은 회로 검증과 시뮬레이션이 모두 valid일 때만 설명할 수 있습니다. 현재 validation=${artifacts.validationReport.status}, simulation=${artifacts.simulationPlan.status}라서 전류 애니메이션은 차단됩니다.${reason ? ` 이유: ${reason}` : ''}`;
    }
    return `${target.label}는 검증된 ${koreanSignalLabel(target.signal ?? target.type)} 경로입니다. ${koreanTargetDetail(target)} 전류는 전원에서 부품을 지나 GND로 돌아오는 닫힌 경로가 있을 때만 흐릅니다.`;
  }
  if (flags.wantsCheck) {
    return `${target.label}를 확인할 때는 먼저 핀 이름과 신호 종류가 검증된 회로 스펙과 일치하는지 봅니다. ${koreanTargetDetail(target)}`;
  }
  return `${target.label}: ${koreanTargetSummary(target)}`;
}

function koreanTargetSummary(target: TutorMessageRequest['target']) {
  return `${target.label}는 ${koreanSignalLabel(target.signal ?? target.type)} 연결입니다. ${koreanTargetDetail(target)}`;
}

function koreanTargetDetail(target: TutorMessageRequest['target']) {
  const endpoints = target.endpoints ?? [];
  if (endpoints.length >= 2) {
    return `${endpoints[0]}에서 ${endpoints[1]}로 이어집니다.`;
  }
  return target.detail ?? target.summary;
}

function koreanMissingEffect(target: TutorMessageRequest['target']) {
  const label = `${target.label} ${target.summary} ${target.detail} ${target.missing}`.toLowerCase();
  if (label.includes('oled') || label.includes('display')) {
    return 'OLED에 필요한 전원이나 신호가 끊겨 화면이 켜지지 않거나 글자가 표시되지 않습니다.';
  }
  if (label.includes('gnd') || label.includes('ground')) {
    return 'GND로 돌아오는 경로가 끊겨 닫힌 전류 경로를 만들 수 없습니다.';
  }
  return '해당 신호 경로가 끊겨 회로 동작과 전류 흐름을 검증할 수 없습니다.';
}

function koreanSignalLabel(signal: string) {
  const labels: Record<string, string> = {
    power: '전원',
    ground: '접지',
    'i2c-data': 'I2C 데이터',
    'i2c-clock': 'I2C 클록',
    gpio: '디지털 신호',
    digital: '디지털 신호',
    connection: '배선',
    pin: '핀',
    part: '부품'
  };
  return labels[signal] ?? signal;
}

function englishResponse(
  target: TutorMessageRequest['target'],
  artifacts: TutorMessageRequest['artifacts'],
  flags: { wantsMissing: boolean; wantsCurrent: boolean; wantsCheck: boolean }
) {
  if (flags.wantsMissing) {
    return `Grounded in the validated circuit, if ${target.label} is missing: ${target.missing}`;
  }
  if (flags.wantsCurrent) {
    if (!hasValidatedSimulation(artifacts)) {
      const reason = simulationBlockReason(artifacts);
      return `${target.label} can only be explained as flowing current when the circuit and simulation are valid. Simulation is ${artifacts.simulationPlan.status}, so current animation is blocked. Validation status: ${artifacts.validationReport.status}.${reason ? ` Reason: ${reason}` : ''}`;
    }
    return `${target.label} can be explained from the validated ${target.signal ?? target.type} simulation context. ${target.detail ?? target.summary} Current needs a closed path from supply, through the load, and back to ground.`;
  }
  if (flags.wantsCheck) {
    return `To check ${target.label}, match the pin names and signal type against the validated circuit spec first. ${target.detail ?? target.summary}`;
  }
  return `${target.label}: ${target.summary} ${target.why}`;
}

function hasValidatedSimulation(artifacts: TutorMessageRequest['artifacts']) {
  return artifacts.validationReport.status === 'valid' && artifacts.simulationPlan.status === 'valid';
}

function simulationBlockReason(artifacts: TutorMessageRequest['artifacts']) {
  return artifacts.simulationPlan.warnings.find((warning) =>
    /SIMULATION_BLOCKED_BY_RENDER_DRC|BREADBOARD_.*CONFLICT/.test(warning)
  ) ?? artifacts.simulationPlan.warnings[0] ?? null;
}

function artifactGrounding(artifacts: TutorMessageRequest['artifacts']) {
  return [
    `validation:${artifacts.validationReport.status}`,
    `simulation:${artifacts.simulationPlan.status}`,
    ...artifacts.validationReport.validatedCurrentPathIds.map((id) => `validated-current-path:${id}`),
    ...artifacts.simulationPlan.currentPaths.map((path) => `current-path:${path.id}`),
    ...simulationWarningGrounding(artifacts.simulationPlan.warnings),
    ...artifacts.contextTrace.map((entry) => entry.sourceId)
  ];
}

function ledGroundingForArtifacts(artifacts: TutorMessageRequest['artifacts']) {
  const componentGrounding = artifacts.circuitSpec.components
    .filter((component) => /\bled\b|led-/i.test(`${component.id} ${component.partId} ${component.label}`))
    .map((component) => `component:${component.id}`);
  const currentPathGrounding = artifacts.simulationPlan.currentPaths
    .filter((path) => /\bled\b|led-/i.test(`${path.id} ${path.label} ${path.through.join(' ')}`))
    .map((path) => `current-path:${path.id}`);

  return uniqueStrings([...componentGrounding, ...currentPathGrounding]);
}

function simulationWarningGrounding(warnings: string[]) {
  return warnings
    .map((warning) => warning.split(':')[0]?.trim())
    .filter((code): code is string => Boolean(code))
    .map((code) => `simulation-warning:${code}`);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
