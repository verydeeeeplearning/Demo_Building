# CLAUDE.md — H-eduware project rules

See `AGENTS.md` for the full agent instructions (source-of-truth specs, stack, harness contract,
test expectations, security). This file captures rules that MUST hold for every change.

## Framework-native agent work (non-negotiable)

This repository's core agent engine is built on the LangChain ecosystem:
LangChain, LangGraph, Deep Agents, and LangSmith. Treat these as first-class
runtime infrastructure, not incidental dependencies.

When implementing or modifying agent behavior (`server/agent/*`, `server/context/*`,
agent observability/evaluation code, and especially `server/agent/deepAgentRuntime.ts`),
**always consult the official documentation for the affected LangChain ecosystem
component first, verify the current TypeScript/JavaScript pattern and signatures,
and use the framework-native mechanism — never hand-roll a bespoke equivalent.**

If the official framework-native path is unclear, surface that uncertainty before
writing custom glue. Do not implement from memory when the behavior depends on
LangChain, LangGraph, Deep Agents, or LangSmith runtime semantics.

- **Memory** → LangGraph **checkpointer + `thread_id`** (short-term, per-thread conversation) and
  **`Store`/`BaseStore`** (long-term, cross-thread). Do NOT re-implement conversation memory by
  manually re-injecting `recentTurns` or folding a running summary by hand.
- **Clarification / narrowing / "역제안"** → LangGraph **`interrupt()` + `Command({ resume })`**
  human-in-the-loop. Do NOT invent a custom response field the LLM is merely *hoped* to fill, and do
  NOT hardcode menus/content in `.ts`.
- **Stateful subagent** → official pattern: subagent `checkpointer: true` + `toolCallLimitMiddleware`.
- **Tracing / observability / evals** → LangSmith official tracing, metadata, dataset, and
  evaluation patterns. Do NOT replace them with ad-hoc prompt logging or secret-bearing traces.
- **Curated content** (starter examples, recommendations) lives in the `agent-context/` **data
  layer**, never in application code.

**Official docs to cite/check before agent implementation:**
- Repo workflow anchor: `docs/agent-request-to-simulation-workflow.md`
  (ordered request-to-simulation flow, context layer role, LangChain ecosystem usage,
  and logging checkpoints)
- `/langchain-ai/deepagentsjs` (Deep Agents, TypeScript)
- `/websites/langchain_oss_javascript_langgraph` (LangGraph, JavaScript)
- Official web docs: LangChain JS, LangGraph JS, Deep Agents JS, and LangSmith docs

Before writing agent code: query the docs for the exact pattern + signatures, design on top of
checkpointer / store / interrupt, use LangSmith-native tracing/evaluation patterns when relevant,
put any curated content in data, and read `docs/agent-request-to-simulation-workflow.md` before
changing the main chat serving path from user request to simulation output. Mention the consulted
official docs in implementation notes when the change depends on ecosystem behavior.

## Clean Architecture & TDD

Follow the global Clean Architecture + test-first workflow (see `~/.claude/CLAUDE.md`). Dependencies
point inward; domain has no framework deps; curated content is data, not code.
