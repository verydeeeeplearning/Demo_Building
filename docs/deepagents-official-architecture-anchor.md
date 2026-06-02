# Deepagents Official Architecture Anchor

Last checked: 2026-06-01

This document anchors H-eduware's Deepagents rebuild to the official LangChain Deep Agents model and to the currently installed package.

## Official Sources

- LangChain JS Deep Agents overview: https://docs.langchain.com/oss/javascript/deepagents/overview
- LangChain JS customization: https://docs.langchain.com/oss/javascript/deepagents/customization
- LangChain JS context engineering: https://docs.langchain.com/oss/javascript/deepagents/context-engineering
- LangChain JS backends: https://docs.langchain.com/oss/javascript/deepagents/backends
- LangChain JS frontend Deep Agents overview: https://docs.langchain.com/oss/javascript/deepagents/frontend/overview
- LangChain JS API reference for `createDeepAgent`: https://reference.langchain.com/javascript/deepagents/index/createDeepAgent
- Local package inspected: `deepagents@1.10.2`

## Official Mental Model

Deepagents is an agent harness, not a replacement for deterministic domain logic. It uses the same model/tool-calling loop as simpler agents, then adds an opinionated orchestration layer for long, multi-step work.

The harness is built around these capabilities:

1. Planning and task decomposition through `write_todos`.
2. Context management through virtual filesystem tools and summarization.
3. Subagent delegation through the `task` tool.
4. Pluggable backends for state, local filesystem, store-backed memory, composite routing, and sandboxes.
5. Optional memory, skills, human-in-the-loop approval, structured output, and custom middleware.

For H-eduware, Deepagents should therefore coordinate and draft. It must not own hardware truth, safety truth, source provenance, validation, render eligibility, or current-flow eligibility.

## Runtime Pieces

`createDeepAgent()` is the main entry point. The current JavaScript package accepts the following configuration categories:

- `model`
- `tools`
- `systemPrompt`
- `middleware`
- `subagents`
- `responseFormat`
- `contextSchema`
- `checkpointer`
- `store`
- `backend`
- `interruptOn`
- `name`
- `memory`
- `skills`
- `permissions`
- `streamTransformers`

The official docs describe deterministic middleware ordering. The local `deepagents@1.10.2` type definitions confirm the default runtime includes:

- `write_todos`
- filesystem tools: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`
- `task` for subagents
- summarization middleware
- patch-tool-call middleware

The type surface also includes `execute` when the selected backend supports shell execution. H-eduware should not depend on agent shell execution for product synthesis.

## System Prompt Assembly

Official guidance says the custom `systemPrompt` is layered with the SDK's built-in harness prompt. The custom prompt should define domain-specific behavior and constraints; it should not copy or replace the Deepagents base prompt.

H-eduware implication:

- Keep `server/agent/deepAgentRuntime.ts` focused on H-eduware-specific rules.
- Do not reimplement Deepagents' built-in todo/filesystem/subagent instructions in our prompt.
- Put non-negotiable product truth into the forced `ContextPacket`, source bundle evidence, and deterministic tools.

## Subagents

Deepagents use a coordinator-worker architecture. The main agent plans and can delegate to subagents, each running in an isolated context. Official docs emphasize that this keeps the supervisor context clean while still allowing detailed work.

Important mechanics:

- A built-in general-purpose subagent exists unless replaced.
- Custom subagents need `name`, `description`, and `systemPrompt`.
- Custom subagents can override `tools`, `model`, `middleware`, `interruptOn`, `skills`, `responseFormat`, and `permissions`.
- Custom subagents receive the default Deepagents middleware stack before their custom middleware.
- Custom subagents do not automatically inherit skills from the main agent.
- Subagent structured output can be returned to the parent as JSON.

H-eduware implication:

- Subagents should be treated as specialized workers, not independent authorities.
- Any subagent that drafts or validates must use the same bounded H-eduware tools and the same request-scoped context.
- The parent coordinator must reconcile subagent output with deterministic server validation.

## Backends And Filesystem

Official docs distinguish state-backed virtual filesystems from real local filesystem access.

H-eduware implication:

- The production/server path should prefer state/store/sandbox-safe behavior over unrestricted local filesystem access.
- Source documents, source claims, and context bundles should be loaded by deterministic server code, not by giving Deepagents broad read access to repo files.
- If a real filesystem backend is ever introduced, it must use explicit permissions and must not expose `.env`, credentials, or unrelated repo state.

## Structured Output

Official docs state that `responseFormat` captures validated structured output in `structuredResponse`.

H-eduware already uses:

- `responseFormat: toolStrategy(LiveAgentDraftSchema)`
- `parseLiveAgentDraft()` reading `structuredResponse` and `structured_response`

Rebuild implication:

- Keep structured output mandatory.
- Treat missing structured output as recoverable runtime failure, never as student-facing raw Deepagents detail.
- Final server validation must still re-validate every structured draft.

## H-eduware Current Fit

Current local files:

- `server/agent/deepAgentRuntime.ts`
  - creates `createDeepAgent`
  - injects request-specific `ContextPacket`
  - uses `toolStrategy(LiveAgentDraftSchema)`
  - creates custom subagents
  - runs a bounded validation repair loop
  - finalizes through deterministic validation/render/simulation tools
- `server/agent/deepAgentTools.ts`
  - exposes context-bound H-eduware tools
  - bounds part search to current candidate parts
  - bounds context document reads to selected retrieval sources
- `server/context/contextPacket.ts`
  - resolves intent, capability matches, retrieval route, v2 bundles, candidate parts, coverage, and prompt block
- `agent-context/v2/`
  - provides compact capability bundles for prompt-safe retrieval
- `agent-context/sources/`
  - provides source claims and hardware support bundles for promotion audits

## Rebuild Invariants

The Deepagents rebuild must preserve these rules:

1. Context packet before Deepagents. The model receives a request-scoped packet before synthesis.
2. Bundle-first retrieval. The prompt should prefer selected `bundle:*` summaries over heavy artifact catalogs.
3. Deterministic tools are authority. Deepagents can propose; server tools decide.
4. Source provenance is a gate. Supported synthesis requires complete support bundle evidence.
5. No broad context reads. Tools expose only route-selected documents, bundles, and candidate parts.
6. No unsupported hardware upgrades. Planned, unsupported, visual-only, or source-incomplete hardware cannot become build-ready through model prior.
7. Structured output is required. No free-form draft should be finalized.
8. Finalization revalidates. Server-side validation/render/simulation must run after any model draft.
9. Repair loop is bounded. Validation repair may fix wiring errors but cannot repair missing context coverage by invention.
10. Browser/live checks remain opt-in when they need secrets.

## Rebuild Direction

Use the official harness instead of fighting it:

1. Keep Deepagents' built-in planner, filesystem state, summarization, and subagent mechanism.
2. Narrow H-eduware custom prompt to domain boundaries and product truth.
3. Move retrieval, support evidence, validation, render, simulation, and finalization into typed deterministic modules.
4. Make subagents consume the same scoped tool facade as the coordinator.
5. Add observable events for planning, context evidence, tool gates, repair attempts, and final validation.

The first implementation slice wired source-backed `HardwareSupportBundle` evidence into `ContextPacket`, Deepagents tools, and final synthesis eligibility. The next slice should clean up coordinator/subagent contracts and observability while preserving the same deterministic finalization boundary.
