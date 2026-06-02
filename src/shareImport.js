export function projectFromShareSnapshot(snapshot, locale = 'ko') {
  const renderPlan = snapshot.renderPlan || {};
  const buildReadyShare = isBuildReadyShare(snapshot);
  const diagnosticVisibleShare = isVisibleDiagnosticShare(snapshot);
  const renderableShare = buildReadyShare || diagnosticVisibleShare;
  const simulationAvailable = buildReadyShare;
  const runText = simulationAvailable
    ? snapshot.simulation?.runText || renderPlan.runText || ''
    : '';
  const validationStatus = snapshot.validation?.status === 'valid'
    ? buildReadyShare ? 'valid' : 'invalid'
    : snapshot.validation?.status === 'warning' ? 'valid_with_warnings' : 'invalid';

  return {
    circuit: {
      title: snapshot.title || snapshot.circuit?.name || 'Shared H-eduware circuit',
      source: 'imported',
      runText,
      parts: renderableShare ? shareParts(snapshot) : [],
      connections: renderableShare ? shareConnections(snapshot) : [],
      floatingCards: renderableShare && Array.isArray(renderPlan.floatingCards) ? renderPlan.floatingCards : [],
      layout: renderableShare ? renderPlan.layout : undefined,
      renderWarnings: buildReadyShare ? [] : invalidShareRenderWarnings(snapshot, locale),
      buildRunnableReport: snapshot.buildRunnableReport,
      solverGateResult: snapshot.solverGateResult,
      validationReport: {
        status: validationStatus,
        errors: validationStatus === 'invalid' ? snapshot.validation?.warnings || [] : [],
        warnings: validationStatus === 'invalid' ? [] : snapshot.validation?.warnings || [],
        validatedCurrentPathIds: simulationAvailable ? ['shared-current-summary'] : []
      },
      simulationPlan: {
        status: simulationAvailable ? 'valid' : 'invalid',
        runText,
        currentPaths: [],
        expectedStates: simulationAvailable
          ? [{ componentId: 'shared-circuit', state: snapshot.simulation?.explanation || 'Shared simulation summary' }]
          : [],
        warnings: [
          ...(snapshot.validation?.warnings || []),
          ...(simulationAvailable ? [] : ['Shared snapshot does not include a runnable current-flow simulation.'])
        ]
      },
      contextCoverage: snapshot.contextEvidence
        ? {
            status: snapshot.contextEvidence.coverageStatus || 'shared',
            score: snapshot.contextEvidence.score ?? 0,
            requiredSourceTypes: snapshot.contextEvidence.sourceTypes || [],
            presentSourceTypes: snapshot.contextEvidence.sourceTypes || [],
            missingSourceTypes: [],
            warnings: snapshot.contextEvidence.warnings || [],
            sufficientFor: simulationAvailable ? ['valid_circuit_synthesis'] : [],
            synthesisEligibility: {
              status: simulationAvailable ? 'eligible' : 'ineligible',
              reason: simulationAvailable
                ? 'Shared snapshot was marked valid before import.'
                : 'Shared snapshot is a non-running draft or invalid circuit.'
            }
          }
        : undefined
    },
    files: [
      {
        id: 'shared-requirements',
        name: locale === 'ko' ? '공유된 회로 요구사항' : 'Shared circuit requirements',
        path: 'shared/share-requirements.md',
        kind: 'Markdown',
        status: locale === 'ko' ? '공유됨' : 'Shared',
        markdown: shareRequirementMarkdown(snapshot, locale)
      }
    ]
  };
}

function shareParts(snapshot) {
  const renderParts = Array.isArray(snapshot.renderPlan?.parts) ? snapshot.renderPlan.parts : [];
  if (renderParts.length > 0) {
    return renderParts.map((part) => ({
      ...part,
      label: part.label || part.name || part.id,
      description: part.description || ''
    }));
  }

  return (snapshot.circuit?.components || []).map((component) => ({
    id: component.id,
    type: component.type || 'part',
    label: component.name || component.id,
    description: component.role || snapshot.circuit?.description || '',
    pins: []
  }));
}

function shareConnections(snapshot) {
  const renderConnections = Array.isArray(snapshot.renderPlan?.connections) ? snapshot.renderPlan.connections : [];
  if (renderConnections.length > 0) {
    return renderConnections.map((connection, index) => normalizeConnection(connection, index));
  }

  return (snapshot.circuit?.connections || []).map((connection, index) => ({
    id: `shared-connection-${index + 1}`,
    from: parseEndpoint(connection.from),
    to: parseEndpoint(connection.to),
    signal: 'digital',
    color: '#2f7df6',
    education: {
      label: connection.label || 'Shared connection',
      title: connection.label || 'Shared connection',
      what: `${connection.from} -> ${connection.to}`
    }
  }));
}

function normalizeConnection(connection, index) {
  const label = readableConnectionLabel(connection.education?.label || connection.label || connection.signal, index);
  return {
    ...connection,
    id: connection.id || `shared-connection-${index + 1}`,
    from: normalizeEndpoint(connection.from),
    to: normalizeEndpoint(connection.to),
    signal: connection.signal || 'digital',
    color: connection.color || '#2f7df6',
    education: {
      label,
      title: connection.education?.title || label,
      what: connection.education?.what || `${endpointLabel(connection.from)} -> ${endpointLabel(connection.to)}`,
      why: connection.education?.why || 'Imported from a public H-eduware share snapshot.',
      missing: connection.education?.missing || 'Removing this connection may break the shared circuit behavior.'
    }
  };
}

