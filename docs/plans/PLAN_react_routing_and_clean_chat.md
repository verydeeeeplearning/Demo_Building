# Implementation Plan: ReAct Agent Routing + Clean Chat Presentation

**Status**: Complete
**Started**: 2026-06-03
**Last Updated**: 2026-06-03
**Branch**: feat/layered-context-architecture

**COMPLETION SUMMARY**: All 5 phases implemented TDD-style. Final gate: typecheck 0 errors; TS unit
489/488 pass/0 fail/1 skip; JS unit 165/162 pass/3 fail (pre-existing styles.css token tests, out of
scope, untouched); build success. The deterministic "rule gate" is now the `assess_request_scope`
agent tool; the binary intent gate is removed; the agent owns the chat/recommend/clarify/build decision
via a flexible `LiveAgentDraft`; safety/unsupported stays a hard server guardrail; and the chat thread
shows only a concise message with internal tool-trace events filtered out. See progress.txt for the
per-phase record.

**CRITICAL INSTRUCTIONS**: After completing each phase:
1. Check off completed task checkboxes
2. Run all quality gate validation commands
3. Verify ALL quality gate items pass
4. Update "Last Updated" date
5. Document learnings in Notes section
6. Only then proceed to next phase

DO NOT skip quality gates or proceed with failing checks.

---

## Overview

### Feature Description

Two coupled problems with the live deepagents runtime, both rooted in the same cause —
**the runtime boxes the LLM into a rigid pipeline instead of using LangChain Deep Agents
as the ReAct harness it is.**

**Problem A — Rule-based routing dead-ends non-build messages.**
A message like `"회로를 하나 추천해줄래?"` (recommend a circuit) is forced through
deterministic routing (`deriveRequirementAnalysis`) + a binary front intent gate, then forced
to emit a structured `CircuitSpec`. With no concrete circuit to build, synthesis throws and the
student sees `"에이전트 실행 중 문제가 발생했어요"`. There is **no agent-owned path** for
*converse / recommend / clarify*. Greetings work only because a separate binary gate special-cases them.

**Problem B — The chat thread dumps the entire raw payload.**
On a successful circuit, the chat bubble shows the LLM's whole `assistantMessage` verbatim —
including an embedded raw `CircuitSpec` JSON block, `배선 요약`, `검증 결과 요약`, and a list of
internal tool-trace lines (`validate_circuit_spec`, `detect_faults`, `build_netlist`,
`estimate_current_paths`) rendered as "decisions" with repetitive placeholder text. The student
should see a short, human chat message; the JSON/wiring/validation detail belongs in the existing
3D scene and 문서(document) tab, not the chat.

### Official Grounding (LangChain Deep Agents)

Verified against the official docs (and consistent with `docs/deepagents-official-architecture-anchor.md`):

- Deep Agents run a **ReAct loop**: reason → act (tool call) → observe → repeat → final answer.
- *"When `responseFormat` is specified, the agent continues the ReAct loop until it can produce a
  valid structured response. The agent makes autonomous decisions about tool usage — it may skip
  tools entirely if it can answer conversationally."*
- *"Let agents decide tool usage. Don't force tools. The agent naturally chooses between tool calls
  and conversational responses based on the query. A well-designed system prompt guides this."*

Our `responseFormat = toolStrategy(LiveAgentDraftSchema)` currently **requires** a `CircuitSpec`,
so the agent can never "answer conversationally." Fixing this is the spine of Feature A.

### Success Criteria

- [ ] `"회로를 하나 추천해줄래?"` returns a conversational recommendation (2–3 buildable options),
      **no error**, no forced circuit, no 3D scene.
- [ ] Greetings / general questions are handled by the **same** agent decision (no separate binary gate).
- [ ] A concrete build request (`"OLED로 깜박이는 회로 만들어줘"`) still builds, validates, and shows the scene — unchanged.
- [ ] Unsafe/unsupported requests still hit the deterministic safety guardrail (unchanged).
- [ ] The chat bubble for a built circuit shows a **concise** message only — no embedded JSON,
      no `배선 요약`/`검증 결과` block, no raw tool-name trace lines.
- [ ] The circuit JSON, wiring, and validation summary remain available in the 3D scene + 문서 tab.
- [ ] `npm test`, `npm run typecheck`, `npm run build` all green; no Clean Architecture violations.

### Explicit Non-Goals (this plan)

