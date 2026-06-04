# Tutor Chat Railway Fallback Fix Plan

## Status

Implemented and verified on 2026-06-04 after RALPLAN consensus approval.

Implementation result:

- Main simulation chat, share API calls, and tutor chat now share
  `hEduwareAgentApiBase` resolution.
- Tutor server failure caching is endpoint-aware, so changing the configured
  API base retries the new endpoint instead of reusing stale fallback state.
- Client-side tutor fallback now classifies `transport`, `http`, and `schema`
  failures and the UI exposes the category through `data-fallback-category`.
- Browser and server deterministic tutor fallback both retarget LED
  voltage/safety follow-ups to LED current-limiting guidance.
- Final architect review: `ARCHITECT APPROVE`, no blocking issues.
- Verification: `npm install`, `npm test`, `npm run build`,
  `npm run test:e2e`, and `npm run check` all passed.

Review record:

- Architect v1: revise. Required dual fallback scope, existing server metadata
  wording, UI propagation, and stronger Railway-like e2e URL assertion.
- Architect v2: approve.
- Critic v1: approve. Confirmed the plan distinguishes routing/proxy, server
  config, structured-output, client schema rejection, cache behavior, and
  fallback answer-quality failures.

## Problem Statement

On the Railway deployment, the main simulation query can work while the tutor
chat shows the Korean UI label for `live_tutor_fallback`. In this codebase that
label maps to
`servingStatus: "live_tutor_fallback"`, meaning the tutor tried or intended to
use the live tutor path and then returned deterministic local copy instead.

Observed user trajectory:

1. Student asks how the circuit works.
2. Tutor answers about Breadboard and shows the fallback status label.
3. Student asks whether the LED can handle higher voltage.
4. Tutor again answers about Breadboard and shows the fallback status label.

This is two failures layered together:

- Serving failure: tutor live serving falls back even though simulation works.
- Conversation quality failure: once fallback happens, the deterministic local
  answer remains tied to the selected inspector target instead of recognizing
  that the follow-up question changed topic to LED voltage/safety.

## Context Snapshot

- RALPLAN context snapshot:
  `.omx/context/tutor-chat-railway-fallback-20260604T142150Z.md`
- Parallel subagent findings:
  - Frontend explorer: simulation and tutor use different runtime contracts.
  - Server explorer: server fallback classes are config, schema/structured
    output, runtime/tool strategy, request schema, or policy.
  - Test engineer: current tests miss the Railway-like configured API base case
    where simulation works but tutor calls a different endpoint.
- Architect review v1:
  - Approved the root cause model and phase order.
  - Required broadening fallback answer-quality work to cover both browser
    fallback and server live fallback, because they are separate deterministic
    local-response implementations.
  - Required Phase 2 to distinguish existing server fallback metadata from
    missing client/UI propagation.

## Official Framework Notes Checked

Before planning runtime changes that touch agent behavior, the following
framework docs were checked:

- LangChain JS structured output:
  <https://docs.langchain.com/oss/javascript/langchain/structured-output>
  - Structured output is returned in `structuredResponse`.
  - `toolStrategy()` is the framework-native tool-calling strategy.
  - `providerStrategy()` can be more reliable when the model/provider supports
    native structured output.
  - Tool strategy has built-in error handling and retry hooks for schema errors.
- Deep Agents JS customization:
  <https://docs.langchain.com/oss/javascript/deepagents/customization>
  - `createDeepAgent()` is the framework-native entrypoint.
  - Model construction should use documented model strings or initialized models.
  - Checkpointers are required for human-in-the-loop and persistent memory use.
- LangGraph JS persistence:
  <https://docs.langchain.com/oss/javascript/langgraph/persistence>
  - Stateful graph access requires `configurable.thread_id`.
- LangChain JS subagents:
  <https://docs.langchain.com/oss/javascript/langchain/multi-agent/subagents>
  - Subagents are stateless by default; persistent subagent memory requires an
    explicit checkpointer design.

