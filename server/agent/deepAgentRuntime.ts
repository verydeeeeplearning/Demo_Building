import { randomUUID } from 'node:crypto';

import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent, type SubAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import { z } from 'zod';

import { getPartRegistry, readContextDoc } from '../context/contextLayer.ts';
import { buildContextPacket } from '../context/contextPacket.ts';
import {
  applyCandidatePartGate,
  buildNetlist,
  compileRenderPlan,
  compileRequirementMarkdown,
  compileSimulationPlan,
  estimateCurrentPaths,
  applyContextCoverageGate,
  validateCircuitSpec
} from './circuitTools.ts';
import { createHeduwareAgentTools } from './deepAgentTools.ts';
import {
  AgentEventSchema,
  AgentMessageRequestSchema,
  AgentRunResultSchema,
  CircuitSpecSchema,
  type AgentEvent,
  type AgentMessageRequest,
  type AgentRunResult,
  type CircuitSpec
} from './schemas.ts';

const LiveAgentDraftSchema = z.object({
  assistantMessage: z.string().min(1),
  clarification: z.string().nullable().default(null),
  circuitSpec: CircuitSpecSchema,
  agentEvents: z.array(AgentEventSchema).default([])
});

type LiveAgentDraft = z.infer<typeof LiveAgentDraftSchema>;
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type DraftProviderInput = {
  attempt: number;
  previousErrors: string[];
};
type DraftProvider = (input: DraftProviderInput) => Promise<LiveAgentDraft>;

export class AgentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigurationError';
  }
}

export class AgentStructuredOutputError extends Error {
  readonly errorCode = 'AGENT_STRUCTURED_OUTPUT_MISSING';

  constructor(message = 'Deepagents did not return a structured circuit draft.') {
    super(message);
    this.name = 'AgentStructuredOutputError';
  }
}

export async function runAgent(request: AgentMessageRequest): Promise<AgentRunResult> {
  return runLiveAgent({ ...request, mode: 'live' });
}

export async function runAgentWithScriptedDrafts(input: {
  request: AgentMessageRequest;
  drafts: unknown[];
  sessionId?: string;
}): Promise<AgentRunResult> {
  const request = AgentMessageRequestSchema.parse({ ...input.request, mode: 'live' });
  const sessionId = input.sessionId ?? `session-${randomUUID()}`;
  const contextPacket = await buildContextPacket(request);
  let draftIndex = 0;

  return runAgentDraftRepairLoop({
    sessionId,
    request,
    contextPacket,
    draftProvider: async () => {
      if (draftIndex >= input.drafts.length) {
        throw new Error('Scripted draft provider ran out of drafts before the repair loop completed.');
      }
      const draft = LiveAgentDraftSchema.parse(input.drafts[draftIndex]);
      draftIndex += 1;
      return draft;
    }
  });
}

export function agentRuntimeHealth() {
  const model = process.env.H_EDUWARE_AGENT_MODEL ?? null;
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const configured = Boolean(model && hasOpenAiKey);

  return {
    ok: configured,
    mode: 'live',
    defaultMode: configured ? 'deepagents-live' : 'deepagents-unconfigured',
    provider: 'openai',
    model,
    hasServerKey: hasOpenAiKey,
    requiredEnv: ['OPENAI_API_KEY', 'H_EDUWARE_AGENT_MODEL']
  };
}

