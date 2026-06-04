# PLAN: Tutor Always-Live Serving

Last updated: 2026-06-04

## Goal

Refactor the right-side Circuit Tutor Chat so it uses the live server-backed
LangChain/DeepAgents path by default whenever the server is configured for live
LLM calls. Remove the hidden browser-only `localStorage.hEduwareAgentServer`
opt-in as the normal serving gate. Keep deterministic local tutor answers only
as an explicit safety fallback for missing live configuration, transport
failure, malformed structured output, or model failure.

Implementation started under `$ralph` on 2026-06-04 after ralplan consensus
approval.

## Original Evidence Before Refactor

- `src/main.js:1115` renders the right-side Tutor Chat drawer.
- `src/main.js:2254` submits Tutor Chat questions through `askCircuitTutor()`.
- `src/circuitTutorClient.js:11` only calls `/api/agent/explain-target` when
  `localStorage.hEduwareAgentServer === "enabled"`.
- `src/circuitTutorClient.js:52` otherwise calls local
  `answerTutorQuestion()`.
- `src/circuitInspector.js:65` is deterministic/rule-based tutor logic.
- `server/index.ts:73` exposes `POST /api/agent/explain-target`.
- `server/agent/circuitTutor.ts:28` builds local response first and tries live
  only when `H_EDUWARE_TUTOR_MODE === "live"`.
- `server/agent/circuitTutor.ts:114` uses `createDeepAgent()` with
  `toolStrategy(LiveTutorDraftSchema)`, no tools, and no checkpointer.
- `docs/agent-tutor-serving-workflow.md` originally recorded a
  deterministic-first ADR, so this change intentionally revises that serving
  policy.

## Official Docs Checked

- Deep Agents customization:
  https://docs.langchain.com/oss/javascript/deepagents/customization
- LangGraph memory/checkpointer/thread_id:
  https://docs.langchain.com/oss/javascript/langgraph/add-memory
- LangGraph interrupts/Command resume:
  https://docs.langchain.com/oss/javascript/langgraph/interrupts
- LangChain structured output/toolStrategy:
  https://docs.langchain.com/oss/javascript/langchain/structured-output
- LangSmith observability:
  https://docs.langchain.com/oss/javascript/langchain/observability

## RALPLAN-DR Summary

### Principles

1. Live-first does not mean unsafe: live failures must be explicit and
   observable, not silently rendered as successful live answers.
2. Default tests must remain deterministic and secret-free.
3. Tutor answers remain selected-target explanations, not synthesis or circuit
   mutation.
4. Use LangChain ecosystem-native mechanisms for live model output and tracing;
   avoid bespoke memory or prompt logging.
5. Preserve demo reliability: local deterministic fallback is still allowed as
   a safety net, but not as the default happy path when live is configured.

### Decision Drivers

1. Remove the hidden browser opt-in that prevents live tutor calls even when the
   server has credentials.
2. Make production behavior predictable from server configuration rather than
   per-browser localStorage state.
3. Keep latency, cost, privacy, and test stability bounded.

### Viable Options

| Option | Summary | Pros | Cons |
| --- | --- | --- | --- |
| A. Client always POSTs tutor questions to server; server keeps current `H_EDUWARE_TUTOR_MODE=live` gate | Smallest client change | Fast to implement; removes hidden localStorage gate | Still not "always live" unless server env is exactly set; repeated dev failures can be noisy |
| B. Server-controlled live-first auto mode | Client calls server by default; server exposes tutor capability and runs live when credentials/model are available | Best operational fit; one source of truth; explicit fallback; testable | Requires small health/config and test updates |
| C. Promote tutor to stateful LangGraph workflow | Add checkpointer-backed Tutor memory with `thread_id` | Strongest LangGraph-native multi-turn tutor story | Higher latency/cost/privacy/eval scope; no evidence yet that multi-turn memory improves tutor answers |

Chosen option: **B. Server-controlled live-first auto mode**.

