# Implementation Plan: Front Intent Gate (off-topic / general-question routing)

**Status**: Complete
**Started**: 2026-06-03
**Last Updated**: 2026-06-03

## Overview

### Problem
A non-circuit message (e.g. greeting "안뇽", or "옴의 법칙이 뭐야?") is forced through the
circuit-synthesis pipeline. The synthesis agent cannot emit a structured `circuitSpec`, so it
throws `AGENT_STRUCTURED_OUTPUT_MISSING`, which the frontend renders as
`"회로 초안을 구조화해서 확인하지 못했어요…"` (`src/agentErrorMessages.js:13-16`).

Root cause: there is **no step that judges whether a message is circuit work or general chat**.
`casual_chat` exists in the route enum (`deepAgentRuntime.ts:73`) and the legacy LLM router prompt,
but: (a) the deterministic `deriveRequirementAnalysis` never produces it, and
(b) `buildPreflightDraftFromAnalysis` has no `casual_chat` branch — it falls through to a
clarification circuit draft. So `casual_chat` is a dead enum.

### Decision (user-approved)
- **Front intent gate**: a lightweight **LLM-judged** classifier runs BEFORE synthesis, in all
  pipeline modes. Agent judges relevance — NOT regex/rules.
- **Actually answer** general/educational questions and gently nudge toward circuit building
  (e.g. "옴의 법칙? V=IR … 직접 회로로 확인해볼래?"), instead of just deflecting.

### Success Criteria
- [ ] "안뇽" → conversational reply, NOT `AGENT_STRUCTURED_OUTPUT_MISSING`.
- [ ] "LED 깜빡이게 해줘" → unchanged circuit synthesis path.
- [ ] Ambiguous / any circuit intent → biased to `circuit_request` (never chat away a real request).
- [ ] No 3D scene rendered for a chat reply.
- [ ] Kill-switch `H_EDUWARE_INTENT_GATE=off` restores pre-gate behavior.

## Architecture (Clean Architecture)

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| Domain/Schema | `IntentDecisionSchema`, `AgentRunResult.responseKind` | intent decision + response-kind types |
| Application | `server/agent/intentGate.ts` — `classifyStudentIntent`, `getIntentGateMode` | LLM-judged classification via injected `ModelPort`/`DeepAgentFactory` |
| Application port | `AgentRuntimeDeps.intentGate?: IntentGate` | injectable seam (tests pass a fake; prod uses default) |
| Adapter | `deepAgentRuntime.ts` — `buildCasualChatResult`, gate wiring in `runLiveAgent` | turn a chat reply into a (circuit-less) `AgentRunResult`; short-circuit before synthesis |
| Presentation | `src/main.js` — `canShowAgentScene` | hide 3D scene when `responseKind === 'chat'` |

The classifier depends only on the `ModelPort` / `DeepAgentFactory` abstractions (no `ChatOpenAI`
import), so tests run with zero live OpenAI calls and the dependency rule is respected.

### Key decisions
| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| Separate front gate (not fold into requirement-analysis) | mode-agnostic; works in legacy AND next (deterministic) modes; matches user's "front gate" choice | one extra lightweight LLM call per request |
| Injectable `intentGate` port (default = LLM) | keeps existing count-asserting tests green by injecting a passthrough; Clean Architecture seam | tests must inject the fake explicitly |
| `responseKind` discriminator + placeholder spec | `circuitSpec.components` is `.min(1)` so an empty spec is invalid; discriminator lets the frontend ignore the placeholder | placeholder circuit carried but never rendered |
| `H_EDUWARE_INTENT_GATE` kill-switch | concrete rollback (mirrors `H_EDUWARE_AGENT_PIPELINE`) | — |

## Phases (TDD)
- **US-1**: `IntentDecisionSchema` + `classifyStudentIntent` + `getIntentGateMode`.
- **US-2**: `responseKind` + `buildCasualChatResult`.
- **US-3**: wire gate into `runLiveAgent` (+ injectable port, kill-switch); keep count tests green.
- **US-4**: frontend `canShowAgentScene` chat guard.
- **US-5**: full verification + docs.

## Rollback
Per story: revert the story's commit. Global runtime kill-switch: `H_EDUWARE_INTENT_GATE=off`.

## Kill-switch
`H_EDUWARE_INTENT_GATE=off` (read by `getIntentGateMode`) skips the gate in `runLiveAgent` entirely —
every message goes straight to requirement-analysis / synthesis exactly as before. Default is `on`.
Covered by `getIntentGateMode` unit tests and the `intentGateRouting` "off skips the gate" test.

## Final verification (2026-06-03)
- `npm run typecheck`: 0 errors.
- TS unit suite (`tsx --test`): 482 tests, 481 pass, 0 fail, 1 skip (env-gated live test).
- JS unit suite (`node --test`): 158 tests, 155 pass, **3 fail — pre-existing, OUT OF SCOPE**
  (styles.css design-token tests: token drift / WCAG contrast / focus token; identical to the
  pre-US-1 baseline, untouched by this feature).
- `npm run build`: success.

## Notes & Learnings
- Only `runAgent` (live path) hits the gate; `runAgentWithScriptedDrafts` bypasses `runLiveAgent`,
  so `agentWorkflow` / `structuredOutputReliability` tests are unaffected.
- Live-path count tests needing a passthrough gate: `agentRuntimeSeams`, `singleRunHarness`.
- `circuitSpec.components` is `.min(1)`, so a chat result cannot use an empty spec — it carries an
  inert placeholder component, hidden by `responseKind === 'chat'`.
- `groundAgentResultArtifacts` is already a no-op when `simulationPlan.currentPaths` is empty, so chat
  results pass through it untouched (no frontend change needed there).
- Clean Architecture: `intentGate.ts` (application use case) depends only on `ModelPort` /
  `DeepAgentFactory` abstractions + the `toolStrategy` response-format helper — never on `ChatOpenAI`.