Decision consequence: this plan does not hand-roll a new agent runtime. It keeps
the tutor live path on the current LangChain/Deep Agents structured-output
mechanism, then adds endpoint parity, diagnostics, tests, and only bounded
framework-native structured-output hardening if Railway logs show that class of
failure.

## Current Architecture

### Main Simulation Chat

Runtime path:

1. UI calls `submitAgentMessageRobust(...)` in `src/main.js`.
2. Client calls `sendAgentMessage(...)` in `src/aiClient.js`.
3. `src/aiClient.js` resolves the agent API base from:
   - `localStorage.hEduwareAgentApiBase`, if present.
   - `http://127.0.0.1:8787` in local dev.
   - Same-origin `/api/...` in production.
4. Server receives `POST /api/agent/message` in `server/index.ts`.
5. Server runs the main agent/deep agent flow.
6. UI renders generated files, PCB/breadboard view, and Run output.

Important property: the simulation path already supports a deployed or
overridden agent API base.

### Tutor Chat

Runtime path:

1. UI calls tutor question handling in `src/main.js`.
2. It calls `askCircuitTutor(...)` in `src/circuitTutorClient.js`.
3. `askCircuitTutor(...)` first checks `localStorage.hEduwareTutorServer`.
   - If set to `disabled`, it returns deterministic local answer with
     `servingStatus: "local_tutor_answer"`.
4. Otherwise it posts to `DEFAULT_ENDPOINT` for `/api/agent/explain-target`.
   - In production: same-origin `/api/agent/explain-target`.
   - In development: `http://127.0.0.1:8787/api/agent/explain-target`.
   - It does not honor `localStorage.hEduwareAgentApiBase`.
5. On network, non-2xx, parse, or response validation failure, it caches a short
   server failure and returns deterministic local copy with
   `servingStatus: "live_tutor_fallback"`.
6. Server receives `POST /api/agent/explain-target` in `server/index.ts`.
7. Server validates request schema, then calls `runTutorAgent(...)` in
   `server/agent/circuitTutor.ts`.
8. `runTutorAgent(...)` either:
   - Returns local mode.
   - Returns live structured answer.
   - Returns `live_tutor_fallback` with fallback metadata.

Important property: tutor and simulation can diverge even in the same browser
session.

## Why The Symptom Is Plausible

`로컬 대체` specifically means `live_tutor_fallback`, not explicit local-only
mode. The likely failure classes are:

1. API base divergence: simulation uses `hEduwareAgentApiBase`, tutor ignores it.
2. Route/deployment divergence: `/api/agent/message` is reachable, but
   `/api/agent/explain-target` is not exposed, stale, or proxied incorrectly.
3. Live tutor config fallback: tutor mode/model/key settings differ from the
   main simulation path.
4. Structured-output fallback: Deep Agents runs, but no valid
   `structuredResponse` matching `LiveTutorDraftSchema` is returned.
5. Client response validation fallback: server answers, but client rejects shape.
6. Browser state: `hEduwareTutorServer` disables server use, or the 15-second
   failure cache suppresses retries.
7. Local fallback quality: selected inspector target remains Breadboard while the
   natural-language question asks about LED voltage.

## RALPLAN-DR

### Decision Drivers

- Simulation and tutor chat must share the same deployment/API-base contract.
- A live tutor failure must be diagnosable from client response metadata and
  Railway logs without exposing secrets.
- Deterministic fallback must still answer common safety/topic-shift questions
  well enough for demo use.
- Default verification must use mocked or cached AI responses, not live OpenAI.
- Agent runtime changes must stay framework-native for LangChain, LangGraph,
  Deep Agents, and LangSmith.

### Options Considered

1. Patch only Railway environment variables.
   - Pros: fastest if the only issue is config.
   - Cons: does not fix API-base divergence, bad fallback answers, or missing
     regression tests.
   - Decision: reject as insufficient.