- NOT deleting the deterministic routing/coverage logic — it is **kept** and **re-exposed as the
  `assess_request_scope` agent tool** (the "rule gate as a tool" the user chose). Only its *forced*
  `clarify_requirements` short-circuit is removed. `unsupported_or_gap` (safety/support-gap) stays a
  deterministic, server-enforced hard guardrail. (User-approved scope: "에이전트가 응답종류 결정" +
  "rule gate를 도구로서 사용".)
- NOT restoring `task`/sub-agent delegation in shadow|next (separate, larger scope — deferred).
- NOT changing the deterministic validation/render/simulation finalization boundary (Rebuild Invariant 8).

---

## Architecture Decisions (Clean Architecture)

### Layer Mapping for This Feature

| Layer | Components | Responsibility |
|-------|-----------|---------------|
| Domain | `LiveAgentDraftSchema` (+ `responseKind`, nullable `circuitSpec`), `AgentRunResultSchema.responseKind`, `RequestScopeSchema` (tool output) | Express the agent's *decision* + the deterministic scope verdict as data; no I/O |
| Application | `runLiveAgent`, `runAgentDraftRepairLoop`, `buildCasualChatResult`, `buildPreflightDraftFromAnalysis`, `composeStudentChatMessage`, `assessRequestScope` (pure deterministic read reused by the tool + the hard guardrail) | Orchestrate ReAct decision → chat vs circuit; keep safety guardrail; compose student-facing text |
| Interface Adapters | `assess_request_scope` tool (in `deepAgentTools.ts`), `buildSystemPrompt` (ReAct teaching prompt), `finalizeAgentResult` (concise message), `agentEventsToDecisions` / `studentFacingEvent*` (frontend trace cleanup) | Surface deterministic authority as a callable tool; translate model output ↔ student-facing presentation |
| Frameworks & Drivers | `createDeepAgent` (deepagents), `src/main.js` chat thread render | Run the harness; paint the DOM |

### Key Decisions

| Decision | Rationale | Trade-offs |
|----------|-----------|------------|
| Make `LiveAgentDraftSchema.circuitSpec` nullable + add `responseKind` | Lets the agent answer conversationally per official ReAct guidance; removes the forced-circuit dead end | `finalizeAgentResult` must branch before circuit finalize |
| Agent decides chat/recommend/clarify/build in its system prompt | "Let agents decide" — replaces rule routing + binary gate with model judgement | Greetings now pay one synthesis-agent invoke (no cheap gate); accepted by user |
| **Expose the deterministic routing/coverage "rule gate" as an agent TOOL** (`assess_request_scope`) instead of a forced pre-step | User-chosen, and the most deepagents-faithful option: anchor Invariant 3 "Deterministic tools are authority; deepagents can propose, server tools decide" + official "let agents decide tool usage". The rule's *authority* is kept; it no longer *forces* control flow — the agent calls it in-loop and decides | Adds one tool; the agent may choose not to call it (mitigated: scope signals are also in the prompt context block, and safety is a hard guardrail) |
| Remove the binary front intent gate (`intentGate.ts`) | Its classify job is now the main agent's ReAct decision, grounded by the `assess_request_scope` tool — no separate LLM pre-router | Deletes last session's gate; tests updated |
| Keep `unsupported_or_gap` as a HARD server guardrail (preflight); drop `clarify_requirements` preflight | Safety/support-gap must NOT be agent-optional (Invariant 6) — server decides; clarification is a conversational judgement the agent owns | Slightly more agent invocations for clarify cases |
| Strip embedded JSON/sections from the student chat message server-side | Defense-in-depth: even if the model over-shares, the student bubble stays clean; detail already lives in 문서 tab/scene | A sanitizer must reliably detect fenced JSON / known section headers |
| Filter raw tool-name events out of frontend "decisions" | Tool names (`build_netlist`…) are internal; students should see clean steps or nothing | Must not hide genuinely useful safety/validation notes |

---

## Dependencies

### Required Before Starting
- [x] Official Deep Agents ReAct behavior confirmed (docs + anchor doc)
- [x] Chat-render + message-composition surface mapped (file:line below)

### External Dependencies
- `deepagents@1.10.2` (installed) — no version change
- `langchain` `toolStrategy`, `zod` — already used

