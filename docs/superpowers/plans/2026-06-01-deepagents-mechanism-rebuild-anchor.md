# Deepagents Mechanism Rebuild Anchor Plan

**Goal:** Rebuild H-eduware's Deepagents mechanism around the official LangChain Deep Agents harness model: coordinator-worker orchestration, scoped context, bounded tools, structured output, and deterministic finalization.

**Primary anchor:** `docs/deepagents-official-architecture-anchor.md`

**Official docs checked:** LangChain JS Deep Agents overview, customization, context engineering, backends, frontend overview, and `createDeepAgent` API reference.

## Working Interpretation

Deepagents should be treated as an orchestration harness:

- The harness provides planning, task delegation, virtual filesystem context management, summarization, middleware ordering, and structured-output plumbing.
- H-eduware provides domain truth through context packets, support bundles, deterministic validation, render compilation, simulation compilation, and final server checks.

This means the rebuild should not make prompts larger or give the model broader authority. It should make each Deepagents step more scoped and observable.

## Current Runtime Baseline

- `server/agent/deepAgentRuntime.ts` already uses `createDeepAgent`, `toolStrategy(LiveAgentDraftSchema)`, custom subagents, and a bounded repair loop.
- `server/agent/deepAgentTools.ts` already exposes bounded context docs and candidate-part search.
- `server/context/contextPacket.ts` now prefers v2 capability bundles for supported/planned routes.
- `agent-context/sources/` now has `SourceClaim` and `HardwareSupportBundle` data.
- `agent-context/legacy/v1/` preserves the previous root context layer for comparison.

## Rebuild Phases

1. Anchor and audit
   - Keep `docs/deepagents-official-architecture-anchor.md` as the official-mechanics source.
   - Compare current Deepagents runtime against the anchor.
   - Identify where H-eduware is duplicating harness behavior in prompts versus using deterministic tools.

2. Source bundle workflow
   - Status: completed for the backend mechanism slice on 2026-06-01.
   - Use `docs/superpowers/plans/2026-06-01-deepagents-source-bundle-workflow.md` as the first implementation slice.
   - Add request-scoped support bundle evidence.
   - Add bounded Deepagents tool access to support bundle evidence.
   - Block build-ready synthesis when matched supported capabilities lack complete bundle evidence.

3. Coordinator and subagent contract cleanup
   - Make subagent roles match official coordinator-worker semantics.
   - Give subagents the same scoped H-eduware tool facade.
   - Avoid asking subagents to decide final validity.

4. Observability
   - Emit clear agent events for context route, support bundle evidence, tool gates, repair attempts, and final validation.
   - Keep student-facing UI free of raw Deepagents or structured-output internals.

5. Verification
   - Default harness: unit tests, audits, build, offline-safe Playwright.
   - Live Deepagents checks remain opt-in behind configured secrets.

## Completed First Slice

Implemented the backend source bundle workflow:

- `server/context/supportBundleEvidence.ts`
- `SupportBundleEvidenceSchema`
- `ContextPacket.supportBundles`
- bounded `load_support_bundle_evidence` Deepagents tool
- final context coverage gate for incomplete support bundle evidence

## Immediate Next Slice

Continue with coordinator/subagent contract cleanup:

- reduce duplicated harness instructions from custom prompts
- add more observable agent events for bundle checks and tool gates
- keep UI/browser evidence polish tracked in the source bundle workflow plan

## Acceptance Criteria

- Official mechanics are documented and linked.
- Deepagents remains a scoped coordinator, not the source of hardware truth.
- The source bundle workflow is implemented before broad workflow/prompt changes.
- Existing supported circuits continue to pass.
- Planned, unsupported, visual-only, or source-incomplete circuits remain ineligible for build-ready render/current simulation.
