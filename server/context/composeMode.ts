// Compose-mode flag (Layered Context Architecture, Phase 2b).
//
//   off    — generated L2 composition never runs (default).
//   shadow — generated composition runs alongside the live packet for logging
//            and diffing ONLY; the live response is byte-for-byte unchanged.
//   on     — (Phase 3) generated composition becomes a primary path.
//
// Keeping this as a tiny, injectable reader makes the rollback story concrete:
// flipping the env var is the kill switch.

export type ComposeMode = 'off' | 'shadow' | 'on';

export function getComposeMode(env: NodeJS.ProcessEnv = process.env): ComposeMode {
  const value = (env.H_EDUWARE_CONTEXT_COMPOSE_MODE ?? '').trim().toLowerCase();
  if (value === 'shadow' || value === 'on') {
    return value;
  }
  return 'off';
}
