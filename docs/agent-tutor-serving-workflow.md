# Agent Tutor Serving Workflow

Last checked: 2026-06-04

The right-side tutor chat is a selected-target QA surface, not the main
requirement-to-simulation synthesis workflow. Keep it deterministic-first unless
measured product evidence shows multi-turn tutor memory materially improves
learning outcomes.

## Ordered Runtime Flow

1. `renderCircuitChatDrawer()` renders the currently selected part, connection,
   or circuit target.
2. The drawer uses dynamic `state.inspector.suggestedQuestions` when a tutor
   response provides them. It falls back to the selected target's built-in
   `questions`.
3. `submitTutorQuestion()` appends the student question and calls
   `askCircuitTutor()` with the selected target, active circuit artifacts,
   locale, and run state.
4. `askCircuitTutor()` uses local deterministic circuit evidence by default.
5. Server mode is opt-in through `localStorage.hEduwareAgentServer === "enabled"`.
   In server mode the client posts to `POST /api/agent/explain-target`.
6. The tutor request includes `circuitSpec`, `validationReport`,
   `simulationPlan`, `contextCoverage`, `buildRunnableReport`,
   `solverGateResult`, and `contextTrace`.
7. `runTutorAgent()` returns `local_tutor_answer` unless
   `H_EDUWARE_TUTOR_MODE=live` is configured.
8. Live tutor mode uses a stateless typed DeepAgent QA run with
   `toolStrategy(LiveTutorDraftSchema)`. It is not a checkpointer-backed
   LangGraph conversation today.
9. The client validates live server responses before rendering. Malformed
   responses or transport failures return a local answer with
   `servingStatus: "live_tutor_fallback"` and a redacted `fallbackReason`.
10. The UI renders tutor `message`, subtle tutor status, and refreshed
    `suggestedQuestions`.

## Serving Contract

- Tutor answers must stay grounded to the selected target id/type/signal and the
  current circuit artifacts.
- The tutor must not describe current flow unless validation and simulation are
  valid and the runnable/solver gates allow the claim.
- Live tutor failure is observable; it must not silently look like a successful
  live answer.
- `response.suggestedQuestions` replaces the chips only for the current target.
  Target changes, locale changes, or inspector reset clear dynamic suggestions.
- Do not add LangGraph checkpointer memory to tutor mode until tutor-specific
  evals show that stateful multi-turn tutoring improves answers enough to justify
  latency, persistence, privacy, and evaluation cost.

## Observability

`/api/agent/explain-target` creates a `tutor-*` trace id and logs:

- `tutor.request.received`
- `tutor.response.sent`
- `tutor.request.failed`

Tutor logs store target metadata, artifact gate status, solver gate
mode/build-readiness, context source ids/types, mode/status, fallback category,
grounding counts, suggested-question counts, and answer hash/length. They do not
store full tutor answers, raw prompts, API keys, or full artifact payloads.

## Verification

```powershell
node --test tests/unit/circuitTutorClient.test.js
npm exec tsx -- --test tests/unit/circuitTutor.test.ts
npm exec tsx -- --test tests/unit/agentLogger.test.ts
npm run test:e2e -- tests/e2e/features.spec.js --grep "live tutor suggested"
```
