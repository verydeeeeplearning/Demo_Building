# Agent Pipeline — Flag & Promotion Operations

## The flag

The agent pipeline mode is controlled by the environment variable `H_EDUWARE_AGENT_PIPELINE`, which accepts three values:

- **`legacy`** (default): The current enumerated-route pipeline remains unchanged and active in production.
- **`shadow`**: Hybrid mode between legacy and next; tier path is active and observes composition separately.
- **`next`**: The new composition pipeline with tier-aware routing, composition candidate selection across the full 37/37 corpus, single deepagents run via deterministic intent derivation, never-502 structured-output fallback, passive subagents removed, and observability middleware.

The flag is read by `getAgentPipelineMode()` in `server/agent/agentPipelineMode.ts`.

### Kill-switch

To revert from `next` back to `legacy` without redeploying:

```bash
export H_EDUWARE_AGENT_PIPELINE=legacy
```

## What `next` changes

All changes below are flag-gated; the default `legacy` mode remains byte-for-byte unchanged.

- **Tier-aware route selection**: A compositional-context route cannot out-rank the primary-output route.
- **Composition candidate authority**: Composition is the authority for candidate selection in `buildContextPacket`, covering the entire in-catalog corpus (37/37 entries).
- **Single deepagent per request**: Deterministic requirement-route derivation replaces the second LLM agent; one `createDeepAgent` call per request.
- **Structured-output reliability**: A missing structured draft is retried, then falls back deterministically — never a 502 error.
- **Passive subagents removed**: Path B subagents are eliminated; observability middleware emits `agent.tool.call` events.

## Promotion checklist

**All steps must be completed in order. Human sign-off is required.**

1. **Live smoke test**
   - Set `OPENAI_API_KEY` and `H_EDUWARE_AGENT_MODEL`
   - Run `npm run check:live`
   - This executes the opt-in live smoke test in `tests/unit/agentPipeline.live.test.ts`
   - Confirm: post-fallback completion = 100% (never a 502)
   - Confirm: structured-output first-shot ≈ ≥95%
   - Optionally widen the sample size with `H_EDUWARE_LIVE_SAMPLE` environment variable if desired

2. **Human reviewer sign-off**
   - Required before proceeding to destructive route deletion

3. **Production flip and cleanup**
   - Flip the production default to `next`
   - Delete the 40 enumerated capability routes in `agent-context/v2/routes.json`
   - Keep only the 3 irreducible routes:
     - `v2-ambiguous-minimal`
     - `unsupported-safety`
     - `supported-hardware-general`

4. **Rollback documentation**
   - Maintain the kill-switch in operational documentation for emergency rollback

## Verification

**Default gate (no live calls required)**

```bash
npm run test:unit       # JS + TS unit tests
npm run typecheck       # Type checking
npm run build           # Build verification
```

All three commands must pass. The live test is opt-in and skips automatically without an API key configured.
