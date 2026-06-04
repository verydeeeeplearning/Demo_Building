import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgentTraceId,
  errorLogSummary,
  logAgentEvent,
  requestLogSummary,
  resultLogSummary,
  tutorRequestLogSummary,
  tutorResultLogSummary
} from './agent/agentLogger.ts';
import { runAgent, agentRuntimeHealth } from './agent/deepAgentRuntime.ts';
import { mapAgentErrorToResponse } from './agent/errorResponse.ts';
import { resolvePlacementLayout } from './agent/placementResolver.ts';
import { runTutorAgent, tutorRuntimeHealth } from './agent/circuitTutor.ts';
import { AgentMessageRequestSchema, PlacementIntentSchema, TutorMessageRequestSchema } from './agent/schemas.ts';
import { loadLocalAgentEnv } from './localEnv.ts';
import { serverProcessHealth } from './serverHealth.ts';
import { ShareCreateRequestSchema } from './share/shareSchemas.ts';
import { createFileShareStore } from './share/shareStore.ts';

loadLocalAgentEnv();

const port = Number(process.env.PORT ?? process.env.H_EDUWARE_AGENT_PORT ?? 8787);
const host = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const shareStore = createFileShareStore();
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      return sendJson(request, response, 204, {});
    }

    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'GET' && requestUrl.pathname === '/api/agent/health') {
      return sendJson(request, response, 200, {
        ...agentRuntimeHealth(),
        ...tutorRuntimeHealth(),
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
          ...errorLogSummary(error)
        });
        throw error;
      }
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/agent/explain-target') {
      const traceId = createAgentTraceId('tutor');
      const body = await readJson(request);
      try {
        const parsed = TutorMessageRequestSchema.parse(body);
        logAgentEvent('tutor.request.received', {
          traceId,
          ...tutorRequestLogSummary(parsed)
        });
        const startedAt = performance.now();
        const result = await runTutorAgent(parsed, {
          traceId,
          runName: 'h-eduware-circuit-tutor',
          tags: [
            'workflow:tutor',
            `target:${parsed.target.type}`,
            parsed.target.signal ? `signal:${parsed.target.signal}` : 'signal:none'
          ],
          metadata: {
            traceId,
            workflow: 'tutor',
            selectedTargetId: parsed.target.id,
            targetType: parsed.target.type,
            targetSignal: parsed.target.signal ?? null
          }
        });
        logAgentEvent('tutor.response.sent', {
          traceId,
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ...tutorResultLogSummary(result)
        });
        return sendJson(request, response, 200, result);
      } catch (error) {
        logAgentEvent('tutor.request.failed', {
          traceId,
          ...errorLogSummary(error)
        });
        throw error;
      }
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

    if (request.method === 'GET' && !requestUrl.pathname.startsWith('/api/')) {
      return serveStatic(request, response, requestUrl.pathname);
    }

    return sendJson(request, response, 404, { error: 'Not found' });
  } catch (error) {
    const mapped = mapAgentErrorToResponse(error);
    return sendJson(request, response, mapped.status, mapped.body);
  }
});

server.listen(port, host, () => {
  console.log(`H-eduware agent server listening at http://${host}:${port}`);
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

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
};

// Serve the Vite production build from dist/. Unknown non-API paths fall back to
// index.html so the single-page app (and ?share= deep links) load on any route.
async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(distDir, relativePath);

  // Block path traversal outside dist/.
  if (resolved !== distDir && !resolved.startsWith(distDir + path.sep)) {
    return sendJson(request, response, 404, { error: 'Not found' });
  }

  const filePath = (await isFile(resolved)) ? resolved : path.join(distDir, 'index.html');
  if (!(await isFile(filePath))) {
    return sendJson(request, response, 500, {
      error: 'Frontend build not found. Run `npm run build` to generate dist/.'
    });
  }

  // Filesystem-authoritative check: dereference symlinks so a link inside dist/
  // cannot escape the served root, even though the lexical check passed above.
  const realRoot = await realDistDir();
  const realFile = await realpath(filePath);
  if (realRoot && realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
    return sendJson(request, response, 404, { error: 'Not found' });
  }

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const isHashedAsset = filePath.startsWith(path.join(distDir, 'assets') + path.sep);
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  createReadStream(filePath).pipe(response);
}

async function isFile(candidate: string) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

let cachedRealDistDir: string | null | undefined;
// Resolve dist/ to its canonical path once; null if it doesn't exist yet.
async function realDistDir() {
  if (cachedRealDistDir === undefined) {
    try {
      cachedRealDistDir = await realpath(distDir);
    } catch {
      cachedRealDistDir = null;
    }
  }
  return cachedRealDistDir;
}
