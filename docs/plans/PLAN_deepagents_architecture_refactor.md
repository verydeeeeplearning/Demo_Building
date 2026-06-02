# Implementation Plan: Deepagents Architecture Refactor (official-harness alignment)

**Status**: ⛔ SUPERSEDED — merged into `PLAN_agent_pipeline_refactor.md` (single authoritative plan). Kept for history only; do NOT execute from this doc.
**Started**: 2026-06-02
**Last Updated**: 2026-06-02

> Companion to `docs/plans/PLAN_context_layer_refactor.md` (the context layer = *what* context exists; this plan = *how* the deepagents harness consumes it). Overlapping items are cross-referenced, not duplicated. Anchored to `docs/deepagents-official-architecture-anchor.md`.

## Overview

### Goal
Align H-eduware's deepagents usage with the **official LangChain Deep Agents model** so the harness is *used* rather than *bypassed* — reducing per-request cost/latency and raising structured-output reliability for in-catalog requests.

### Official model (verified 2026-06-02 from docs.langchain.com/oss/javascript/deepagents)
- **One** deep agent: a tool-calling loop with built-in **`write_todos` planning**, **`task` subagent delegation**, **virtual-FS context offloading** (tool I/O > ~20k tokens → file + path ref), **summarization** (~85% window), and **`responseFormat` → `structuredResponse`**.
- **System prompt layering**: `USER` (our `systemPrompt`) → (`BASE` SDK default or `CUSTOM`) → `SUFFIX`. USER is always front; custom prompt should define **domain rules only**, never reimplement harness (todo/FS/subagent) instructions.
- **Middleware order** (deterministic): TodoList → Skills(if set) → Filesystem → SubAgent → Summarization → PatchToolCalls → custom → profile → AnthropicCaching → Memory(AGENTS.md) → HumanInTheLoop.
- **Subagents** `{name, description, systemPrompt, tools?, model?, responseFormat?}`: "isolate detailed work and avoid context bloat"; each keeps its own conversation history; tools are **scoped per subagent**; return summaries to the coordinator.
- **Context engineering**: progressive disclosure (skills frontmatter loaded at startup, body on relevance); pass runtime data (metadata/keys) via `context`/`contextSchema`, **not** the prompt; persist large outputs to FS and `read_file`/`grep` fragments on demand.

### As-Is (verified in `server/agent/deepAgentRuntime.ts`)
- `createDeepAgent` is called with only `model, tools, subagents, responseFormat, systemPrompt, name`. **Unused**: `context`/`contextSchema`, `backend`/FS, summarization config, `checkpointer`/`store`, `middleware`, `skills`, `memory`, `interruptOn`.
- **Two full harness runs per request**: `runRequirementAnalysisAgent` (`:422`, its own `createDeepAgent` + all 11 tools + full promptBlock) then synthesis (`:339`, `createDeepAgent` + 11 tools + 6 subagents + full promptBlock). ~2× context cost.
- Full `contextPacket.promptBlock` (~9–38k chars) inlined into `systemPrompt` — no FS offloading, no progressive disclosure.
- **6 subagents are passed but delegation is not instructed**; `responseFormat: toolStrategy(LiveAgentDraftSchema)` forces a single structured emit. Subagent `name/description/systemPrompt` are injected (via the `task` schema + `renderSubagentPromptBudgetText`, `:1530`) → likely **passive token weight** (to be confirmed by trace). 3 subagents also each carry all 11 tools.
- The synthesis run must retrieve + draft + validate + emit in **one shot** (no `write_todos` decomposition leveraged) → structured-output misses on complex circuits.
- `AGENT_STRUCTURED_OUTPUT_MISSING` throws at `parseLiveAgentDraft:1283`, **outside** the retry guard (`runAgentDraftRepairLoop:901-930`) → terminal 502.
- Finalization is deterministic server-side (validation/render/simulation) — **correct**, preserves the anchor invariants; keep it.