2. Force tutor chat through the main `/api/agent/message` simulation agent.
   - Pros: one endpoint.
   - Cons: conflates simulation generation and explanatory QA, increases
     latency, risks context/trajectory contamination, and discards existing
     tutor schemas.
   - Decision: reject for this slice.

3. Make tutor local-only.
   - Pros: robust transport.
   - Cons: hides the live failure and produces exactly the stale Breadboard-style
     answers the user reported.
   - Decision: reject.

4. Align tutor with the main agent API base, add diagnostics, harden local
   fallback topic handling, and then address server structured-output issues if
   logs prove that is the active failure.
   - Pros: directly targets the observed divergence, keeps current architecture,
     improves all failure trajectories, and is testable without secrets.
   - Cons: touches client API base behavior and some tests.
   - Decision: accept.

### Decision

Implement endpoint parity and fallback observability first. Keep the tutor live
agent stateless and structured-output based. Do not add tutor memory,
checkpointer state, or a new agent orchestration layer unless a later product
requirement explicitly asks for multi-turn tutor memory.

## Implementation Plan

### Phase 0: Confirm Production Failure Class

Before changing runtime behavior, collect one Railway failing tutor turn.

Check browser DevTools:

- Request URL for `/api/agent/explain-target`.
- HTTP status.
- Response body `servingStatus`.
- Response body `fallbackCategory` and `fallbackReason`, if present.
- Whether the request went to the same origin as the working simulation request.

Check Railway logs for the same turn:

- `tutor.request.received`
- `tutor.response.sent`
- `tutor.request.failed`
- `servingStatus`
- `runtimeMode`
- `liveConfigured`
- `liveAttempted`
- `fallbackCategory`
- `fallbackReasonPreview`
- `structuredOutputStatus`
- `traceId` / `requestId` / `sessionId`

Expected triage:

- No server log for `/api/agent/explain-target`: client routing/proxy/API-base
  issue.
- `tutor.request.failed`: request schema or route handler failure.
- `tutor.response.sent` with `fallbackCategory: "configuration"`: Railway env
  or mode issue.
- `fallbackCategory: "structured-output"`: live Deep Agents structured-output
  issue.
- `fallbackCategory: "live-failure"`: model/provider/runtime timeout or API
  failure.

### Phase 1: Unify Agent API Base Resolution

Goal: main simulation, sharing, placement, health, and tutor use one endpoint
resolution contract.

Planned changes:

- Add a small shared client helper, likely `src/agentApiBase.js`, with:
  - `agentApiBase(storage = globalThis.localStorage)`
  - `agentApiUrl(path, storage = globalThis.localStorage)`
  - same production/dev/default semantics as `src/aiClient.js` today.
- Update `src/aiClient.js` to use the helper without changing behavior.
- Update `src/shareClient.js` to use the helper without changing behavior.
- Update `src/circuitTutorClient.js` to call:
  - `agentApiUrl('/api/agent/explain-target')`
  - not `DEFAULT_ENDPOINT`.
- Update tutor failure cache key so it includes the resolved endpoint. Changing
  `hEduwareAgentApiBase` must invalidate cached tutor failures.
- Keep `hEduwareTutorServer === "disabled"` as an explicit local-only override,
  but do not let it silently masquerade as live fallback.

Regression tests:

- `tests/unit/circuitTutorClient.test.js`
  - configured `hEduwareAgentApiBase` is used for tutor requests.
  - changing `hEduwareAgentApiBase` changes the tutor cache key.
  - explicit `hEduwareTutorServer: "disabled"` returns `local_tutor_answer`
    without network.
- Existing `aiClient` and `shareClient` tests remain green.

### Phase 2: Propagate And Verify Fallback Reason Metadata

Goal: if tutor falls back on Railway, the next report should identify the
specific failure class without reading raw exception text.

Planned changes:

- Preserve existing redaction behavior.
- Treat server metadata as already partially implemented, then verify and
  tighten it:
  - `server/agent/circuitTutor.ts` already has server-side categories for
    configuration, structured output, and live runtime failure.
  - `server/agent/agentLogger.ts` already summarizes tutor mode, serving status,
    live attempt/config state, fallback category, redacted fallback reason
    preview, and structured output status.
  - Implementation should add tests or small tightening only where these fields
    are missing or under-specified.
