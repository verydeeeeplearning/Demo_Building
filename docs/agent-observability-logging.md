# Agent Observability Logging

H-eduware agent requests can be traced with local structured logs and optional
LangSmith tracing.

## Local Logs

Local logs are off by default. Enable them when running the agent server:

```bash
H_EDUWARE_AGENT_LOG_LEVEL=debug H_EDUWARE_AGENT_LOG_JSON=true H_EDUWARE_AGENT_MODEL=gpt-5.4-mini npm run agent:dev
```

Each `/api/agent/message` request receives a `traceId`. The server logs JSON
events to stdout and, by default, to `.local/agent-traces/agent-events.jsonl`.
Override the file path with `H_EDUWARE_AGENT_LOG_FILE=/path/to/events.jsonl`, or
set `H_EDUWARE_AGENT_LOG_FILE=false` to disable the file sink.

Useful local inspection commands:

```bash
tail -f .local/agent-traces/agent-events.jsonl
rg "agent-bc220c06" .local/agent-traces/agent-events.jsonl
```

The log includes these events:

- `agent.request.received`
- `context.packet.built`
- `requirement.analysis.completed`
- `agent.synthesis.attempt`
- `agent.validation.completed`
- `agent.response.sent`
- `agent.request.failed`

The local log intentionally stores previews and route metadata only. It does
not log API keys, environment values, raw prompts, full context packets, or full
student transcripts.

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
