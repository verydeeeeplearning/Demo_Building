import { randomUUID } from 'node:crypto';

import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import { z } from 'zod';

import {
  TutorMessageResponseSchema,
  type TutorMessageRequest,
  type TutorMessageResponse
} from './schemas.ts';

const LiveTutorDraftSchema = z.object({
  message: z.string().min(1),
  suggestedQuestions: z.array(z.string().min(1)).default([])
});

type LiveTutorDraft = z.infer<typeof LiveTutorDraftSchema>;
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type TutorRuntimeMode = 'auto' | 'live' | 'local';
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
};

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
  const localResponse = buildLocalTutorResponse(request);
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
      fallbackCategory: 'configuration'
    });
  }

  try {
    const draft = options.liveDraftProvider
      ? await options.liveDraftProvider({
        request,
        localResponse,
        traceId: options.traceId,
        runName: options.runName,
        tags: options.tags,
        metadata: options.metadata
      })
      : await runLiveTutorDraft(request, localResponse, options);
    const parsed = LiveTutorDraftSchema.parse(draft);
    return TutorMessageResponseSchema.parse({
      ...localResponse,
      mode: 'live',
      servingStatus: 'live_tutor_answer',
      runtimeMode: runtime.runtimeMode,
      liveConfigured: runtime.liveConfigured,
      liveAttempted: true,
      message: parsed.message,
      grounding: uniqueStrings([...localResponse.grounding, 'live-deepagents-tutor']),
      suggestedQuestions: parsed.suggestedQuestions.length > 0
        ? parsed.suggestedQuestions
        : localResponse.suggestedQuestions
    });
  } catch (error) {
    return TutorMessageResponseSchema.parse({
      ...localResponse,
      servingStatus: 'live_tutor_fallback',
      fallbackReason: redactTutorFallbackReason(error),
      runtimeMode: runtime.runtimeMode,
      liveConfigured: runtime.liveConfigured,
      liveAttempted: true,
      fallbackCategory: error instanceof z.ZodError ? 'structured-output' : 'live-failure'
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
    fallbackCategory: options.fallbackCategory
  });
}

function buildLocalTutorResponse(request: TutorMessageRequest): TutorMessageResponse {
  const locale = request.locale === 'en' ? 'en' : 'ko';
  const target = request.target;
  const artifacts = request.artifacts;
  const flags = classifyTutorQuestion(request.question);

  return TutorMessageResponseSchema.parse({
    sessionId: request.sessionId ?? `tutor-${randomUUID()}`,
    mode: 'local',
    servingStatus: 'local_tutor_answer',
    message: locale === 'ko'
      ? koreanResponse(target, artifacts, flags)
      : englishResponse(target, artifacts, flags),
    grounding: [
      target.id,
      target.type,
      target.signal,
      ...(target.endpoints ?? []),
      ...artifactGrounding(artifacts)
    ].filter((value): value is string => Boolean(value)),
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
  options: TutorAgentOptions = {}
): Promise<LiveTutorDraft> {
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

  const agent = createDeepAgent({
    model,
    tools: [],
    responseFormat: toolStrategy(LiveTutorDraftSchema),
    systemPrompt: buildLiveTutorSystemPrompt(request),
    name: 'h-eduware-tutor-deepagent'
  });

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
      targetType: request.target.type,
      targetSignal: request.target.signal ?? null,
      selectedTargetId: request.target.id
    },
    configurable: {
      thread_id: request.sessionId ?? `tutor-${randomUUID()}`
    }
  });

  return parseLiveTutorDraft(output);
}

function parseLiveTutorDraft(output: unknown): LiveTutorDraft {
  const candidate = output && typeof output === 'object'
    ? (output as Record<string, unknown>).structuredResponse ?? (output as Record<string, unknown>).structured_response
    : null;
  if (!candidate) {
    throw new Error('Deepagents tutor did not return structured output.');
  }
  return LiveTutorDraftSchema.parse(candidate);
}

function buildLiveTutorSystemPrompt(request: TutorMessageRequest) {
  const language = request.locale === 'en' ? 'English' : 'Korean';
  return [
    'You are the H-eduware circuit tutor for a student inspecting a simulated circuit.',
    `Answer in ${language}.`,
    'Use only the selected target, circuit artifacts, validation report, simulation plan, and context trace in the user message.',
    'Do not invent wiring, pins, current paths, supported hardware, or simulation behavior.',
    'If validation or simulation is not valid, explain the blocker instead of describing current as flowing.',
    'Keep the answer short, concrete, and student-facing. Avoid internal terms such as canonical context, trace, artifact, structured output, or tool call.'
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
    artifacts: {
      circuitSpec: request.artifacts.circuitSpec,
      validationReport: request.artifacts.validationReport,
      simulationPlan: request.artifacts.simulationPlan,
      contextCoverage: request.artifacts.contextCoverage,
      buildRunnableReport: request.artifacts.buildRunnableReport,
      solverGateResult: request.artifacts.solverGateResult,
      contextTrace: request.artifacts.contextTrace
    },
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

function simulationWarningGrounding(warnings: string[]) {
  return warnings
    .map((warning) => warning.split(':')[0]?.trim())
    .filter((code): code is string => Boolean(code))
    .map((code) => `simulation-warning:${code}`);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