- Add missing client-side categories in `src/circuitTutorClient.js`:
  - client transport fallback: `fallbackCategory: "transport"`
  - client non-2xx fallback: `fallbackCategory: "http"`
  - client malformed response fallback: `fallbackCategory: "schema"`
- Preserve server-side categories:
  - server missing config: `fallbackCategory: "configuration"`
  - server structured output issue: `fallbackCategory: "structured-output"`
  - server live runtime failure: `fallbackCategory: "live-failure"`
- Carry `fallbackCategory` through `submitTutorQuestion()` in `src/main.js`
  into `state.inspector.chatMessages`.
- Add a compact UI diagnostic hook:
  - status badge still uses the localized fallback label.
  - `data-status` remains `live_tutor_fallback`.
  - add `data-fallback-category` for e2e and diagnostics.
  - optional localized title/tooltip can say the live tutor was unavailable and
    local evidence was used.

Regression tests:

- `tests/unit/circuitTutorClient.test.js`
  - non-2xx response maps to `fallbackCategory: "http"`.
  - network error maps to `fallbackCategory: "transport"`.
  - malformed response maps to `fallbackCategory: "schema"`.
- `tests/unit/circuitTutor.test.ts`
  - live mode without credentials returns configuration fallback metadata.
  - structured-output failure returns structured-output fallback metadata.
- `tests/unit/agentLogger.test.ts`
  - fallback summary includes category and redacted preview only.

### Phase 3: Unify Deterministic Fallback Topic Handling Across Client And Server

Goal: local fallback should not repeat Breadboard content when the user asks a
clear LED voltage/safety follow-up.

Important constraint: there are two deterministic fallback paths.

- Browser transport/schema fallback:
  - `src/circuitTutorClient.js` calls `localTutorResponse(...)`, which uses
    `answerTutorQuestion(...)` in `src/circuitInspector.js`.
- Server live/config/structured-output fallback:
  - `server/agent/circuitTutor.ts` builds local fallback via
    `buildLocalTutorResponse(...)`.

Implementation must update both paths or extract a shared pure classifier that
both paths use.

Preferred design:

- Add a small shared pure intent helper, for example
  `src/tutorQuestionIntent.js`, with no DOM, Vite, server, or network
  dependency.
- Use it from:
  - `src/circuitInspector.js` for browser fallback.
  - `server/agent/circuitTutor.ts` for server fallback.
- The helper should classify only the small hackathon demo domain:
  - mentioned part: LED, OLED, Arduino, resistor, breadboard.
  - safety/voltage/current terms.
  - language support for Korean and English trigger terms.
- The helper should return intent metadata, not finished copy:
  - `mentionedPart`
  - `isVoltageSafetyQuestion`
  - `shouldRetarget`
  - `confidence`
- Each local answer builder can still produce its own existing copy style, but
  they must share the retarget/safety decision.

Planned browser fallback changes:

- Add a small deterministic question classifier for the demo domain:
  - mentions LED, OLED, Arduino, resistor, breadboard.
  - safety/voltage/current terms, including Korean phrases such as
    voltage, "voltage" transliterations, higher-voltage wording, burn/damage
    wording, current, and resistor terms.
- If the selected target is Breadboard but the question clearly mentions LED and
  circuit parts include LED:
  - locally retarget the answer to the LED profile, or
  - produce a safety-focused LED answer while preserving a short reference to
    the selected Breadboard connection.
- For LED voltage/current questions, deterministic answer should say:
  - LED is current-sensitive, not a load that should be served arbitrary higher
    voltage directly.
  - Use a current-limiting resistor.
  - Arduino 5V/3.3V GPIO should not drive high-voltage loads directly.
  - For higher voltage, use an appropriate driver/transistor/MOSFET and shared
    ground, outside the current demo scope.
