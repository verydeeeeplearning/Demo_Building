# Agent Request-To-Simulation Workflow

Last checked: 2026-06-04

H-eduware's agent engine is built on the LangChain ecosystem: LangChain,
LangGraph, Deep Agents, and LangSmith. Agent changes must consult the official
JS/TS documentation before changing runtime behavior.

Visualization:

- [`user-query-to-simulation-swimlane.svg`](user-query-to-simulation-swimlane.svg): main Chat UI request-to-simulation flow
- [`chat-ui-surfaces-flow.svg`](chat-ui-surfaces-flow.svg): main Chat UI and tutor Chat UI compared

Official docs checked for this workflow:

- Deep Agents `createDeepAgent`: https://docs.langchain.com/oss/javascript/deepagents/customization
- LangChain structured output / `toolStrategy`: https://docs.langchain.com/oss/javascript/langchain/structured-output
- LangGraph memory / `thread_id`: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- LangGraph interrupts / `Command({ resume })`: https://docs.langchain.com/oss/javascript/langgraph/interrupts
- LangChain middleware / `wrapToolCall`: https://docs.langchain.com/oss/javascript/langchain/middleware/custom
- LangSmith tracing tags and metadata: https://docs.langchain.com/langsmith/trace-with-langchain

## Ordered Runtime Flow

1. `server/index.ts` accepts `POST /api/agent/message`, parses
   `AgentMessageRequestSchema`, creates a trace id, logs `agent.request.received`,
   and calls `runAgent(parsed, { traceId })`.
2. `runAgent()` delegates to `runLiveAgent()` in `server/agent/deepAgentRuntime.ts`.
   The runtime resolves `sessionId`, pipeline mode, model port, Deep Agent factory,
   and LangSmith metadata.
3. `runLiveAgent()` normalizes the client turn envelope (`taskId`, `turnId`,
   client request-kind hint) into an effective server request kind, encoded
   `thread_id = session.<session>.task.<task>`, and a per-thread mutation lock
   before invoking any framework/model work.
4. `buildContextPacket()` in `server/context/contextPacket.ts` routes the student
   message through the context layer. On clarification resume, `forceCapabilityId`
   re-grounds the packet to the selected capability.
5. The context layer loads capability matches, v2 routes, v2 bundles, source-backed
   support bundles, candidate parts, render footprints, simulation primitives, and
   validation coverage. It returns structured `ContextPacket` data plus the
   model-facing `promptBlock`.
6. `runLiveAgent()` turns the packet into scoped `toolOptions`: context coverage,
   candidate parts, allowed context source ids, support bundle evidence, request
   scope, and locale.
7. Requirement routing is either a legacy requirement-analysis Deep Agent run or
   deterministic derivation in `shadow|next`. The route is logged as
   `requirement.analysis.completed`.
8. The synthesis prompt is assembled from compact operating memory, context index,
   candidate registry summary, and `contextPacket.promptBlock`. Prompt budget is
   enforced before invocation.
9. The synthesis Deep Agent is created with `createDeepAgent`, scoped H-eduware
   tools, `toolStrategy(LiveAgentDraftSchema)`, LangGraph checkpointer, and
   the encoded session/task `thread_id`.
10. If the student is resuming a LangGraph interrupt, the runtime validates and
    consumes the one-time `resumeInteractionId`, then invokes with
    `new Command({ resume })`; otherwise it invokes with the user prompt message.
11. During the Deep Agent run, tools can read only route-selected context docs,
    search only candidate parts, load only in-packet support bundles, and call
    deterministic validation/render/simulation tools.
12. The runtime parses `structuredResponse`/`structured_response` into
    `LiveAgentDraft`. Plain-message recovery remains a fallback for model behavior
    that does not populate structured output.
13. Chat drafts return inert chat results. `interrupt()` payloads return
    `awaiting_input`. Circuit drafts enter deterministic finalization.
14. `finalizeAgentResult()` validates the model `CircuitSpec`, applies candidate
    part, intent fulfillment, and context coverage gates, then builds netlist,
    current paths, render plan, simulation plan, runnable report, solver gate
    result, and requirement markdown.
15. `AgentRunResultSchema` crosses the HTTP boundary with `contextTrace`,
    `contextCoverage`, `requirementMarkdown`, `circuitSpec`, `validationReport`,
    `renderPlan`, `simulationPlan`, `buildRunnableReport`, and optional
    `solverGateResult`, plus echoed `taskId`, `turnId`, and
    `effectiveRequestKind` when available.
16. The frontend ignores stale responses whose echoed ids do not match the latest
    pending turn, preserves the last visible artifact while non-renderable chat or
    clarification turns complete, and renders parts from `renderPlan`.
17. The frontend shows run output/current-flow
    evidence from `simulationPlan`.

## Context Layer Role

- Route selection: maps student intent to a v2 route and bundle set.
- Candidate authority: determines which parts the agent may use.
- Prompt grounding: supplies the compact `promptBlock` and registry summary.
- Tool boundary: constrains context reads, part search, support evidence, and
  validation tools to the selected packet.