async function runLiveAgent(request: AgentMessageRequest): Promise<AgentRunResult> {
  const { apiKey, modelName } = requireLiveConfig();
  const sessionId = request.sessionId ?? `session-${randomUUID()}`;
  const contextPacket = await buildContextPacket(request);
  const [rules, coordinatorPrompt] = await Promise.all([
    readContextDoc('agent-operating-memory'),
    readContextDoc('context-index')
  ]);
  const registrySummary = buildRegistrySummary(contextPacket.candidateParts);

  const model = new ChatOpenAI({
    model: modelName,
    apiKey,
    ...modelGenerationOptions(modelName)
  });

  const agent = createDeepAgent({
    model,
    tools: createHeduwareAgentTools({
      contextCoverage: contextPacket.contextCoverage,
      candidateParts: contextPacket.candidateParts,
      allowedContextSourceIds: contextPacket.retrievalPlan.sourceIds
    }),
    subagents: createSubagents({
      contextCoverage: contextPacket.contextCoverage,
      candidateParts: contextPacket.candidateParts,
      allowedContextSourceIds: contextPacket.retrievalPlan.sourceIds
    }),
    responseFormat: toolStrategy(LiveAgentDraftSchema),
    systemPrompt: buildSystemPrompt({
      locale: request.locale ?? 'ko',
      rules,
      coordinatorPrompt,
      registrySummary,
      contextPacketBlock: contextPacket.promptBlock
    }),
    name: 'h-eduware-deepagent'
  });

  return runAgentDraftRepairLoop({
    sessionId,
    request,
    contextPacket,
    draftProvider: async ({ attempt, previousErrors }) => {
      const output = await agent.invoke({
        messages: [{
          role: 'user',
          content: buildAgentUserPrompt(request, { attempt, previousErrors })
        }]
      }, {
        configurable: {
          thread_id: sessionId
        }
      });
      return parseLiveAgentDraft(output);
    }
  });
}

function requireLiveConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.H_EDUWARE_AGENT_MODEL;

  if (!apiKey || !modelName) {
    throw new AgentConfigurationError(
      'Deepagents live mode requires OPENAI_API_KEY and H_EDUWARE_AGENT_MODEL on the server process.'
    );
  }

  return { apiKey, modelName };
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

async function finalizeAgentResult({
  sessionId,
  request,
  draft,
  contextPacket,
  repairEvents = []
}: {
  sessionId: string;
  request: AgentMessageRequest;
  draft: LiveAgentDraft;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  repairEvents?: AgentEvent[];
}): Promise<AgentRunResult> {
  const circuitSpec = normalizePhysicalCircuitSpec(CircuitSpecSchema.parse(draft.circuitSpec));
  const validationReport = applyCandidatePartGate(
    await validateCircuitSpec(circuitSpec),
    circuitSpec,
    contextPacket.candidateParts
  );
  const effectiveValidationReport = applyContextCoverageGate(validationReport, contextPacket.contextCoverage);
  const netlist = await buildNetlist(circuitSpec);
  const currentPaths = await estimateCurrentPaths(circuitSpec, netlist, effectiveValidationReport);
  const renderPlan = await compileRenderPlan(circuitSpec, effectiveValidationReport);
  const simulationPlan = await compileSimulationPlan(circuitSpec, effectiveValidationReport, currentPaths, renderPlan);
  const requirementMarkdown = await compileRequirementMarkdown(circuitSpec, effectiveValidationReport, simulationPlan);
  const clarification = effectiveValidationReport.status === 'valid'
    ? null
    : draft.clarification ?? firstCoverageClarification(contextPacket.contextCoverage, request.locale ?? 'ko') ?? firstClarification(circuitSpec, request.locale ?? 'ko');
  const assistantMessage = finalAssistantMessage({
    draftMessage: draft.assistantMessage,
    validationReport: effectiveValidationReport,
    clarification,
    locale: request.locale ?? 'ko'
  });

  return AgentRunResultSchema.parse({
    sessionId,
    mode: 'live',
    assistantMessages: [assistantMessage],
    agentEvents: normalizeEvents([
      { type: 'coordinator', name: 'deepagents-coordinator', status: 'completed', summary: 'Created structured circuit draft through Deepagents.' },
      ...repairEvents,
      ...draft.agentEvents,
      { type: 'validation', name: 'context-coverage-gate', status: contextPacket.contextCoverage.status === 'sufficient' ? 'completed' : 'warning', summary: contextPacket.contextCoverage.status },
      { type: 'validation', name: 'server-validator', status: effectiveValidationReport.status === 'valid' ? 'completed' : 'warning', summary: effectiveValidationReport.status }
    ]),
    clarification,
    contextTrace: contextPacket.contextTrace,
    contextCoverage: contextPacket.contextCoverage,
    requirementMarkdown,
    circuitSpec,
    validationReport: effectiveValidationReport,
    renderPlan,
    simulationPlan
  });
}

