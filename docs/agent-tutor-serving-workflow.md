# Agent Tutor Serving Workflow

Last checked: 2026-06-04

The right-side tutor chat is a selected-target QA surface, not the main
requirement-to-simulation synthesis workflow. It is live-first when the server
is configured for live LLM calls, with deterministic local evidence retained as
an explicit fallback or local-only mode.

Visualization:

- [`chat-ui-surfaces-flow.svg`](chat-ui-surfaces-flow.svg): main chat UI and tutor chat UI compared
- [`tutor-chat-serving-flow.svg`](tutor-chat-serving-flow.svg): selected-target tutor request flow

## Ordered Runtime Flow

1. `renderCircuitChatDrawer()` renders the currently selected part, connection,
   or circuit target.
2. The drawer uses dynamic `state.inspector.suggestedQuestions` when a tutor
   response provides them. It falls back to the selected target's built-in
   `questions`.
3. `submitTutorQuestion()` appends the student question and calls
   `askCircuitTutor()` with the selected target, active circuit artifacts,
   locale, and run state.
4. If the drawer text is a circuit modification request (for example add,
   change, replace, or revise), the client closes the tutor drawer and routes the
   text through the main chat synthesis path instead of asking the tutor to
   mutate artifacts.
5. Before posting, the client creates a freshness key from selected target,
   artifact version, locale, and request sequence. Only the response for the
   current key may append tutor text or clear the current thinking state.
6. `askCircuitTutor()` posts to `POST /api/agent/explain-target` by default.
   The old `localStorage.hEduwareAgentServer === "enabled"` opt-in is removed
   from the normal path. For local debugging only,
   `localStorage.hEduwareTutorServer = "disabled"` forces local evidence.
7. The client validates server responses before rendering. Transport failures
   and malformed responses return a local answer with explicit fallback status.
8. The tutor request includes `circuitSpec`, `validationReport`,
   `simulationPlan`, `contextCoverage`, `buildRunnableReport`,
   `solverGateResult`, and `contextTrace`.
9. `runTutorAgent()` uses the shared `resolveTutorRuntimeMode()` resolver:
   `local` never calls live, `live` requires live configuration, and `auto`
   calls live when `OPENAI_API_KEY` and `H_EDUWARE_AGENT_MODEL` are available.
10. Live tutor mode uses a stateless typed DeepAgent QA run with
   `toolStrategy(LiveTutorDraftSchema)`. It receives the route `tutor-*`
   trace id as LangSmith metadata. It is not a checkpointer-backed LangGraph
   conversation today.
11. Missing live configuration, malformed structured output, model failure, or
   transport failure returns a local answer with `servingStatus:
   "live_tutor_fallback"` and a redacted `fallbackReason`.
12. The UI renders tutor `message`, subtle tutor status, and refreshed
    `suggestedQuestions`.

## Serving Contract

- Tutor answers must stay grounded to the selected target id/type/signal and the
  current circuit artifacts.
- The tutor must not describe current flow unless validation and simulation are
  valid and the runnable/solver gates allow the claim.
- Live tutor failure is observable; it must not silently look like a successful
  live answer.
- Health and serving behavior must agree because `/api/agent/health.tutor` and
  `runTutorAgent()` use the same runtime resolver.
- `response.suggestedQuestions` replaces the chips only for the current target.
  Target changes, locale changes, or inspector reset clear dynamic suggestions.
- Stale tutor responses are discarded when the selected target, artifact
  version, locale, or request sequence has changed since the request was sent.
- Tutor mode never owns artifact mutation. Modification text is promoted to the
  main chat path so task/thread identity, context packet routing, validation,
  and stale-response guards remain centralized.
- Do not add LangGraph checkpointer memory to tutor mode until tutor-specific
  evals show that stateful multi-turn tutoring improves answers enough to justify
  latency, persistence, privacy, and evaluation cost.

## Observability

`/api/agent/explain-target` creates a `tutor-*` trace id and logs:

- `tutor.request.received`
- `tutor.response.sent`
- `tutor.request.failed`

Tutor logs store target metadata, artifact gate status, solver gate
mode/build-readiness, context source ids/types, runtime mode, live configured
state, live attempt state, mode/status, fallback category, latency, grounding
counts, suggested-question counts, and answer hash/length. They do not store
full tutor answers, raw prompts, API keys, or full artifact payloads.

## Verification

```powershell
node --test tests/unit/circuitTutorClient.test.js
node --test tests/unit/tutorRequestFreshness.test.js
npm exec tsx -- --test tests/unit/circuitTutor.test.ts
npm exec tsx -- --test tests/unit/agentLogger.test.ts
npm run test:e2e -- tests/e2e/features.spec.js --grep "live tutor suggested"
```
