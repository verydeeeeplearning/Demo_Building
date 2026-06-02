const SECRET_PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]{10,}/g,
  /sk-[A-Za-z0-9_-]{10,}/g,
  /OPENAI_API_KEY\s*=\s*[^\s]+/g,
  /H_EDUWARE_AGENT_MODEL\s*=\s*[^\s]+/g,
  /OPENAI_API_KEY/g,
  /H_EDUWARE_AGENT_MODEL/g,
  /\.local[\\/]+agent\.env/g
];

export function createShareSnapshot(project, options = {}) {
  const circuit = project?.circuit || {};
  const validationReport = circuit.validationReport || null;
  const simulationPlan = circuit.simulationPlan || null;
  const runnableReport = circuit.buildRunnableReport || null;
  const solverGateResult = circuit.solverGateResult || null;
  const requirementMarkdown = firstMarkdown(project) || '';
  const source = options.source || inferSource(circuit);
  const status = shareStatus(validationReport, simulationPlan, source, runnableReport);
  const validationStatus = validationStatusForShare(status);
  const title = boundedText(circuit.title || circuit.circuitSpec?.title || options.title || 'H-eduware circuit', 80);
  const summary = boundedText(
    options.summary || circuit.circuitSpec?.intent?.primaryGoal || summaryFromMarkdown(requirementMarkdown) || `${title} circuit shared from H-eduware.`,
    280
  );
  const currentPaths = Array.isArray(simulationPlan?.currentPaths) ? simulationPlan.currentPaths : [];
  const expectedStates = Array.isArray(simulationPlan?.expectedStates) ? simulationPlan.expectedStates : [];
  const publicRenderPlan = renderPlanFromCircuit(circuit);
  const simulationAvailable = status === 'valid'
    && simulationPlan?.status === 'valid'
    && runnableGateAllowsShare(runnableReport, source, validationReport);
  const diagnosticVisible = !simulationAvailable
    && solverGateResult?.visibleSimulation === true
    && Array.isArray(publicRenderPlan?.parts)
    && publicRenderPlan.parts.length > 0;
  const snapshot = {
    schemaVersion: 1,
    createdAt: options.createdAt || new Date().toISOString(),
    locale: options.locale === 'en' ? 'en' : 'ko',
    title,
    summary,
    status,
    source,
    studentPromptSummary: options.studentPromptSummary
      ? boundedText(options.studentPromptSummary, 280)
      : undefined,
    requirementMarkdown: boundedText(requirementMarkdown, 12000, ''),
    circuit: {
      name: title,
      description: boundedText(circuit.circuitSpec?.intent?.primaryGoal || summary, 500, ''),
      components: shareComponents(circuit),
      connections: shareConnections(circuit)
    },
    validation: {
      status: validationStatus,
      warnings: validationWarnings(validationReport, simulationPlan, runnableReport),
      unsupportedItems: unsupportedItems(circuit, validationReport)
    },
    buildRunnableReport: runnableReport ? sanitizeBuildRunnableReport(runnableReport) : undefined,
    solverGateResult: solverGateResult ? sanitizeShareValue(solverGateResult) : undefined,
    simulation: {
      available: simulationAvailable,
      runText: simulationPlan?.runText || circuit.runText || undefined,
      explanation: simulationAvailable
        ? simulationExplanation(currentPaths, expectedStates)
        : diagnosticVisible
          ? '3D diagnostic scene is available, but current-flow simulation is not verified for this shared snapshot.'
        : 'Current-flow simulation is not available for this shared snapshot.',
      currentPathCount: simulationAvailable ? Math.min(currentPaths.length, 60) : 0
    },
    renderPlan: options.includeRenderPlan === false ? undefined : sanitizeShareValue(publicRenderPlan),
    contextEvidence: contextEvidence(circuit)
  };

  return pruneUndefined(sanitizeShareValue(snapshot));
}