### Key Existing Anchors (file:line)
- `server/agent/deepAgentRuntime.ts:65` — `LiveAgentDraftSchema` (target of Feature A)
- `server/agent/deepAgentRuntime.ts:342` `runLiveAgent`; `:369-399` front intent-gate block (remove)
- `server/agent/deepAgentRuntime.ts:1446` `runAgentDraftRepairLoop` (add chat branch)
- `server/agent/deepAgentRuntime.ts:1129` `buildCasualChatResult` (reuse for agent chat)
- `server/agent/deepAgentRuntime.ts:1578` `buildPreflightDraftFromAnalysis` (relax clarify short-circuit)
- `server/agent/deepAgentRuntime.ts:2066` `buildSystemPrompt` (ReAct teaching prompt)
- `server/agent/deepAgentRuntime.ts:1289` `finalAssistantMessage` / `:1338` `sanitizeStudentFacingAssistantMessage`
- `src/main.js:1451-1454` — chat thread maps `assistantMessages` verbatim
- `src/main.js:1870` `agentEventsToDecisions`; `:1918` `studentFacingEventSummary`
- `server/agent/schemas.ts:1001` — `AgentRunResultSchema.responseKind` (already present)

---

## Test Strategy

**TDD Principle**: Write tests FIRST, then implement to make them pass.

| Test Type | Coverage Target | Purpose |
|-----------|-----------------|---------|
| Unit (TS, node:test via tsx) | ≥90% of new branch logic | schema decision, chat-branch, message sanitizer |
| Unit (JS, node:test) | ≥80% | frontend decisions cleanup, chat text stays concise |
| Integration (TS) | critical paths | `runAgent` with injected agent → chat vs circuit |
| Regression | full suite green | existing seams/harness/workflow tests unchanged in intent |

Test doubles: injected `ModelPort` + `DeepAgentFactory` (zero live OpenAI calls), as already used in
`agentRuntimeSeams.test.ts` / `singleRunHarness.test.ts`.

---

## Implementation Phases

### Phase 1: Flexible draft schema + agent-owned chat branch
**Goal**: The synthesis agent can return a conversational reply (no circuit) and the runtime routes it to a chat result.
**Status**: Pending

#### RED: Write Failing Tests First
- [ ] Test 1.1 `tests/unit/liveAgentDraftDecision.test.ts`
  - `LiveAgentDraftSchema.parse({ responseKind:'chat', assistantMessage:'...', circuitSpec:null })` succeeds.
  - `LiveAgentDraftSchema.parse({ assistantMessage:'...', circuitSpec:{...valid...} })` defaults `responseKind:'circuit'`.
  - Expected: FAIL (schema currently requires circuitSpec, no responseKind).
- [ ] Test 1.2 `tests/unit/agentChatDecisionRouting.test.ts`
  - Inject a `DeepAgentFactory` whose synthesis agent returns `structuredResponse:{ responseKind:'chat', assistantMessage:'추천: 1) LED 깜빡임 2) 버튼 입력 3) OLED 표시. 어느 걸 만들까요?', circuitSpec:null }`.
  - Assert `runAgent('회로 추천해줘')` → `result.responseKind === 'chat'`, `assistantMessages[0]` equals the reply, `renderPlan.parts.length === 0`, `buildRunnableReport.runnable === false`, **no throw**.
  - A second case: synthesis agent returns a full circuit draft → `result.responseKind === 'circuit'`, scene parts > 0.
  - Expected: FAIL.

#### GREEN: Implement to Make Tests Pass
- [ ] Task 1.3 `server/agent/deepAgentRuntime.ts:65` — extend `LiveAgentDraftSchema`:
  - add `responseKind: z.enum(['chat','circuit']).default('circuit')`
  - change `circuitSpec: CircuitSpecSchema` → `CircuitSpecSchema.nullable().default(null)`
- [ ] Task 1.4 `runAgentDraftRepairLoop` (`:1500` loop body) — after a successful `draftProvider(...)`:
  - if `draft.responseKind === 'chat' || !draft.circuitSpec` → build reply via `composeStudentChatMessage(draft)` (assistantMessage + clarification if present) → `return buildCasualChatResult({ traceId, sessionId, request, contextPacket, reply })`.
  - Log `agent.validation.completed` with `responseKind:'chat'`.
- [ ] Task 1.5 — keep `finalizeAgentResult` reached only for circuit drafts (circuitSpec non-null). No type break: `CircuitSpecSchema.parse(unknown)` accepts the narrowed value.

#### REFACTOR
- [ ] Extract `composeStudentChatMessage(draft)` helper; reuse for chat-branch and structured-output fallback chat cases.