function finalAssistantMessage({
  draftMessage,
  validationReport,
  clarification,
  locale
}: {
  draftMessage: string;
  validationReport: AgentRunResult['validationReport'];
  clarification: string | null;
  locale: 'ko' | 'en';
}) {
  if (validationReport.status !== 'invalid') {
    return draftMessage;
  }

  const reason = studentValidationReason(validationReport.errors, locale);
  if (locale === 'ko') {
    return [
      '아직 이 회로를 안전하게 확정할 수 없어요.',
      `회로 검증에서 ${reason}`,
      clarification ? `다음 단계: ${clarification}` : '부품, 핀, 전원, 접지 조건을 바로잡은 뒤 다시 회로를 확정해야 합니다.'
    ].join(' ');
  }

  return [
    'I could not safely finalize this circuit.',
    `Validation found ${reason}`,
    clarification ? `Next step: ${clarification}` : 'Fix the parts, pins, power, and ground assumptions before building it.'
  ].join(' ');
}

function studentValidationReason(errors: string[], locale: 'ko' | 'en') {
  const joined = errors.join('\n');
  if (/CONTEXT_CANDIDATE_PART_NOT_ALLOWED/.test(joined)) {
    return locale === 'ko'
      ? '현재 요청 범위에 포함되지 않은 부품이 초안에 들어간 문제가 확인됐습니다.'
      : 'a part that was not selected for the current request.';
  }
  if (/UNKNOWN_PIN/.test(joined)) {
    return locale === 'ko'
      ? '존재하지 않는 핀을 사용하는 문제가 확인됐습니다.'
      : 'a connection to a pin that does not exist on the selected part.';
  }
  if (/LED_WITHOUT_RESISTOR|LED_RESISTOR|LED_SERIES/.test(joined)) {
    return locale === 'ko'
      ? 'LED 전류 제한 저항 또는 직렬 전류 경로 문제가 확인됐습니다.'
      : 'an LED current-limiting resistor or closed series path problem.';
  }
  if (/DIRECT_POWER_SHORT/.test(joined)) {
    return locale === 'ko'
      ? '전원과 접지가 직접 연결되는 단락 문제가 확인됐습니다.'
      : 'a direct short between power and ground.';
  }
  if (/MISSING_COMMON_GROUND/.test(joined)) {
    return locale === 'ko'
      ? '공통 접지 경로가 빠진 문제가 확인됐습니다.'
      : 'a missing common ground return path.';
  }
  return locale === 'ko'
    ? '수정이 필요한 배선 또는 부품 문제가 확인됐습니다.'
    : 'a wiring or part issue that must be fixed first.';
}

async function runAgentDraftRepairLoop({
  sessionId,
  request,
  contextPacket,
  draftProvider,
  maxAttempts = 2
}: {
  sessionId: string;
  request: AgentMessageRequest;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  draftProvider: DraftProvider;
  maxAttempts?: number;
}): Promise<AgentRunResult> {
  const unsupportedPreflightDraft = buildUnsupportedPreflightDraft(request, contextPacket);
  if (unsupportedPreflightDraft) {
    return finalizeAgentResult({
      sessionId,
      request,
      draft: unsupportedPreflightDraft,
      contextPacket
    });
  }

  const repairEvents: AgentEvent[] = [];
  let previousErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const draft = await draftProvider({ attempt, previousErrors });
    const finalized = await finalizeAgentResult({
      sessionId,
      request,
      draft,
      contextPacket,
      repairEvents
    });

    if (finalized.validationReport.status === 'valid' || !shouldAttemptValidationRepair(finalized)) {
      return finalized;
    }

    previousErrors = finalized.validationReport.errors;
    if (attempt < maxAttempts) {
      repairEvents.push(validationRepairEvent(attempt, maxAttempts, previousErrors));
      continue;
    }

    return appendAgentEvents(finalized, [
      validationRepairExhaustedEvent(maxAttempts, previousErrors)
    ]);
  }

  throw new Error('Agent repair loop exited without a finalized result.');
}