- Synthesis eligibility: blocks build-ready output when route coverage, support
  bundle evidence, explicit part coverage, or safety is insufficient.
- Final guardrail: finalization re-applies context coverage and candidate-part
  gates even if the model emitted a plausible-looking circuit.

### Context Eligibility Invariants

- Unknown explicit hardware names near hardware nouns are clarification or
  support-gap signals.
- `supported-hardware-general` does not authorize build-ready synthesis without
  complete bundle evidence or a valid topology composition proof.
- LangGraph checkpointer + `thread_id` owns conversation continuity.
  `conversationContext` is bounded artifact and UI grounding only.
- Tutor memory follows the same framework ownership rule: LangGraph
  checkpointer plus scoped `thread_id`. Tutor scope additionally includes
  artifact fingerprint and selected target id so answers from one visual
  artifact or target cannot bleed into another.
- Client `recentTurns` and client-supplied running summaries are never folded
  into synthesis prompts. They are not a source of parts, pins, protocols, or
  request routing authority.
- Structured `conversationContext.currentArtifact`, `lastSupportedGoal`, and
  `pendingSupportedAlternative` are used only for revision or clarification
  resume turns. New independent tasks route from the current message and context
  packet, not old visible chat text.
- Clarification resumes require a random one-time `interactionId` generated by
  the server and echoed by the client as `resumeInteractionId`.
- Live tools are scoped by the current `ContextPacket`; missing candidate parts,
  allowed source ids, or support bundle scope blocks tool access.
- Tutor context reads are projection-scoped. Item-level context trace ids return
  only the selected item projection, not the aggregate registry or primitive
  document.
- An empty scoped candidate-part set blocks validation, netlist, fault,
  rendering, and simulation artifact tools.
- UI serving state must distinguish buildable originals, clarification,
  unsupported/review-only diagnostics, safe equivalents, and tutor answers.

## Observability Coverage

Local JSONL logs now cover the major request-to-simulation handoffs without
recording raw prompts, full transcripts, or secrets:

- `agent.request.received`
- `context.packet.built`
- `context.compose.shadow`
- `context.compose.shadow.failed`
- `prompt.budget.exceeded`
- `requirement.analysis.completed`
- `requirement.analysis.recovered`
- `requirement.doc.authored`
- `requirement.doc.authoring.failed`
- `agent.llm.handoff`
- `agent.llm.completed`
- `agent.structured_output.parsed`
- `agent.synthesis.attempt`
- `agent.synthesis.structured_output_missing`
- `agent.tool.call`
- `agent.simulation.compiled`
- `agent.validation.completed`
- `agent.response.sent`
- `agent.request.failed`

`agent.llm.handoff` records stage, agent name, LangGraph `thread_id`, prompt
lengths, prompt hashes, route, candidate part ids, tool names, and subagent names.
`agent.llm.completed` records structured-output presence, message count, tool
call names, assistant text hash, and assistant text length. `agent.tool.call`
records tool name, status, duration, input hash/size, and output hash/size.
`agent.simulation.compiled` records final validation, netlist, render,
simulation, runnable, and solver-gate summary.

LangSmith remains the official detailed framework trace path when enabled. Local
logs intentionally stay privacy-preserving and diagnostic.

## Live Category Evaluation

The opt-in live matrix lives in `tests/unit/agentCategorySimulation.live.test.ts`.
It is skipped unless `OPENAI_API_KEY` and `H_EDUWARE_AGENT_MODEL` are configured
directly or through `.local/agent.env`.

Run:

```powershell
npm run check:live
```

Useful controls:

```powershell
$env:H_EDUWARE_LIVE_CATEGORY_LIMIT='10'
$env:H_EDUWARE_LIVE_SAMPLE='4'
$env:H_EDUWARE_AGENT_LOG_LEVEL='silent'
npm exec tsx -- --test tests/unit/agentCategorySimulation.live.test.ts
```

`npm run check:live` defaults to a bounded live smoke run. Set
`H_EDUWARE_LIVE_CATEGORY_LIMIT=0` to run the full category matrix.

Current categories:

- Hackathon golden path: Arduino + breadboard + I2C OLED.
- Digital LED output.
- Button input plus LED and buzzer.
- Analog potentiometer LED dimmer.
- DHT11 sensor to OLED readout.
- Servo motion.
- H-bridge DC motor driver.
- Addressable NeoPixel display.
- Unsafe mains request, allowed only as safe-equivalent low-voltage simulation.
- Ambiguous sensor request, expected to pause for clarification.

The live matrix caught and fixed a deterministic context-layer bug where
`NeoPixel 12 LED ring` was routed as generic `digital-light-output`. The fix
adds explicit NeoPixel/WS2812 phrases to the addressable LED capability source
data and is covered by `tests/unit/contextPacket.test.ts`.
