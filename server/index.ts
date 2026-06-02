import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  createAgentTraceId,
  logAgentEvent,
  requestLogSummary,
  resultLogSummary
} from './agent/agentLogger.ts';
import { runAgent, agentRuntimeHealth } from './agent/deepAgentRuntime.ts';
import { mapAgentErrorToResponse } from './agent/errorResponse.ts';
import { resolvePlacementLayout } from './agent/placementResolver.ts';
import { runTutorAgent } from './agent/circuitTutor.ts';
import { AgentMessageRequestSchema, PlacementIntentSchema, TutorMessageRequestSchema } from './agent/schemas.ts';
import { loadLocalAgentEnv } from './localEnv.ts';
import { serverProcessHealth } from './serverHealth.ts';
import { ShareCreateRequestSchema } from './share/shareSchemas.ts';
import { createFileShareStore } from './share/shareStore.ts';

loadLocalAgentEnv();

const port = Number(process.env.H_EDUWARE_AGENT_PORT ?? 8787);
const shareStore = createFileShareStore();

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      return sendJson(request, response, 204, {});
    }

    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'GET' && requestUrl.pathname === '/api/agent/health') {
      return sendJson(request, response, 200, {
        ...agentRuntimeHealth(),
        ...serverProcessHealth()
      });
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/agent/message') {
      const traceId = createAgentTraceId();
      const body = await readJson(request);
      try {
        const parsed = AgentMessageRequestSchema.parse(body);
        logAgentEvent('agent.request.received', {
          traceId,
          ...requestLogSummary(parsed)
        });
        const result = await runAgent(parsed, { traceId });
        logAgentEvent('agent.response.sent', {
          traceId,
          sessionId: result.sessionId,
          ...resultLogSummary(result)
        });
        return sendJson(request, response, 200, result);
      } catch (error) {
        logAgentEvent('agent.request.failed', {
          traceId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : 'Unknown server error'
        });
        throw error;
      }
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/agent/explain-target') {
      const body = await readJson(request);
      const parsed = TutorMessageRequestSchema.parse(body);
      const result = await runTutorAgent(parsed);
      return sendJson(request, response, 200, result);
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/agent/placement') {
      const body = await readJson(request);
      const parsed = PlacementIntentSchema.parse(body);
      const result = await resolvePlacementLayout(parsed);
      return sendJson(request, response, 200, result);
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/share/projects') {
      const body = await readJson(request);
      const parsed = ShareCreateRequestSchema.parse(body);
      const stored = await shareStore.create(parsed.snapshot);
      return sendJson(request, response, 200, {
        shareId: stored.shareId,
        shareUrl: publicShareUrl(stored.shareId),
        createdAt: stored.createdAt
      });
    }

    const shareMatch = requestUrl.pathname.match(/^\/api\/share\/projects\/([^/]+)$/);
    if (request.method === 'GET' && shareMatch) {
      const stored = await shareStore.read(shareMatch[1]);
      if (!stored) {
        return sendJson(request, response, 404, { error: 'Share not found', retryable: false });
      }
      return sendJson(request, response, 200, { snapshot: stored.snapshot });
    }

    return sendJson(request, response, 404, { error: 'Not found' });
  } catch (error) {
    const mapped = mapAgentErrorToResponse(error);
    return sendJson(request, response, mapped.status, mapped.body);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`H-eduware agent server listening at http://127.0.0.1:${port}`);
});

function sendJson(request: IncomingMessage, response: ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowedCorsOrigin(request),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  response.end(JSON.stringify(value));
}

function allowedCorsOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) {
    return 'http://127.0.0.1:4173';
  }

  try {
    const parsed = new URL(origin);
    const isLocalHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    const isAllowedPort = ['4173', '5173'].includes(parsed.port);
    if (parsed.protocol === 'http:' && isLocalHost && isAllowedPort) {
      return origin;
    }
  } catch {
    return 'http://127.0.0.1:4173';
  }

  return 'http://127.0.0.1:4173';
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function publicShareUrl(shareId: string) {
  const configuredBase = process.env.H_EDUWARE_PUBLIC_APP_URL ?? 'http://127.0.0.1:4173';
  const base = configuredBase.replace(/\/+$/, '');
  return `${base}/?share=${shareId}`;
}
