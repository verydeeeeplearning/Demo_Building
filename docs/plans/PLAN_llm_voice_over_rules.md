# Fix Plan: Let the LLM's Voice Lead (stop rules from overriding agent replies)

**Status**: Proposed — awaiting approval
**Date**: 2026-06-03
**Branch**: feat/layered-context-architecture
**Basis**: 3 parallel code-explorer subagent investigations of `server/agent/` + `src/` (file:line cited).

---

## Problem statement (from the user)

> "rule로 만들지 말라고. 지금 llm 기반으로 답변하는데 rule로 계속 나오잖아."

Two distinct failure classes were found by end-to-end live testing (real gpt-5.4-mini + agent logs + Playwright):

- **Class A — structured-output 502s** (the greeting error "회로 초안을 구조화해서 확인하지 못했어요"). **ALREADY FIXED** this session (see "Done" below).
- **Class B — canned text overrides the LLM's words.** When the agent writes a natural reply but the deterministic circuit validator returns anything other than `valid + runnable`, the server **discards the LLM message** and substitutes a boilerplate template. This is what still makes answers "look rule-based." **This plan targets Class B.**

---

## Done already this session (Class A + groundwork)

| Fix | File | Effect | Status |
|-----|------|--------|--------|
| Recover a plain-text synthesis reply as a chat result | `deepAgentRuntime.ts` `recoverDraftFromAgentMessages` | greeting/recommend answered in plain text → `responseKind:'chat'` instead of 502 | shipped (main `7c6dd26`) |
| Requirement-analysis structured-output fallback (legacy) | `deepAgentRuntime.ts` runLiveAgent `.catch` → `deriveRequirementAnalysis` | legacy greeting no longer 502s; verified live (`requirement.analysis.recovered`, 5/5 probes chat) | shipped (main `02e6589`) |
| responseKind invariant + ReAct decision + scope tool + concise chat | prior commits | agent decides chat/recommend/clarify/build | shipped |

Strategic note (no code): setting `H_EDUWARE_AGENT_PIPELINE=next` on Railway replaces the legacy requirement-analysis LLM with the deterministic route entirely (env-only). Fix 1 already makes legacy robust, so this is optional, not required.

---

## Root cause of Class B (subagent evidence)

**Rank 1 — `finalAssistantMessage` replaces the LLM message** (`deepAgentRuntime.ts:1274`, called from `finalizeAgentResult:1061`).

Pass-through happens ONLY when the draft is fully `valid + runnable` (or `unsupported`). For the very common `valid-but-not-runnable` and `invalid` cases, the LLM's natural Korean reply is **silently dropped** and replaced by:
- valid-not-runnable → `"회로 초안은 이해했지만 아직 실행 가능한 시뮬레이션으로 확정되지는 않았어요. 막힌 지점: {reason} …"`
- invalid → `"아직 이 회로를 안전하게 확정할 수 없어요. 회로 검증에서 {reason} …"`

`{reason}` comes from `studentValidationReason` (`:1399`), itself a code→canned-Korean table. So a student who got a thoughtful LLM explanation sees a template instead, on every imperfect circuit.

**Rank 2 — `sanitizeStudentFacingAssistantMessage`** (`:1359`): a 17-entry regex replacement table applied to EVERY message. Can rewrite the LLM's phrasing mid-sentence (e.g. `렌더링`→`3D 보기`, `컨텍스트`→`자료`), occasionally breaking Korean grammar. The synthesis prompt already instructs the model to avoid internal terms, so this is mostly redundant on real LLM output.

**Rank 3 — `buildUnsupportedPreflightDraft`** (`:1643`): canned safety text; the synthesis agent never runs for `unsupported_or_gap`. **Legitimate hard guardrail — keep.**

**Rank 4 — `toConciseStudentMessage`** (`:1335`): greedy `**header**[\s\S]*?(?=\*\*|$)` could erase legitimate content if the LLM bolds a phrase matching a `CHAT_DETAIL_HEADERS` keyword.

Other canned points (verified legitimate, no change): `buildStructuredOutputFallbackDraft` (infra fallback), `recoverDraftFromAgentMessages` placeholder (LLM wrote nothing), `safeEquivalentAssistantMessage` (safety), client `agentErrorMessages.js` (error path), `confirm-current-draft` UI shortcut.