Option C is intentionally deferred. The official LangGraph memory docs require a
checkpointer plus `thread_id` for stateful continuity, but the current product
need is to remove an accidental client-side gate and prefer live QA. Stateful
tutor memory should wait for tutor-specific eval evidence.

## Target Serving Policy

### Serving Authority Invariant

The server owns tutor serving authority. There must be exactly one exported
resolver, for example `resolveTutorRuntimeMode(env = process.env)`, that returns
the effective tutor runtime policy and live readiness:

```ts
type TutorRuntimeMode = 'auto' | 'live' | 'local';

type TutorRuntimeResolution = {
  runtimeMode: TutorRuntimeMode;
  liveConfigured: boolean;
  liveDefault: boolean;
  liveRequired: boolean;
  fallbackAllowed: boolean;
};
```

Both `runTutorAgent()` and `/api/agent/health` must consume this same resolver.
No second copy of the mode/env logic is allowed in the browser, health route, or
logger. Unit tests must assert that health metadata and actual serving behavior
agree for `local`, `live`, and `auto`.

### Browser Client

- Remove `localStorage.hEduwareAgentServer === "enabled"` as the normal gate.
- `askCircuitTutor()` should call `/api/agent/explain-target` by default.
- Production uses same-origin `/api/agent/explain-target`.
- Local dev uses `http://127.0.0.1:8787/api/agent/explain-target`, matching the
  current dev endpoint.
- Add a reachability cache so a missing local agent server does not trigger a
  slow/failing request on every tutor question.
  - Cache key: `${DEFAULT_ENDPOINT}|${location.origin}`.
  - Failure TTL: 15 seconds for tutor POST transport failures.
  - Reset behavior: any successful tutor response clears the failure cache; TTL
    expiry retries the server path.
  - Do not add a mandatory preflight health probe unless later evidence shows
    repeated local dev transport failures are slow enough to justify the extra
    network hop. `/api/agent/health.tutor` remains the status/capability
    surface, not a client-side serving authority.
  - Do not apply a short abort timeout to the live tutor POST itself, because a
    valid LLM answer may take longer than a reachability probe.
- Keep an explicit dev override only for debugging:
  - `localStorage.hEduwareTutorServer = "disabled"` forces local fallback.
  - Do not use localStorage to enable the normal live path.
- Validate server responses before rendering, as current code already does.

### Server

- Replace `shouldUseLiveTutor()` with a resolver such as:

```ts
type TutorRuntimeMode = 'auto' | 'live' | 'local';
```

- Proposed semantics:
  - `H_EDUWARE_TUTOR_MODE=local`: never call live, return local answer with
    `servingStatus: "local_tutor_answer"`.
  - `H_EDUWARE_TUTOR_MODE=live`: require live config; if missing, return local
    fallback with `servingStatus: "live_tutor_fallback"` and redacted reason.
  - unset or `auto`: call live when `OPENAI_API_KEY` and
    `H_EDUWARE_AGENT_MODEL` are available; otherwise return local with explicit
    `servingStatus`.
- Keep local deterministic answer as grounding baseline and fallback content.
- Live response stays typed through `toolStrategy(LiveTutorDraftSchema)`.
- Do not add LangGraph checkpointer yet; this remains stateless selected-target
  QA. If future multi-turn tutor memory is needed, add checkpointer and
  `thread_id` according to official LangGraph docs.

### Health / Capability Surface

- Extend existing `/api/agent/health`, which currently merges main agent runtime
  and server process health, with a small tutor capability field derived from
  `resolveTutorRuntimeMode()`:

```json
{
  "tutor": {
    "serverAvailable": true,
    "runtimeMode": "auto",
    "liveConfigured": true,
    "liveDefault": true
  }
}
```

- Do not expose secret values or model keys.
- Client may cache this field for UX/status but should not rely on it as the
  only safety gate; server remains authoritative.
- Add a test that `/api/agent/health.tutor.liveDefault` matches whether
  `runTutorAgent()` attempts live under the same environment.

### UI / UX