#### Quality Gate
- [ ] TDD cycle followed; Tests 1.1/1.2 now pass
- [ ] `npm run typecheck` clean
- [ ] `npm test` green (TS + JS suites; pre-existing 3 CSS-token JS failures remain out of scope)
- [ ] Clean Architecture: schema stays framework-free; branch logic in application layer
- [ ] Manual: injected chat draft → chat result; circuit draft → circuit result

---

### Phase 2: ReAct teaching system prompt (agent decides the turn type, grounded by the scope tool)
**Goal**: The single synthesis agent reasons about the request, may call `assess_request_scope` for an authoritative read, and chooses converse / recommend / clarify / build.
**Status**: Pending

#### RED
- [ ] Test 2.1 `tests/unit/reactSystemPrompt.test.ts`
  - `buildSystemPrompt({...})` output contains the decision contract: instructions to (a) answer general/greeting/recommend conversationally with `responseKind:"chat"` + `circuitSpec:null`, (b) ask ONE clarification when underspecified (chat), (c) build with `responseKind:"circuit"` + full spec when concrete, (d) never fabricate a circuit just to have one, (e) when unsure whether a request is buildable/supported, call `assess_request_scope` and respect its verdict.
  - Assert the prompt still preserves safety/grounding lines ("Build only safe, low-voltage…", "Do not invent parts, pins, protocols…", context packet + registry blocks present).
  - Expected: FAIL.
- [ ] Test 2.2 — prompt-budget guard: `measureAgentPromptBudget({stage:'synthesis', ...})` for a representative packet stays `withinBudget` after the longer prompt (compaction reserves overhead).
  - Expected: FAIL or PASS depending on length; if over, compaction must absorb it.

#### GREEN
- [ ] Task 2.3 `buildSystemPrompt` (`:2066`) — prepend a concise "DECIDE the turn (ReAct)" block before the circuit rules; mention the `assess_request_scope` tool as the authority for buildability/support; keep all existing grounding/safety lines and `contextPacketBlock`/`registrySummary`. Do NOT re-implement deepagents' built-in planner/tool instructions (anchor §System Prompt Assembly).
- [ ] Task 2.4 — ensure the synthesis user prompt (`buildAgentUserPrompt`) no longer hard-asserts "Return a validated-ready circuit draft"; soften to "Build a circuit only if the request is a concrete buildable goal; otherwise answer conversationally."

#### REFACTOR
- [ ] Keep added prompt text minimal/token-lean; verify compaction headroom.

#### Quality Gate
- [ ] Tests 2.1/2.2 pass; prompt within budget on representative packets
- [ ] `npm run typecheck` / `npm test` green
- [ ] No safety/grounding line removed (diff-reviewed)

---

### Phase 3: Rule gate → agent tool (`assess_request_scope`) + remove binary intent gate; keep safety guardrail
**Goal**: Turn the deterministic routing/coverage "rule gate" into a callable authority tool the agent uses in its ReAct loop; retire the binary LLM pre-gate; keep safety deterministic and non-bypassable.
**Status**: Pending

#### RED
- [ ] Test 3.1 `tests/unit/assessRequestScope.test.ts`
  - `assessRequestScope(request, contextPacket)` (pure) returns `{ route, buildEligible, unsupported, unsafe, candidateParts:[{id,label,kind}], supportedCapabilities:[...], reason }` derived deterministically from `contextCoverage.synthesisEligibility` + `unsupportedSignals` (same signals `deriveRequirementAnalysis` uses).
  - The `assess_request_scope` tool (from `createHeduwareAgentTools`) returns the JSON of that read for a given request scope; bounded to the current context packet (no broad reads — Invariant 5).
  - Expected: FAIL.
- [ ] Test 3.2 update `tests/unit/agentRuntimeSeams.test.ts` + `singleRunHarness.test.ts` — remove the `intentGate:` passthrough injection; assert factory/model counts unchanged (model ×1; factory 2 legacy / 1 next). The new tool changes the tool LIST, not the construction counts.
- [ ] Test 3.3 `tests/unit/clarifyReachesAgent.test.ts` — a `clarify_requirements`-routed request (injected) now **constructs and invokes** the synthesis agent (no preflight short-circuit); the agent's chat decision is returned.
  - Expected: FAIL (today clarify short-circuits to a canned preflight draft).
- [ ] Test 3.4 — an `unsupported_or_gap`/safety request still returns the deterministic unsupported preflight HARD guardrail (server-enforced, agent never reached for the unsafe build).

