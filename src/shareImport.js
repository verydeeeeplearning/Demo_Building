import { t } from './i18n.js';

export function projectFromShareSnapshot(snapshot, locale = 'ko') {
  const renderPlan = snapshot.renderPlan || {};
  const buildReadyShare = isBuildReadyShare(snapshot);
  const visibleReviewShare = isVisibleReviewShare(snapshot);
  const renderableShare = buildReadyShare || visibleReviewShare;
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
                : visibleReviewShare
                  ? locale === 'ko'
                    ? '공유 장면은 자동 검토 상태로 열립니다.'
                    : 'Shared snapshot opens as an automatic review scene.'
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
    return isVisibleReviewShare(snapshot)
      ? reviewShareRequirementMarkdown(snapshot, locale)
      : blockedShareRequirementMarkdown(snapshot, locale);
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
  const gate = snapshot.solverGateResult;
  if (gate?.controls || gate?.buildReadyScope) {
    return snapshot.status === 'valid'
      && snapshot.validation?.status === 'valid'
      && snapshot.simulation?.available === true
      && shareRunEnabled(gate)
      && shareCurrentAnimationEnabled(gate);
  }
  return snapshot.status === 'valid'
    && snapshot.validation?.status === 'valid'
    && snapshot.simulation?.available === true
    && runnableGateAllowsShare(snapshot.buildRunnableReport, snapshot.source);
}

function isVisibleReviewShare(snapshot) {
  const gate = snapshot.solverGateResult || {};
  const explicitKind = normalizeAdjustmentKind(gate.presentationAdjustment?.kind || gate.mode);
  return (gate.visibleSimulation === true || isReviewAdjustmentKind(explicitKind))
    && !isBuildReadyShare(snapshot)
    && Array.isArray(snapshot.renderPlan?.parts)
    && snapshot.renderPlan.parts.length > 0;
}

function runnableGateAllowsShare(report, source = 'agent') {
  if (report) {
    return report.runnable === true;
  }
  return source === 'demo';
}

function shareRunEnabled(gate = {}) {
  if (gate.buildReadyScope === 'none') {
    return false;
  }
  if (gate.controls && typeof gate.controls.runEnabled === 'boolean') {
    return gate.controls.runEnabled === true;
  }
  if (gate.buildReadyScope === 'displayed_equivalent') {
    return gate.presentationAdjustment?.displayedEquivalentBuildReady === true
      || gate.buildReady === true;
  }
  return gate.buildReady === true;
}

function shareCurrentAnimationEnabled(gate = {}) {
  if (gate.buildReadyScope === 'none') {
    return false;
  }
  if (gate.controls && typeof gate.controls.currentAnimationEnabled === 'boolean') {
    return gate.controls.currentAnimationEnabled === true;
  }
  if (gate.controls && typeof gate.controls.runEnabled === 'boolean') {
    return gate.controls.runEnabled === true;
  }
  return shareRunEnabled(gate);
}

function shareAdjustmentKind(gate = {}) {
  const explicitKind = normalizeAdjustmentKind(gate.presentationAdjustment?.kind || gate.mode);
  if (isReviewAdjustmentKind(explicitKind)) {
    return explicitKind;
  }
  return normalizeAdjustmentKind(gate.simulationActivity) === 'state_only'
    ? 'state_only'
    : 'diagnostic_simulation';
}

function normalizeAdjustmentKind(kind) {
  const value = String(kind || '').trim();
  if (value === 'diagnostic') return 'diagnostic_simulation';
  if (value === 'placeholder') return 'placeholder_part_simulation';
  if (value === 'safe_equivalent') return 'safe_equivalent_simulation';
  if ([
    'diagnostic_simulation',
    'placeholder_part_simulation',
    'safe_equivalent_simulation',
    'state_only'
  ].includes(value)) {
    return value;
  }
  return '';
}

function isReviewAdjustmentKind(kind) {
  return [
    'diagnostic_simulation',
    'placeholder_part_simulation',
    'safe_equivalent_simulation',
    'state_only'
  ].includes(kind);
}

function shareAdjustmentLabel(kind, locale) {
  return t(`publicShare.adjustment.${kind}.label`, {}, locale);
}

