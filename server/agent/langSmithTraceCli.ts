import { Client } from 'langsmith/client';
import type { Run } from 'langsmith';

import { loadLocalAgentEnv } from '../localEnv.ts';

type CliOptions = {
  traceId: string | null;
  projectName: string;
  limit: number;
  sinceMinutes: number;
  json: boolean;
};

loadLocalAgentEnv();

const options = parseArgs(process.argv.slice(2));

if (!process.env.LANGSMITH_API_KEY) {
  console.error([
    'LANGSMITH_API_KEY is not set.',
    'Add LANGSMITH_API_KEY and LANGSMITH_PROJECT to .local/agent.env or export them before running this command.'
  ].join(' '));
  process.exitCode = 2;
} else {
  await main(options);
}

async function main({ traceId, projectName, limit, sinceMinutes, json }: CliOptions) {
  const client = new Client({
    apiUrl: process.env.LANGSMITH_ENDPOINT,
    apiKey: process.env.LANGSMITH_API_KEY
  });
  const startTime = new Date(Date.now() - sinceMinutes * 60 * 1000);
  const matchedRuns = [];

  for await (const run of client.listRuns({
    projectName,
    startTime,
    limit,
    order: 'desc'
  })) {
    const summary = summarizeRun(run);
    if (!traceId || summary.localTraceId === traceId) {
      matchedRuns.push({
        ...summary,
        url: await safeRunUrl(client, run)
      });
    }
  }

  if (json) {
    console.log(JSON.stringify({
      projectName,
      traceId,
      matchedRunCount: matchedRuns.length,
      runs: matchedRuns
    }, null, 2));
    return;
  }

  if (matchedRuns.length === 0) {
    console.log(
      traceId
        ? `No LangSmith runs found for local traceId ${traceId} in project ${projectName}.`
        : `No LangSmith runs found in project ${projectName}.`
    );
    return;
  }

  console.log(`LangSmith project: ${projectName}`);
  if (traceId) {
    console.log(`Local traceId: ${traceId}`);
  }
  for (const run of matchedRuns) {
    console.log([
      `- ${run.name} (${run.runType})`,
      `  id: ${run.id}`,
      `  langsmithTraceId: ${run.langSmithTraceId}`,
      `  localTraceId: ${run.localTraceId ?? 'n/a'}`,
      `  startedAt: ${run.startedAt ?? 'n/a'}`,
      `  status: ${run.error ? 'error' : 'ok'}`,
      `  tags: ${run.tags.join(', ') || 'n/a'}`,
      run.url ? `  url: ${run.url}` : null
    ].filter(Boolean).join('\n'));
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    traceId: null,
    projectName: process.env.LANGSMITH_PROJECT || 'default',
    limit: 50,
    sinceMinutes: 180,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--trace-id' && next) {
      options.traceId = next;
      index += 1;
    } else if (arg === '--project' && next) {
      options.projectName = next;
      index += 1;
    } else if (arg === '--limit' && next) {
      options.limit = positiveInteger(next, options.limit);
      index += 1;
    } else if (arg === '--since-minutes' && next) {
      options.sinceMinutes = positiveInteger(next, options.sinceMinutes);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function summarizeRun(run: Run) {
  const metadata = run.extra && typeof run.extra === 'object'
    ? (run.extra.metadata ?? {}) as Record<string, unknown>
    : {};
  return {
    id: run.id,
    name: run.name,
    runType: run.run_type,
    langSmithTraceId: run.trace_id ?? '',
    localTraceId: typeof metadata.traceId === 'string' ? metadata.traceId : null,
    contextRouteId: typeof metadata.contextRouteId === 'string' ? metadata.contextRouteId : null,
    requirementRoute: typeof metadata.requirementRoute === 'string' ? metadata.requirementRoute : null,
    startedAt: run.start_time ? String(run.start_time) : '',
    error: run.error ?? null,
    tags: run.tags ?? []
  };
}

async function safeRunUrl(client: Client, run: Run) {
  try {
    return await client.getRunUrl({ run });
  } catch {
    return null;
  }
}

function printHelp() {
  console.log([
    'Usage: npm run trace:langsmith -- [options]',
    '',
    'Options:',
    '  --trace-id <id>         Match the local H-eduware traceId stored in LangSmith metadata.',
    '  --project <name>        LangSmith project name. Defaults to LANGSMITH_PROJECT or default.',
    '  --limit <n>             Maximum recent runs to inspect. Defaults to 50.',
    '  --since-minutes <n>     Lookback window. Defaults to 180.',
    '  --json                  Print machine-readable JSON.'
  ].join('\n'));
}
