const MAX_THREAD_PART_CHARS = 120;

export function buildTutorAuthoritySnapshot(artifacts = {}) {
  const circuitSpec = artifacts.circuitSpec || {};
  const validationReport = artifacts.validationReport || {};
  const simulationPlan = artifacts.simulationPlan || {};
  const renderPlan = artifacts.renderPlan || {};
  const buildRunnableReport = artifacts.buildRunnableReport || {};
  const solverGateResult = artifacts.solverGateResult || {};

  return {
    circuit: {
      id: circuitSpec.id,
      title: circuitSpec.title,
      components: compactById(circuitSpec.components, ['id', 'partId', 'label', 'pins']),
      connections: compactById(circuitSpec.connections, ['id', 'from', 'to', 'source', 'target', 'net']),
      behavior: circuitSpec.behavior || null
    },
    render: {
      title: renderPlan.title,
      parts: compactById(renderPlan.parts, ['id', 'partId', 'label', 'type']),
      connections: compactById(renderPlan.connections, ['id', 'from', 'to', 'kind']),
      warnings: renderPlan.warnings || []
    },
    validation: {
      status: validationReport.status,
      errors: compactMessages(validationReport.errors),
      warnings: compactMessages(validationReport.warnings),
      validatedCurrentPathIds: validationReport.validatedCurrentPathIds || []
    },
    simulation: {
      status: simulationPlan.status,
      runText: simulationPlan.runText || '',
      currentPaths: compactById(simulationPlan.currentPaths, ['id', 'kind', 'label', 'primitiveId', 'through'])
    },
    build: {
      runnable: buildRunnableReport.runnable,
      reasons: buildRunnableReport.reasons || []
    },
    solver: {
      status: solverGateResult.status,
      verified: solverGateResult.verified,
      notVerified: solverGateResult.notVerified || []
    },
    contextSourceIds: (artifacts.contextTrace || [])
      .map((entry) => entry?.sourceId)
      .filter(Boolean)
      .sort()
  };
}

export async function buildTutorArtifactFingerprint(artifacts = {}) {
  const digest = await sha256Hex(stableStringify(buildTutorAuthoritySnapshot(artifacts)));
  return `afp-${digest.slice(0, 16)}`;
}

export function normalizeTutorSessionId(value, fallback = 'session-local') {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return encodeThreadPart(raw) || fallback;
}

export function targetScopeId(target) {
  const raw = target?.id || `${target?.type || 'target'}:${target?.connectionId || target?.partId || 'whole-circuit'}`;
  return encodeThreadPart(raw) || 'target-none';
}

export function buildTutorThreadId({ sessionId, artifactFingerprint, targetId, locale }) {
  return [
    'tutor',
    'session',
    normalizeTutorSessionId(sessionId),
    'artifact',
    encodeThreadPart(artifactFingerprint || 'afp-none'),
    'target',
    encodeThreadPart(targetId || 'target-none'),
    'locale',
    locale === 'en' ? 'en' : 'ko'
  ].join('.');
}

export function encodeThreadPart(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_THREAD_PART_CHARS);
}

function compactById(items, fields) {
  return Array.isArray(items)
    ? items
      .map((item) => pickFields(item, fields))
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
    : [];
}

function compactMessages(items) {
  return Array.isArray(items)
    ? items.map((item) => typeof item === 'string' ? item : pickFields(item, ['code', 'message', 'path', 'id']))
    : [];
}

function pickFields(value, fields) {
  const output = {};
  for (const field of fields) {
    if (value && Object.prototype.hasOwnProperty.call(value, field)) {
      output[field] = value[field];
    }
  }
  return output;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
