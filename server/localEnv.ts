import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_AGENT_ENV = path.resolve(__dirname, '../.local/agent.env');

export function loadLocalAgentEnv(filePath = LOCAL_AGENT_ENV) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = unquoteEnvValue(line.slice(separator + 1).trim());
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value: string) {
  const startsQuoted = value.startsWith('"') || value.startsWith("'");
  if (!startsQuoted) {
    return value;
  }

  const quote = value[0];
  return value.endsWith(quote) ? value.slice(1, -1) : value.slice(1);
}