function buildUnsupportedPreflightDraft(
  request: AgentMessageRequest,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>
): LiveAgentDraft | null {
  const supportGaps = uniqueStrings(contextPacket.supportGaps);
  const unsupportedSignals = uniqueStrings(contextPacket.unsupportedSignals);
  const isUnsupportedSafetyRoute = contextPacket.contextRoute.routeId === 'unsupported-safety';
  const hasUnsupportedCapability = contextPacket.capabilityMatches.some((capability) =>
    capability.supportLevel === 'unsupported'
  );

  const isPlannedContextGap = supportGaps.length > 0 && !isUnsupportedSafetyRoute && !hasUnsupportedCapability;

  if (!isUnsupportedSafetyRoute && !hasUnsupportedCapability && unsupportedSignals.length === 0 && supportGaps.length === 0) {
    return null;
  }

  const locale = request.locale ?? 'ko';
  const blockedItems = uniqueStrings([...unsupportedSignals, ...supportGaps]);
  const unsupportedItems = isPlannedContextGap
    ? supportGaps
    : blockedItems.length > 0
      ? blockedItems
    : ['unsupported or unsafe request outside the low-voltage classroom scope'];
  const safeAlternative = locale === 'ko'
    ? 'Arduino 5V, GND, 220Ω 저항, LED처럼 안전한 저전압 회로로 바꾸면 설계와 시뮬레이션을 진행할 수 있습니다.'
    : 'I can help reframe this as a safe low-voltage Arduino circuit, such as Arduino 5V, GND, a 220 ohm resistor, and an LED.';
  const safetyMessage = locale === 'ko'
    ? `이 요청은 감전이나 화재 위험이 있는 고전압/지원불가 회로라서 배선도나 시뮬레이션으로 만들 수 없습니다. ${safeAlternative}`
    : `This request is unsafe or unsupported for a student breadboard simulation, so I cannot turn it into wiring or a runnable circuit. ${safeAlternative}`;
  const supportGapMessage = `This request matches planned H-eduware hardware, but the canonical context bundle is not ready for validated wiring, rendering, or current simulation yet. Missing support evidence: ${unsupportedItems.join(' | ')}.`;
  const assistantMessage = localizedPreflightMessage({
    locale,
    isPlannedContextGap,
    unsupportedItems,
    fallbackSafetyMessage: safetyMessage,
    fallbackSupportGapMessage: supportGapMessage
  });
  const safetyClarification = locale === 'ko'
    ? '안전한 저전압 Arduino 회로로 바꾸려면 원하는 입력과 출력 동작을 다시 알려 주세요.'
    : 'Tell me the low-voltage Arduino input and output behavior you want to build instead.';
  const supportGapClarification = locale === 'ko'
    ? '현재 지원되는 회로를 선택하거나, 이 부품을 지원하기 위한 부품 정보와 검증/렌더링/시뮬레이션 자료를 먼저 추가해야 합니다.'
    : 'Choose a currently supported circuit, or add the missing canonical context bundle before validated synthesis.';
  const clarification = isPlannedContextGap ? supportGapClarification : safetyClarification;

  return LiveAgentDraftSchema.parse({
    assistantMessage,
    clarification,
    circuitSpec: {
      id: 'unsupported-safety-request',
      title: locale === 'ko' ? '지원하지 않는 안전 위험 요청' : 'Unsupported safety-risk request',
      intent: {
        primaryGoal: request.message,
        output: 'unsupported',
        controller: 'none',
        behavior: 'unsafe-or-unsupported'
      },
      components: [{
        id: 'arduino-uno',
        partId: 'arduino-uno',
        label: 'Arduino Uno',
        designator: 'U1'
      }],
      connections: [],
      behavior: { runText: 'UNSUPPORTED' },
      assumptions: [
        'H-eduware only simulates safe, low-voltage educational breadboard circuits.',
        `Context route: ${contextPacket.contextRoute.routeId}.`
      ],
      unsupportedItems,
      clarificationNeeds: [clarification]
    },
    agentEvents: [
      {
        type: 'coordinator',
        name: 'context-router',
        status: 'completed',
        summary: `Blocked before synthesis via ${contextPacket.contextRoute.routeId}.`
      },
      {
        type: 'validation',
        name: isPlannedContextGap ? 'context-support-gap' : 'safety-policy',
        status: 'warning',
        summary: isPlannedContextGap
          ? `Planned capability lacks canonical context for valid synthesis: ${unsupportedItems.join(', ')}.`
          : `Unsupported or unsafe signals: ${unsupportedItems.join(', ')}.`
      }
    ]
  });
}