function studentFacingShareReviewNote(reason, locale = 'ko') {
  const raw = String(reason || '').trim();
  if (!raw) {
    return locale === 'en'
      ? 'Automatic review is still checking this scene.'
      : '자동 검토가 이 장면을 확인하고 있습니다.';
  }
  if (/unsafe|mains|high[- ]?voltage|220V|outlet/i.test(raw)) {
    return locale === 'en'
      ? 'The original unsafe request is replaced with a safe low-voltage view.'
      : '원래 위험한 요청 대신 안전한 저전압 보기로 바꾸었습니다.';
  }
  if (/current[- ]?flow|current or signal path|validated current|signal path/i.test(raw)) {
    return locale === 'en'
      ? 'Current-flow controls wait for a checked path.'
      : '확인된 경로가 준비될 때까지 전류 흐름 조작은 꺼져 있습니다.';
  }
  if (/blocked|degraded|hard gate|cannot proceed|diagnostic render|render is diagnostic only/i.test(raw)) {
    return locale === 'en'
      ? 'The scene was automatically adjusted into a safe review state.'
      : '안전하게 볼 수 있도록 장면을 자동으로 검토 상태로 조정했습니다.';
  }
  if (/validation status is unsupported|context[-_ ]?support[-_ ]?gap|canonical context|valid synthesis|support bundle|part[-_ ]?capability|verified support data|simulation[-_ ]?primitive|unsupported/i.test(raw)) {
    return locale === 'en'
      ? 'More verified reference data is needed before this can be finalized.'
      : '회로로 확정하기 전에 검증 자료가 더 필요합니다.';
  }
  if (/build[- ]?ready|runnable|build-ready claim/i.test(raw)) {
    return locale === 'en'
      ? 'Assembly-ready status still needs review.'
      : '조립 가능 상태로 표시하려면 추가 검토가 필요합니다.';
  }
  return raw;
}

function invalidShareRenderWarnings(snapshot, locale = 'ko') {
  const visibleReview = isVisibleReviewShare(snapshot);
  const reviewKind = shareAdjustmentKind(snapshot.solverGateResult);
  const warnings = [
    ...(snapshot.validation?.warnings || []),
    ...(snapshot.validation?.unsupportedItems || []),
    ...(snapshot.buildRunnableReport?.runnable === false ? snapshot.buildRunnableReport.reasons || [] : [])
  ];
  const detail = warnings.length > 0
    ? ` ${warnings.map((warning) => studentFacingShareReviewNote(warning, locale)).join(' ')}`
    : '';

  if (locale === 'en') {
    return [{
      code: 'SHARED_SNAPSHOT_NOT_BUILD_READY',
      componentId: 'shared-snapshot',
      message: visibleReview
        ? `This shared snapshot was automatically adjusted to a ${shareAdjustmentLabel(reviewKind, locale)} scene. The 3D scene stays visible for review; Run and current-flow controls stay off until the checked scope is ready.${detail}`
        : `This shared snapshot is not validated as a build-ready PCB circuit, so parts, wiring, and current-flow simulation are hidden until it is reviewed.${detail}`
    }];
  }

  return [{
    code: 'SHARED_SNAPSHOT_NOT_BUILD_READY',
    componentId: 'shared-snapshot',
    message: visibleReview
      ? `이 공유 회로는 ${shareAdjustmentLabel(reviewKind, locale)} 장면으로 자동 조정되었습니다. 3D 장면은 검토용으로 계속 보이며, 확인된 범위가 준비될 때까지 실행과 전류 흐름 조작은 꺼져 있습니다.${detail}`
      : `이 공유 회로는 조립 가능한 PCB 회로로 검증되지 않아, 검토가 끝날 때까지 부품, 배선, 전류 흐름 시뮬레이션을 표시하지 않습니다.${detail}`
  }];
}

function reviewShareRequirementMarkdown(snapshot, locale = 'ko') {
  const title = snapshot.title || 'Shared H-eduware circuit';
  const reviewKind = shareAdjustmentKind(snapshot.solverGateResult);
  const warnings = [
    ...(snapshot.validation?.warnings || []),
    ...(snapshot.validation?.unsupportedItems || []),
    ...(snapshot.buildRunnableReport?.runnable === false ? snapshot.buildRunnableReport.reasons || [] : [])
  ];
  const warningLines = warnings.length > 0
    ? warnings.map((warning) => `- ${studentFacingShareReviewNote(warning, locale)}`).join('\n')
    : locale === 'en'
      ? '- Automatic review is still checking the assembly and current-flow scope.'
      : '- 자동 검토가 조립과 전류 흐름 범위를 확인하고 있습니다.';

  if (locale === 'en') {
    return `# ${title}

This shared circuit opens as a ${shareAdjustmentLabel(reviewKind, locale)} scene. The hardware view remains visible for review, and Run/current-flow controls stay within the checked scope.

## Review Notes

${warningLines}
`;
  }

  return `# ${title}

이 공유 회로는 ${shareAdjustmentLabel(reviewKind, locale)} 장면으로 열립니다. 하드웨어 보기는 검토용으로 계속 보이며, 실행과 전류 흐름 조작은 확인된 범위 안에서만 켜집니다.

## 검토 메모

${warningLines}
`;
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
