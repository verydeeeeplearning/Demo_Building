# Design Plan: Framework-Native Agent Memory + Human-in-the-Loop Clarification

**Status**: Proposed (design only — supersedes the prior hand-rolled approach)
**Started**: 2026-06-04
**Rule**: Per `CLAUDE.md` / `AGENTS.md`, this agent MUST use framework-native deepagents/LangGraph
mechanisms (checkpointer, store, interrupt) — not bespoke fields or hardcoded content. Re-verify every
API against the official docs (`/langchain-ai/deepagentsjs`, `/websites/langchain_oss_javascript_langgraph`)
during implementation.

> This replaces the earlier draft of this plan (manual `conversationContext` re-injection +
> `clarificationChoices` field + hardcoded starter menu). That bespoke direction was rejected: the LLM
> can't be relied on to fill a custom field, and curated content was leaking into `.ts`. We move to the
> framework primitives.

---

## 1. Current agent architecture (As-Is, framework lens)

Source: `server/agent/deepAgentRuntime.ts`, `server/index.ts`, `server/agent/schemas.ts`.

| Concern | Current state | Evidence | Framework gap |
|---------|---------------|----------|---------------|
| **Agent construction** | `createDeepAgent({ model, tools, subagents, responseFormat: toolStrategy(...), systemPrompt })` at 3 sites | `deepAgentRuntime.ts:479,595,847` | No `checkpointer`, no `store` passed |
| **Invocation** | `agent.invoke({ messages: [user] }, { configurable: { thread_id: sessionId } })` | `:522,538` | `thread_id` is **inert without a checkpointer** — each call is a fresh stateless graph |
| **Session** | `sessionId = request.sessionId ?? session-${uuid}`; returned to client; **no server store** | `:343` | Server fully stateless between requests |
| **Conversation memory** | Hand-rolled: client sends `conversationContext.recentTurns` (≤12); server re-injects them as a prompt block + a server-recomputed `foldRunningSummary` | `:2251-2298`, `schemas.ts:1034` | Re-implements what the **checkpointer** does natively |
| **Clarification** | Free-text only: `responseKind:'chat'`, question in `assistantMessages[0]`; ReAct "ask ONE question" | `:1599`, `:2229` | No HITL pause/resume; no structured options pattern |
| **Slot-filling / narrowing** | None (single-turn LLM question) | — | No `interrupt()`/`Command` loop |

**Determinism funnel (keep):** every turn runs `buildContextPacket` (capabilityGraph → route → bundle →
candidateParts → promptBlock) and injects it. This is the app's grounding/safety core and is independent
of how conversation memory is stored. The refactor changes **memory + clarification**, not the funnel.

**Bespoke code added this session (to be reverted in Phase 0):** `clarificationChoices` field on
`LiveAgentDraftSchema`/`AgentRunResultSchema`, `server/agent/clarificationChoices.ts` (hardcoded menu),
`pendingClarification` plumbing, and the prompt-injection of `pendingClarification`. The client chip
**renderer** (`src/clarificationChoicesView.js`) and the `sessionStorage` session id persistence are
reusable and stay.

---

## 2. Official patterns (verified via context7)

**A. Short-term memory = checkpointer + `thread_id`** (`/websites/langchain_oss_javascript_langgraph`,
"Add Short-Term Memory with MemorySaver"):
```ts
import { MemorySaver } from "@langchain/langgraph";
const checkpointer = new MemorySaver();
const graph = builder.compile({ checkpointer });
await graph.invoke({ messages: [{ role: "user", content: "hi" }] }, { configurable: { thread_id: "1" } });
```
deepagents: *"Session persistence is managed through LangGraph's checkpointer… the server replays the
entire conversation history."*

**B. Long-term memory = `Store`** (cross-thread, optional):
```ts
import { InMemoryStore } from "@langchain/langgraph";
const graph = builder.compile({ store: new InMemoryStore() });
```

