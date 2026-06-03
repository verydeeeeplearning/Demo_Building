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
import type { BaseCheckpointSaver } from '@langchain/langgraph';
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
  // LangGraph checkpointer for the conversation agent (thread_id = sessionId). Production omits it and
  // uses the shared in-process MemorySaver; a durable saver (Phase 4) or a test double is injected here.
  checkpointer?: BaseCheckpointSaver;
};