export function createShareMarkdown(snapshot, locale = 'ko') {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  const title = redactShareText(snapshot.title || 'H-eduware circuit');
  const parts = (snapshot.circuit?.components || [])
    .slice(0, 12)
    .map((component) => `- ${redactShareText(component.name)} (${redactShareText(component.type)})`)
    .join('\n') || '- No public parts listed.';
  const runnable = snapshotShareRunnable(snapshot);
  const diagnosticVisible = snapshotDiagnosticVisible(snapshot);
  const validation = runnable ? snapshot.validation?.status || snapshot.status || 'draft' : 'invalid';
  const simulation = runnable && snapshot.simulation?.available
    ? redactShareText(snapshot.simulation.explanation)
    : diagnosticVisible
      ? '3D diagnostic scene is available, but Run and current-flow simulation need review.'
    : 'Simulation is not marked as available for this shared snapshot.';
  const heading = normalizedLocale === 'en'
    ? `# Circuit I designed: ${title}`
    : `# 내가 만든 회로: ${title}`;
  const validationLabel = normalizedLocale === 'en' ? 'Validation' : '검증 상태';
  const partsLabel = normalizedLocale === 'en' ? 'Parts' : '부품';
  const simulationLabel = normalizedLocale === 'en' ? 'How it works' : '동작 설명';
  const cta = normalizedLocale === 'en'
    ? 'Created with H-eduware.'
    : 'H-eduware로 만든 공유 회로입니다.';

  return redactShareText([
    heading,
    '',
    redactShareText(snapshot.summary || ''),
    '',
    `**${validationLabel}: ${validation}**`,
    '',
    `## ${partsLabel}`,
    '',
    parts,
    '',
    `## ${simulationLabel}`,
    '',
    simulation,
    '',
    cta
  ].join('\n'));
}

export function redactShareText(value) {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, '[redacted]'),
    String(value ?? '')
  );
}

function firstMarkdown(project) {
  return project?.files?.find((file) => file.kind === 'Markdown' && typeof file.markdown === 'string')?.markdown
    || project?.files?.find((file) => typeof file.markdown === 'string')?.markdown
    || project?.requirementMarkdown
    || '';
}

function shareStatus(validationReport, simulationPlan, source, runnableReport) {
  if (!validationReport) {
    return source === 'demo' ? 'valid' : 'draft';
  }
  if (!runnableGateAllowsShare(runnableReport, source, validationReport)) {
    return 'invalid';
  }
  if (validationReport.status === 'valid' && (!simulationPlan || simulationPlan.status === 'valid')) {
    return 'valid';
  }
  if (validationReport.status === 'valid_with_warnings') {
    return 'warning';
  }
  return 'invalid';
}

function runnableGateAllowsShare(runnableReport, source, validationReport) {
  if (runnableReport) {
    return runnableReport.runnable === true;
  }
  return source === 'demo' && !validationReport;
}

function snapshotShareRunnable(snapshot) {
  if (snapshot?.buildRunnableReport) {
    return snapshot.buildRunnableReport.runnable === true;
  }
  return snapshot?.source === 'demo';
}

function snapshotDiagnosticVisible(snapshot) {
  return snapshot?.solverGateResult?.visibleSimulation === true
    && snapshot?.solverGateResult?.buildReady !== true
    && Array.isArray(snapshot?.renderPlan?.parts)
    && snapshot.renderPlan.parts.length > 0;
}

function sanitizeBuildRunnableReport(report) {
  return {
    status: report.status === 'runnable' ? 'runnable' : 'blocked',
    runnable: report.runnable === true,
    reasons: Array.isArray(report.reasons) ? report.reasons.slice(0, 20).map((reason) => boundedText(reason, 500, '')) : [],
    validationStatus: boundedText(report.validationStatus || 'invalid', 40, 'invalid'),
    simulationStatus: boundedText(report.simulationStatus || 'invalid', 40, 'invalid'),
    renderWarningCount: safeCount(report.renderWarningCount),
    renderBlockingWarningCount: safeCount(report.renderBlockingWarningCount),
    renderPartCount: safeCount(report.renderPartCount),
    currentPathCount: safeCount(report.currentPathCount),
    expectedStateCount: safeCount(report.expectedStateCount)
  };
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 10000) : 0;
}

function validationStatusForShare(status) {
  if (status === 'valid') return 'valid';
  if (status === 'warning') return 'warning';
  return 'invalid';
}

function inferSource(circuit) {
  if (circuit?.contextCoverage || circuit?.circuitSpec) {
    return 'agent';
  }
  return 'demo';
}

function shareComponents(circuit) {
  const components = Array.isArray(circuit.parts) && circuit.parts.length > 0
    ? circuit.parts
    : circuit.circuitSpec?.components || [];
  return components.slice(0, 80).map((component) => ({
    id: boundedText(component.id || component.partId || component.label || 'component', 120),
    type: boundedText(component.type || component.partId || 'part', 80),
    name: boundedText(component.label || component.name || component.partId || component.id || 'Part', 120),
    role: component.description || component.designator || component.role
      ? boundedText(component.description || component.designator || component.role, 160, '')
      : undefined
  }));
}