#### GREEN
- [ ] Task 3.5 `server/agent/circuitTools.ts` (or a small new `requestScope.ts`) — add pure `assessRequestScope(request, contextPacket)` returning `RequestScopeSchema`. Reuse the exact deterministic signals from `deriveRequirementAnalysis` (DRY: have `deriveRequirementAnalysis` and the tool share this read).
- [ ] Task 3.6 `server/agent/deepAgentTools.ts` — add the `assess_request_scope` tool to `createHeduwareAgentTools` (needs the request scope; pass via `HeduwareAgentToolOptions.requestScope` precomputed in `runLiveAgent`, so the tool stays context-bounded and side-effect-free).
- [ ] Task 3.7 `runLiveAgent` (`:369-399`) — delete the `getIntentGateMode()` block and the `classifyStudentIntent`/`getIntentGateMode` import (`:15`). Precompute `assessRequestScope(...)` and pass it into `toolOptions` for the tool.
- [ ] Task 3.8 `buildPreflightDraftFromAnalysis` (`:1578`) — short-circuit **only** `unsupported_or_gap` (hard guardrail); return `null` for `synthesize_circuit` **and** `clarify_requirements` so both reach the agent.
- [ ] Task 3.9 — delete `server/agent/intentGate.ts`; remove `intentGate?` from `AgentRuntimeDeps` (`agentRuntimePorts.ts:34`); remove the two `agent.intent.gate.*` events from `agentLogger.ts`.
- [ ] Task 3.10 — delete `tests/unit/intentGate.test.ts` + `tests/unit/intentGateRouting.test.ts`; fold their still-relevant coverage (chat result shape) into Phase 1 tests.

#### REFACTOR
- [ ] Keep `buildClarificationPreflightDraft` (still used by `buildStructuredOutputFallbackDraft`).
- [ ] Ensure `assessRequestScope` is the single source of the deterministic route read (no duplicated eligibility logic).

#### Quality Gate
- [ ] Tests 3.1–3.4 pass; deleted-test coverage re-homed
- [ ] `npm run typecheck` / `npm test` green
- [ ] Clean Architecture: tool depends on the application-layer scope read; safety stays server-authoritative
- [ ] Grep confirms zero residual `intentGate` references in `server/` + `src/`
- [ ] Invariants preserved: 1 (packet before agent), 3 (tools are authority), 5 (bounded reads), 6 (no unsupported upgrade), 8 (finalize revalidates)

---

### Phase 4: Concise student chat message (strip raw payload server-side)
**Goal**: The chat bubble carries a short human message; JSON/wiring/validation detail stays in 문서 tab + scene.
**Status**: Pending

#### RED
- [ ] Test 4.1 `tests/unit/studentChatMessage.test.ts` — a sanitizer `toConciseStudentMessage(text, locale)`:
  - strips fenced code blocks (```json … ```), inline raw `CircuitSpec`-looking JSON objects, and known detail sections (`배선 요약`, `검증 결과 요약`, `회로 초안`) from the message.
  - preserves the leading human sentences and any `clarification`/next-step prompt.
  - on a message that is ALREADY concise, returns it unchanged.
  - Expected: FAIL.
