// Agent-pipeline mode flag (Agent Pipeline Refactor, PLAN_agent_pipeline_refactor.md).
//
//   legacy — the current enumerated-route pipeline (default; production today).
//   shadow — the new composition pipeline runs alongside legacy for logging/diffing ONLY;
//            the live response is byte-for-byte unchanged.
//   next   — the new composition pipeline becomes the primary path.
//
// One flag governs the whole pipeline refactor (context selection + harness changes). Keeping it
// a tiny injectable reader makes rollback concrete: flipping the env var is the kill switch
// (Phase 6.3 prod runtime kill-switch). Mirrors `getComposeMode` from the prior track.

export type AgentPipelineMode = 'legacy' | 'shadow' | 'next';

export function getAgentPipelineMode(env: NodeJS.ProcessEnv = process.env): AgentPipelineMode {
  const value = (env.H_EDUWARE_AGENT_PIPELINE ?? '').trim().toLowerCase();
  if (value === 'shadow' || value === 'next') {
    return value;
  }
  return 'legacy';
}