### Success Criteria
- [ ] **One** deep agent invocation per request (intent handled by a deterministic preflight or an isolated subagent, not a second full harness).
- [ ] Subagent disposition resolved by evidence: either active coordinator-worker delegation with **scoped tools + summary returns**, or removal of unused subagents — never paid-for-but-unused.
- [ ] Custom `systemPrompt` contains domain rules only (no harness-instruction duplication); verified against the layering model.
- [ ] Structured-output failure is recoverable (retry + deterministic fallback), never a student-facing 502.
- [ ] Tool-schema tokens reduced (scoped per worker; not 11×4); per-request round-trips reduced (one run, not two).
- [ ] Deterministic finalization boundary unchanged (anchor invariants 3,4,6,7,8 preserved).
- [ ] No regression: `npm run test:unit`, `typecheck`, `build`, `test:e2e` (72 mocked) green.
- [ ] Rollout behind a flag; opt-in LangSmith trace confirms the new flow (todos/delegation/round-trips).

### Anchor invariants that MUST be preserved
Context packet before deepagents; deterministic tools are authority; source provenance gate; no unsupported upgrades; structured output required; finalization revalidates; bounded repair; no broad context reads.

## Architecture Decisions (Clean Architecture)
| Layer | Components | Responsibility |
|-------|-----------|---------------|
| Domain | anchor invariants, RequirementAnalysis/LiveAgentDraft schemas | product truth, structured contracts |
| Application | single-run orchestration policy, subagent/delegation policy, retry+fallback policy | how the harness is driven |
| Interface Adapters | `deepAgentRuntime` wiring (one `createDeepAgent`, scoped subagents, optional middleware/skills), `ModelPort` | translate policy into the harness |
| Frameworks & Drivers | `deepagents`, `ChatOpenAI` | the harness/model behind ports |

| Decision | Rationale (official) | Trade-off |
|----------|---------------------|-----------|
| Collapse 2 runs → 1 | Idiomatic single agent + planning; ~2× cost cut | Intent step must move to preflight/subagent |
| Scope tools per subagent OR drop subagents | "avoid context bloat"; tools scoped per worker | Requires trace-confirmed disposition |
| Leverage `write_todos`/`task` decomposition | Bounded steps raise structured-output reliability | Behavior depends on prompt + harness |
| Prompt = domain-only (layering) | USER→BASE→SUFFIX; don't fight the harness | Audit/trim current prompt |
| FS offloading + progressive disclosure | Bounded entry tokens; large tool outputs off-prompt | Coordinated with context-layer Phase 3 |
| Custom middleware for observability | `wrapToolCall` is the official hook | New middleware surface |

## Dependencies
- Approval + 1 opt-in live LangSmith trace (Phase D0). `ModelPort` from context-layer Phase 0.5 (shared). `deepagents@1.10.2`.

## Test Strategy
Default gates mocked/cassette (no live OpenAI). Unit tests assert: single `createDeepAgent` per request, subagent tool-scoping, prompt contains no harness-base duplication, retry/fallback on structured-output throw, round-trip/token reductions via the metrics harness. Opt-in live LangSmith trace validates real delegation/todos.

## Implementation Phases

### Phase D0: Trace-confirm As-Is harness utilization (evidence first)
**Goal**: Resolve "are subagents/write_todos/task actually used?" with a real trace before changing anything.
**Status**: Pending
- [ ] D0.1 Run one opt-in live request through LangSmith (`npm run trace:langsmith`); record: `task`/subagent invocations, `write_todos` usage, round-trip count, tool-schema token share, where time/tokens go.
- [ ] D0.2 Write findings into Notes; decide subagent disposition (D3 path A vs B) from evidence.
- Gate: trace captured; disposition decision recorded.

### Phase D1: System-prompt layering hygiene (low-risk)
**Goal**: Custom prompt = domain rules only.
**Status**: Pending
- [ ] D1.1 RED: a test asserts the H-eduware `systemPrompt` does not duplicate harness base instructions (no re-implemented todo/filesystem/subagent guidance) and stays within a token budget.
- [ ] D1.2 GREEN: trim `buildSystemPrompt` to domain/product rules; rely on harness BASE for mechanics.
- Gate: TDD · build · e2e no-regression.