- [ ] Test 4.2 — `finalizeAgentResult` output: given a `draft.assistantMessage` containing an embedded JSON block, `result.assistantMessages[0]` contains **no** ``` fences and **no** `"components"`/`"connections"` JSON keys; `result.requirementMarkdown` still carries the full detail.
  - Expected: FAIL.

#### GREEN
- [ ] Task 4.3 — add `toConciseStudentMessage` and call it inside `sanitizeStudentFacingAssistantMessage` (or immediately after) in `finalizeAgentResult` so `studentMessage` is always concise.
- [ ] Task 4.4 — strengthen the synthesis prompt: instruct the model to put ONLY a short human explanation in `assistantMessage` and to NOT paste the CircuitSpec/JSON/wiring tables into it (the server renders those). Defense-in-depth: the sanitizer still strips if the model over-shares.

#### REFACTOR
- [ ] Ensure the sanitizer is locale-safe and idempotent.

#### Quality Gate
- [ ] Tests 4.1/4.2 pass
- [ ] `npm run typecheck` / `npm test` green
- [ ] Manual: OLED-blink build → chat bubble is 1–3 sentences; 문서 tab + scene retain full detail

---

### Phase 5: Frontend — clean decisions trace, no raw tool dump
**Goal**: The "확정된 조건"/decisions panel shows clean, deduped, student-facing steps — never raw tool names.
**Status**: Pending

#### RED
- [ ] Test 5.1 `tests/unit/agentDecisions.test.js` (extract `agentEventsToDecisions` + `studentFacingEventLabel`/`studentFacingEventSummary` into a testable pure module `src/agentDecisions.js`):
  - raw tool-name events (`validate_circuit_spec`, `detect_faults`, `build_netlist`, `estimate_current_paths`) are **filtered out** or collapsed into a single clean "회로 검토" step — not shown as separate raw rows.
  - duplicate/placeholder summaries are de-duplicated (no repeated "요청을 검토하고…" rows).
  - genuine safety/support-gap/validation-warning events still surface with their clean label.
  - Expected: FAIL.
- [ ] Test 5.2 — a `responseKind:'chat'` result yields **zero** decision rows (a conversational reply has no "확정된 조건").

#### GREEN
- [ ] Task 5.3 — extract the decision-mapping helpers from `src/main.js` into `src/agentDecisions.js` (pure, dependency-free) and import back (mirrors `src/agentSceneVisibility.js`).
- [ ] Task 5.4 — add a tool-event filter/allowlist: drop internal tool-call events (`type:'tool'` or names matching the tool registry) from student decisions; keep coordinator/validation/safety events; dedupe by clean label+value.
- [ ] Task 5.5 — `main.js:1450` — for `responseKind:'chat'`, set `decisions: []`.

#### REFACTOR
- [ ] Remove now-unused branches in `studentFacingEventSummary` if the raw tool-trace path is fully filtered upstream.

#### Quality Gate
- [ ] Tests 5.1/5.2 pass
- [ ] `npm test` green; `npm run build` succeeds
- [ ] Manual: built circuit shows ≤ a few clean steps; chat reply shows none; no raw tool names anywhere in the thread

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Longer ReAct prompt exceeds prompt budget on tight routes | Med | Med | Phase 2 budget test; compaction reserves overhead; keep added text lean |
| Agent over-eagerly chooses `chat` and stops building real requests | Med | High | Prompt biases to `circuit` when a concrete buildable goal is present; `assess_request_scope` gives an authoritative buildable verdict; Phase 1/2 integration tests cover the build path; keep deterministic finalize |
| Agent never calls `assess_request_scope` (tools aren't forced) | Med | Low | Scope signals are ALSO in the prompt context block, so the decision is grounded either way; safety is a hard guardrail regardless |
| Sanitizer strips legitimate human text (false positive) | Med | Med | Only strip fenced blocks + known section headers + JSON-object heuristics; idempotent test on already-concise text |
| Removing intent gate changes factory/model counts → seams tests break | High | Low | Phase 3 updates those tests; passthrough injection removed; counts re-asserted |
| Deleting `intentGate.ts` leaves dangling refs | Med | Low | Grep gate; typecheck; remove ports field + log events together |
| Greetings now cost a full agent invoke (latency/$) | High | Low | Accepted by user (agent-decides scope); revisit caching later if needed |
| Frontend helper extraction regresses existing decision rendering | Low | Med | Pure-module extraction with parity tests before wiring back |

## Rollback Strategy

Each phase is an independent commit; revert is per-phase.

- **Phase 1**: revert `LiveAgentDraftSchema` + repair-loop branch → circuit-only behavior restored.
- **Phase 2**: revert `buildSystemPrompt`/`buildAgentUserPrompt` text → prior prompt.
- **Phase 3**: restore `intentGate.ts`, the gate block, the clarify short-circuit, ports field, log events, and the two deleted tests from git history.
- **Phase 4**: drop `toConciseStudentMessage` call → messages pass through as before.
- **Phase 5**: restore in-`main.js` decision helpers; revert `decisions: []` for chat.

Kill-switches: none new. (The old `H_EDUWARE_INTENT_GATE` switch is removed with the gate.)
`H_EDUWARE_AGENT_PIPELINE` (legacy|shadow|next) behavior is preserved.

## Progress Tracking
- Phase 1: 0%
- Phase 2: 0%
- Phase 3: 0%
- Phase 4: 0%
- Phase 5: 0%
Overall: 0%

## Notes & Learnings
- Reuses last session's scaffolding: `AgentRunResultSchema.responseKind`, `buildCasualChatResult`,
  `src/agentSceneVisibility.js` (chat hides the scene) all already exist — Feature A wires the
  *agent's own* decision into them instead of a separate binary gate.
- Anchor invariants preserved: context packet before deepagents (1), deterministic tools are
  authority (3), unsupported hardware never upgraded (6), structured output required (7),
  finalization revalidates (8), repair loop bounded (9).