function shareConnections(circuit) {
  const connections = Array.isArray(circuit.connections) ? circuit.connections : circuit.circuitSpec?.connections || [];
  return connections.slice(0, 200).map((connection) => ({
    from: boundedText(endpointKey(connection.from), 160),
    to: boundedText(endpointKey(connection.to), 160),
    label: connection.education?.label || connection.label || connection.signal
      ? boundedText(connection.education?.label || connection.label || connection.signal, 160, '')
      : undefined
  }));
}

function endpointKey(endpoint = {}) {
  const partId = endpoint.partId || endpoint.componentId || endpoint.id || 'unknown';
  return `${partId}:${endpoint.pin || 'pin'}`;
}

function validationWarnings(validationReport, simulationPlan, runnableReport) {
  return [
    ...(validationReport?.errors || []),
    ...(validationReport?.warnings || []),
    ...(simulationPlan?.warnings || []),
    ...(runnableReport?.runnable === false ? runnableReport.reasons || [] : [])
  ].slice(0, 30).map((warning) => boundedText(warning, 500, ''));
}

function unsupportedItems(circuit, validationReport) {
  return unique([
    ...(circuit.circuitSpec?.unsupportedItems || []),
    ...(validationReport?.status === 'unsupported' ? validationReport.errors || [] : [])
  ].map((item) => String(item).replace(/^Unsupported request item:\s*/i, '').trim()))
    .slice(0, 30)
    .map((item) => boundedText(item, 500, ''));
}

function simulationExplanation(currentPaths, expectedStates) {
  if (currentPaths.length > 0) {
    const firstPath = currentPaths[0];
    return boundedText(`${firstPath.label || 'Current path'} flows from ${firstPath.from} to ${firstPath.to}.`, 1000, '');
  }
  if (expectedStates.length > 0) {
    return boundedText(`Expected state: ${expectedStates.map((state) => state.state).join(', ')}.`, 1000, '');
  }
  return 'The validated circuit can be simulated, but no current path summary was provided.';
}

function renderPlanFromCircuit(circuit) {
  if (!Array.isArray(circuit.parts) && !Array.isArray(circuit.connections)) {
    return undefined;
  }
  return {
    title: circuit.title,
    runText: circuit.runText || circuit.simulationPlan?.runText,
    parts: circuit.parts || [],
    connections: circuit.connections || [],
    floatingCards: circuit.floatingCards || [],
    layout: circuit.layout,
    warnings: circuit.renderWarnings || []
  };
}

function contextEvidence(circuit) {
  const coverage = circuit.contextCoverage;
  if (!coverage) {
    return circuit.contextTrace?.length
      ? {
          coverageStatus: 'trace-only',
          sourceTypes: unique(circuit.contextTrace.map((entry) => entry.sourceType).filter(Boolean)).slice(0, 20),
          warnings: []
        }
      : undefined;
  }
  return {
    coverageStatus: boundedText(coverage.status || 'unknown', 80),
    score: Number.isFinite(coverage.score) ? coverage.score : undefined,
    sourceTypes: unique([...(coverage.presentSourceTypes || []), ...(coverage.requiredSourceTypes || [])]).slice(0, 20),
    warnings: (coverage.warnings || []).slice(0, 20).map((warning) => boundedText(warning, 500, ''))
  };
}

function summaryFromMarkdown(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('_'));
}

function boundedText(value, maxLength, fallback = 'Untitled') {
  const redacted = redactShareText(value || fallback).replace(/\s+/g, ' ').trim();
  return redacted.length > maxLength ? `${redacted.slice(0, Math.max(0, maxLength - 1)).trim()}…` : redacted;
}

function sanitizeShareValue(value) {
  if (typeof value === 'string') {
    return redactShareText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeShareValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['agentEvents', 'chatMessages', 'rawMessages', 'contextTrace'].includes(key))
        .map(([key, entryValue]) => [key, sanitizeShareValue(entryValue)])
    );
  }
  return value;
}

function pruneUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, pruneUndefined(entryValue)])
    );
  }
  return value;
}

function unique(values) {
  return [...new Set(values)];
}
