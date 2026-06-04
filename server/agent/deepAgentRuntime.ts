import { randomUUID } from 'node:crypto';

import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createDeepAgent, type SubAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import { MemorySaver, Command } from '@langchain/langgraph';
import { z } from 'zod';

// Short-term conversation memory (LangGraph "Add Short-Term Memory" pattern): one shared in-process
// saver, keyed by thread_id = sessionId. The saver is the state store, so re-constructing the agent
// per request is fine — the same thread accumulates across requests. Production durability (a saver
// that survives restarts) is Phase 4; injectable via AgentRuntimeDeps.checkpointer.
const conversationCheckpointer = new MemorySaver();

import type { AgentRuntimeDeps, DeepAgentFactory, ModelPort } from './agentRuntimePorts.ts';

import { getPartRegistry, loadTopologyTemplates, readContextDoc } from '../context/contextLayer.ts';
import { buildContextPacket } from '../context/contextPacket.ts';
import { getComposeMode } from '../context/composeMode.ts';
import { getAgentPipelineMode } from './agentPipelineMode.ts';
import { assessRequestScope } from './requestScope.ts';
import { createObservabilityMiddleware } from './observabilityMiddleware.ts';
import { runShadowComposition } from '../context/generatedComposition.ts';
import {
  contextPacketLogSummary,
  createAgentTraceId,
  langSmithMetadata,
  llmHandoffLogSummary,
  llmOutputLogSummary,
  logAgentEvent,
  resultLogSummary
} from './agentLogger.ts';
import {
  applyCandidatePartGate,
  buildNetlist,
  buildRunnableReport,
  buildSolverGateResult,
  compileRenderPlan,
  compileRequirementMarkdown,
  compileSimulationPlan,
  estimateCurrentPaths,
  applyContextCoverageGate,
  applyIntentFulfillmentGate,
  validateCircuitSpec
} from './circuitTools.ts';
import { createHeduwareAgentTools } from './deepAgentTools.ts';

type HeduwareAgentToolsOptions = NonNullable<Parameters<typeof createHeduwareAgentTools>[0]>;
import {
  compactBlocksWithinAssembledBudget,
  foldRunningSummary,
  type SystemContextBlocks
} from './contextCompaction.ts';
import {
  deriveRequirementDoc,
  fitBriefToBudget,
  renderRequirementDocSection
} from './circuit/requirementBrief.ts';
import {
  AgentEventSchema,
  AgentMessageRequestSchema,
  AgentRunResultSchema,
  CircuitSpecSchema,
  ClarificationRequestSchema,
  RequirementDocSchema,
  ServingStatusSchema,
  SupportedAlternativeSchema,
  type AgentEvent,
  type AgentMessageRequest,
  type AgentRunResult,
  type BuildRunnableReport,
  type CircuitSpec,
  type ClarificationRequest,
  type ContextCoverageReport,
  type RequirementDoc,
  type SolverGateResult,
  type SupportedAlternative
} from './schemas.ts';

// ReAct decision (LangChain Deep Agents): the synthesis agent itself chooses whether this turn is a
// conversational reply (greeting / general question / recommendation / clarification) or a built
// circuit — official guidance: "the agent may skip tools entirely if it can answer conversationally".
// The schema permits a null circuitSpec so the 'chat' variant needs no spec; the chat-vs-circuit
// INVARIANT (chat => no spec, circuit => spec required) is enforced at runtime in parseLiveAgentDraft,
// which keeps the live toolStrategy contract a single flat object. Default 'circuit' + nullable
// circuitSpec keep every existing scripted/preflight/recovered draft (which supplies a spec) compatible.
export const LiveAgentDraftSchema = z.object({
  responseKind: z.enum(['chat', 'circuit']).default('circuit'),
  assistantMessage: z.string().min(1),
  clarification: z.string().nullable().default(null),
  circuitSpec: CircuitSpecSchema.nullable().default(null),
  agentEvents: z.array(AgentEventSchema).default([]),
  supportedAlternatives: z.array(SupportedAlternativeSchema).default([])
});

const RequirementAnalysisSchema = z.object({
  route: z.enum(['casual_chat', 'clarify_requirements', 'synthesize_circuit', 'unsupported_or_gap']),
  confidence: z.number().min(0).max(1).default(0.5),
  summary: z.string().min(1),
  assistantMessage: z.string().min(1),
  clarification: z.string().nullable().default(null),
  blockingReason: z.string().nullable().default(null),
  circuitGoal: z.object({
    input: z.string().nullable().default(null),
    output: z.string().nullable().default(null),
    behavior: z.string().nullable().default(null),
    controller: z.string().nullable().default(null)
  }).default({
    input: null,
    output: null,
    behavior: null,
    controller: null
  }),
  agentEvents: z.array(AgentEventSchema).default([])
});

type LiveAgentDraft = z.infer<typeof LiveAgentDraftSchema>;
type RequirementAnalysis = z.infer<typeof RequirementAnalysisSchema>;
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type AgentPromptBudgetStage = 'requirement-analysis' | 'synthesis';
type DraftProviderInput = {
  attempt: number;
  previousErrors: string[];
};
type DraftProvider = (input: DraftProviderInput) => Promise<LiveAgentDraft>;
type AgentRunOptions = {
  traceId?: string;
  // Injectable seams (Phase 0.5). Production passes nothing -> real ChatOpenAI + createDeepAgent.
  deps?: AgentRuntimeDeps;
};

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

// Propagates a LangGraph interrupt (the agent called ask_to_narrow and the graph paused) out of the
// repair loop so runLiveAgent can return an awaiting_input result instead of a circuit draft.
class AgentInterruptSignal extends Error {
  readonly payload: ClarificationRequest;

  constructor(payload: ClarificationRequest) {
    super('Agent paused for clarification.');
    this.name = 'AgentInterruptSignal';
    this.payload = payload;
  }
}

export class AgentPromptBudgetError extends Error {
  readonly errorCode = 'AGENT_PROMPT_BUDGET_EXCEEDED';
  readonly stage: AgentPromptBudgetStage;
  readonly actualChars: number;
  readonly maxChars: number;

  constructor(stage: AgentPromptBudgetStage, actualChars: number, maxChars: number) {
    super(`Deepagents ${stage} prompt exceeded budget: ${actualChars}/${maxChars} chars.`);
    this.name = 'AgentPromptBudgetError';
    this.stage = stage;
    this.actualChars = actualChars;
    this.maxChars = maxChars;
  }
}

export async function runAgent(request: AgentMessageRequest, options: AgentRunOptions = {}): Promise<AgentRunResult> {
  return runLiveAgent({ ...request, mode: 'live' }, options);
}

export async function runAgentWithScriptedDrafts(input: {
  request: AgentMessageRequest;
  drafts: unknown[];
  sessionId?: string;
  requirementAnalysis?: unknown;
  // Optional overrides (Phase 4 throw-path tests): inject a draft provider directly (e.g. one that
  // throws AgentStructuredOutputError) and enable the deterministic structured-output fallback.
  draftProvider?: DraftProvider;
  structuredOutputFallback?: boolean;
}): Promise<AgentRunResult> {
  const request = AgentMessageRequestSchema.parse({ ...input.request, mode: 'live' });
  const sessionId = input.sessionId ?? `session-${randomUUID()}`;
  const traceId = createAgentTraceId('scripted-agent');
  const contextPacket = await buildContextPacket(request);
  const requirementAnalysis = input.requirementAnalysis
    ? RequirementAnalysisSchema.parse(input.requirementAnalysis)
    : defaultScriptedRequirementAnalysis(request);
  let draftIndex = 0;

  const scriptedProvider: DraftProvider = async () => {
    if (draftIndex >= input.drafts.length) {
      throw new Error('Scripted draft provider ran out of drafts before the repair loop completed.');
    }
    const draft = LiveAgentDraftSchema.parse(input.drafts[draftIndex]);
    draftIndex += 1;
    return draft;
  };

  return runAgentDraftRepairLoop({
    traceId,
    sessionId,
    request,
    contextPacket,
    requirementAnalysis,
    draftProvider: input.draftProvider ?? scriptedProvider,
    structuredOutputFallback: input.structuredOutputFallback
  });
}

// Phase 3 — deterministic intent derivation. Replaces the requirement-analysis LLM call (the first
// of two createDeepAgent runs) with a pure mapping over the context packet's already-deterministic
// signals (anchor invariant 3: intent stays deterministic). Route distribution vs the LLM baseline
// is validated by Phase 6 live smoke; the corpus locks the structural mapping here.
export function deriveRequirementAnalysis(
  request: AgentMessageRequest,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>
): RequirementAnalysis {
  // Single source of truth for the deterministic route: the same read the agent sees via the
  // assess_request_scope tool (Phase 3).
  const scope = assessRequestScope(contextPacket);

  return RequirementAnalysisSchema.parse({
    route: scope.route,
    confidence: scope.buildEligible || scope.unsupported ? 0.9 : 0.6,
    summary: scope.reason,
    assistantMessage: scope.reason,
    clarification: null,
    blockingReason: scope.unsupported
      ? contextPacket.unsupportedSignals[0]
      : scope.route === 'clarify_requirements'
        ? contextPacket.contextCoverage.synthesisEligibility.reason
        : null,
    circuitGoal: {
      input: null,
      output: null,
      behavior: request.message,
      controller: null
    },
    agentEvents: []
  });
}