### Phase D2: Collapse two harness runs into one
**Goal**: One `createDeepAgent` invocation per request.
**Status**: Pending
- [ ] D2.1 RED: a request triggers exactly ONE `createDeepAgent`/full invoke; intent/requirement is produced by the deterministic preflight (`buildPreflightDraftFromAnalysis`) or an isolated `intent-analyst` subagent, not a second harness.
- [ ] D2.2 GREEN: remove `runRequirementAnalysisAgent`'s separate full agent; route intent through preflight/subagent; reuse the single assembled packet (context-layer Phase 3).
- Gate: TDD · build · round-trip count asserted = 1 main run · e2e no-regression.

### Phase D3: Subagent disposition (evidence-driven)
**Goal**: No paid-for-but-unused subagents.
**Status**: Pending (path chosen in D0)
- **Path A (delegation is real/valuable):** scope each subagent to its phase tools (shared with context-layer Phase 4); instruct delegation in the coordinator prompt; require summary returns; test tool-scoping + that the coordinator no longer carries all 11.
- **Path B (delegation unused):** remove the unused subagents; keep only those that demonstrably run; test token reduction.
- Gate: TDD · build · tool-schema tokens reduced · e2e no-regression.

### Phase D4: Context engineering via the harness
**Goal**: Progressive disclosure + FS offloading + runtime `context`.
**Status**: Pending (overlaps context-layer Phase 3)
- [ ] D4.1 RED: large tool outputs (> threshold) are offloaded (FS/path ref) instead of re-entering the prompt; toolOptions/runtime metadata pass via `context`/`contextSchema`, not the prompt.
- [ ] D4.2 GREEN: enable FS/backend offloading config; move `toolOptions` to runtime `context` where it reduces prompt tokens; slim entry block (shared with context-layer Phase 3).
- Gate: TDD · build · entry/tool tokens bounded · e2e no-regression.

### Phase D5: Structured-output reliability + observability middleware
**Goal**: No 502 for realizable requests; harness-native observability.
**Status**: Pending (C2 shared with context-layer Phase 4)
- [ ] D5.1 RED: structured-output throw on attempt 1 → caught + retried; on exhaustion → deterministic preflight fallback (never 502). A custom `wrapToolCall` middleware emits tool-gate/repair events.
- [ ] D5.2 GREEN: wrap `draftProvider` (`deepAgentRuntime.ts:901`) in try/catch + fallback; add observability middleware replacing ad-hoc logging.
- Gate: TDD · build · throw-path retry unit-tested · e2e no-regression.

### Phase D6 (optional): Domain knowledge as skills (progressive disclosure)
**Goal**: Move bulky domain guidance (recipes, validation prose) from the inline prompt to harness **skills** loaded on relevance.
**Status**: Pending / optional
- [ ] D6.1 RED: a request that needs a specific recipe loads only that skill's body; unrelated requests do not.
- [ ] D6.2 GREEN: model selected domain docs as skills; wire `skills` into `createDeepAgent`.
- Gate: TDD · build · startup token reduction · e2e no-regression.

## Risk Assessment
| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| Removing the 2nd run changes intent quality | Med | Med | Keep deterministic preflight; corpus eval (context-layer) guards |
| Activating delegation changes harness control flow non-deterministically | Med | Med | D0 trace first; mocked workflow tests; flag |
| FS offloading / `context` misconfig leaks repo files | Low | High | No real-FS backend; explicit permissions; load sources via deterministic code (anchor §Backends) |
| Skills migration regresses guidance | Low | Med | D6 optional, last; shadow compare |
| Prompt trim drops a needed product rule | Med | High | D1 keeps product truth in ContextPacket + tools, not the trimmed prose |

## Rollback Strategy
Flag-gate the single-run + delegation changes; D1/D2/D5 structural edits revert via git. Deterministic finalization boundary is never touched, so server validation/render/simulation remain the safety net regardless of harness changes.

## Progress Tracking
- D0, D1, D2, D3, D4, D5, D6: 0% · Overall: 0%

## Notes & Learnings
- Official: USER systemPrompt always front (USER→BASE→SUFFIX); custom prompt should be domain-only.
- Official middleware order verified; `wrapToolCall` is the observability hook; "do not mutate attributes after init — use graph state."
- As-Is uses none of context/FS/summarization/checkpointer/skills/middleware; runs the harness twice; inlines full context; passes-but-doesn't-orchestrate 6 subagents.
- Keep deterministic finalization + anchor invariants intact — this refactor changes *how the harness is driven*, not *who owns truth*.