---

## Design principle for the fix

> The **LLM owns the prose**. The deterministic layer owns the **circuit gate** (whether the 3D scene / run is enabled) and may **APPEND** a short status note — it must NOT replace the LLM's words, except for a hard-safety refusal (`unsupported_or_gap`).

---

## Phases (TDD: RED → GREEN → REFACTOR; gate each with typecheck + TS suite + live probe)

### Phase 1 — `finalAssistantMessage`: lead with the LLM, append the status (Rank 1)
**Goal**: The LLM's `draft.assistantMessage` always leads. For `valid-not-runnable` / `invalid`, append a concise one-line status/next-step instead of replacing.

- RED: `tests/unit/finalAssistantMessage.test.ts` — given a draft message "여기 LED 회로예요 …" and a `valid-not-runnable` report, the result CONTAINS the draft message AND a short status note; it does NOT equal the old canned template verbatim. Invalid case likewise keeps the draft message.
- GREEN: rewrite `finalAssistantMessage` (`:1274`) to: `return [draftMessage, statusNote].join('\n\n')` where `statusNote` is the short validation/runnable reason (reuse `studentValidationReason`), only when not valid+runnable. Keep the hard-safety/unsupported path unchanged (it goes through `buildUnsupportedPreflightDraft`, not here).
- Keep `clarification` surfacing intact.
- Quality gate: existing finalize tests updated; live probe — an under-specified circuit shows the LLM text + a note, not a bare template.

### Phase 2 — make `sanitizeStudentFacingAssistantMessage` non-destructive (Rank 2)
**Goal**: Stop rewriting natural LLM prose. Only strip/replace when an INTERNAL term actually leaked.

- RED: `tests/unit/sanitizeStudentMessage.test.ts` — a natural sentence containing `렌더링` in a normal pedagogical sense is left intact OR mapped only when it co-occurs with a known internal phrase; a message that literally contains `CircuitSpec`/`context packet`/`support bundle evidence` is still cleaned.
- GREEN: narrow the table to only the genuinely-internal tokens (`CircuitSpec`, `context packet`, `support bundle evidence`, `structured output`, `unsupportedItems`, `clarificationNeeds`), and drop the broad linguistic rewrites (`렌더링`/`컨텍스트`/`확정하지 않겠습니다` …). Idempotent.
- Quality gate: TS suite; live probe — a built circuit's LLM message reads naturally, unedited.

### Phase 3 — harden `toConciseStudentMessage` header regex (Rank 4)
**Goal**: Don't erase legitimate bolded text.

- RED: a message `**회로 초안**을 잘 이해했어요. 시작할게요!` (bold keyword used in a sentence, not a section) is preserved.
- GREEN: only strip a detail section when the bold header is at a line start AND followed by list/JSON/table content (anchor the regex to line boundaries + require a following block), not mid-sentence.
- Quality gate: existing `studentChatMessage.test.ts` stays green + new case passes.

### Phase 4 — live end-to-end verification (Playwright, real LLM)
- Scenarios through the browser at `http://127.0.0.1:8787/`: greeting, recommendation, a clean buildable circuit, an under-specified circuit (valid-not-runnable), an unsafe request (220V).
- Assert: greeting/recommend → natural chat; clean circuit → LLM message + scene; under-specified → LLM message + appended note (NOT a bare template); unsafe → safety guardrail (canned, expected).
- Capture `agent-events.jsonl` traces for each.

---

## Risk / rollback

| Risk | Mitigation |
|------|-----------|
| Appending status makes messages long | keep the note to one short line; the LLM is already told to be concise |
| Narrowing the sanitizer lets an internal term slip through | keep the genuinely-internal tokens; the prompt already forbids them; live probe checks |
| Header-regex change misses a real dump | Phase 3 keeps fenced-code + line-anchored section stripping; the prompt tells the model not to paste dumps |

Each phase is an independent commit; revert per phase. No schema or pipeline-mode changes.

---

## Out of scope (note only)
- Switching production default to `next` (env-only; optional, Fix 1 already covers robustness).
- Centralizing the scattered policy/prompt rules into `policy/rules.ts` (separate refactor).
