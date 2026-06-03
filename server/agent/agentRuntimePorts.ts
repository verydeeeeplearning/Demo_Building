// Application ports for the agent runtime (Agent Pipeline Refactor, Phase 0.5 seams).
//
// These abstractions let the composition root inject real implementations in production and fakes
// in tests, so reliability / one-run / catalog-growth can be GATED deterministically without ever
// calling a live model (Clean Architecture: inner layers depend on these ports, not on ChatOpenAI
// or deepagents directly).
//
//   ModelPort        — creates the chat model. Default wraps ChatOpenAI (+ live config); a test
//                      double returns a fake BaseChatModel so zero live calls happen.
//   DeepAgentFactory — constructs a deep agent from a config. Default is deepagents.createDeepAgent;
//                      a counting double asserts exactly-one-construction (Phase 3).
//
// Default implementations live in `deepAgentRuntime.ts` (next to the live config + model options
// they need); only the *types* live here to keep the port boundary dependency-light.

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { createDeepAgent } from 'deepagents';

/** Creates the chat model used by the requirement-analysis and synthesis agents. */
export interface ModelPort {
  createModel(): BaseChatModel;
}

/** Constructs a deep agent. Structurally identical to `deepagents.createDeepAgent`. */
export type DeepAgentFactory = typeof createDeepAgent;

/** Injectable runtime dependencies; all optional so production callers pass nothing. */
export type AgentRuntimeDeps = {
  modelPort?: ModelPort;
  deepAgentFactory?: DeepAgentFactory;
  // Front intent gate (PLAN_intent_gate.md). Default is the LLM-judged classifyStudentIntent; tests
  // inject a passthrough so deterministic-route assertions stay exact. Inline import type keeps the
  // port boundary free of a value-level dependency on the gate module.
  intentGate?: import('./intentGate.ts').IntentGate;
};