function localizedPreflightMessage({
  locale,
  isPlannedContextGap,
  unsupportedItems,
  fallbackSafetyMessage,
  fallbackSupportGapMessage
}: {
  locale: 'ko' | 'en';
  isPlannedContextGap: boolean;
  unsupportedItems: string[];
  fallbackSafetyMessage: string;
  fallbackSupportGapMessage: string;
}) {
  if (locale !== 'ko') {
    return isPlannedContextGap ? fallbackSupportGapMessage : fallbackSafetyMessage;
  }

  if (isPlannedContextGap) {
    const itemSummary = summarizeUnsupportedItemsForKorean(unsupportedItems);
    return `요청한 ${itemSummary}은 앱의 부품 목록에는 보이지만, 아직 검증 가능한 회로로 만들 준비가 끝나지 않았습니다. 정확한 배선, 3D 배치, 전류 시뮬레이션에 필요한 부품 정보와 검증 규칙이 더 필요합니다. 현재 지원되는 Arduino Uno 기반 LED, 버튼, OLED, 부저, 서보 회로 중 하나로 바꾸면 바로 설계할 수 있습니다.`;
  }

  return '이 요청은 감전이나 화재 위험이 있는 고전압/위험 부하 회로라서 브레드보드 배선이나 실행 가능한 시뮬레이션으로 만들 수 없습니다. Arduino 5V, GND, 220 ohm 저항, LED처럼 안전한 저전압 회로로 바꾸면 설계와 시뮬레이션을 진행할 수 있습니다.';
}

