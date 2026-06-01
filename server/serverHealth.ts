import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_STARTED_AT_MS = Date.now();

const DEFAULT_SOURCE_FILES = [
  { id: 'server:index', path: fileURLToPath(new URL('./index.ts', import.meta.url)) },
  { id: 'agent:deep-agent-runtime', path: fileURLToPath(new URL('./agent/deepAgentRuntime.ts', import.meta.url)) },
  { id: 'agent:circuit-tools', path: fileURLToPath(new URL('./agent/circuitTools.ts', import.meta.url)) },
  { id: 'context:context-packet', path: fileURLToPath(new URL('./context/contextPacket.ts', import.meta.url)) },
  { id: 'agent:circuit-tutor', path: fileURLToPath(new URL('./agent/circuitTutor.ts', import.meta.url)) }
];

type SourceFileProbe = {
  id: string;
  path: string;
};

type SourceStatusOptions = {
  startedAtMs?: number;
  checkedAtMs?: number;
  files?: SourceFileProbe[];
  toleranceMs?: number;
};

export function serverProcessHealth() {
  return {
    serverStartedAt: new Date(SERVER_STARTED_AT_MS).toISOString(),
    serverUptimeMs: Math.round(process.uptime() * 1000),
    sourceStatus: sourceFreshnessStatus({ startedAtMs: SERVER_STARTED_AT_MS })
  };
}

export function sourceFreshnessStatus(options: SourceStatusOptions = {}) {
  const startedAtMs = options.startedAtMs ?? SERVER_STARTED_AT_MS;
  const checkedAtMs = options.checkedAtMs ?? Date.now();
  const toleranceMs = options.toleranceMs ?? 250;
  const files = options.files ?? DEFAULT_SOURCE_FILES;
  const staleSourceFiles = [];
  const errors = [];
  let newestSourceModifiedAtMs = 0;

  for (const file of files) {
    try {
      const stat = statSync(file.path);
      newestSourceModifiedAtMs = Math.max(newestSourceModifiedAtMs, stat.mtimeMs);
      if (stat.mtimeMs > startedAtMs + toleranceMs) {
        staleSourceFiles.push({
          id: file.id,
          modifiedAt: new Date(stat.mtimeMs).toISOString()
        });
      }
    } catch (error) {
      errors.push({
        id: file.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    stale: staleSourceFiles.length > 0,
    checkedAt: new Date(checkedAtMs).toISOString(),
    newestSourceModifiedAt: newestSourceModifiedAtMs
      ? new Date(newestSourceModifiedAtMs).toISOString()
      : null,
    staleSourceFiles,
    errors
  };
}
