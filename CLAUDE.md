# CLAUDE.md — H-eduware project rules

See `AGENTS.md` for the full agent instructions (source-of-truth specs, stack, harness contract,
test expectations, security). This file captures rules that MUST hold for every change.

## Framework-native agent work (non-negotiable)

When implementing or modifying the Deep Agents / LangChain agent (`server/agent/*`, especially
`deepAgentRuntime.ts`), **always consult the official documentation first and use the framework's
native mechanism — never hand-roll a bespoke equivalent.**

- **Memory** → LangGraph **checkpointer + `thread_id`** (short-term, per-thread conversation) and
  **`Store`/`BaseStore`** (long-term, cross-thread). Do NOT re-implement conversation memory by
  manually re-injecting `recentTurns` or folding a running summary by hand.
- **Clarification / narrowing / "역제안"** → LangGraph **`interrupt()` + `Command({ resume })`**
  human-in-the-loop. Do NOT invent a custom response field the LLM is merely *hoped* to fill, and do
  NOT hardcode menus/content in `.ts`.
- **Stateful subagent** → official pattern: subagent `checkpointer: true` + `toolCallLimitMiddleware`.
- **Curated content** (starter examples, recommendations) lives in the `agent-context/` **data
  layer**, never in application code.

**Official docs to cite (context7):**
- `/langchain-ai/deepagentsjs` (Deep Agents, TypeScript)
- `/websites/langchain_oss_javascript_langgraph` (LangGraph, JavaScript)

Before writing agent code: query the docs for the exact pattern + signatures, design on top of
checkpointer / store / interrupt, and put any curated content in data. If a framework-native path is
unclear, surface it and confirm — do not substitute an ad-hoc structure.

## Clean Architecture & TDD

Follow the global Clean Architecture + test-first workflow (see `~/.claude/CLAUDE.md`). Dependencies
point inward; domain has no framework deps; curated content is data, not code.