function summarizeUnsupportedItemsForKorean(items: string[]) {
  const names = uniqueStrings(items.map(friendlyUnsupportedItemName).filter(Boolean));
  if (names.length === 0) {
    return '부품 또는 동작';
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' 등' : ''}`;
}

function friendlyUnsupportedItemName(item: string) {
  const parenthetical = item.match(/\(([^)]+)\)/)?.[1]?.trim();
  if (parenthetical) {
    return parenthetical;
  }

  const visualPartId = item.match(/visual-only hardware ([^\s]+)/i)?.[1]?.trim();
  if (visualPartId) {
    return visualPartId;
  }

  const capabilityId = item.match(/^([a-z0-9-]+) is (planned|partial|unsupported)/i)?.[1]?.trim();
  if (capabilityId) {
    return capabilityId;
  }

  if (/high-voltage|mains|220\s*v|220v/i.test(item)) {
    return '고전압 전원';
  }
  if (/heater|thermal|hazardous/i.test(item)) {
    return '히터 같은 위험 부하';
  }

  return item.split('.')[0]?.trim().slice(0, 80) ?? '';
}

function normalizePhysicalCircuitSpec(spec: CircuitSpec): CircuitSpec {
  if (
    spec.unsupportedItems.length > 0 ||
    spec.components.some((component) => component.partId === 'breadboard-half') ||
    !spec.components.some((component) => component.partId === 'arduino-uno')
  ) {
    return spec;
  }

  const breadboardId = spec.components.some((component) => component.id === 'breadboard')
    ? 'breadboard-1'
    : 'breadboard';

  return CircuitSpecSchema.parse({
    ...spec,
    components: [
      {
        id: breadboardId,
        partId: 'breadboard-half',
        label: 'Half-size breadboard',
        designator: 'BB1'
      },
      ...spec.components
    ],
    assumptions: uniqueStrings([
      ...spec.assumptions,
      'A half-size breadboard is used as the classroom build surface.'
    ])
  });
}

export function parseLiveAgentDraft(output: unknown): LiveAgentDraft {
  const candidate = output && typeof output === 'object'
    ? (output as Record<string, unknown>).structuredResponse ?? (output as Record<string, unknown>).structured_response
    : null;

  if (!candidate) {
    throw new AgentStructuredOutputError();
  }

  return LiveAgentDraftSchema.parse(candidate);
}

function buildSystemPrompt({
  locale,
  rules,
  coordinatorPrompt,
  registrySummary,
  contextPacketBlock
}: {
  locale: 'ko' | 'en';
  rules: string;
  coordinatorPrompt: string;
  registrySummary: string;
  contextPacketBlock: string;
}) {
  const language = locale === 'ko' ? 'Korean' : 'English';

  return [
    coordinatorPrompt,
    rules,
    `Respond to the student in natural ${language}.`,
    'You are building educational, low-voltage Arduino/breadboard circuits for students.',
    'You must use the request-specific CONTEXT PACKET below as the first source of truth. Do not synthesize hardware outside that packet.',
    'You must use canonical part ids and pin names from context. Do not invent component ids, part ids, pins, protocols, or simulator capabilities.',
    'If the request is too vague, unsafe, or outside the supported registry, return a CircuitSpec with unsupportedItems and clarificationNeeds instead of a fake circuit.',
    'Before finalizing, use context and deterministic tools where useful: search_part_capabilities, validate_circuit_spec, build_netlist, estimate_current_paths, compile_render_plan, compile_simulation_plan, and compile_requirement_markdown.',
    'The final structured response must contain assistantMessage, clarification, circuitSpec, and concise agentEvents. The server will independently validate and compile artifacts after your draft.',
    '',
    contextPacketBlock,
    '',
    'Supported canonical parts:',
    registrySummary
  ].join('\n');
}

export function buildAgentUserPrompt(
  request: AgentMessageRequest,
  repair?: { attempt: number; previousErrors: string[] }
) {
  const lines = [
    `Student message: ${request.message}`,
    request.confirmation ? `Student confirmation/context: ${request.confirmation}` : '',
    renderConversationContextForPrompt(request),
    'Return a validated-ready circuit draft if possible. If not possible, ask one targeted clarification and mark unsupported/clarification needs explicitly.'
  ].filter(Boolean);

  if (repair && repair.attempt > 1 && repair.previousErrors.length > 0) {
    lines.push(
      `Repair attempt ${repair.attempt}: the previous draft failed deterministic server validation.`,
      'Repair only by returning a new CircuitSpec grounded in the same context packet. Do not invent parts, pins, protocols, or simulator behavior.',
      `Previous validation errors:\n${repair.previousErrors.map((error) => `- ${error}`).join('\n')}`
    );
  }

  return lines.join('\n');
}

function renderConversationContextForPrompt(request: AgentMessageRequest) {
  const context = request.conversationContext;
  if (!context) {
    return '';
  }

  const artifact = context.currentArtifact;
  const lines = [
    'Conversation grounding:',
    context.lastSupportedGoal ? `- Last supported goal: ${context.lastSupportedGoal}` : '',
    `- Awaiting build confirmation: ${context.awaitingBuildConfirmation ? 'yes' : 'no'}`,
    artifact ? `- Current artifact: ${artifact.title} (${artifact.source})` : '',
    artifact?.circuitSpec?.intent?.primaryGoal ? `- Current artifact goal: ${artifact.circuitSpec.intent.primaryGoal}` : '',
    artifact?.circuitSpec?.components?.length ? `- Current artifact parts: ${artifact.circuitSpec.components.map((component) => component.partId).join(', ')}` : '',
    artifact?.validationReport?.status ? `- validationStatus=${artifact.validationReport.status}` : '',
    artifact?.simulationPlan?.status ? `- simulationStatus=${artifact.simulationPlan.status}` : ''
  ].filter(Boolean);

  if (context.recentTurns.length > 0) {
    lines.push(
      'Recent conversation:',
      ...context.recentTurns.slice(-6).map((turn) => `- ${turn.role}: ${turn.text}`)
    );
  }

  return lines.join('\n');
}

function buildRegistrySummary(parts: Awaited<ReturnType<typeof getPartRegistry>>) {
  if (parts.length === 0) {
    return 'No canonical hardware registry entries were selected for this route. Ask a clarification or mark unsupported instead of inventing parts.';
  }

  return parts.map((part) => [
    `- ${part.id} (${part.label})`,
    `kind=${part.kind}`,
    `aliases=${part.aliases.join(', ') || 'none'}`,
    `pins=${part.pins.map((pin) => `${pin.name}:${pin.role}`).join(', ')}`,
    `protocols=${part.protocols.join(', ') || 'none'}`,
    `limits=${part.electrical.voltageRange.nominal}V nominal, ${part.electrical.maxCurrentMa}mA max`,
    `requires=${part.requiredPassives.map((passive) => passive.partId).join(', ') || 'none'}`
  ].join('; ')).join('\n');
}

function createSubagents(toolOptions: Parameters<typeof createHeduwareAgentTools>[0] = {}): SubAgent[] {
  const tools = () => createHeduwareAgentTools(toolOptions);
  return [
    {
      name: 'intent-analyst',
      description: 'Extracts the student goal, input/output behavior, assumptions, ambiguity, and safety concerns.',
      systemPrompt: 'Analyze the student request into concise intent facts. Return only facts needed for CircuitSpec drafting.'
    },
    {
      name: 'context-retriever',
      description: 'Retrieves H-eduware context-layer docs and registry facts.',
      systemPrompt: 'Use load_context_index, read_context_doc, and search_part_capabilities. Return concise cited facts, not long copied context.',
      tools: tools()
    },
    {
      name: 'circuit-synthesizer',
      description: 'Drafts candidate CircuitSpec objects from intent and canonical registry data.',
      systemPrompt: 'Draft CircuitSpec only with supported part ids and exact pin names. Do not claim validity.'
    },
    {
      name: 'constraint-validator',
      description: 'Reviews deterministic validation, netlist, safety, and unsupported status.',
      systemPrompt: 'Call validation tools and report authoritative errors/warnings without rewriting them.',
      tools: tools()
    },
    {
      name: 'simulation-planner',
      description: 'Plans current-flow and expected state simulation from validated circuit artifacts.',
      systemPrompt: 'Only produce current-flow statements from valid validation and netlist/current path tool outputs.',
      tools: tools()
    },
    {
      name: 'lesson-explainer',
      description: 'Creates student-facing explanation text for the final assistant response.',
      systemPrompt: 'Explain the circuit in student-friendly language. Keep it concise and avoid unsupported claims.'
    }
  ];
}

function normalizeEvents(events: Array<z.infer<typeof AgentEventSchema>>): AgentEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.type}:${event.name}:${event.status}:${event.summary ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function shouldAttemptValidationRepair(result: AgentRunResult) {
  if (result.validationReport.status !== 'invalid') {
    return false;
  }

  return !result.validationReport.errors.some((error) =>
    error.startsWith('CONTEXT_COVERAGE_INSUFFICIENT') ||
    error.startsWith('CONTEXT_CANDIDATE_PART_NOT_ALLOWED')
  );
}

function validationRepairEvent(attempt: number, maxAttempts: number, errors: string[]): AgentEvent {
  return AgentEventSchema.parse({
    type: 'validation',
    name: 'validation-repair',
    status: 'warning',
    summary: `Attempt ${attempt}/${maxAttempts} failed deterministic validation: ${summarizeValidationErrors(errors)}`
  });
}

function validationRepairExhaustedEvent(maxAttempts: number, errors: string[]): AgentEvent {
  return AgentEventSchema.parse({
    type: 'validation',
    name: 'validation-repair-exhausted',
    status: 'warning',
    summary: `Stopped after ${maxAttempts} bounded validation attempts: ${summarizeValidationErrors(errors)}`
  });
}

function appendAgentEvents(result: AgentRunResult, events: AgentEvent[]) {
  return AgentRunResultSchema.parse({
    ...result,
    agentEvents: normalizeEvents([
      ...result.agentEvents,
      ...events
    ])
  });
}

function summarizeValidationErrors(errors: string[]) {
  return errors.length > 0
    ? errors.join(' | ')
    : 'unknown validation failure';
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function firstClarification(spec: CircuitSpec, locale: 'ko' | 'en') {
  const fallback = locale === 'ko'
    ? '회로를 안전하게 확정하려면 입력, 출력, 전원 조건을 조금 더 알려주세요.'
    : 'I need the input, output, and power assumptions before I can safely finalize this circuit.';
  return spec.clarificationNeeds[0] ?? spec.unsupportedItems[0] ?? fallback;
}

function firstCoverageClarification(
  contextCoverage: Awaited<ReturnType<typeof buildContextPacket>>['contextCoverage'],
  locale: 'ko' | 'en'
) {
  if (contextCoverage.status === 'sufficient') {
    return null;
  }

  const firstWarning = contextCoverage.warnings[0];
  if (locale === 'ko') {
    return firstWarning
      ? `이 회로를 확정하기에는 컨텍스트 근거가 부족합니다: ${firstWarning}`
      : '이 회로를 확정하기에는 컨텍스트 근거가 부족합니다. 지원 부품, 검증 규칙, 렌더링 근거를 더 확인해야 합니다.';
  }

  return firstWarning
    ? `I need more canonical context before finalizing this circuit: ${firstWarning}`
    : 'I need more canonical context before finalizing this circuit.';
}
