# Agent Observability Logging

H-eduware agent requests can be traced with local structured logs and optional
LangSmith tracing.

## Local Logs

Local logs are off by default. Enable them when running the agent server:

```bash
H_EDUWARE_AGENT_LOG_LEVEL=debug H_EDUWARE_AGENT_LOG_JSON=true H_EDUWARE_AGENT_MODEL=gpt-5.4-mini npm run agent:dev
```

Each `/api/agent/message` and `/api/agent/explain-target` request receives a
`traceId`. The server logs JSON events to stdout and, by default, to
`.local/agent-traces/agent-events.jsonl`. Override the file path with
`H_EDUWARE_AGENT_LOG_FILE=/path/to/events.jsonl`, or set
`H_EDUWARE_AGENT_LOG_FILE=false` to disable the file sink.

Useful local inspection commands:

```bash
tail -f .local/agent-traces/agent-events.jsonl
rg "agent-bc220c06" .local/agent-traces/agent-events.jsonl
```

The log includes these events:

- `agent.request.received`
- `context.packet.built`
- `requirement.analysis.completed`
- `agent.llm.handoff`
- `agent.llm.completed`
- `agent.structured_output.parsed`
- `agent.synthesis.attempt`
- `agent.tool.call`
- `agent.simulation.compiled`
- `agent.validation.completed`
- `agent.response.sent`
- `agent.request.failed`
- `tutor.request.received`
- `tutor.response.sent`
- `tutor.request.failed`

The local log intentionally stores previews, hashes, and route metadata only. It
does not log API keys, environment values, raw prompts, full context packets,
full tutor answers, or full student transcripts. Failure summaries redact
API-key-shaped values before writing local logs.

Useful fields include:

- `traceId`
- `sessionId`
- `messagePreview`
- `recentTurnCount`
- `lastAssistantPreview`
- `contextRouteId`
- `capabilityIds`
- `supportGaps`
- `synthesisEligibility`
- `requirementRoute`
- `validationStatus`
- `renderPartCount`
- `currentPathCount`
- `pipelineMode`
- `selectedBundleIds`
- `candidatePartIds`
- `candidateProvenance`
- `unknownHardwareMentions`
- `fallbackRoute`
- `supportBundleStatus`
- `servingStatus`

`agent.llm.handoff` stores stage, agent name, LangGraph `thread_id`, prompt
lengths, prompt hashes, route, candidate parts, tool names, and subagent names.
It does not store raw prompt text. `agent.llm.completed` stores structured-output
presence, message count, tool call names, assistant text hash, and assistant text
length. `agent.tool.call` stores tool name, status, duration, input hash/size,
and output hash/size. `agent.simulation.compiled` stores the validation,
netlist, render, simulation, runnable, and solver-gate summary for the final
artifact.

Tutor logs use the same privacy boundary. `tutor.request.received` records the
selected target id/type/signal, validation/simulation/runnable gate status,
solver gate mode/build readiness, context source ids/types, current-path count,
and a question preview. `tutor.response.sent` records local/live/fallback mode,
`servingStatus`, redacted fallback preview, structured-output status, grounding
count, suggested-question count, and tutor message hash/length.

## LangSmith

LangChain/Deepagents tracing can be enabled through environment variables:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=h-eduware-local-agent
# Optional when one API key can access multiple workspaces:
# LANGSMITH_WORKSPACE_ID=...
# Optional for non-US LangSmith accounts, for example:
# LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
LANGCHAIN_CALLBACKS_BACKGROUND=true
```

The runtime attaches `runName`, `tags`, and metadata to the requirement-analysis
and circuit-synthesis agent calls. Tags include the workflow stage, context
route, capability ids, and synthesis eligibility. Metadata includes the same
`traceId` as local logs so a local event can be matched to its LangSmith trace.

Set these variables before starting `npm run agent:dev`; LangChain reads tracing
configuration from the server process environment.

To retrieve recent LangSmith runs from the local development environment:

```bash
npm run trace:langsmith -- --trace-id agent-bc220c06-6406-4c1d-aecc-2ee8316ce749
npm run trace:langsmith -- --project h-eduware-local-agent --since-minutes 60 --json
```

This command loads `.local/agent.env`, uses the LangSmith SDK, and matches the
local H-eduware `traceId` stored in LangSmith run metadata. It does not print API
keys or full prompts.

LangSmith traces may include prompts and model inputs. Keep it enabled only in
local/dev environments where that data exposure is acceptable.

For the full ordered request-to-simulation workflow and live category gate, see
[`agent-request-to-simulation-workflow.md`](agent-request-to-simulation-workflow.md).