- Keep copy concise and Korean-locale friendly.

Planned server fallback changes:

- Update `buildLocalTutorResponse(...)` or its helper copy functions in
  `server/agent/circuitTutor.ts` to use the same intent helper.
- If target is Breadboard but question clearly mentions LED voltage/safety, the
  server fallback message must also answer LED/current-limiting safety instead
  of repeating Breadboard explanation.
- Keep `grounding` conservative:
  - include original selected target ids.
  - include retargeted part id only when it can be identified from artifacts or
    selected target context without invention.
- Keep `servingStatus` unchanged:
  - explicit local server mode remains `local_tutor_answer`.
  - live failure remains `live_tutor_fallback` after `withTutorRuntime(...)`.

Regression tests:

- `tests/unit/circuitInspector.test.js`
  - Breadboard target + LED voltage question returns LED/safety content.
  - Breadboard target + generic "how does this work" still returns Breadboard
    content.
  - OLED/Arduino/resistor mentions can retarget only when confidence is clear.
- `tests/unit/circuitTutor.test.ts`
  - server local response for Breadboard target + LED voltage question returns
    LED/current-limiting guidance.
  - server live fallback response for the same question keeps
    `servingStatus: "live_tutor_fallback"` and still returns LED/current-limiting
    guidance.
  - server generic Breadboard question remains Breadboard-focused.

### Phase 4: Railway-Like E2E Coverage

Goal: prevent recurrence where simulation works but tutor silently uses a
different endpoint.

Add Playwright coverage in `tests/e2e/features.spec.js`:

- Scenario A: configured fake Railway base powers both simulation and tutor.
  - Set `localStorage.hEduwareAgentApiBase = "http://127.0.0.1:8798"`.
  - Route/mock `/api/agent/health`, `/api/agent/message`,
    `/api/agent/explain-target` only on `8798`.
  - Explicitly fail or record any tutor request to the old default
    `http://127.0.0.1:8787/api/agent/explain-target`.
  - Assert the captured tutor request URL starts with
    `http://127.0.0.1:8798`.
  - Confirm simulation path builds the circuit.
  - Confirm PCB canvas is nonblank.
  - Ask tutor question.
  - Assert latest tutor status has `data-status="live_tutor_answer"`.
- Scenario B: configured fake Railway base has working simulation but failing
  tutor.
  - Mock message success.
  - Mock explain-target failure.
  - Confirm simulation still succeeds.
  - Confirm tutor shows `live_tutor_fallback`.
  - Confirm fallback category is visible and redacted.

Do not use live OpenAI calls.

### Phase 5: Optional Framework-Native Structured-Output Hardening

Only do this if Phase 0 evidence shows `fallbackCategory:
"structured-output"` or missing `structuredResponse` from Deep Agents.

Planned options:

- Prefer LangChain's documented structured output behavior:
  - check whether `toolStrategy(LiveTutorDraftSchema, { handleError: ... })`
    should add a clearer retry prompt.
  - if the deployed model supports native structured output reliably, consider
    `providerStrategy(LiveTutorDraftSchema)` or direct schema response format,
    following LangChain JS docs.
- Keep `LiveTutorDraftSchema` validation as the final boundary.
- Keep redacted fallback behavior when validation still fails.
- Add fixture-based tests that simulate:
  - `structuredResponse` present and valid.
  - `structured_response` present and valid.
  - no structured response.
  - Zod validation failure.

Do not implement ad-hoc JSON scraping of arbitrary assistant text as the primary
runtime path. That would weaken the framework-native structured-output contract.

### Phase 6: Verification And Deployment Checklist

Focused checks:

```powershell
npm run test:unit -- tests/unit/circuitTutorClient.test.js tests/unit/circuitTutor.test.ts tests/unit/agentLogger.test.ts tests/unit/circuitInspector.test.js
npx playwright test tests/e2e/features.spec.js -g "configured Railway agent base|wrong tutor endpoint|tutor"
```

Default acceptance gate:

