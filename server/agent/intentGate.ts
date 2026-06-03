// Front intent gate (PLAN_intent_gate.md).
//
// A lightweight, LLM-JUDGED classifier that runs BEFORE circuit synthesis in every pipeline mode.
// It answers one question — "is this message circuit work, or general conversation?" — so a greeting
// or a general/educational question gets a real conversational answer instead of being forced through
// structured circuit synthesis (which would throw AGENT_STRUCTURED_OUTPUT_MISSING).
//
// Clean Architecture: this is an application-layer use case. It depends only on the ModelPort /
// DeepAgentFactory abstractions (never on ChatOpenAI directly), so tests drive it with a fake agent
// and zero live OpenAI calls. The decision is agent-side judgement, not a regex/rule table.
//
// Fail-open: any invoke/parse failure resolves to `circuit_request` so a flaky gate can never block a
// real circuit request — it just falls through to the existing synthesis pipeline.

import { toolStrategy } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import type { DeepAgentFactory } from './agentRuntimePorts.ts';
import { logAgentEvent } from './agentLogger.ts';
import {
  IntentDecisionSchema,
  type AgentMessageRequest,
  type IntentDecision
} from './schemas.ts';

export interface IntentGateInput {
  request: AgentMessageRequest;
  model: BaseChatModel;
  deepAgentFactory: DeepAgentFactory;
  traceId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/** Classifies a student message as circuit work or casual chat. Structurally injectable for tests. */
export type IntentGate = (input: IntentGateInput) => Promise<IntentDecision>;

/**
 * Runtime kill-switch for the front intent gate (mirrors getAgentPipelineMode / getComposeMode).
 * Default 'on'. Set H_EDUWARE_INTENT_GATE=off to restore exact pre-gate behavior (every message
 * goes straight to requirement-analysis / synthesis as before).
 */
export function getIntentGateMode(env: NodeJS.ProcessEnv = process.env): 'on' | 'off' {
  return (env.H_EDUWARE_INTENT_GATE ?? '').trim().toLowerCase() === 'off' ? 'off' : 'on';
}

const CIRCUIT_REQUEST_FALLBACK: IntentDecision = {
  kind: 'circuit_request',
  reply: null,
  reason: 'intent-gate-fallback'
};

export const classifyStudentIntent: IntentGate = async (input) => {
  const locale = input.request.locale ?? 'ko';
  const agent = input.deepAgentFactory({
    model: input.model,
    tools: [],
    responseFormat: toolStrategy(IntentDecisionSchema),
    systemPrompt: buildIntentSystemPrompt(locale),
    name: 'h-eduware-intent-gate'
  });

  try {
    const output = await agent.invoke({
      messages: [{ role: 'user', content: buildIntentUserPrompt(input.request) }]
    }, {
      runName: 'h-eduware-intent-gate',
      tags: ['h-eduware', 'intent-gate'],
      metadata: { ...(input.metadata ?? {}), traceId: input.traceId },
      configurable: { thread_id: input.sessionId ? `${input.sessionId}:intent-gate` : undefined }
    });
    return normalizeDecision(parseIntentDecision(output));
  } catch (error) {
    // Fail-open: a flaky gate must never block a real circuit request.
    logAgentEvent('agent.intent.gate.failed', {
      traceId: input.traceId,
      sessionId: input.sessionId,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return CIRCUIT_REQUEST_FALLBACK;
  }
};

export function parseIntentDecision(output: unknown): IntentDecision {
  const candidate = output && typeof output === 'object'
    ? (output as Record<string, unknown>).structuredResponse ?? (output as Record<string, unknown>).structured_response
    : null;

  if (!candidate) {
    throw new Error('Intent gate did not return a structured decision.');
  }

  return IntentDecisionSchema.parse(candidate);
}

/** Circuit requests never carry a chat reply; casual chat must carry a non-empty one. */
function normalizeDecision(decision: IntentDecision): IntentDecision {
  if (decision.kind === 'circuit_request') {
    return { ...decision, reply: null };
  }
  if (!decision.reply || decision.reply.trim().length === 0) {
    // A casual_chat decision with no authored reply is unusable — fall through to circuit work.
    return CIRCUIT_REQUEST_FALLBACK;
  }
  return decision;
}

function buildIntentSystemPrompt(locale: 'ko' | 'en'): string {
  const replyLanguage = locale === 'ko' ? 'Korean' : 'English';
  return [
    'You are the front intent gate for H-eduware, a breadboard circuit learning app for students.',
    'Classify the student\'s LATEST message into exactly one kind:',
    '- circuit_request: they want to design, build, modify, explain, or simulate a specific circuit,',
    '  OR they are answering a follow-up about a circuit (e.g. "응 만들어줘", giving input/output detail).',
    '- casual_chat: a greeting, small talk, thanks, or a GENERAL question (concept, theory, "what is X")',
    '  that is not itself a request to build a particular circuit.',
    'BIAS: when the message is ambiguous, or shows any concrete circuit goal, choose circuit_request.',
    'Never choose casual_chat just because a circuit request is vague — that path has its own clarify step.',
    `For casual_chat: write "reply" as a warm, concise answer in ${replyLanguage}. If it is a real`,
    'question, actually answer it (briefly explain the concept), then invite them to build a related',
    'circuit. For a greeting, greet back and ask what circuit they want to make.',
    'For circuit_request: set "reply" to null.',
    'Always set "kind", "reply", and a one-line "reason".'
  ].join('\n');
}

function buildIntentUserPrompt(request: AgentMessageRequest): string {
  const turns = request.conversationContext?.recentTurns ?? [];
  const historyBlock = turns.length > 0
    ? ['Recent conversation (oldest first):', ...turns.map((turn) => `- ${turn.role}: ${turn.text}`), ''].join('\n')
    : '';
  return `${historyBlock}Latest student message:\n"""\n${request.message}\n"""`;
}