- Rename the status badge meaning:
  - `live_tutor_answer`: live tutor
  - `live_tutor_fallback`: live unavailable; local evidence used
  - `local_tutor_answer`: local mode explicitly configured or server absent in
    dev
- Keep fallback badge subtle, but visible enough for debugging and demo trust.
- Do not show raw fallback reasons to students unless copy is sanitized and
  product-friendly.
- Fix mojibake Korean local tutor strings before relying on local fallback UX in
  Korean demos.

## Implementation Plan

### Phase 1: RED Tests For Always-Live Default

Files:

- `tests/unit/circuitTutorClient.test.js`
- `tests/unit/circuitTutor.test.ts`
- `tests/e2e/features.spec.js`

Add failing tests that prove:

1. `askCircuitTutor()` calls `/api/agent/explain-target` by default without
   `localStorage.hEduwareAgentServer`.
2. `localStorage.hEduwareTutorServer="disabled"` forces local fallback.
3. Server `auto` mode calls live when `OPENAI_API_KEY` and
   `H_EDUWARE_AGENT_MODEL` are present.
4. Server `auto` mode does not call live when credentials are absent and still
   returns a safe local response.
5. E2E Tutor Chat receives a mocked live response without setting the old
   localStorage key.

### Phase 2: Client Serving Refactor

Files:

- `src/circuitTutorClient.js`
- `src/main.js`

Tasks:

1. Remove `SERVER_OPT_IN_KEY = "hEduwareAgentServer"` from normal flow.
2. Add `TUTOR_SERVER_DISABLED_KEY = "hEduwareTutorServer"` for explicit dev
   override only.
3. Call server by default; do not apply a short abort timeout to the live tutor
   POST.
4. Add short-lived failure cache to avoid repeated slow fallback when local
   server is absent.
5. Keep response schema validation and redacted fallback reason handling.
6. Ensure current-artifact main chat path also benefits from live tutor default
   because it calls `askCircuitTutor()`.

### Phase 3: Server Live-First Auto Mode

Files:

- `server/agent/circuitTutor.ts`
- `server/agent/schemas.ts`
- `server/index.ts`
- `server/serverHealth.ts` if health fields belong there

Tasks:

1. Implement `resolveTutorRuntimeMode()` with `local | live | auto`.
2. Default unset mode to `auto`.
3. In `auto`, attempt live when `OPENAI_API_KEY` and
   `H_EDUWARE_AGENT_MODEL` are configured.
4. In `live`, treat missing config as a visible `live_tutor_fallback`, not a
   silent local answer.
5. Keep `LiveTutorDraftSchema` and `toolStrategy` as the live structured output
   contract.
6. Add health/capability metadata without secret values.
7. Export the resolver and use it from both `runTutorAgent()` and health
   reporting so there is no serving/health drift.

### Phase 4: Observability And LangSmith Metadata

Files:

- `server/agent/agentLogger.ts`
- `server/agent/circuitTutor.ts`
- `docs/agent-observability-logging.md`

Tasks:

1. Change `runTutorAgent(request, options)` to accept trace metadata:

```ts
type TutorAgentOptions = {
  traceId?: string;
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  liveDraftProvider?: ...;
};
```

2. Require `server/index.ts` to pass its existing `tutor-*` trace id into
   `runTutorAgent(parsed, { traceId, runName: 'h-eduware-circuit-tutor', ... })`.
3. Pass the same sanitized `traceId`, tags, and metadata into the live
   DeepAgent `invoke()` config, mirroring the main synthesis runtime's
   LangSmith metadata approach.
4. Log `tutor.live.attempt` or include live attempt fields in
   `tutor.response.sent`.
5. Include:
   - `runtimeMode`
   - `liveConfigured`
   - `liveAttempted`
   - `structuredOutputStatus`
   - `latencyMs`
   - `fallbackCategory`
   - `target id/type/signal`
6. Keep local logs preview/hash-only.
7. Add LangSmith run metadata/tags for the tutor DeepAgent:
   - `traceId`
   - `workflow: tutor`
   - `targetType`
   - `targetSignal`
   - `servingStatus`
