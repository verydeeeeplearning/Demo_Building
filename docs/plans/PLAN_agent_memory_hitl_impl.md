# Implementation Plan: Agent Memory (checkpointer) + HITL Clarification (interrupt)

**Status**: Phases 1, 2a–2d, 3 COMPLETE (commits 1da1bfb, bbad5a8, 64a1136, ec6bcf5, db9be3d, c38c0b9, 7dc2d8f).
Interactive narrowing works end to end (interrupt-based HITL + forceCapabilityId re-grounding + client chips/resume + session persistence). Remaining: US-6 (10-query local e2e -> .docx report).
**Design doc**: `docs/plans/PLAN_session_and_interactive_clarification.md` (the why). This doc is the **how**.
**Rule**: framework-native only; re-verify each API against the docs while coding (`CLAUDE.md`).

## Verified API surface (installed packages — confirmed, not assumed)
- **deepagents@1.10.2** `createDeepAgent(params)` accepts: `checkpointer?: BaseCheckpointSaver | boolean`,
  `store?: BaseStore`, `interruptOn?: Record<string, boolean | InterruptOnConfig>` (HITL "Requires a
  checkpointer"). (`node_modules/deepagents/dist/index.d.ts:3064-3110`, `:1978`)
- **@langchain/langgraph@1.3.3** exports: `MemorySaver`, `InMemoryStore`, `interrupt<I,R>(value:I):R`,
  `Command`, `BaseCheckpointSaver`, `BaseStore`, const `INTERRUPT="__interrupt__"`, helpers
  `isInterrupted`, `getStore`. Interrupt result: `result["__interrupt__"]: Interrupt[]`, each `{ value }`.
- **langchain@1.4.2** exports: `toolStrategy` (in use), `tool`, `toolCallLimitMiddleware`,
  `humanInTheLoopMiddleware`.
- **Key fact**: `MemorySaver` is a *state store keyed by `thread_id`*. The runtime already calls
  `agent.invoke(..., { configurable: { thread_id: sessionId } })` (`deepAgentRuntime.ts:538`). A
  **shared module-singleton saver** passed to each `createDeepAgent` makes state persist across requests
  even though a fresh agent instance is built per request.

---

## Phase 0 — Revert the bespoke mechanism (clean baseline)
**Goal**: remove the hand-rolled clarification/memory code so we build on the framework cleanly.
- `git checkout -- src/main.js server/agent/schemas.ts server/agent/deepAgentRuntime.ts` (revert this
  session's bespoke edits: `clarificationChoices` field, `pendingClarification`, prompt injection,
  starter-menu wiring, client chip wiring).
- Delete `server/agent/clarificationChoices.ts` and `tests/unit/clarificationChoices.test.ts`.
- Delete `tests/e2e/clarification-choices.spec.js` (rewritten in Phase 3 against the interrupt contract).
- **Keep** (framework-agnostic, reused): `src/clarificationChoicesView.js` (→ renamed `interruptOptionsView.js`
  in Phase 3), `src/agentSessionStore.js` + their unit tests.
**Gate**: `npx tsc --noEmit` clean; `npm test` green; agent contract back to committed baseline.

## Phase 1 — Short-term memory via checkpointer
**Goal**: the deepagents thread remembers prior turns natively; drop manual history re-injection.
**Files**: `server/agent/deepAgentRuntime.ts`, `server/agent/agentRuntimePorts.ts`.
1. Add a shared saver: `const conversationCheckpointer = new MemorySaver();` (module scope) — injectable
   via `deps.checkpointer ?? conversationCheckpointer` (Phase 0.5 seam style).
2. Pass it to the **synthesis** `createDeepAgent` call (`:479`): `checkpointer: conversationCheckpointer`.
3. Keep `thread_id: sessionId` (already present). Per turn, send only the **new** user message + the
   per-turn deterministic context packet (grounding stays); the thread supplies history.
4. **Remove** `renderConversationContextForPrompt`'s `recentTurns`/`foldRunningSummary` re-injection
   (the checkpointer owns history). Keep `currentArtifact`/`lastSupportedGoal` grounding if still needed,
   or migrate later. (Decide during impl: minimal removal first.)
**RED test** (`tests/unit/agentMemoryCheckpointer.test.ts`): after one `runAgentWithScriptedDrafts` on
`sessionId=S`, assert the shared checkpointer has a stored tuple for `{configurable:{thread_id:S}}`
containing the turn's messages (`await conversationCheckpointer.getTuple({configurable:{thread_id:S}})`).
This is a deterministic *wiring* test (no live model). Memory *recall* quality is a live/cassette smoke.
**Gate**: eval + context suites 0 regression; tsc clean. Docs: langgraph "Add Short-Term Memory".

## Phase 2 (slot fill) — category taxonomy + grounded options, derived from ALL supported capabilities

**Why this shape**: the narrowing criterion is "does the agent have enough parameters (slots) to build?".
A hand-picked option list is incomplete (it dropped 27 of 39 supported capabilities) and is the
hardcoding the project forbids. Instead, derive options from the **whole** capability graph via a small
authored **category taxonomy**, guaranteed complete by a coverage test. Beginners narrow by tapping a
category, then a specific capability (progressive disclosure), so all 39 stay reachable without a wall
of choices.

**The slots** (criterion for "sufficient to build"), grounded in already-computed data:
- `output` — from `intentSpec.outputModalities`; open ⇒ propose **categories** (below).
- `sensor`/`trigger` — conditionally required when behavior is reactive (`intentSpec.behaviors`/`inputModalities`);
  open ⇒ propose the sensor capabilities.
- `must-ask disambiguation` — when the choice changes behavior (motor type, active/passive buzzer, generic sensor).
- `display_content` — when output is a text display (free text).
- Auto-derived (never asked): controller, power, pins, passives, topology (capability `requiredRoles`/`requiredParts` + principles).
- **Sufficiency** = `output` resolved ∧ all required slots for that output filled ∧ no must-ask open.

**Category taxonomy (authored in `agent-context/data/slot-policy.json`, NOT in code):** every supported
capability is assigned to exactly one build category, or marked context/non-build. 7 build categories:
빛/LED · 소리 · 모터/움직임 · 스위칭(릴레이) · 디스플레이 · 센서값 표시 · 센서로 감지→출력.
A **coverage test fails** if any supported capability is unassigned or double-assigned — nothing is
silently dropped, and a new capability forces a taxonomy update.

**Option value vs capabilityId**: a capability's own `studentPhrases` don't always re-route to it (matcher
contention — proven by the grounding guard). So a selected option resumes by carrying its **`capabilityId`**
(structured), and the server forces that capability's route — robust, no per-capability routing phrases to
author. (Open item: add a "seed/force capability" input to the context funnel.)

### Phase 2a — taxonomy data + loader + coverage guard
- `agent-context/data/slot-policy.json` (v2): build categories (id, localized label, `capabilityIds`) +
  `contextCapabilities` (non-build). `server/agent/slotPolicy.ts`: load + validate; `outputCategories(locale)`,
  `capabilitiesInCategory(id)`, `categoryOfCapability(id)`.
- RED: coverage test — partition every supported capability across categories ∪ context (exactly once).

### Phase 2b — grounded option generator (categories + drill-down)
- `outputSlotOptions(locale)` → the 7 categories. `capabilityOptions(categoryId, locale)` → the supported
  capabilities in it, each `{ id, label, capabilityId }`. Labels authored in the taxonomy (short, student-facing).
- RED: every drill-down option's `capabilityId` is supported; selecting it (by id) resolves to that capability.

### Phase 2c — slot resolver (sufficiency + open slot)
- `resolveOpenSlot(intentSpec, capabilityMatches, policy)` → `{ sufficient }` | `{ slotKind, question, options }`.
  Uses `intentSpec` (output/input/behavior/ambiguities) + the matched capability's `requiredRoles`.
- RED: value-display-without-sensor → asks sensor; vacuous → asks output (categories); generic motor → asks motor-type; resolved → sufficient.

## Phase 2d — HITL clarification via `interrupt()` (server)
**Goal**: the agent pauses to ask, the server surfaces it, a follow-up resumes the same thread.
**Files**: `server/agent/deepAgentTools.ts` (new tool), `deepAgentRuntime.ts`, `schemas.ts`, `server/index.ts`.
1. **Clarification tool** (`deepAgentTools.ts`): `request_clarification` via `tool()` with schema
   `{ question: z.string(), options: z.array(z.object({ label: z.string(), value: z.string() })).optional() }`;
   impl: `return interrupt({ kind: 'clarification', question, options: options ?? [] });`. The agent calls
   it when a required slot is open; `interrupt()` pauses the graph (checkpointer holds the pause).
   Register it in `createHeduwareAgentTools`. System prompt: instruct the agent to call
   `request_clarification` (with grounded options from the context packet) instead of free-texting a
   question. Options are **grounded** (candidate caps/parts), never hardcoded.
2. **Detect interrupt** (`deepAgentRuntime.ts`): after `agent.invoke`, if `output["__interrupt__"]?.length`,
   read `payload = output["__interrupt__"][0].value` and return a new result variant.
3. **Schema** (`schemas.ts`): add `responseKind: 'awaiting_input'` (extend the enum) and an
   `interrupt?: { question: string; options: ClarificationOption[] }` field on `AgentRunResult`
   (`ClarificationOption = { label, value }`). Add `resume?: string` to `AgentMessageRequest`.
4. **Resume** (`deepAgentRuntime.ts` + `server/index.ts`): if `request.resume` is set, invoke
   `agent.invoke(new Command({ resume: request.resume }), { configurable: { thread_id: sessionId } })`
   instead of messages. The tool's `interrupt()` returns `request.resume` to the agent, which continues
   (to build or to ask again).
**RED tests** (`tests/unit/agentInterrupt.test.ts`):
   (a) request/response mapping — given an agent stub whose invoke returns `{__interrupt__:[{value:{question,options}}]}`,
       `runAgent` returns `responseKind:'awaiting_input'` with that payload.
   (b) resume routing — given `request.resume`, the runtime invokes with a `Command` (assert via injected
       agent spy) and threads the same `thread_id`.
   (c) cassette smoke (recorded model) — a real `createDeepAgent` run where the model calls
       `request_clarification` → pause → resume → build. (Recorded via `modelCassette`, opt-in.)
**Gate**: tsc + unit green. Docs: langgraph "Invoke and Resume Agent with Interrupt".

## Phase 3 — Client resume loop + session persistence
**Files**: `src/main.js`, `src/aiClient.js`, `src/interruptOptionsView.js` (renamed), `src/agentSessionStore.js`.
1. `aiClient.sendAgentMessage`: support `{ resume }` in the body (already passes through extras).
2. On `responseKind:'awaiting_input'`: render `interrupt.options` as reply chips (reuse the view module);
   selecting one → POST `{ sessionId, resume: option.value }`; "직접 입력" → focus the textarea, then a
   typed message also posts as `{ sessionId, resume: text }` while a pause is open.
3. Persist `sessionId` to `sessionStorage` (reuse `agentSessionStore`) so reload resumes the server-held
   thread (with a durable saver, full continuity; with MemorySaver, within process uptime).
**RED tests**: jsdom unit for option render + resume-submit; Playwright (mocked `/api/agent/message`)
for the ask→select→resume→build loop (`tests/e2e/agent-clarification.spec.js`).
**Gate**: client unit + mocked e2e green; `npm run build` clean.

## Phase 4 — Production durability (before deploy)
- Swap the dev `MemorySaver` for a durable saver so redeploys don't drop threads/paused interrupts.
  Options (verify availability/version): `@langchain/langgraph-checkpoint-postgres` (Railway Postgres) or
  a Redis saver. Wire via the same `deps.checkpointer` seam; env-selected (MemorySaver fallback in dev).
**Gate**: live smoke that a thread survives a server restart.

## Phase 5 — Acceptance
- `npm run check` (unit + build + e2e) green.
- Mocked E2E: vague request → agent asks (interrupt) with options → student taps → resume → build renders.
- Optional live smoke (`RUN_LIVE_E2E=1`): real interrupt→resume round-trip; assert no secret leak.

---

## Risks / decisions to confirm while building (from docs, not guesses)
1. **Per-request agent re-construction + shared saver**: confirm a fresh `createDeepAgent({checkpointer:
   sharedSaver})` invoked with the same `thread_id` reads prior state (expected: yes — saver is the store).
   If deepagents needs a persisted *compiled* agent instead, hoist the agent to a module singleton.
2. **`interrupt()` inside a custom `tool()`** under deepagents `toolStrategy`: confirm the pause surfaces as
   `output["__interrupt__"]` from `agent.invoke` (vs requiring `.stream`). Cassette smoke in Phase 2 settles it.
3. **Context-packet injection vs thread history**: inject the packet as the per-turn user content; rely on
   the checkpoint for *history* only — avoid double-grounding/bloat.
4. **`interruptOn` vs custom interrupt tool**: `interruptOn` gates *existing* tools (approve/edit/reject);
   for a free-form/option *question* we use a custom `request_clarification` tool that calls `interrupt()`.
   Confirm this is the recommended shape (docs show tool-level `interrupt()`).
5. **Durable saver package + Railway**: pick Postgres vs Redis; verify version compat with langgraph 1.3.