```powershell
npm test
npm run build
npm run test:e2e
npm run check
```

Railway smoke checks after deployment:

- `/api/agent/health` returns tutor runtime metadata.
- Main simulation request returns success.
- Tutor request to `/api/agent/explain-target` returns either:
  - `live_tutor_answer`, expected; or
  - `live_tutor_fallback` with clear `fallbackCategory`, not silent ambiguity.
- Browser Network tab shows tutor and simulation use the same configured agent
  base.
- Logs have no API keys, raw prompts with secrets, or full exception stacks in
  user-visible responses.

## File-Level Work Plan

Likely files to edit:

- `src/agentApiBase.js`
  - New shared API-base helper.
- `src/aiClient.js`
  - Use shared helper; behavior should remain unchanged.
- `src/shareClient.js`
  - Use shared helper; behavior should remain unchanged.
- `src/circuitTutorClient.js`
  - Use shared helper for `/api/agent/explain-target`.
  - Include resolved endpoint in reachability cache key.
  - Add fallback category metadata for client-side fallback paths.
- `src/tutorQuestionIntent.js`
  - New shared pure intent/retarget classifier for deterministic fallback
    answer paths.
- `src/circuitInspector.js`
  - Use shared intent helper for browser fallback retarget/safety handling.
- `src/main.js`
  - Add `data-fallback-category` or equivalent status metadata rendering if
    needed.
- `src/locales/ko.js`, `src/locales/en.js`
  - Add optional short fallback diagnostic copy if UI tooltip/title is used.
- `server/agent/circuitTutor.ts`
  - Use shared intent helper for server fallback retarget/safety handling.
  - Tighten fallback metadata only if tests show missing fields.
- `server/agent/agentLogger.ts`
  - Add fallback category tests/summary fields if missing.
- `tests/unit/circuitTutorClient.test.js`
- `tests/unit/circuitInspector.test.js`
- `tests/unit/circuitTutor.test.ts`
- `tests/unit/agentLogger.test.ts`
- `tests/e2e/features.spec.js`

## Available Agent Types And Staffing Guidance

Recommended subagent staffing if this plan becomes implementation work:

- `executor`: client API-base parity patch and unit tests.
- `executor`: deterministic fallback retargeting and inspector tests.
- `test-engineer`: Railway-like e2e scenarios and full gate triage.
- `code-reviewer`: final review for accidental behavior drift in main
  simulation path.
- `dependency-expert`: only if Phase 5 structured-output hardening is needed.

Do not parallelize edits to `src/circuitTutorClient.js` and its tests across
multiple workers; that is a shared write surface.

## Risks And Mitigations

- Risk: changing shared API-base helper breaks simulation.
  - Mitigation: preserve existing `aiClient.js` tests and add helper tests before
    routing tutor through it.
- Risk: fallback category leaks raw errors.
  - Mitigation: only expose stable enum plus redacted preview; extend logger
    redaction tests.
- Risk: retargeting answers the wrong component.
  - Mitigation: only retarget on high-confidence part mentions; otherwise keep
    selected inspector target behavior.
- Risk: treating structured-output failure as transport failure hides server
  issues.
  - Mitigation: separate `schema`, `structured-output`, `transport`, and `http`
    categories.
- Risk: adding tutor memory to solve topic shifts increases complexity.
  - Mitigation: do not add memory in this slice; solve obvious part mentions
    deterministically, keep live tutor stateless.

## Acceptance Criteria

- With `hEduwareAgentApiBase` configured, tutor chat posts to the same configured
  base as simulation.
- Simulation can succeed and tutor can return `live_tutor_answer` in a mocked
  Railway-like e2e path.
- If tutor endpoint fails while simulation succeeds, UI shows
  `live_tutor_fallback` with a stable fallback category.
- Breadboard-selected local fallback answers an LED voltage/safety follow-up with
  LED/current-limiting guidance, not another generic Breadboard explanation.
- No default test depends on live OpenAI or secrets.
- `npm run check` passes.