function defaultScriptedRequirementAnalysis(request: AgentMessageRequest): RequirementAnalysis {
  return RequirementAnalysisSchema.parse({
    route: 'synthesize_circuit',
    confidence: 1,
    summary: 'Scripted test path proceeds directly to circuit synthesis.',
    assistantMessage: 'Proceeding to scripted circuit synthesis.',
    clarification: null,
    blockingReason: null,
    circuitGoal: {
      input: null,
      output: null,
      behavior: request.message,
      controller: null
    },
    agentEvents: []
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

export async function buildAgentPromptBudgetAudits(request: AgentMessageRequest) {
  const pipelineMode = getAgentPipelineMode();
  const contextPacket = await buildContextPacket(request, { pipelineMode });
  const [operatingMemory, contextIndex] = await Promise.all([
    readContextDoc('agent-operating-memory'),
    readContextDoc('context-index')
  ]);
  const toolOptions = {
    contextCoverage: contextPacket.contextCoverage,
    candidateParts: contextPacket.candidateParts,
    allowedContextSourceIds: contextPacket.retrievalPlan.sourceIds,
    supportBundles: contextPacket.supportBundles
  };
  const subagents = pipelineMode === 'legacy' ? createSubagents(toolOptions) : [];
  const requirementSystemPrompt = buildRequirementAnalysisSystemPrompt({
    locale: request.locale ?? 'ko',
    contextPacketBlock: contextPacket.promptBlock
  });
  const requirementUserPrompt = buildRequirementAnalysisUserPrompt(request);
  const synthesisExtraBlocks = [renderSubagentPromptBudgetText(subagents)];
  const buildSynthesisSystemPrompt = (blocks: SystemContextBlocks): string =>
    buildSystemPrompt({
      locale: request.locale ?? 'ko',
      operatingMemory: blocks.operatingMemory,
      coordinatorPrompt: blocks.coordinatorPrompt,
      registrySummary: blocks.registrySummary,
      contextPacketBlock: blocks.contextPacketBlock
    });
  const synthesisRawBlocks: SystemContextBlocks = {
    operatingMemory: compactRuntimeOperatingMemory(operatingMemory),
    coordinatorPrompt: compactRuntimeContextIndex(contextIndex),
    registrySummary: buildRegistrySummary(contextPacket.candidateParts),
    contextPacketBlock: contextPacket.promptBlock
  };
  const synthesisUserPrompt = buildAgentUserPrompt(request, { attempt: 1, previousErrors: [] });
  const synthesisBlocks = compactBlocksForAssembledPrompt({
    stage: 'synthesis',
    contextPacket,
    rawBlocks: synthesisRawBlocks,
    buildSystemPromptFrom: buildSynthesisSystemPrompt,
    userPrompt: synthesisUserPrompt,
    extraPromptBlocks: synthesisExtraBlocks
  });
  const synthesisSystemPrompt = buildSynthesisSystemPrompt(synthesisBlocks);

  return {
    contextPacket,
    audits: [
      measureAgentPromptBudget({
        stage: 'requirement-analysis',
        contextPacket,
        systemPrompt: requirementSystemPrompt,
        userPrompt: requirementUserPrompt
      }),
      measureAgentPromptBudget({
        stage: 'synthesis',
        contextPacket,
        systemPrompt: synthesisSystemPrompt,
        userPrompt: synthesisUserPrompt,
        extraPromptBlocks: synthesisExtraBlocks
      })
    ]
  };
}

async function observeShadowComposition(input: {
  traceId: string;
  sessionId: string;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
}): Promise<void> {
  const mode = getComposeMode();
  if (mode === 'off') {
    return;
  }
  try {
    const shadow = await runShadowComposition({
      candidateParts: input.contextPacket.candidateParts,
      loadTemplates: () => loadTopologyTemplates()
    });
    logAgentEvent('context.compose.shadow', {
      traceId: input.traceId,
      sessionId: input.sessionId,
      mode,
      status: shadow.status,
      topologyId: shadow.composition?.topologyId ?? null,
      complete: shadow.composition?.complete ?? false,
      buildReadyScope: shadow.composition?.buildReadyScope ?? null,
      blockingCount: shadow.composition?.blockingConditions.length ?? 0
    });
  } catch (error) {
    logAgentEvent('context.compose.shadow.failed', {
      traceId: input.traceId,
      sessionId: input.sessionId,
      mode,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}

async function runLiveAgent(request: AgentMessageRequest, options: AgentRunOptions = {}): Promise<AgentRunResult> {
  const modelPort = options.deps?.modelPort ?? createDefaultModelPort();
  const deepAgentFactory = options.deps?.deepAgentFactory ?? createDeepAgent;
  const pipelineMode = getAgentPipelineMode();
  const sessionId = request.sessionId ?? `session-${randomUUID()}`;
  const traceId = options.traceId ?? createAgentTraceId();
  // On a clarification resume, ground the packet to the chosen capability (forceCapabilityId ignores a
  // category-id resume, so an intermediate narrowing step still re-asks rather than mis-building).
  const contextPacket = await buildContextPacket(
    { ...request, forceCapabilityId: request.resume },
    { pipelineMode }
  );
  const baseMetadata = langSmithMetadata({ traceId, request, contextPacket });
  logAgentEvent('context.packet.built', {
    traceId,
    sessionId,
    ...contextPacketLogSummary(contextPacket)
  });
  // Phase 2b shadow: in shadow/on mode, run the L2 generated composition
  // alongside the live packet for logging/diffing ONLY. Guarded + default-off so
  // it can never alter the response or break a request.
  await observeShadowComposition({ traceId, sessionId, contextPacket });
  const [operatingMemory, coordinatorPrompt] = await Promise.all([
    readContextDoc('agent-operating-memory'),
    readContextDoc('context-index')
  ]);
  const runtimeOperatingMemory = compactRuntimeOperatingMemory(operatingMemory);
  const runtimeContextIndex = compactRuntimeContextIndex(coordinatorPrompt);
  const registrySummary = buildRegistrySummary(contextPacket.candidateParts);

  const model = modelPort.createModel();

  // ReAct routing (PLAN_react_routing_and_clean_chat): there is no binary pre-gate for the
  // chat/recommend/clarify/build decision — the deterministic routing/coverage read is exposed to the
  // synthesis agent as the assess_request_scope tool, and the agent itself decides. The ONE thing that
  // is NOT agent-discretionary is safety: an unsupported_or_gap route is short-circuited before
  // synthesis by buildPreflightDraftFromAnalysis (a hard, server-enforced guardrail; Invariant 6).
  const requestScope = assessRequestScope(contextPacket);

  const toolOptions = {
    contextCoverage: contextPacket.contextCoverage,
    candidateParts: contextPacket.candidateParts,
    allowedContextSourceIds: contextPacket.retrievalPlan.sourceIds,
    supportBundles: contextPacket.supportBundles,
    requestScope,
    locale: request.locale ?? 'ko'
  };
  // Phase 3 single-run: in shadow|next, derive the requirement route deterministically instead of
  // running a second deep agent — collapsing the two createDeepAgent runs into the one synthesis
  // run. legacy keeps the LLM requirement-analysis agent.
  const requirementAnalysis = pipelineMode === 'legacy'
    ? await runRequirementAnalysisAgent({
        traceId,
        sessionId,
        request,
        contextPacket,
        model,
        toolOptions,
        metadata: baseMetadata,
        deepAgentFactory
      }).catch((error) => {
        // Robustness: on a non-circuit turn (greeting / general question) the requirement-analysis
        // model often replies in plain text and never emits the structured route. Rather than 502 with
        // "회로 초안을 구조화해서 확인하지 못했어요", fall back to the SAME deterministic route the
        // next-pipeline uses. The turn still reaches the synthesis agent, which answers conversationally.
        if (error instanceof AgentStructuredOutputError) {
          logAgentEvent('requirement.analysis.recovered', {
            traceId,
            sessionId,
            reason: 'requirement-analysis structured output missing; using deterministic route'
          });
          return deriveRequirementAnalysis(request, contextPacket);
        }
        throw error;
      })
    : deriveRequirementAnalysis(request, contextPacket);
  logAgentEvent('requirement.analysis.completed', {
    traceId,
    sessionId,
    requirementRoute: requirementAnalysis.route,
    requirementConfidence: requirementAnalysis.confidence,
    requirementSummary: requirementAnalysis.summary,
    blockingReason: requirementAnalysis.blockingReason
  });

  // Phase 4 Path B: the subagents are never instructed and the model converges to an immediate
  // emit (Phase 0 reachability proved delegation is reachable but behaviorally unused), so in
  // shadow|next we drop them to cut the `task`-tool subagent-description token weight. legacy keeps
  // them for provable no-change.
  const subagents = pipelineMode === 'legacy' ? createSubagents(toolOptions) : [];
  // Phase 5a — graceful compaction: compact the dominant system/context blocks at the
  // prompt-assembly boundary so that an over-budget context returns a bounded prompt
  // instead of throwing AgentPromptBudgetError.  Reserves the non-block overhead
  // (system-prompt scaffolding + user prompt + subagent blocks) so the FULL assembled
  // prompt — what the assert measures — fits the route budget, not just the raw blocks.
  const synthesisExtraBlocks = [renderSubagentPromptBudgetText(subagents)];
  const buildSynthesisSystemPrompt = (blocks: SystemContextBlocks): string =>
    buildSystemPrompt({
      locale: request.locale ?? 'ko',
      operatingMemory: blocks.operatingMemory,
      coordinatorPrompt: blocks.coordinatorPrompt,
      registrySummary: blocks.registrySummary,
      contextPacketBlock: blocks.contextPacketBlock
    });
  const synthesisRawBlocks: SystemContextBlocks = {
    operatingMemory: runtimeOperatingMemory,
    coordinatorPrompt: runtimeContextIndex,
    registrySummary,
    contextPacketBlock: contextPacket.promptBlock
  };
  // Faithful chain (flag-gated, default off): author the requirement document and fit it
  // grounding-first so it LEADS the synthesis prompt without compacting context grounding.
  // briefOptions === undefined (flag off / non-synthesize route) => prompt byte-identical to before.
  const requirementBriefResult = await buildSynthesisRequirementBrief({
    request,
    contextPacket,
    requirementAnalysis,
    buildSystemPromptFrom: buildSynthesisSystemPrompt,
    rawBlocks: synthesisRawBlocks,
    extraPromptBlocks: synthesisExtraBlocks,
    model,
    deepAgentFactory,
    metadata: baseMetadata,
    traceId,
    sessionId
  });
  const requirementDoc = requirementBriefResult?.doc;
  const briefOptions = requirementBriefResult ? { requirementBrief: requirementBriefResult.brief } : undefined;
  const synthesisUserPrompt = buildAgentUserPrompt(request, { attempt: 1, previousErrors: [] }, briefOptions);
  const synthesisBlocks = compactBlocksForAssembledPrompt({
    stage: 'synthesis',
    contextPacket,
    rawBlocks: synthesisRawBlocks,
    buildSystemPromptFrom: buildSynthesisSystemPrompt,
    userPrompt: synthesisUserPrompt,
    extraPromptBlocks: synthesisExtraBlocks
  });
  const synthesisSystemPrompt = buildSynthesisSystemPrompt(synthesisBlocks);
  assertAgentPromptBudget({
    stage: 'synthesis',
    contextPacket,
    systemPrompt: synthesisSystemPrompt,
    userPrompt: synthesisUserPrompt,
    extraPromptBlocks: synthesisExtraBlocks
  });

  const agentTools = createHeduwareAgentTools(toolOptions);
  const agentName = 'h-eduware-deepagent';
  const agentRunName = 'h-eduware-circuit-synthesis';
  const agentThreadId = sessionId;
  const agent = deepAgentFactory({
    model,
    tools: agentTools,
    subagents,
    responseFormat: toolStrategy(LiveAgentDraftSchema),
    systemPrompt: synthesisSystemPrompt,
    // Conversation memory: the thread (thread_id = sessionId) carries prior turns so the agent no
    // longer depends on the client re-sending history. See conversationCheckpointer above.
    checkpointer: options.deps?.checkpointer ?? conversationCheckpointer,
    name: agentName,
    middleware: [createObservabilityMiddleware((event) => {
      logAgentEvent('agent.tool.call', {
        traceId,
        sessionId,
        tool: event.tool,
        status: event.status,
        durationMs: event.durationMs,
        inputHash: event.inputHash,
        inputChars: event.inputChars,
        ...(event.outputHash !== undefined ? { outputHash: event.outputHash } : {}),
        ...(event.outputChars !== undefined ? { outputChars: event.outputChars } : {}),
        ...(event.error !== undefined ? { error: event.error } : {})
      });
    })]
  });

  try {
    return await runAgentDraftRepairLoop({
    traceId,
    sessionId,
    request,
    contextPacket,
    requirementAnalysis,
    requirementDoc,
    structuredOutputFallback: pipelineMode !== 'legacy',
    draftProvider: async ({ attempt, previousErrors }) => {
      logAgentEvent('agent.synthesis.attempt', {
        traceId,
        sessionId,
        attempt,
        previousErrorCount: previousErrors.length
      });
      const userPrompt = buildAgentUserPrompt(request, { attempt, previousErrors }, briefOptions);
      assertAgentPromptBudget({
        stage: 'synthesis',
        contextPacket,
        systemPrompt: synthesisSystemPrompt,
        userPrompt,
        extraPromptBlocks: [renderSubagentPromptBudgetText(subagents)]
      });
      // A clarification answer resumes the paused thread (Command) on the first attempt only; a repair
      // retry re-prompts normally (the resume was already consumed into the thread).
      const invokeInput = request.resume && attempt === 1
        ? new Command({ resume: request.resume })
        : { messages: [{ role: 'user', content: userPrompt }] };
      logAgentEvent('agent.llm.handoff', {
        traceId,
        sessionId,
        ...llmHandoffLogSummary({
          stage: 'synthesis',
          agentName,
          runName: agentRunName,
          threadId: agentThreadId,
          inputKind: request.resume && attempt === 1 ? 'command-resume' : 'messages',
          systemPrompt: synthesisSystemPrompt,
          userPrompt,
          contextPacket,
          attempt,
          previousErrors,
          requirementRoute: requirementAnalysis.route,
          toolNames: toolNamesFor(agentTools),
          subagentNames: subagentNamesFor(subagents)
        })
      });
      const output = await agent.invoke(invokeInput, {
        runName: agentRunName,
        tags: langSmithTags('synthesis', contextPacket),
        metadata: {
          ...baseMetadata,
          requirementRoute: requirementAnalysis.route,
          requirementSummary: requirementAnalysis.summary,
          attempt,
          previousErrorCount: previousErrors.length
        },
        configurable: {
          thread_id: agentThreadId
        }
      });
      logAgentEvent('agent.llm.completed', {
        traceId,
        sessionId,
        stage: 'synthesis',
        agentName,
        runName: agentRunName,
        threadId: agentThreadId,
        attempt,
        ...llmOutputLogSummary(output)
      });
      // HITL: the agent called ask_to_narrow -> the graph paused. Surface the question/options to the
      // client as an awaiting_input turn instead of parsing a (non-existent) draft.
      const interruptPayload = extractInterruptPayload(output);
      if (interruptPayload) {
        throw new AgentInterruptSignal(interruptPayload);
      }
      const draft = parseLiveAgentDraft(output);
      logAgentEvent('agent.structured_output.parsed', {
        traceId,
        sessionId,
        stage: 'synthesis',
        agentName,
        runName: agentRunName,
        threadId: agentThreadId,
        attempt,
        ...liveDraftLogSummary(draft)
      });
      return draft;
    }
    });
  } catch (error) {
    if (error instanceof AgentInterruptSignal) {
      return buildAwaitingInputResult({ traceId, sessionId, request, contextPacket, payload: error.payload });
    }
    throw error;
  }
}

async function runRequirementAnalysisAgent({
  traceId,
  sessionId,
  request,
  contextPacket,
  model,
  toolOptions,
  metadata,
  deepAgentFactory
}: {
  traceId: string;
  sessionId: string;
  request: AgentMessageRequest;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  model: BaseChatModel;
  toolOptions: HeduwareAgentToolsOptions;
  metadata: Record<string, unknown>;
  deepAgentFactory: DeepAgentFactory;
}): Promise<RequirementAnalysis> {
  // Phase 5a — compact the contextPacketBlock for the requirement-analysis prompt so that
  // an over-budget context packet does not hard-fail this assert site either. Reserves the
  // non-block overhead so the full assembled prompt fits, not just the raw context block.
  const requirementUserPrompt = buildRequirementAnalysisUserPrompt(request);
  const buildRequirementSystemPrompt = (blocks: SystemContextBlocks): string =>
    buildRequirementAnalysisSystemPrompt({
      locale: request.locale ?? 'ko',
      contextPacketBlock: blocks.contextPacketBlock
    });
  const requirementBlocks = compactBlocksForAssembledPrompt({
    stage: 'requirement-analysis',
    contextPacket,
    rawBlocks: {
      operatingMemory: '',
      coordinatorPrompt: '',
      registrySummary: '',
      contextPacketBlock: contextPacket.promptBlock
    },
    buildSystemPromptFrom: buildRequirementSystemPrompt,
    userPrompt: requirementUserPrompt
  });
  const systemPrompt = buildRequirementSystemPrompt(requirementBlocks);
  const userPrompt = requirementUserPrompt;
  assertAgentPromptBudget({
    stage: 'requirement-analysis',
    contextPacket,
    systemPrompt,
    userPrompt
  });

  const analyzerTools = createHeduwareAgentTools(toolOptions);
  const agentName = 'h-eduware-requirement-analysis-agent';
  const runName = 'h-eduware-requirement-analysis';
  const threadId = `${sessionId}:requirement-analysis`;
  const analyzer = deepAgentFactory({
    model,
    tools: analyzerTools,
    responseFormat: toolStrategy(RequirementAnalysisSchema),
    systemPrompt,
    name: agentName
  });

  logAgentEvent('agent.llm.handoff', {
    traceId,
    sessionId,
    ...llmHandoffLogSummary({
      stage: 'requirement-analysis',
      agentName,
      runName,
      threadId,
      inputKind: 'messages',
      systemPrompt,
      userPrompt,
      contextPacket,
      toolNames: toolNamesFor(analyzerTools)
    })
  });
  const output = await analyzer.invoke({
    messages: [{
      role: 'user',
      content: userPrompt
    }]
  }, {
    runName,
    tags: langSmithTags('requirement-analysis', contextPacket),
    metadata: {
      ...metadata,
      traceId
    },
    configurable: {
      thread_id: threadId
    }
  });
  logAgentEvent('agent.llm.completed', {
    traceId,
    sessionId,
    stage: 'requirement-analysis',
    agentName,
    runName,
    threadId,
    ...llmOutputLogSummary(output)
  });

  const analysis = parseRequirementAnalysis(output);
  logAgentEvent('agent.structured_output.parsed', {
    traceId,
    sessionId,
    stage: 'requirement-analysis',
    agentName,
    runName,
    threadId,
    requirementRoute: analysis.route,
    requirementConfidence: analysis.confidence,
    blockingReason: analysis.blockingReason,
    agentEventCount: analysis.agentEvents.length
  });
  return analysis;
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

// Production ModelPort: reads live config and constructs the real ChatOpenAI model. Tests inject a
// fake ModelPort instead, so the live config + network are never touched.
function createDefaultModelPort(): ModelPort {
  return {
    createModel(): BaseChatModel {
      const { apiKey, modelName } = requireLiveConfig();
      return new ChatOpenAI({
        model: modelName,
        apiKey,
        ...modelGenerationOptions(modelName)
      });
    }
  };
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

export function measureAgentPromptBudget({
  stage,
  contextPacket,
  systemPrompt,
  userPrompt,
  extraPromptBlocks = []
}: {
  stage: AgentPromptBudgetStage;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  systemPrompt: string;
  userPrompt: string;
  extraPromptBlocks?: string[];
}) {
  const promptBlocks = [systemPrompt, userPrompt, ...extraPromptBlocks].filter(Boolean);
  const actualChars = promptBlocks.join('\n\n').length;
  const maxChars = contextPacket.retrievalPlan.maxPromptChars;

  return {
    stage,
    actualChars,
    maxChars,
    remainingChars: maxChars - actualChars,
    contextBlockChars: contextPacket.promptBlock.length,
    withinBudget: actualChars <= maxChars
  };
}

function assertAgentPromptBudget(input: Parameters<typeof measureAgentPromptBudget>[0]) {
  const audit = measureAgentPromptBudget(input);
  if (!audit.withinBudget) {
    logAgentEvent('prompt.budget.exceeded', {
      stage: audit.stage,
      actualChars: audit.actualChars,
      maxChars: audit.maxChars,
      contextBlockChars: audit.contextBlockChars,
      remainingChars: audit.remainingChars
    });
    throw new AgentPromptBudgetError(audit.stage, audit.actualChars, audit.maxChars);
  }
}

/**
 * Chars reserved below the route budget when compacting the system/context
 * blocks, to absorb minor block-vs-scaffold length differences introduced by
 * buildSystemPrompt (headers, trimming) so the post-compaction assert clears.
 */
const PROMPT_BUDGET_SAFETY_MARGIN = 64;

/** Chars reserved for the "=== REQUIREMENT DOCUMENT ... ===" wrapper around the injected brief. */
const REQUIREMENT_BRIEF_WRAPPER_CHARS = 140;

/**
 * Requirement-document chain flag (faithful: doc drives synthesis). Default OFF so the synthesis
 * prompt is byte-identical to prior behavior — the live agent is unaffected until opted in.
 *   off (default) | derive (deterministic doc) | llm (LLM-authored doc; reserved for US-002 faithful).
 */
function requirementDocChainMode(): 'off' | 'derive' | 'llm' {
  const value = (process.env.H_EDUWARE_REQUIREMENT_DOC_CHAIN ?? '').trim().toLowerCase();
  if (value === 'llm') return 'llm';
  if (value === 'derive' || value === '1' || value === 'on' || value === 'true') return 'derive';
  return 'off';
}

/**
 * Build the grounding-first requirement brief to inject into the synthesis user prompt, or undefined
 * when the chain is off or the route is not synthesize_circuit. Fits the brief to the budget that
 * remains AFTER the (uncompacted) system blocks + brief-less user prompt + extras, so the brief
 * yields first and system grounding (contextPacketBlock) is protected (Critic M1).
 */
function deterministicRequirementDoc(
  request: AgentMessageRequest,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>
): RequirementDoc {
  return deriveRequirementDoc(
    request.message,
    contextPacket.candidateParts.map((part) => ({ id: part.id, kind: part.kind, label: part.label }))
  );
}

/**
 * Build the grounding-first requirement brief to inject into the synthesis user prompt, or undefined
 * when the chain is off or the route is not synthesize_circuit. In 'llm' mode the document is AUTHORED
 * by the model (faithful); on any authoring failure it falls back to the deterministic doc so synthesis
 * is never broken. Fits the brief to the budget that remains AFTER the (uncompacted) system blocks +
 * brief-less user prompt + extras, so the brief yields first and contextPacketBlock grounding is
 * protected (Critic M1).
 */
async function buildSynthesisRequirementBrief(input: {
  request: AgentMessageRequest;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  requirementAnalysis: RequirementAnalysis;
  buildSystemPromptFrom: (blocks: SystemContextBlocks) => string;
  rawBlocks: SystemContextBlocks;
  extraPromptBlocks: string[];
  model: BaseChatModel;
  deepAgentFactory: DeepAgentFactory;
  metadata: Record<string, unknown>;
  traceId: string;
  sessionId: string;
}): Promise<{ brief: string; doc: RequirementDoc } | undefined> {
  const mode = requirementDocChainMode();
  if (mode === 'off' || input.requirementAnalysis.route !== 'synthesize_circuit') {
    return undefined;
  }
  let doc: RequirementDoc;
  if (mode === 'llm') {
    try {
      doc = await authorRequirementDoc({
        traceId: input.traceId,
        sessionId: input.sessionId,
        request: input.request,
        contextPacket: input.contextPacket,
        model: input.model,
        metadata: input.metadata,
        deepAgentFactory: input.deepAgentFactory
      });
      logAgentEvent('requirement.doc.authored', {
        traceId: input.traceId,
        sessionId: input.sessionId,
        controller: doc.controller,
        requiredPartCount: doc.intendedParts.filter((p) => p.required).length,
        verbatimConstraintCount: doc.verbatimConstraints.length
      });
    } catch (error) {
      logAgentEvent('requirement.doc.authoring.failed', {
        traceId: input.traceId,
        sessionId: input.sessionId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      doc = deterministicRequirementDoc(input.request, input.contextPacket); // never break synthesis
    }
  } else {
    doc = deterministicRequirementDoc(input.request, input.contextPacket);
  }
  // Measure the assembled prompt WITHOUT the brief to find the brief's reserved budget.
  const baseline = measureAgentPromptBudget({
    stage: 'synthesis',
    contextPacket: input.contextPacket,
    systemPrompt: input.buildSystemPromptFrom(input.rawBlocks),
    userPrompt: buildAgentUserPrompt(input.request, { attempt: 1, previousErrors: [] }),
    extraPromptBlocks: input.extraPromptBlocks
  });
  const reserved = baseline.maxChars - baseline.actualChars - REQUIREMENT_BRIEF_WRAPPER_CHARS;
  return { brief: fitBriefToBudget(doc, Math.max(0, reserved)), doc };
}

/** Faithful chain (US-002): the model AUTHORS the requirement document before synthesis. */
async function authorRequirementDoc(input: {
  traceId: string;
  sessionId: string;
  request: AgentMessageRequest;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  model: BaseChatModel;
  metadata: Record<string, unknown>;
  deepAgentFactory: DeepAgentFactory;
}): Promise<RequirementDoc> {
  const userPrompt = buildRequirementDocUserPrompt(input.request);
  const buildDocSystemPrompt = (blocks: SystemContextBlocks): string =>
    buildRequirementDocSystemPrompt({
      locale: input.request.locale ?? 'ko',
      contextPacketBlock: blocks.contextPacketBlock
    });
  const blocks = compactBlocksForAssembledPrompt({
    stage: 'requirement-analysis',
    contextPacket: input.contextPacket,
    rawBlocks: { operatingMemory: '', coordinatorPrompt: '', registrySummary: '', contextPacketBlock: input.contextPacket.promptBlock },
    buildSystemPromptFrom: buildDocSystemPrompt,
    userPrompt
  });
  const systemPrompt = buildDocSystemPrompt(blocks);
  assertAgentPromptBudget({ stage: 'requirement-analysis', contextPacket: input.contextPacket, systemPrompt, userPrompt });

  // No circuit-building tools and no structured-tool responseFormat: the authoring agent emits the
  // RequirementDoc as a JSON answer (the structured-tool seam did not populate structuredResponse for
  // this model). parseRequirementDoc extracts the JSON from the message content.
  const agentName = 'h-eduware-requirement-doc-agent';
  const runName = 'h-eduware-requirement-doc';
  const threadId = `${input.sessionId}:requirement-doc`;
  const author = input.deepAgentFactory({
    model: input.model,
    tools: [],
    systemPrompt,
    name: agentName
  });
  logAgentEvent('agent.llm.handoff', {
    traceId: input.traceId,
    sessionId: input.sessionId,
    ...llmHandoffLogSummary({
      stage: 'requirement-doc',
      agentName,
      runName,
      threadId,
      inputKind: 'messages',
      systemPrompt,
      userPrompt,
      contextPacket: input.contextPacket,
      toolNames: []
    })
  });
  const output = await author.invoke({
    messages: [{ role: 'user', content: userPrompt }]
  }, {
    runName,
    tags: langSmithTags('requirement-analysis', input.contextPacket),
    metadata: { ...input.metadata, traceId: input.traceId },
    configurable: { thread_id: threadId }
  });
  logAgentEvent('agent.llm.completed', {
    traceId: input.traceId,
    sessionId: input.sessionId,
    stage: 'requirement-doc',
    agentName,
    runName,
    threadId,
    ...llmOutputLogSummary(output)
  });
  const doc = parseRequirementDoc(output);
  logAgentEvent('agent.structured_output.parsed', {
    traceId: input.traceId,
    sessionId: input.sessionId,
    stage: 'requirement-doc',
    agentName,
    runName,
    threadId,
    controller: doc.controller,
    requiredPartCount: doc.intendedParts.filter((part) => part.required).length,
    intendedPartCount: doc.intendedParts.length,
    verbatimConstraintCount: doc.verbatimConstraints.length
  });
  return doc;
}

/** Pull the model's textual answer out of a deepagents/langgraph invoke result, across shapes. */
function extractAgentOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object') return '';
  const o = output as Record<string, unknown>;
  const messages = o.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
    const content = last?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === 'string' ? part : ((part as Record<string, unknown>)?.text as string) ?? ''))
        .join('');
    }
  }
  if (typeof o.content === 'string') return o.content;
  if (typeof o.output === 'string') return o.output;
  return '';
}

/** Extract the first balanced JSON object from text (tolerates markdown fences / surrounding prose). */
function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseRequirementDoc(output: unknown): RequirementDoc {
  // 1. Use the framework's structured response if present.
  const structured = output && typeof output === 'object'
    ? (output as Record<string, unknown>).structuredResponse ?? (output as Record<string, unknown>).structured_response
    : null;
  // 2. Otherwise parse the JSON object the model emitted as its answer (json 형태).
  const candidate = structured ?? extractJsonObject(extractAgentOutputText(output));
  if (!candidate) {
    throw new AgentStructuredOutputError('Deepagents did not return a parseable requirement document.');
  }
  return RequirementDocSchema.parse(candidate);
}

function buildRequirementDocSystemPrompt({ locale, contextPacketBlock }: { locale: 'ko' | 'en'; contextPacketBlock: string }) {
  return [
    `You are H-eduware's requirement-document author (locale: ${locale}).`,
    'Read the student request and the context packet, then AUTHOR a structured requirement document for a beginner-safe, low-voltage circuit. The downstream synthesis step will build a circuit that satisfies this document.',
    'Rules:',
    '- Use ONLY parts that appear in the context packet candidate parts. Never invent parts, pins, or protocols.',
    '- intendedParts: list the parts the circuit needs; set required=true for the controller, the output/load, and any required passive (e.g. a current-limiting resistor). Set required=false for optional aids (breadboard, wiring).',
    '- verbatimConstraints: copy exact lexical details from the student message (controller pins like D8, component values like 220 ohm, repeat counts). Do not paraphrase them.',
    '- goal and behavior: concise and faithful to the request.',
    'Output: return ONLY a single JSON object (no markdown fences, no prose) with EXACTLY these fields:',
    '{"goal": string, "controller": string|null, "inputs": string[], "outputs": string[], "intendedParts": [{"partId": string, "role": string, "required": boolean}], "behavior": string, "verbatimConstraints": string[], "assumptions": string[]}',
    '',
    'Context packet:',
    contextPacketBlock
  ].join('\n');
}

function buildRequirementDocUserPrompt(request: AgentMessageRequest) {
  return [
    `Student message: ${request.message}`,
    request.confirmation ? `Student confirmation/context: ${request.confirmation}` : '',
    'Author the requirement document now.'
  ].filter(Boolean).join('\n');
}

/**
 * Phase 5a (live-path fix): compact the dominant system/context blocks so the
 * FULLY ASSEMBLED prompt fits the route budget — not merely the raw blocks.
 *
 * The assert measures `systemPrompt + userPrompt + extraPromptBlocks`, where
 * `systemPrompt` wraps the blocks with scaffolding. Compacting the blocks alone
 * against `maxPromptChars` (the original Phase 5a behaviour) let a prompt that
 * was a few chars over budget slip through uncompacted and hard-fail with a 413
 * AgentPromptBudgetError (observed live: synthesis 9029/9000). Here we measure
 * the real assembled prompt; if it is over budget we reserve the measured
 * non-block overhead (+ a safety margin) and compact the blocks into what
 * remains. Returns the (possibly unchanged) blocks to build the final prompt.
 */
function compactBlocksForAssembledPrompt(args: {
  stage: AgentPromptBudgetStage;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  rawBlocks: SystemContextBlocks;
  buildSystemPromptFrom: (blocks: SystemContextBlocks) => string;
  userPrompt: string;
  extraPromptBlocks?: string[];
}): SystemContextBlocks {
  const audit = measureAgentPromptBudget({
    stage: args.stage,
    contextPacket: args.contextPacket,
    systemPrompt: args.buildSystemPromptFrom(args.rawBlocks),
    userPrompt: args.userPrompt,
    extraPromptBlocks: args.extraPromptBlocks
  });
  return compactBlocksWithinAssembledBudget({
    rawBlocks: args.rawBlocks,
    assembledLength: audit.actualChars,
    maxChars: audit.maxChars,
    safetyMargin: PROMPT_BUDGET_SAFETY_MARGIN
  });
}

function compactRuntimeOperatingMemory(_memory: string) {
  return [
    '# Operating Memory Summary',
    'Validate before build-ready rendering or current-flow claims.',
    'Current animation must come from validated netlist/current paths only.',
    'Never invent parts, pins, protocols, or simulator capability; mark unsupported or ask one clarification.',
    'Prefer safe low-voltage Arduino/breadboard circuits. Registry/tool outputs are canonical.',
    'Keep subagent outputs concise; no long copied context.'
  ].join('\n');
}

function compactRuntimeContextIndex(_index: string) {
  return [
    '# Context Index Summary',
    'Authority order: safety policy, deterministic validation, schemas, support bundles, registry data, product/pedagogy.',
    'Use the request ContextRoute/RetrievalPlan only; do not scan omitted catalogs or legacy snapshots.',
    'v2 bundles are the prompt surface. Heavy registry, primitive, footprint, and source-claim details are tool data.',
    'Unsupported or ambiguous prompts stay policy-first. Supported hardware requires registry, pins, validation, simulation primitive, footprint, eval, and browser evidence.'
  ].join('\n');
}

async function finalizeAgentResult({
  traceId,
  sessionId,
  request,
  draft,
  contextPacket,
  coordinatorEvent = {
    type: 'coordinator',
    name: 'deepagents-coordinator',
    status: 'completed',
    summary: 'Created structured circuit draft through Deepagents.'
  },
  requirementDoc,
  repairEvents = []
}: {
  traceId?: string;
  sessionId: string;
  request: AgentMessageRequest;
  draft: LiveAgentDraft;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  coordinatorEvent?: AgentEvent;
  requirementDoc?: RequirementDoc;
  repairEvents?: AgentEvent[];
}): Promise<AgentRunResult> {
  const sourceCircuitSpec = normalizePhysicalCircuitSpec(CircuitSpecSchema.parse(draft.circuitSpec));
  const safeEquivalentSpec = shouldUseSafeEquivalentSimulation(sourceCircuitSpec, draft, contextPacket)
    ? buildSafeLowVoltageLedEquivalentSpec(sourceCircuitSpec, request.locale ?? 'ko')
    : null;
  const circuitSpec = safeEquivalentSpec ?? sourceCircuitSpec;
  const validationReport = safeEquivalentSpec
    ? await validateCircuitSpec(circuitSpec)
    : applyCandidatePartGate(
        await validateCircuitSpec(circuitSpec),
        circuitSpec,
        contextPacket.candidateParts
      );
  const intentFulfillmentReport = safeEquivalentSpec
    ? validationReport
    : applyIntentFulfillmentGate(
        validationReport,
        circuitSpec,
        contextPacket.intentSpec,
        contextPacket.candidateParts
      );
  const effectiveValidationReport = safeEquivalentSpec
    ? intentFulfillmentReport
    : applyContextCoverageGate(intentFulfillmentReport, contextPacket.contextCoverage);
  const netlist = await buildNetlist(circuitSpec);
  const currentPaths = await estimateCurrentPaths(circuitSpec, netlist, effectiveValidationReport);
  const renderPlan = await compileRenderPlan(circuitSpec, effectiveValidationReport);
  const simulationPlan = await compileSimulationPlan(circuitSpec, effectiveValidationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(effectiveValidationReport, renderPlan, simulationPlan);
  const solverGateResult = buildSolverGateResult(
    effectiveValidationReport,
    renderPlan,
    simulationPlan,
    runnableReport,
    safeEquivalentSpec
      ? {
          mode: 'safe_equivalent_simulation',
          repairLevel: 'safe_equivalent',
          sourceSpecId: sourceCircuitSpec.id,
          equivalentSpecId: safeEquivalentSpec.id,
          verifiedClaims: ['safe low-voltage equivalent circuit was validated instead of the unsafe original request'],
          notVerified: ['original unsafe request was not converted into wiring or build-ready hardware'],
          repairSummary: ['Original unsafe request was replaced with a safe low-voltage equivalent simulation.']
        }
      : {}
  );
  logAgentEvent('agent.simulation.compiled', {
    traceId,
    sessionId,
    circuitSpecId: circuitSpec.id,
    sourceCircuitSpecId: sourceCircuitSpec.id,
    safeEquivalent: Boolean(safeEquivalentSpec),
    validationStatus: effectiveValidationReport.status,
    validationErrorCount: effectiveValidationReport.errors.length,
    validationWarningCount: effectiveValidationReport.warnings.length,
    netCount: netlist.nets.length,
    currentPathCount: simulationPlan.currentPaths.length,
    renderPartCount: renderPlan.parts.length,
    renderConnectionCount: renderPlan.connections.length,
    simulationStatus: simulationPlan.status,
    buildRunnableStatus: runnableReport.status,
    buildRunnable: runnableReport.runnable,
    solverMode: solverGateResult.mode,
    solverBuildReady: solverGateResult.buildReady,
    solverVisibleSimulation: solverGateResult.visibleSimulation
  });
  // Faithful chain (US-005): when the agent authored a requirement document, surface it FIRST in the
  // 문서 tab (the requirement that drove synthesis), then the realized circuit details below it — one
  // model, two views. Flag off (requirementDoc undefined) => unchanged post-synthesis doc.
  const realizedMarkdown = await compileRequirementMarkdown(circuitSpec, effectiveValidationReport, simulationPlan, runnableReport);
  const requirementMarkdown = requirementDoc
    ? `${renderRequirementDocSection(requirementDoc)}\n\n---\n\n${realizedMarkdown}`
    : realizedMarkdown;
  const clarification = effectiveValidationReport.status === 'valid'
    ? null
    : draft.clarification ?? firstCoverageClarification(contextPacket.contextCoverage, request.locale ?? 'ko') ?? firstClarification(circuitSpec, request.locale ?? 'ko');
  const assistantMessage = safeEquivalentSpec
    ? safeEquivalentAssistantMessage(request.locale ?? 'ko', sourceCircuitSpec)
    : finalAssistantMessage({
        draftMessage: draft.assistantMessage,
        validationReport: effectiveValidationReport,
        buildRunnableReport: runnableReport,
        clarification,
        locale: request.locale ?? 'ko'
      });
  const studentMessage = toConciseStudentMessage(
    sanitizeStudentFacingAssistantMessage(assistantMessage, request.locale ?? 'ko')
  );
  const servingStatus = deriveServingStatus({
    contextCoverage: contextPacket.contextCoverage,
    buildRunnableReport: runnableReport,
    solverGateResult,
    unsupportedItems: circuitSpec.unsupportedItems
  });

  return AgentRunResultSchema.parse({
    traceId,
    sessionId,
    mode: 'live',
    servingStatus,
    assistantMessages: [studentMessage],
    agentEvents: normalizeEvents([
      coordinatorEvent,
      ...repairEvents,
      ...draft.agentEvents,
      { type: 'validation', name: 'context-coverage-gate', status: contextPacket.contextCoverage.status === 'sufficient' ? 'completed' : 'warning', summary: contextPacket.contextCoverage.status },
      { type: 'validation', name: 'server-validator', status: effectiveValidationReport.status === 'valid' ? 'completed' : 'warning', summary: effectiveValidationReport.status },
      { type: 'validation', name: 'build-runnable-gate', status: runnableReport.runnable ? 'completed' : 'warning', summary: runnableReport.status }
    ]),
    clarification,
    contextTrace: contextPacket.contextTrace,
    contextCoverage: contextPacket.contextCoverage,
    requirementMarkdown,
    circuitSpec,
    validationReport: effectiveValidationReport,
	    renderPlan,
	    simulationPlan,
	    buildRunnableReport: runnableReport,
	    solverGateResult,
	    supportedAlternatives: draft.supportedAlternatives
	  });
}

// Front intent gate (PLAN_intent_gate.md): turn a conversational reply into an AgentRunResult that
// carries NO renderable circuit. AgentRunResultSchema requires a circuitSpec with >=1 component, so a
// minimal placeholder is attached; the `responseKind: 'chat'` discriminator tells the frontend to skip
// the 3D scene entirely. Validation/render/simulation are reported as empty + not-runnable. The chat
// reply is surfaced verbatim — the circuit-validation messaging in finalizeAgentResult is bypassed.
export function buildCasualChatResult({
  traceId,
  sessionId,
  request,
  contextPacket,
  reply
}: {
  traceId?: string;
  sessionId: string;
  request: AgentMessageRequest;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  reply: string;
}): AgentRunResult {
  const locale = request.locale ?? 'ko';
  const placeholderSpec = {
    id: 'casual-chat',
    title: locale === 'ko' ? '일반 대화' : 'General conversation',
    intent: { primaryGoal: request.message, output: 'conversation', controller: 'none' },
    // Schema floor: >=1 component. Inert and never rendered (responseKind === 'chat').
    components: [{ id: 'chat-context', partId: 'arduino-uno', label: 'Arduino Uno' }],
    connections: [],
    behavior: { runText: 'CHAT' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  };

  return AgentRunResultSchema.parse({
    traceId,
    sessionId,
    mode: 'live',
    responseKind: 'chat',
    servingStatus: deriveServingStatus({
      contextCoverage: contextPacket.contextCoverage,
      unsupportedItems: placeholderSpec.unsupportedItems
    }),
    assistantMessages: [reply],
    agentEvents: [{
      type: 'coordinator',
      name: 'deepagents-coordinator',
      status: 'completed',
      summary: 'Answered conversationally — no circuit synthesis this turn.'
    }],
    clarification: null,
    contextTrace: contextPacket.contextTrace,
    contextCoverage: contextPacket.contextCoverage,
    requirementMarkdown: '',
    circuitSpec: placeholderSpec,
    validationReport: {
      status: 'unsupported',
      errors: [],
      warnings: [],
      validatedCurrentPathIds: []
    },
    renderPlan: {
      title: placeholderSpec.title,
      runText: 'CHAT',
      parts: [],
      connections: [],
      floatingCards: [],
      warnings: []
    },
    simulationPlan: {
      status: 'unsupported',
      runText: 'CHAT',
      currentPaths: [],
      expectedStates: [],
      warnings: []
    },
    buildRunnableReport: {
      status: 'blocked',
      runnable: false,
      reasons: ['Casual conversation — there is no circuit to build.'],
      validationStatus: 'unsupported',
      simulationStatus: 'unsupported',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: 0,
      currentPathCount: 0,
      expectedStateCount: 0
    },
    supportedAlternatives: []
  });
}

// Read a LangGraph interrupt payload off an agent.invoke result and validate it into a
// ClarificationRequest. Returns null when the run did not pause (a normal draft result).
function extractInterruptPayload(output: unknown): ClarificationRequest | null {
  if (!output || typeof output !== 'object') {
    return null;
  }
  const interrupts = (output as Record<string, unknown>).__interrupt__;
  if (!Array.isArray(interrupts) || interrupts.length === 0) {
    return null;
  }
  const value = (interrupts[0] as { value?: unknown })?.value;
  const parsed = ClarificationRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// An awaiting_input turn: the agent paused (ask_to_narrow) and is waiting for the student to pick an
// option. Mirrors buildCasualChatResult's inert placeholders; carries the question + grounded options.
function buildAwaitingInputResult({
  traceId,
  sessionId,
  request,
  contextPacket,
  payload
}: {
  traceId?: string;
  sessionId: string;
  request: AgentMessageRequest;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  payload: ClarificationRequest;
}): AgentRunResult {
  const locale = request.locale ?? 'ko';
  const base = buildCasualChatResult({
    traceId,
    sessionId,
    request,
    contextPacket,
    reply: payload.question || (locale === 'ko' ? '아래에서 골라주세요.' : 'Please choose below.')
  });
  return AgentRunResultSchema.parse({
    ...base,
    responseKind: 'awaiting_input',
    clarificationRequest: payload
  });
}

// ReAct chat decision -> the student-facing message. A conversational draft may carry a follow-up
// clarification (e.g. "어느 걸 만들어볼까요?"); append it once so the chat bubble reads as one reply.
function composeStudentChatMessage(draft: LiveAgentDraft): string {
  const clarification = draft.clarification?.trim();
  if (clarification && !draft.assistantMessage.includes(clarification)) {
    return `${draft.assistantMessage}\n\n${clarification}`;
  }
  return draft.assistantMessage;
}

function shouldUseSafeEquivalentSimulation(
  sourceCircuitSpec: CircuitSpec,
  draft: LiveAgentDraft,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>
) {
  return contextPacket.contextRoute.routeId === 'unsupported-safety'
    && sourceCircuitSpec.unsupportedItems.length > 0
    && draft.supportedAlternatives.some((alternative) =>
      alternative.id === 'safe-low-voltage-led' && alternative.source === 'safety-policy'
    );
}

function buildSafeLowVoltageLedEquivalentSpec(sourceCircuitSpec: CircuitSpec, locale: 'ko' | 'en'): CircuitSpec {
  const originalBlockers = uniqueStrings(sourceCircuitSpec.unsupportedItems);
  return CircuitSpecSchema.parse({
    id: `${sourceCircuitSpec.id}-safe-equivalent-led`,
    title: locale === 'ko' ? '안전한 저전압 LED 대체 회로' : 'Safe Low-Voltage LED Equivalent',
    intent: {
      primaryGoal: locale === 'ko'
        ? '위험한 원 요청 대신 안전한 Arduino LED 회로를 시뮬레이션한다'
        : 'simulate a safe Arduino LED circuit instead of the unsafe original request',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'safe-equivalent-low-voltage'
    },
    components: [
      { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard', designator: 'BB1' },
      { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: '5mm LED', designator: 'D1' }
    ],
    connections: [
      {
        id: 'd9-to-resistor',
        from: { componentId: 'arduino-uno', pin: 'D9' },
        to: { componentId: 'resistor-1', pin: '1' },
        signal: 'gpio',
        color: '#2f7df6'
      },
      {
        id: 'resistor-to-led',
        from: { componentId: 'resistor-1', pin: '2' },
        to: { componentId: 'led-1', pin: 'A' },
        signal: 'gpio',
        color: '#2f7df6'
      },
      {
        id: 'led-to-ground',
        from: { componentId: 'led-1', pin: 'K' },
        to: { componentId: 'arduino-uno', pin: 'GND' },
        signal: 'ground',
        color: '#20242a'
      }
    ],
    behavior: { runText: locale === 'ko' ? '안전 대체 LED 켜짐' : 'SAFE EQUIVALENT LED ON' },
    assumptions: [
      'The original request is not rendered or treated as build-ready hardware.',
      `Original blocked items: ${originalBlockers.join(', ') || 'unsafe request'}.`,
      'This equivalent uses Arduino low-voltage GPIO, one 5mm LED, and a 220 ohm current-limiting resistor.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function safeEquivalentAssistantMessage(locale: 'ko' | 'en', sourceCircuitSpec: CircuitSpec) {
  const original = sourceCircuitSpec.unsupportedItems.join(', ') || sourceCircuitSpec.intent.primaryGoal;
  if (locale === 'ko') {
    return [
      `원 요청(${original})은 안전상 실제 배선이나 build-ready 회로로 만들지 않습니다.`,
      '대신 검증된 Arduino Uno + 5mm LED + 220Ω 저항의 안전한 저전압 대체 회로를 시뮬레이션으로 보여줄게요.'
    ].join(' ');
  }
  return [
    `I will not turn the original request (${original}) into wiring or build-ready hardware.`,
    'Instead, I am showing a verified safe low-voltage Arduino Uno + 5mm LED + 220 ohm resistor equivalent simulation.'
  ].join(' ');
}

function finalAssistantMessage({
  draftMessage,
  validationReport,
  buildRunnableReport,
  clarification,
  locale
}: {
  draftMessage: string;
  validationReport: AgentRunResult['validationReport'];
  buildRunnableReport: BuildRunnableReport;
  clarification: string | null;
  locale: 'ko' | 'en';
}) {
  if (validationReport.status !== 'invalid' && (validationReport.status !== 'valid' || buildRunnableReport.runnable)) {
    return draftMessage;
  }

  if (validationReport.status === 'valid' && !buildRunnableReport.runnable) {
    const reason = summarizeValidationErrors(buildRunnableReport.reasons);
    if (locale === 'ko') {
      return [
        '회로 초안은 이해했지만 아직 실행 가능한 시뮬레이션으로 확정되지는 않았어요.',
        `막힌 지점: ${reason}`,
        '배치와 시뮬레이션 조건을 다시 맞춰서 검증해야 합니다.'
      ].join(' ');
    }
    return [
      'I understood the circuit draft, but it is not yet a runnable simulation.',
      `Blocked by: ${reason}`,
      'The placement and simulation conditions need to be repaired before build/run.'
    ].join(' ');
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

// Detail sections that belong in the 3D scene / 문서 tab, never in the chat bubble. If the model
// pastes them into assistantMessage anyway, strip them so the student sees only a short reply
// (PLAN_react_routing_and_clean_chat Phase 4). The synthesis prompt also instructs the model not to.
const CHAT_DETAIL_HEADERS = [
  '회로 초안', '배선 요약', '배선 안내', '검증 결과 요약', '검증 결과', '회로도',
  'circuit draft', 'wiring summary', 'validation summary', 'validation result'
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A model on the provider-native structured-output path echoes the full LiveAgentDraft JSON into the
// message text channel (empirical R6.5, PLAN_sensible_simulation P1). If a whole string is that
// serialized draft, return its parsed object so callers can use the inner assistantMessage instead of
// leaking the raw JSON. Returns null for anything that is not a single JSON object with an assistantMessage.
function tryUnwrapDraftText(text: string): { responseKind?: string; assistantMessage?: string; clarification?: unknown; circuitSpec?: unknown } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.assistantMessage === 'string') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function toConciseStudentMessage(message: string): string {
  // 0. If the whole message is a serialized agent draft (provider-native echoes the JSON into the
  // text channel — R6.5), keep only its human assistantMessage.
  let out = tryUnwrapDraftText(message)?.assistantMessage ?? message;
  // 1. Drop fenced code blocks (the embedded CircuitSpec JSON / code dumps).
  out = out.replace(/```[\s\S]*?```/g, ' ');
  // 2. Drop known detail sections: from a bold header to the next bold header or end of message.
  for (const header of CHAT_DETAIL_HEADERS) {
    const re = new RegExp(`\\*\\*\\s*${escapeRegExp(header)}\\s*\\*\\*[\\s\\S]*?(?=\\*\\*[^*\\n]+\\*\\*|$)`, 'gi');
    out = out.replace(re, ' ');
  }
  // 3. Unwrap structural labels, keeping their content — both bold (**assistantMessage**) and bare
  // (assistantMessage:) forms the model sometimes emits as labeled plain text instead of JSON.
  out = out
    .replace(/\*\*\s*(assistantMessage|clarification|message)\s*\*\*/gi, ' ')
    .replace(/\b(assistantMessage|clarificationNeeds|clarification|responseKind|circuitSpec)\s*[:：]\s*/gi, ' ');
  // 4. Remove any stray unfenced JSON-ish content (a whole-line minified object, lone braces/brackets,
  // "key": value lines).
  out = out
    .replace(/^\s*\{".*\}\s*$/gm, ' ')
    .replace(/^\s*[{}[\],]+\s*$/gm, ' ')
    .replace(/^\s*"[^"]+"\s*:.*$/gm, ' ');
  // 5. Collapse whitespace.
  out = out
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return out || message;
}

function sanitizeStudentFacingAssistantMessage(message: string, locale: 'ko' | 'en') {
  let sanitized = message
    .replace(/verified support data gap/gi, locale === 'ko' ? '검증 자료 부족' : 'verified support data gap')
    .replace(/missing verified support data/gi, locale === 'ko' ? '검증 자료 부족' : 'missing verified support data')
    .replace(/verified hardware support data/gi, locale === 'ko' ? '검증 자료' : 'verified hardware data')
    .replace(/verified support data/gi, locale === 'ko' ? '검증 자료' : 'verified support data')
    .replace(/verified source data/gi, locale === 'ko' ? '출처가 확인된 검증 자료' : 'verified source data')
    .replace(/support bundle evidence/gi, locale === 'ko' ? '검증 자료' : 'verified support data')
    .replace(/source-backed support evidence/gi, locale === 'ko' ? '출처가 확인된 검증 자료' : 'verified source data')
    .replace(/source-backed hardware support bundle/gi, locale === 'ko' ? '검증 자료' : 'verified hardware data')
    .replace(/support bundle/gi, locale === 'ko' ? '검증 자료' : 'verified support data')
    .replace(/canonical context bundle/gi, locale === 'ko' ? '검증 자료' : 'verified context data')
    .replace(/canonical context/gi, locale === 'ko' ? '검증 자료' : 'verified context data')
    .replace(/context packet/gi, locale === 'ko' ? '요청 자료' : 'request context')
    .replace(/valid synthesis/gi, locale === 'ko' ? '회로 확정' : 'circuit finalization')
    .replace(/validated synthesis/gi, locale === 'ko' ? '검증된 회로 확정' : 'validated circuit finalization')
    .replace(/CircuitSpec/g, locale === 'ko' ? '회로 초안' : 'circuit draft')
    .replace(/unsupportedItems/g, locale === 'ko' ? '지원하지 않는 항목' : 'unsupported items')
    .replace(/clarificationNeeds/g, locale === 'ko' ? '확인할 점' : 'clarification needs')
    .replace(/render plans?/gi, locale === 'ko' ? '3D 보기' : '3D view')
    .replace(/current-flow claims?/gi, locale === 'ko' ? '전류 흐름 설명' : 'current-flow explanation');

  if (locale === 'ko') {
    sanitized = sanitized
      .replace(/현재 요청 컨텍스트에는\s*(필수\s*)?(지원|소스)\s*번들\s*(증거|근거)가\s*로드되어\s*있지\s*않습니다\.?\s*/g, '이 회로는 아직 검증 자료가 부족합니다. ')
      .replace(/(필수\s*)?(지원|소스)\s*번들\s*(증거|근거)/g, '검증 자료')
      .replace(/빌드 가능한\s*배선도\s*\/\s*렌더\s*\/\s*전류 흐름 시뮬레이션/g, '배선도, 3D 보기, 전류 흐름 시뮬레이션')
      .replace(/빌드 가능한/g, '만들 수 있는')
      .replace(/확정하지 않겠습니다/g, '바로 확정하지 않을게요')
      .replace(/컨텍스트/g, '자료')
      .replace(/렌더링/g, '3D 보기')
      .replace(/렌더/g, '3D 보기')
      .replace(/시뮬레이션으로 확정/g, '시뮬레이션까지 확정')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return sanitized;
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

// Phase 4 — deterministic structured-output fallback. When the agent never emits a structured
// draft (the AGENT_STRUCTURED_OUTPUT_MISSING 502 path), build a deterministic draft instead of
// throwing: a preflight draft for non-synthesis routes, otherwise a clarification draft. This layers
// on the existing recoverDraftFromAgentMessages salvage inside parseLiveAgentDraft. Never null.
function buildStructuredOutputFallbackDraft(
  request: AgentMessageRequest,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>,
  requirementAnalysis: RequirementAnalysis
): LiveAgentDraft {
  const preflight = buildPreflightDraftFromAnalysis(request, contextPacket, requirementAnalysis);
  if (preflight) {
    return preflight;
  }
  const locale = request.locale ?? 'ko';
  const fallback = buildClarificationPreflightDraft(request, contextPacket, {
    ...requirementAnalysis,
    route: 'clarify_requirements',
    assistantMessage: locale === 'ko'
      ? '이번에는 검증된 회로를 합성하지 못했어요. 목표와 사용할 부품을 한 문장으로 알려주시면 다시 시도할게요.'
      : 'I could not synthesize a verified circuit this time. Tell me the goal and the parts in one sentence and I will retry.'
  });
  if (!fallback) {
    throw new Error('Structured-output fallback could not build a clarification draft.');
  }
  return fallback;
}

function structuredOutputFallbackEvent(maxAttempts: number): AgentEvent {
  return AgentEventSchema.parse({
    type: 'coordinator',
    name: 'structured-output-fallback',
    status: 'warning',
    summary: `Agent did not emit a structured draft after ${maxAttempts} attempt(s); returned a deterministic fallback instead of a 502.`
  });
}

async function runAgentDraftRepairLoop({
  traceId,
  sessionId,
  request,
  contextPacket,
  requirementAnalysis,
  requirementDoc,
  draftProvider,
  maxAttempts = 2,
  structuredOutputFallback = false
}: {
  traceId: string;
  sessionId: string;
  request: AgentMessageRequest;
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>;
  requirementAnalysis: RequirementAnalysis;
  // Faithful chain (US-005): the authored requirement document, surfaced in the 문서 tab. Optional
  // (undefined when the chain is off / on scripted paths) -> falls back to the post-synthesis doc.
  requirementDoc?: RequirementDoc;
  draftProvider: DraftProvider;
  maxAttempts?: number;
  // Phase 4 (flag-gated): catch AGENT_STRUCTURED_OUTPUT_MISSING and fall back deterministically
  // instead of surfacing a 502. legacy leaves the throw unguarded (provably unchanged).
  structuredOutputFallback?: boolean;
}): Promise<AgentRunResult> {
  const preflightDraft = buildPreflightDraftFromAnalysis(request, contextPacket, requirementAnalysis);
  if (preflightDraft) {
    const finalized = await finalizeAgentResult({
      sessionId,
      request,
      draft: preflightDraft,
      traceId,
      contextPacket,
      requirementDoc,
      coordinatorEvent: {
        type: 'coordinator',
        name: 'deepagents-coordinator',
        status: 'completed',
        summary: 'Requirement-analysis agent handled the turn before circuit synthesis.'
      },
      repairEvents: [requirementAnalysisEvent(requirementAnalysis)]
    });
    logAgentEvent('agent.validation.completed', {
      traceId,
      sessionId,
      preflight: true,
      ...resultLogSummary(finalized)
    });
    return finalized;
  }

  const repairEvents: AgentEvent[] = [requirementAnalysisEvent(requirementAnalysis)];
  let previousErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let draft: LiveAgentDraft;
    try {
      draft = await draftProvider({ attempt, previousErrors });
    } catch (error) {
      // Phase 4 reliability: a missing structured draft is recoverable, not a 502.
      if (structuredOutputFallback && error instanceof AgentStructuredOutputError) {
        logAgentEvent('agent.synthesis.structured_output_missing', { traceId, sessionId, attempt });
        previousErrors = [...previousErrors, error.errorCode];
        if (attempt < maxAttempts) {
          repairEvents.push(validationRepairEvent(attempt, maxAttempts, previousErrors));
          continue;
        }
        const fallbackDraft = buildStructuredOutputFallbackDraft(request, contextPacket, requirementAnalysis);
        const finalizedFallback = await finalizeAgentResult({
          sessionId,
          request,
          draft: fallbackDraft,
          traceId,
          contextPacket,
          requirementDoc,
          repairEvents: [...repairEvents, structuredOutputFallbackEvent(maxAttempts)]
        });
        logAgentEvent('agent.validation.completed', {
          traceId,
          sessionId,
          attempt,
          structuredOutputFallback: true,
          ...resultLogSummary(finalizedFallback)
        });
        return finalizedFallback;
      }
      throw error;
    }
    // ReAct decision: the agent answered conversationally (greeting / general question /
    // recommendation / clarification) instead of building. Skip synthesis finalization and return a
    // chat result — no circuit is rendered. (Invariant 8 still holds: only circuit drafts revalidate.)
    if (draft.responseKind === 'chat' || !draft.circuitSpec) {
      const chatResult = buildCasualChatResult({
        traceId,
        sessionId,
        request,
        contextPacket,
        reply: composeStudentChatMessage(draft)
      });
      logAgentEvent('agent.validation.completed', {
        traceId,
        sessionId,
        attempt,
        responseKind: 'chat',
        ...resultLogSummary(chatResult)
      });
      return chatResult;
    }
    const finalized = await finalizeAgentResult({
      sessionId,
      request,
      draft,
      traceId,
      contextPacket,
      requirementDoc,
      repairEvents
    });
    logAgentEvent('agent.validation.completed', {
      traceId,
      sessionId,
      attempt,
      ...resultLogSummary(finalized)
    });

    if (finalized.buildRunnableReport.runnable || !shouldAttemptQualityRepair(finalized)) {
      return finalized;
    }

    previousErrors = qualityGateErrors(finalized);
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

function langSmithTags(stage: string, contextPacket: Awaited<ReturnType<typeof buildContextPacket>>) {
  return [
    'h-eduware',
    stage,
    contextPacket.contextRoute.routeId,
    ...contextPacket.capabilityMatches.map((capability) => `capability:${capability.id}`),
    `eligibility:${contextPacket.contextCoverage.synthesisEligibility.status}`
  ];
}

function liveDraftLogSummary(draft: LiveAgentDraft) {
  const spec = draft.circuitSpec;
  return {
    responseKind: draft.responseKind,
    clarificationPresent: Boolean(draft.clarification),
    circuitSpecId: spec?.id ?? null,
    componentCount: spec?.components.length ?? 0,
    connectionCount: spec?.connections.length ?? 0,
    unsupportedItemCount: spec?.unsupportedItems.length ?? 0,
    clarificationNeedCount: spec?.clarificationNeeds.length ?? 0,
    agentEventCount: draft.agentEvents.length,
    supportedAlternativeCount: draft.supportedAlternatives.length
  };
}

function toolNamesFor(tools: Array<{ name?: unknown }>) {
  return tools
    .map((agentTool) => agentTool.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

function subagentNamesFor(subagents: SubAgent[]) {
  return subagents.map((subagent) => subagent.name);
}

function buildPreflightDraftFromAnalysis(
  request: AgentMessageRequest,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>,
  requirementAnalysis: RequirementAnalysis
): LiveAgentDraft | null {
  // Hard safety guardrail (server-enforced, NOT agent-optional): unsupported/unsafe requests never
  // reach synthesis. Everything else — including clarify_requirements — now reaches the agent, which
  // owns the ReAct decision (answer conversationally vs build). Invariant 6 stays intact.
  if (requirementAnalysis.route === 'unsupported_or_gap') {
    return buildUnsupportedPreflightDraft(request, contextPacket, requirementAnalysis);
  }

  return null;
}

function requirementAnalysisEvent(requirementAnalysis: RequirementAnalysis): AgentEvent {
  return AgentEventSchema.parse({
    type: 'coordinator',
    name: 'requirement-analysis-agent',
    status: 'completed',
    summary: `${requirementAnalysis.route}: ${requirementAnalysis.summary}`
  });
}

function buildUnsupportedPreflightDraft(
  request: AgentMessageRequest,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>,
  requirementAnalysis: RequirementAnalysis
): LiveAgentDraft | null {
  const supportGaps = uniqueStrings(contextPacket.supportGaps);
  const unsupportedSignals = uniqueStrings(contextPacket.unsupportedSignals);
  const isUnsupportedSafetyRoute = contextPacket.contextRoute.routeId === 'unsupported-safety';
  const hasUnsupportedCapability = contextPacket.capabilityMatches.some((capability) =>
    capability.supportLevel === 'unsupported'
  );

  const isPlannedContextGap = supportGaps.length > 0 && !isUnsupportedSafetyRoute && !hasUnsupportedCapability;

  const locale = request.locale ?? 'ko';
  const blockedItems = uniqueStrings([...unsupportedSignals, ...supportGaps]);
  const unsupportedItems = isPlannedContextGap
    ? supportGaps
    : blockedItems.length > 0
      ? blockedItems
    : [requirementAnalysis.blockingReason ?? 'unsupported or incomplete request outside the current build-ready scope'];
  const safeAlternative = locale === 'ko'
    ? 'Arduino 5V, GND, 220Ω 저항, LED처럼 안전한 저전압 회로로 바꾸면 설계와 시뮬레이션을 진행할 수 있습니다.'
    : 'I can help reframe this as a safe low-voltage Arduino circuit, such as Arduino 5V, GND, a 220 ohm resistor, and an LED.';
  const supportedAlternatives = [
    defaultSupportedAlternative(locale, isPlannedContextGap ? 'context-support-gap' : 'safety-policy')
  ];
  const safetyMessage = locale === 'ko'
    ? `이 요청은 감전이나 화재 위험이 있는 고전압/지원불가 회로라서 배선도나 시뮬레이션으로 만들 수 없습니다. ${safeAlternative}`
    : `This request is unsafe or unsupported for a student breadboard simulation, so I cannot turn it into wiring or a runnable circuit. ${safeAlternative}`;
  const supportGapMessage = 'This request matches H-eduware hardware that is not fully verified yet, so I cannot finalize wiring, 3D view, or current simulation. Choose a currently supported circuit or add the missing verified hardware data first.';
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
    : 'Choose a currently supported circuit, or add the missing verified hardware data before finalizing the circuit.';
  const clarification = requirementAnalysis.clarification ?? (isPlannedContextGap ? supportGapClarification : safetyClarification);
  const diagnosticComponents = diagnosticPreflightComponents(contextPacket, isPlannedContextGap);

  return LiveAgentDraftSchema.parse({
    assistantMessage: requirementAnalysis.assistantMessage || assistantMessage,
    clarification,
    circuitSpec: {
      id: 'unsupported-safety-request',
      title: isPlannedContextGap
        ? locale === 'ko' ? '지원 준비 중인 하드웨어 진단 장면' : 'Hardware Support Gap Diagnostic Scene'
        : locale === 'ko' ? '지원하지 않는 안전 위험 요청' : 'Unsupported safety-risk request',
      intent: {
        primaryGoal: request.message,
        output: 'unsupported',
        controller: 'none',
        behavior: 'unsafe-or-unsupported'
      },
      components: diagnosticComponents,
      connections: [],
      behavior: { runText: isPlannedContextGap ? 'DIAGNOSTIC VIEW' : 'UNSUPPORTED' },
      assumptions: [
        'H-eduware only simulates safe, low-voltage educational breadboard circuits.',
        ...(isPlannedContextGap ? ['The visible scene is diagnostic only; exact wiring and current-flow claims are blocked until support data is complete.'] : []),
        `Context route: ${contextPacket.contextRoute.routeId}.`
      ],
      unsupportedItems,
      clarificationNeeds: [clarification]
    },
    agentEvents: [
      {
        type: 'validation',
        name: isPlannedContextGap ? 'context-support-gap' : 'safety-policy',
        status: 'warning',
        summary: isPlannedContextGap
          ? `This request needs more verified hardware data before circuit finalization: ${unsupportedItems.join(', ')}.`
          : `Unsupported or unsafe signals: ${unsupportedItems.join(', ')}.`
      }
    ],
    supportedAlternatives
  });
}

function diagnosticPreflightComponents(
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>,
  includeCandidateParts: boolean
): CircuitSpec['components'] {
  type DiagnosticComponent = CircuitSpec['components'][number];
  const candidates = includeCandidateParts
    ? contextPacket.candidateParts
      .filter((part) => part.id !== 'jumper-wire')
      .slice(0, 8)
    : [];
  const byPartId = new Map(candidates.map((part) => [part.id, part]));
  const orderedPartIds = uniqueStrings([
    byPartId.has('breadboard-half') ? 'breadboard-half' : '',
    byPartId.has('arduino-uno') ? 'arduino-uno' : '',
    ...candidates.map((part) => part.id)
  ].filter(Boolean));

  const components: DiagnosticComponent[] = orderedPartIds
    .flatMap((partId, index): DiagnosticComponent[] => {
      const part = byPartId.get(partId);
      if (!part) {
        return [];
      }
      return [{
        id: diagnosticComponentId(partId),
        partId,
        label: part.label,
        designator: diagnosticDesignator(part.kind, index)
      }];
    });

  if (components.length > 0) {
    return components;
  }

  return [{
    id: 'arduino-uno',
    partId: 'arduino-uno',
    label: 'Arduino Uno',
    designator: 'U1'
  }];
}

function diagnosticComponentId(partId: string) {
  if (partId === 'breadboard-half') {
    return 'breadboard';
  }
  return partId.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'diagnostic-part';
}

function diagnosticDesignator(kind: string, index: number) {
  const prefix = kind === 'controller'
    ? 'U'
    : kind === 'board'
      ? 'BB'
      : kind === 'input'
        ? 'S'
        : kind === 'output'
          ? 'OUT'
          : kind === 'passive'
            ? 'P'
            : 'X';
  return `${prefix}${index + 1}`;
}

function defaultSupportedAlternative(
  locale: 'ko' | 'en',
  source: SupportedAlternative['source']
): SupportedAlternative {
  return SupportedAlternativeSchema.parse({
    id: 'safe-low-voltage-led',
    goal: locale === 'ko'
      ? 'Arduino Uno + 5mm LED + 220Ω 저항으로 안전한 저전압 LED 회로 만들기'
      : 'Build a safe low-voltage Arduino Uno LED circuit with a 5mm LED and 220 ohm resistor',
    label: locale === 'ko' ? '안전한 Arduino LED 회로' : 'Safe Arduino LED circuit',
    reason: locale === 'ko'
      ? '현재 검증된 부품과 시뮬레이션 경로가 준비된 안전한 대안입니다.'
      : 'This alternative uses verified low-voltage parts and a supported simulation path.',
    source,
    partIds: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire'],
    capabilityIds: ['digital-light-output']
  });
}

function buildClarificationPreflightDraft(
  request: AgentMessageRequest,
  contextPacket: Awaited<ReturnType<typeof buildContextPacket>>,
  requirementAnalysis: RequirementAnalysis
): LiveAgentDraft | null {
  const locale = request.locale ?? 'ko';
  const clarification = locale === 'ko'
    ? '만들고 싶은 회로의 입력, 출력, 동작을 한 문장으로 알려 주세요. 예: Arduino Uno D9로 LED를 깜빡이기.'
    : 'Tell me the circuit input, output, and behavior in one sentence. Example: blink an LED from Arduino Uno D9.';

  return LiveAgentDraftSchema.parse({
    assistantMessage: requirementAnalysis.assistantMessage,
    clarification: requirementAnalysis.clarification ?? clarification,
    circuitSpec: {
      id: 'clarification-needed',
      title: locale === 'ko' ? '회로 요청 구체화 필요' : 'Circuit request needs clarification',
      intent: {
        primaryGoal: request.message,
        output: 'clarification-needed',
        controller: 'none',
        behavior: requirementAnalysis.route
      },
      components: [{
        id: 'arduino-uno',
        partId: 'arduino-uno',
        label: 'Arduino Uno',
        designator: 'U1'
      }],
      connections: [],
      behavior: { runText: 'CLARIFY' },
      assumptions: [
        'No concrete circuit input, output, or hardware behavior was identified yet.',
        `Requirement analysis route: ${requirementAnalysis.route}.`,
        `Requirement analysis summary: ${requirementAnalysis.summary}.`,
        `Context route: ${contextPacket.contextRoute.routeId}.`
      ],
      unsupportedItems: ['clarification-required'],
      clarificationNeeds: [requirementAnalysis.clarification ?? clarification]
    },
    agentEvents: []
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

  const catalogPartId = item.match(/(?:context-known|pin-known|unsafe-blocked|catalog-only|visual-only) hardware ([^\s]+)/i)?.[1]?.trim();
  if (catalogPartId) {
    return catalogPartId;
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

  const recoveredCandidate = candidate ?? recoverDraftFromAgentMessages(output);
  if (!recoveredCandidate) {
    throw new AgentStructuredOutputError();
  }

  const draft = LiveAgentDraftSchema.parse(recoveredCandidate);
  // responseKind is authoritative: a 'circuit' draft MUST carry a circuitSpec. If the model claims a
  // circuit but omits the spec, treat it as a recoverable structured-output miss (-> bounded repair /
  // deterministic fallback) rather than silently degrading a build request into a chat reply.
  if (draft.responseKind === 'circuit' && !draft.circuitSpec) {
    throw new AgentStructuredOutputError('Circuit draft is missing its circuitSpec.');
  }
  return draft;
}

function recoverDraftFromAgentMessages(output: unknown) {
  const messages = output && typeof output === 'object' && Array.isArray((output as Record<string, unknown>).messages)
    ? (output as Record<string, unknown>).messages as unknown[]
    : [];
  if (messages.length === 0) {
    return null;
  }

  const assistantTextRaw = latestAssistantText(messages);
  // The model may emit the whole draft as plain JSON text with no structured tool call (the live leak).
  // Unwrap it so the inner human message is recovered instead of the serialized blob.
  const unwrapped = assistantTextRaw ? tryUnwrapDraftText(assistantTextRaw) : null;
  const assistantText = unwrapped?.assistantMessage ?? assistantTextRaw;
  const circuitSpec = latestCircuitSpecFromToolCalls(messages) ?? unwrapped?.circuitSpec ?? null;
  if (!circuitSpec) {
    // The agent answered conversationally (greeting / recommendation / clarification) in plain text
    // WITHOUT emitting the structured circuit tool — a perfectly valid ReAct outcome. Recover it as a
    // chat reply instead of failing with AGENT_STRUCTURED_OUTPUT_MISSING. This is what makes a greeting
    // robust on the live path (legacy mode has no structured-output fallback), where the model often
    // just replies in natural language for non-circuit turns.
    if (assistantText) {
      return {
        responseKind: 'chat',
        assistantMessage: assistantText,
        clarification: null,
        circuitSpec: null,
        agentEvents: []
      };
    }
    return null;
  }

  return {
    responseKind: 'circuit',
    assistantMessage: assistantText ?? '회로 초안을 만들었습니다. 서버 검증 결과를 기준으로 배선과 시뮬레이션을 준비할게요.',
    clarification: null,
    circuitSpec,
    agentEvents: toolCallEvents(messages)
  };
}

function latestCircuitSpecFromToolCalls(messages: unknown[]) {
  for (const message of [...messages].reverse()) {
    for (const call of [...toolCallsForMessage(message)].reverse()) {
      const args = call.args && typeof call.args === 'object'
        ? call.args as Record<string, unknown>
        : {};
      const spec = args.spec ?? args.circuitSpec;
      if (spec) {
        return spec;
      }
    }
  }
  return null;
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

function toolCallEvents(messages: unknown[]): AgentEvent[] {
  const seen = new Set<string>();
  return messages
    .flatMap(toolCallsForMessage)
    .map((call) => call.name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => {
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .map((name) => AgentEventSchema.parse({
      type: 'tool',
      name,
      status: 'completed',
      summary: `Recovered completed ${name} tool call from Deepagents message history.`
    }));
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

export function parseRequirementAnalysis(output: unknown): RequirementAnalysis {
  const candidate = output && typeof output === 'object'
    ? (output as Record<string, unknown>).structuredResponse ?? (output as Record<string, unknown>).structured_response
    : null;

  if (!candidate) {
    throw new AgentStructuredOutputError('Deepagents did not return a structured requirement analysis.');
  }

  return RequirementAnalysisSchema.parse(candidate);
}

function buildRequirementAnalysisSystemPrompt({
  locale,
  contextPacketBlock
}: {
  locale: 'ko' | 'en';
  contextPacketBlock: string;
}) {
  const language = locale === 'ko' ? 'Korean' : 'English';
  return [
    `Respond to the student in natural ${language}.`,
    'You are the first Deepagents requirement-analysis analyst for H-eduware.',
    'Your only job is to understand the student turn and choose the next workflow route. Do not create CircuitSpec, wiring, render plans, or simulation claims in this step.',
    '',
    'Routes:',
    '- casual_chat: greetings, meta conversation, or "let us start" style messages with no concrete circuit goal.',
    '- clarify_requirements: the student wants a circuit but has not provided enough input/output/behavior detail.',
    '- synthesize_circuit: the student gave a concrete, supported circuit goal that can move to circuit synthesis.',
    '- unsupported_or_gap: the request is unsafe, unsupported, planned, context-known-only, visual-only, or source/context evidence is insufficient for build-ready synthesis.',
    '',
    'Use the CONTEXT PACKET as routing evidence. If context coverage is ineligible because of ambiguity, route casual_chat or clarify_requirements. If it is ineligible because of support gaps, unsupported hardware, or safety, route unsupported_or_gap. Only route synthesize_circuit when the message contains a concrete circuit behavior and the packet supports valid_circuit_synthesis.',
    'Return concise student-facing text. For casual_chat or clarify_requirements, ask one friendly next question. For synthesize_circuit, summarize the interpreted goal without overpromising validity. For unsupported_or_gap, explain the blocker and offer a supported next step.',
    '',
    contextPacketBlock
  ].join('\n');
}

function buildRequirementAnalysisUserPrompt(request: AgentMessageRequest) {
  return [
    `Student message: ${request.message}`,
    request.confirmation ? `Student confirmation/context: ${request.confirmation}` : '',
    renderConversationContextForPrompt(request),
    'Analyze this turn first. Choose exactly one route value and return the structured requirement analysis.'
  ].filter(Boolean).join('\n');
}

export function buildSystemPrompt({
  locale,
  operatingMemory,
  coordinatorPrompt,
  registrySummary,
  contextPacketBlock
}: {
  locale: 'ko' | 'en';
  operatingMemory: string;
  coordinatorPrompt: string;
  registrySummary: string;
  contextPacketBlock: string;
}) {
  const language = locale === 'ko' ? 'Korean' : 'English';

  return [
    coordinatorPrompt,
    operatingMemory,
    `Respond in natural ${language}. You are H-eduware's circuit tutor for students.`,
    '',
    // ReAct decision contract (LangChain Deep Agents: reason -> optionally call tools -> answer).
    'DECIDE this turn first, then act:',
    '- Greeting, small talk, or a GENERAL question (a concept, "what is X", or "recommend a circuit" with no concrete build target): answer warmly in the student\'s language. For a recommendation, suggest 2-3 concrete buildable circuits from the supported parts and invite the student to pick one to build. Set responseKind="chat" and circuitSpec=null. Never fabricate a circuit just to have one.',
    '- The request is too vague to build — no clear output device (e.g. "뭔가 만들어줘", "회로 추천"), or a required sensor/detail is missing: call the ask_to_narrow tool to offer grounded options the student can tap (level="output" for categories; a category id like "sensor-readout"/"motion" to drill down). Prefer ask_to_narrow over a free-text question whenever concrete options exist. After the student picks a capability, build it.',
    '- A concrete, buildable circuit goal: build it. Set responseKind="circuit" and return a full CircuitSpec.',
    'When unsure whether a request is buildable or within the supported scope, call assess_request_scope and respect its verdict.',
    '',
    'When building a circuit:',
    'Build only safe, low-voltage educational Arduino/breadboard circuits.',
    'Use the CONTEXT PACKET and tool outputs as source of truth. Do not invent parts, pins, protocols, wiring, render support, or simulator behavior.',
    'Build-ready requires complete verified hardware data plus deterministic validation. Otherwise return unsupportedItems or one clarification.',
    'Student text must avoid internal terms like context packet, support bundle evidence, structured output, and CircuitSpec; say verified hardware data or 검증 자료.',
    'Put ONLY a short, friendly human explanation in assistantMessage — do NOT paste the CircuitSpec JSON, wiring tables, or validation summaries into it; the server renders the circuit, wiring, and document views separately.',
    'Return assistantMessage, clarification, CircuitSpec, and concise agentEvents. The server independently validates, renders, simulates, and gates the draft.',
    '',
    contextPacketBlock,
    '',
    'Supported canonical parts:',
    registrySummary
  ].join('\n');
}

export function buildAgentUserPrompt(
  request: AgentMessageRequest,
  repair?: { attempt: number; previousErrors: string[] },
  options?: { requirementBrief?: string }
) {
  // Faithful chain: when a requirement document is authored, it LEADS the prompt as the requirement
  // of record. The raw "Student message" line is KEPT for lexical grounding (verbatim nuance, M2).
  // When no brief is supplied (flag off / non-synthesize route) the prompt is byte-identical to before.
  const briefBlock = options?.requirementBrief
    ? [
        '=== REQUIREMENT DOCUMENT — build a circuit that satisfies this ===',
        options.requirementBrief,
        '=== END REQUIREMENT DOCUMENT ===',
        ''
      ]
    : [];
  const lines = [
    ...briefBlock,
    `Student message: ${request.message}`,
    request.confirmation ? `Student confirmation/context: ${request.confirmation}` : '',
    renderConversationContextForPrompt(request),
    'Build a circuit (responseKind="circuit") only if this is a concrete, buildable goal; otherwise answer conversationally (responseKind="chat", circuitSpec=null) — greet, recommend buildable options, or ask one targeted clarification.'
  ].filter(Boolean);

  if (repair && repair.attempt > 1 && repair.previousErrors.length > 0) {
    lines.push(
      `Repair attempt ${repair.attempt}: the previous draft failed deterministic server quality gates.`,
      'Repair only by returning a new CircuitSpec grounded in the same context packet. Do not invent parts, pins, protocols, or simulator behavior.',
      `Previous quality gate errors:\n${repair.previousErrors.map((error) => `- ${error}`).join('\n')}`
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
    artifact?.simulationPlan?.status ? `- simulationStatus=${artifact.simulationPlan.status}` : '',
    artifact?.buildRunnableReport?.status ? `- buildRunnableStatus=${artifact.buildRunnableReport.status}; runnable=${artifact.buildRunnableReport.runnable ? 'yes' : 'no'}` : '',
    artifact?.buildRunnableReport?.reasons?.length ? `- buildRunnableReasons=${artifact.buildRunnableReport.reasons.slice(0, 3).join('; ')}` : ''
  ].filter(Boolean);

  if (context.recentTurns.length > 0) {
    lines.push(
      'Recent conversation:',
      ...context.recentTurns.slice(-6).map((turn) => `- ${turn.role}: ${turn.text}`)
    );
  }

  // Phase 5b — advisory running summary injection.
  // The server RE-COMPUTES the summary from the server-validated recentTurns each request.
  // Any client-supplied runningSummary is UNTRUSTED/advisory: it is never echoed into an
  // authority-bearing block.  The clearly-delimited block below is excluded from the
  // canonical authority chain (consistent with the "never invent parts/pins/protocols" posture).
  const serverDerivedSummary = foldRunningSummary(
    context.recentTurns,
    // locale is not accessible here; the summary is locale-agnostic (role prefixes only)
    'en'
  );
  if (serverDerivedSummary) {
    lines.push(
      '',
      '--- EARLIER CONTEXT (advisory, non-authoritative — never a source of parts/pins/protocols) ---',
      serverDerivedSummary,
      '--- END EARLIER CONTEXT ---'
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
    `pins=${part.pins.map((pin) => pin.name).join(', ') || 'none'}`,
    `protocols=${part.protocols.join(', ') || 'none'}`,
    `requires=${part.requiredPassives.map((passive) => passive.partId).join(', ') || 'none'}`
  ].join('; ')).join('\n');
}

function renderSubagentPromptBudgetText(subagents: SubAgent[]) {
  return subagents.map((subagent) => [
    `Subagent: ${subagent.name}`,
    subagent.description ? `Description: ${subagent.description}` : '',
    subagent.systemPrompt ? `Prompt: ${subagent.systemPrompt}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');
}

function createSubagents(toolOptions: HeduwareAgentToolsOptions): SubAgent[] {
  const tools = () => createHeduwareAgentTools(toolOptions);
  return [
    {
      name: 'intent-analyst',
      description: 'Extract goal, I/O behavior, ambiguity, and safety concerns.',
      systemPrompt: 'Return concise intent facts needed for CircuitSpec drafting.'
    },
    {
      name: 'context-retriever',
      description: 'Retrieve bounded registry/context facts.',
      systemPrompt: 'Use context tools only for selected sources. Return concise bundle-backed facts.',
      tools: tools()
    },
    {
      name: 'circuit-synthesizer',
      description: 'Draft candidate CircuitSpec from intent and registry data.',
      systemPrompt: 'Use supported part ids and exact pins only. Do not claim validity.'
    },
    {
      name: 'constraint-validator',
      description: 'Review validation, netlist, safety, and gaps.',
      systemPrompt: 'Call validation tools and report authoritative gaps/errors.',
      tools: tools()
    },
    {
      name: 'simulation-planner',
      description: 'Plan simulation from validated artifacts.',
      systemPrompt: 'Current-flow statements require valid netlist/current path tool outputs.',
      tools: tools()
    },
    {
      name: 'lesson-explainer',
      description: 'Write student-facing explanation.',
      systemPrompt: 'Explain concisely and avoid unsupported claims.'
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

function shouldAttemptQualityRepair(result: AgentRunResult) {
  if (result.validationReport.status === 'invalid') {
    return !result.validationReport.errors.some((error) =>
      error.startsWith('CONTEXT_COVERAGE_INSUFFICIENT') ||
      error.startsWith('CONTEXT_CANDIDATE_PART_NOT_ALLOWED')
    );
  }

  return result.validationReport.status === 'valid' && !result.buildRunnableReport.runnable;
}

function qualityGateErrors(result: AgentRunResult) {
  if (result.validationReport.status === 'invalid') {
    return result.validationReport.errors;
  }
  return result.buildRunnableReport.reasons.length > 0
    ? result.buildRunnableReport.reasons
    : [`build runnable gate status is ${result.buildRunnableReport.status}`];
}

function validationRepairEvent(attempt: number, maxAttempts: number, errors: string[]): AgentEvent {
  return AgentEventSchema.parse({
    type: 'validation',
    name: 'validation-repair',
    status: 'warning',
    summary: `Attempt ${attempt}/${maxAttempts} failed deterministic quality gates: ${summarizeValidationErrors(errors)}`
  });
}

function validationRepairExhaustedEvent(maxAttempts: number, errors: string[]): AgentEvent {
  return AgentEventSchema.parse({
    type: 'validation',
    name: 'validation-repair-exhausted',
    status: 'warning',
    summary: `Stopped after ${maxAttempts} bounded quality-gate attempts: ${summarizeValidationErrors(errors)}`
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

function deriveServingStatus(result: {
  contextCoverage: ContextCoverageReport;
  buildRunnableReport?: BuildRunnableReport;
  solverGateResult?: SolverGateResult;
  unsupportedItems?: string[];
}): z.infer<typeof ServingStatusSchema> {
  if (
    result.solverGateResult?.mode === 'safe_equivalent_simulation'
    || result.solverGateResult?.buildReadyScope === 'displayed_equivalent'
  ) {
    return 'safe_equivalent';
  }

  if (result.contextCoverage.synthesisEligibility.status !== 'eligible') {
    return result.unsupportedItems?.length ? 'unsupported' : 'needs_clarification';
  }

  if (result.buildRunnableReport?.runnable) {
    return 'buildable_original';
  }

  return 'review_only_diagnostic';
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
      ? `이 회로를 확정하기에는 검증 자료가 부족합니다: ${firstWarning}`
      : '이 회로를 확정하기에는 검증 자료가 부족합니다. 지원 부품, 검증 규칙, 3D 보기 근거를 더 확인해야 합니다.';
  }

  return firstWarning
    ? `I need more verified context data before finalizing this circuit: ${firstWarning}`
    : 'I need more verified context data before finalizing this circuit.';
}