8. Do not log raw tutor prompt JSON, full artifacts, full answers, or secrets.

### Phase 5: Documentation Update

Files:

- `docs/agent-tutor-serving-workflow.md`
- `docs/agent-request-to-simulation-workflow.md`
- `docs/README.md`
- `CLAUDE.md` and `AGENTS.md` only if standing rules need a policy update

Tasks:

1. Replace deterministic-first ADR with live-first-auto ADR.
2. State that local deterministic tutor is fallback or explicit local mode.
3. Document old `hEduwareAgentServer` key as removed/deprecated.
4. Document the new dev disable override, if added.
5. Mention official docs consulted for DeepAgents structured output and
   LangGraph memory deferral.

### Phase 6: Verification

Default harness, no live secrets required:

```powershell
node --test tests/unit/circuitTutorClient.test.js
npm exec tsx -- --test tests/unit/circuitTutor.test.ts tests/unit/agentLogger.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/features.spec.js --grep "tutor"
npm run check
```

Opt-in live harness:

```powershell
npm run check:live
```

Expected:

- Default tests mock live responses and never require `OPENAI_API_KEY`.
- Live smoke uses configured credentials and confirms Tutor QA can return
  `live_tutor_answer`.
- Logs and e2e pages do not expose `OPENAI_API_KEY`, `H_EDUWARE_AGENT_MODEL`, or
  `sk-` shaped values.

## Acceptance Criteria

1. Right-side Tutor Chat live mocked e2e passes without setting
   `localStorage.hEduwareAgentServer`.
2. With live env configured, server returns `servingStatus:
   "live_tutor_answer"` for a valid selected target and valid structured output.
3. With live env missing or model failure, UI renders a local evidence answer
   with `servingStatus: "live_tutor_fallback"` or explicit local mode, not a
   silent live success.
4. Client response validation still blocks malformed live responses from being
   rendered directly.
5. Main current-artifact question path uses the same live-first tutor client.
6. A mocked live-first test covers the main current-artifact question path at
   `answerCurrentArtifactQuestion()`, not only the right drawer.
7. `/api/agent/health.tutor` and `runTutorAgent()` derive their behavior from
   the same runtime resolver.
8. Tutor LangSmith metadata receives the route `traceId` when live is attempted.
9. `npm run check` passes without live credentials.
10. `npm run check:live` passes when credentials are available.
11. Documentation no longer says browser localStorage is required to enable
   server tutor mode.

## Pre-Mortem

1. **Cost/latency spike**: every right-side question now calls OpenAI by default.
   Mitigation: server auto/local modes, short health-probe timeout,
   retry/failure cache, log latency, and optional local override for dev. Do not
   short-abort a valid live tutor POST solely because the model is still
   answering.
2. **Demo fallback confusion**: live fails but student sees an answer and assumes
   it was live. Mitigation: visible `live_tutor_fallback` badge and logs.
3. **Privacy leak through traces**: tutor prompt JSON includes artifacts and
   question text. Mitigation: local logs use hashes/previews; LangSmith is
   opt-in; no secrets or raw full artifacts in custom logs.

## ADR

### Decision

Adopt **server-controlled live-first auto mode** for the right-side Tutor Chat.
The browser calls the tutor server by default; the server attempts live DeepAgent
QA when live configuration is available, and falls back explicitly to local
deterministic evidence when live is unavailable or fails.

### Drivers

- Hidden browser localStorage gate makes live readiness unpredictable.
- User expectation is that configured live infrastructure should be used.
- Default test and demo reliability still require deterministic fallback.

### Alternatives Considered

- Keep deterministic-first with manual localStorage opt-in: rejected because it
  directly contradicts the desired always-live behavior.
- Client always POSTs but server keeps `H_EDUWARE_TUTOR_MODE=live` as the only
  gate: acceptable as a minimal slice, but weaker than server auto mode.
- Stateful LangGraph tutor memory: deferred until evals prove multi-turn memory
  improves tutor learning outcomes enough to justify persistence/cost.

### Consequences