**C. Human-in-the-loop = `interrupt()` + `Command({ resume })`** (docs: "Invoke and Resume Agent with
Interrupt"):
```ts
import { Command } from "@langchain/langgraph";
let res = await agent.invoke({ messages: [user] }, { configurable: { thread_id } });
// res contains __interrupt__  (the agent paused to ask the user)
res = await agent.invoke(new Command({ resume: selectedValue }), { configurable: { thread_id } });
```

**D. Stateful subagent (resolves the prior "interrupt-in-subagent broken" blocker)** — official pattern
is subagent `checkpointer: true` + `toolCallLimitMiddleware` to avoid parallel-call checkpoint conflicts.
deepagents also exposes `interruptOn` for tool-approval gating.

**E. Native context compaction** — deepagents `createSummarizationMiddleware` replaces the hand-rolled
`foldRunningSummary` once the checkpointer owns history.

---

## 3. Target design

### 3a. Memory → checkpointer
- Pass a `checkpointer` to `createDeepAgent`; invoke with `thread_id = sessionId`.
- Send only the **new** user turn (+ the per-turn deterministic context packet) each request; prior turns
  come from the checkpoint. **Remove** the manual `recentTurns` re-injection and `foldRunningSummary`.
- Dev/demo: `MemorySaver` (in-process). Production: a **durable saver** (Postgres/Redis) so a redeploy
  doesn't drop live threads/paused interrupts. (Phase 4.)
- Optional later: a `Store` for long-term, cross-session memory (student preferences). Not in MVP.

### 3b. Clarification / "역제안" → `interrupt()` HITL
- Add an `ask_user` tool (or reuse deepagents `interruptOn`) that calls
  `interrupt({ question, options })`. The agent calls it when a required detail is open — the graph
  **pauses deterministically** (not dependent on the LLM filling a field).
- `options` are **grounded by the deterministic layer** (candidate capabilities/parts for the open slot)
  — derived from the context packet, never hardcoded.

### 3c. HTTP resume protocol (adapting interrupt to request/response)
- **Request**: extend `AgentMessageRequest` with an optional `resume` (a selected option value or free
  text). If `resume` is present → `agent.invoke(new Command({ resume }), { configurable: { thread_id:
  sessionId } })`; else → normal invoke with the new message.
- **Response**: if the run ends in `__interrupt__`, return `{ status: 'awaiting_input', interrupt:
  { question, options }, sessionId }`; else the normal result. The checkpointer holds the paused state
  between the two HTTP calls (keyed by `sessionId` = `thread_id`).
- **Client**: on `awaiting_input`, render `options` as chips (reuse `clarificationChoicesView.js`);
  selecting one (or typing) POSTs `{ sessionId, resume: value }` to resume the same thread.

### Determinism boundary (unchanged)
LLM owns: when to ask, which slot, phrasing, part selection. Deterministic code owns: the grounded option
set, the context funnel, validation/DRC, safety. The checkpointer/interrupt are **mechanism**, not
authority.

---

## 4. Implementation phases (TDD; cite docs per phase)

### Phase 0 — Revert the bespoke mechanism
- Remove `clarificationChoices` from `LiveAgentDraftSchema`/`AgentRunResultSchema`, delete
  `server/agent/clarificationChoices.ts` + its test, remove the `pendingClarification` server injection
  and the starter-menu fallback. Keep `clarificationChoicesView.js` (rename to an interrupt-options view)
  and the `sessionStorage` session id persistence.
- Gate: typecheck + existing suites green (back to pre-session behavior for the agent contract).

### Phase 1 — Checkpointer memory (short-term)
- Wire `checkpointer` (MemorySaver) into `createDeepAgent`; invoke with `thread_id = sessionId`; stop
  re-injecting `recentTurns`/`foldRunningSummary`.
- RED: a scripted/cassette test proving turn 2 on the same `sessionId` sees turn 1 (thread memory) without
  the client re-sending history.
- Gate: eval + context suites 0 regression; tsc clean. Doc: §2A.

### Phase 2 — Interrupt-based clarification (server)
- Add the `ask_user`/`interrupt()` tool; map `__interrupt__` → `awaiting_input` response; add `resume`
  request handling → `Command({ resume })`.
- RED: scripted test — an ambiguous request returns `awaiting_input` with grounded `options`; a follow-up
  `resume` continues the same thread to a build. Doc: §2C.

### Phase 3 — Client resume loop
- Render `awaiting_input.options` as chips; submit `{ sessionId, resume }`; keep free-text. Persist
  `sessionId` (sessionStorage) so reload resumes the server-held thread.
- RED: jsdom/Playwright (mocked) — options render, selecting one POSTs `resume`, the thread continues.

### Phase 4 — Production durability (optional, before deploy)
- Swap MemorySaver → a durable saver (Postgres/Redis) so redeploys don't drop threads/interrupts.
- Doc: LangGraph persistence backends.

### Phase 5 — Verify
- `npm run check` (unit + build + e2e); a mocked E2E of the full ask→resume loop; optional live smoke.

---

## 5. Risks & implications (honest)
| Risk | Impact | Mitigation |
|------|--------|------------|
| Server becomes **stateful** | ops + scaling | MemorySaver for dev/demo; durable saver (Phase 4) for prod; `thread_id`=sessionId keeps it sticky |
| MemorySaver loses paused interrupts on restart | a mid-clarification thread is dropped on redeploy | acceptable for demo; Phase 4 durable saver removes it |
| `interrupt()` + `toolStrategy` structured-output interaction | unknown until tested | spike in Phase 2; the official `interrupt`/`Command` flow is the reference |
| Per-turn context-packet injection vs thread history | double-grounding / prompt bloat | inject context packet as the per-turn user content; rely on checkpoint for *history*, not for grounding |
| deepagents subagent + interrupt | prior blocker | use official `checkpointer:true` + `toolCallLimitMiddleware`, or run interrupt in the main agent |

## 6. Open items to confirm during implementation (from docs, not guesses)
1. Exact import surface in this repo's versions (`langchain@1.4`, `@langchain/langgraph`): `MemorySaver`,
   `interrupt`, `Command`, `toolCallLimitMiddleware` availability.
2. Whether `createDeepAgent` accepts `checkpointer`/`store` directly or needs the underlying graph.
3. Reading `__interrupt__` from the deepagents `invoke` result shape (vs `stream.interrupted`).
4. Durable saver choice for Railway (Postgres vs Redis).