function readableConnectionLabel(value, index) {
  const text = String(value || '').trim();
  if (!text) {
    return `Shared connection ${index + 1}`;
  }
  if (text.toLowerCase() === 'digital') {
    return 'Digital signal';
  }
  if (text.toLowerCase() === 'power') {
    return 'Power';
  }
  if (text.toLowerCase() === 'ground') {
    return 'Ground';
  }
  return text;
}

function normalizeEndpoint(endpoint = {}) {
  return {
    partId: endpoint.partId || endpoint.componentId || endpoint.id || 'unknown',
    pin: endpoint.pin || 'pin'
  };
}

function parseEndpoint(value) {
  const [partId, ...pinParts] = String(value || 'unknown:pin').split(':');
  return {
    partId: partId || 'unknown',
    pin: pinParts.join(':') || 'pin'
  };
}

function endpointLabel(endpoint = {}) {
  return `${endpoint.partId || endpoint.componentId || endpoint.id || 'unknown'}:${endpoint.pin || 'pin'}`;
}

function shareRequirementMarkdown(snapshot, locale = 'ko') {
  if (!isBuildReadyShare(snapshot)) {
    return blockedShareRequirementMarkdown(snapshot, locale);
  }

  const markdown = String(snapshot.requirementMarkdown || '').trim();
  if (markdown) {
    return markdown;
  }

  const parts = (snapshot.circuit?.components || [])
    .map((component) => `- ${component.name || component.id} (${component.type || 'part'})`)
    .join('\n') || '- No public parts listed.';

  return `# ${snapshot.title || 'Shared H-eduware circuit'}

${snapshot.summary || ''}

## Parts

${parts}

## Simulation

${snapshot.simulation?.explanation || 'No simulation summary is available.'}
`;
}

function isBuildReadyShare(snapshot) {
  return snapshot.status === 'valid'
    && snapshot.validation?.status === 'valid'
    && snapshot.simulation?.available === true
    && runnableGateAllowsShare(snapshot.buildRunnableReport, snapshot.source);
}

function isVisibleDiagnosticShare(snapshot) {
  return snapshot.solverGateResult?.visibleSimulation === true
    && snapshot.solverGateResult?.buildReady !== true
    && Array.isArray(snapshot.renderPlan?.parts)
    && snapshot.renderPlan.parts.length > 0;
}

function runnableGateAllowsShare(report, source = 'agent') {
  if (report) {
    return report.runnable === true;
  }
  return source === 'demo';
}

function invalidShareRenderWarnings(snapshot, locale = 'ko') {
  const diagnosticVisible = isVisibleDiagnosticShare(snapshot);
  const warnings = [
    ...(snapshot.validation?.warnings || []),
    ...(snapshot.validation?.unsupportedItems || []),
    ...(snapshot.buildRunnableReport?.runnable === false ? snapshot.buildRunnableReport.reasons || [] : [])
  ];
  const detail = warnings.length > 0 ? ` ${warnings.join(' ')}` : '';

  if (locale === 'en') {
    return [{
      code: 'SHARED_SNAPSHOT_NOT_BUILD_READY',
      componentId: 'shared-snapshot',
      message: diagnosticVisible
        ? `This shared snapshot is not validated as build-ready. The 3D scene is shown for diagnosis only; Run and current-flow simulation stay disabled until it is reviewed.${detail}`
        : `This shared snapshot is not validated as a build-ready PCB circuit, so parts, wiring, and current-flow simulation are hidden until it is reviewed.${detail}`
    }];
  }

  return [{
    code: 'SHARED_SNAPSHOT_NOT_BUILD_READY',
    componentId: 'shared-snapshot',
    message: diagnosticVisible
      ? `이 공유 회로는 아직 조립 가능 상태로 검증되지 않았습니다. 3D 장면은 진단용으로만 표시하며, 실행과 전류 흐름 시뮬레이션은 검토가 끝날 때까지 비활성화됩니다.${detail}`
      : `이 공유 회로는 조립 가능한 PCB 회로로 검증되지 않아, 검토가 끝날 때까지 부품, 배선, 전류 흐름 시뮬레이션을 표시하지 않습니다.${detail}`
  }];
}

function blockedShareRequirementMarkdown(snapshot, locale = 'ko') {
  const title = snapshot.title || 'Shared H-eduware circuit';
  const warnings = [
    ...(snapshot.validation?.warnings || []),
    ...(snapshot.validation?.unsupportedItems || []),
    ...(snapshot.buildRunnableReport?.runnable === false ? snapshot.buildRunnableReport.reasons || [] : []),
    ...(snapshot.simulation?.available === false ? ['Shared snapshot does not include a runnable current-flow simulation.'] : [])
  ];
  const warningLines = warnings.length > 0
    ? warnings.map((warning) => `- ${warning}`).join('\n')
    : '- Shared snapshot is not validated for build-ready wiring.';

  if (locale === 'en') {
    return `# ${title}

This shared circuit is not validated as a build-ready H-eduware circuit. It is imported as a non-running draft that needs review before assembly or current-flow simulation.

## Review Notes

${warningLines}
`;
  }

  return `# ${title}

이 공유 회로는 아직 조립 가능한 H-eduware 회로로 검증되지 않았습니다. 조립이나 전류 흐름 시뮬레이션 전에 검토가 필요한 비실행 초안으로 가져왔습니다.

## 검토 필요 사항

${warningLines}
`;
}