- More live calls in production when students use the Tutor Chat.
- Fallback must be product-visible and observable.
- Tutor remains stateless; no LangGraph memory changes are needed in this
  iteration.
- Documentation and tests must be updated because the prior ADR changes.

### Follow-Ups

- Add tutor-specific live eval cases for common Korean and English questions.
- Decide whether local fallback Korean copy should be replaced or fully repaired.
- Revisit checkpointer-backed tutor memory only after tutor eval data supports
  it.

## Available Agent Types Roster

- `architect` (gpt-5.5 high): validate boundaries, framework-native design, and
  long-term serving tradeoffs.
- `critic` (gpt-5.5 high): challenge risks, acceptance criteria, and testability.
- `test-engineer` (gpt-5.5 medium): design default/live test matrix.
- `executor` (gpt-5.5 medium): implement client/server slices after approval.
- `verifier` (gpt-5.5 high): validate final behavior and log privacy.
- `writer` (gpt-5.5 high): update docs and migration notes.

## Suggested Execution Staffing

- `$ultragoal` default: use for durable sequential implementation with this plan
  as the goal ledger.
- `$team`: recommended if parallel implementation is desired:
  - Lane 1 client serving contract and e2e tests.
  - Lane 2 server live-first auto mode and health metadata.
  - Lane 3 observability/docs/test matrix.
- `$ralph` fallback: use only if a single-owner persistent loop is preferred
  over the default Ultragoal ledger.

## Team Verification Path

1. Each lane reports changed files and focused tests.
2. Integrator runs `npm run check`.
3. Live verifier runs `npm run check:live` only when credentials are available.
4. Privacy verifier scans logs/e2e pages for secret-shaped leakage.
5. Final reviewer confirms docs no longer describe old localStorage enablement
   as the normal path.

## Goal-Mode Follow-Up Suggestions

- Recommended: `$ultragoal` with this plan for durable implementation tracking.
- Parallel option: `$team` with the three lanes above.
- Fallback: `$ralph` only if explicitly choosing a single-owner completion loop.

## RALPLAN Review Log

### Architect Review 1

Verdict: `ITERATE`.

Actioned revisions:

- Added the Serving Authority Invariant requiring one shared
  `resolveTutorRuntimeMode()` for both health and serving behavior.
- Pinned `/api/agent/health.tutor` to the same resolver to avoid drift.
- Specified `runTutorAgent()` trace metadata options and required
  `server/index.ts` to pass the existing `tutor-*` trace id into live DeepAgent
  invocation.
- Replaced vague client timeout wording with a concrete health-probe/failure
  cache policy and avoided short-aborting long live tutor POSTs.
- Added acceptance criteria for the main current-artifact question path.

### Architect Review 2

Verdict: `APPROVE`.

Architect confirmation:

- The revised plan closes the previous architectural blockers.
- Server-owned `auto | live | local` mode resolution is the correct serving
  authority boundary.
- Health metadata, trace propagation, client reachability caching, and main
  current-artifact coverage are now concrete enough for implementation.
- Remaining tradeoff is accepted: live-first improves configured product
  behavior but increases cost/latency exposure, so fallback observability and
  retry discipline are mandatory.

### Critic Review 1

Verdict: `APPROVE`.

Critic confirmation:

- Principle/option consistency passes.
- ADR alternatives and deferral of stateful LangGraph tutor memory are
  defensible.
- Risk mitigation covers cost, latency, privacy, malformed output, transport
  failure, fallback confusion, and live-test opt-in boundaries.
- Acceptance criteria and verification commands are testable.
- Framework-native use is appropriate: DeepAgents structured output through
  `toolStrategy`, LangGraph memory explicitly deferred rather than hand-rolled,
  and LangSmith metadata/tracing included for live tutor attempts.

### Consensus Gate

Complete: `true`.

Planning artifacts:

- Context snapshot:
  `.omx/context/tutor-always-live-serving-20260604T080654Z.md`
- Plan:
  `docs/plans/PLAN_tutor_always_live_serving.md`

The approved implementation handoff is Option B: server-controlled live-first
auto mode with explicit local fallback.

## Ralph Implementation Log

### Iteration 1

- [x] Added RED tests for client default server use without
  `hEduwareAgentServer`.
- [x] Added explicit `hEduwareTutorServer="disabled"` local override test.
- [x] Added server `resolveTutorRuntimeMode()` auto-mode tests.
- [x] Added health metadata drift test through `tutorRuntimeHealth()`.
- [x] Added main current-artifact and right-drawer e2e coverage by removing the
  old localStorage enable step from mocked live tutor paths.
- [x] Implemented live-first client serving with explicit local disable override
  and transport-failure cache.
- [x] Implemented shared server tutor runtime resolver and health metadata.
- [x] Passed route `traceId`, tags, run name, and sanitized metadata into live
  tutor DeepAgent invocation.
- [x] Added tutor runtime/live/fallback metadata to response schema and logs.
- [x] Updated tutor serving and observability docs.
- [x] Run focused e2e verification.
- [x] Run full `npm run check`.
- [x] Run opt-in `npm run check:live`.
- [x] Architect verification.
- [x] Deslop pass and post-deslop regression.

Focused e2e verification:

```powershell
npm run test:e2e -- tests/e2e/features.spec.js --grep "LED draft follow-up|live tutor suggested"
```

Result: PASS, 4/4 across desktop and mobile.

Focused regression verification after e2e stabilization:

```powershell
npm run test:e2e -- tests/e2e/features.spec.js --grep "browser verification protocol|selected simulated connection|hardware move resolves"
```

Result: PASS, 6/6 across desktop and mobile.

Default acceptance verification:

```powershell
npm run check
```

Result: PASS. Unit tests, context acceptance, typecheck, production build, and
Playwright e2e all completed. E2E summary: 116 passed, 30 skipped.

Opt-in live verification:

```powershell
npm run check:live
```

Result: PASS. Live category matrix completed 5/5 supported circuit cases, and
live smoke completed 2/2 tests with no 502s.

Ralph Architect verification:

Verdict: `APPROVE`.

Summary:

- Client no longer requires `localStorage.hEduwareAgentServer` and only keeps
  `localStorage.hEduwareTutorServer="disabled"` as an explicit local override.
- Server `resolveTutorRuntimeMode()` is the single authority for
  `auto | live | local`, and health/runtime behavior uses the same resolver.
- Live tutor remains framework-native through DeepAgents `createDeepAgent()` and
  LangChain `toolStrategy(LiveTutorDraftSchema)` without adding bespoke memory.
- Trace id, run name, tags, sanitized metadata, runtime mode, live attempt
  state, fallback category, redacted reason preview, and latency are observable.
- Default tests stay secret-free; `npm run check:live` remains opt-in.

Non-blocking follow-ups resolved in this implementation log:

- The client reachability policy is documented as POST-transport-failure cache
  only, not a mandatory preflight health probe.
- The older chat UI/context refactor plan now points readers to this plan for
  the current tutor serving contract.

AI slop cleanup report:

- Scope: Ralph-owned tutor serving files plus the two affected plan docs.
- Behavior lock: targeted tutor client/server/log unit tests and full
  `npm run check`.
- Fallback findings: transport-failure cache, live configuration fallback,
  structured-output fallback, and explicit local override are classified as
  grounded compatibility/fail-safe fallbacks because they preserve visible
  `servingStatus`, redacted reasons, tests, and logs.
- Cleanup performed: renamed stale client helper wording from agent-server
  opt-in semantics to tutor-server semantics and removed an unnecessary block
  around the tutor POST try/catch.
- Post-deslop targeted tests:
  - `node --test tests/unit/circuitTutorClient.test.js` PASS, 6/6.
  - `npm exec tsx -- --test tests/unit/circuitTutor.test.ts tests/unit/agentLogger.test.ts`
    PASS, 20/20.
- Post-deslop acceptance:
  - `npm run check` PASS. E2E summary: 116 passed, 30 skipped.
