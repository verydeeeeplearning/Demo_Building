export function renderWarningTitle(locale = 'ko') {
  return locale === 'en' ? 'Render warnings' : '화면 표시 경고';
}

export function renderWarningsMarkdown(warnings = [], locale = 'ko') {
  const title = renderWarningTitle(locale);
  const intro = locale === 'en'
    ? 'These warnings explain where the circuit is electrically validated but cannot be fully visualized yet.'
    : '전기적으로 검증된 회로라도 아직 화면에 정확히 표시하기 어려운 부분을 정리합니다.';
  const componentLabel = locale === 'en' ? 'Component' : '부품';
  const noneLabel = locale === 'en' ? '- None' : '- 없음';
  const rows = warnings.length > 0
    ? warnings.map((warning) => [
      `- **${warning.code}**`,
      `  - ${componentLabel}: ${warning.componentId || 'unknown'}`,
      `  - ${renderWarningMessage(warning, locale)}`
    ].join('\n')).join('\n')
    : noneLabel;

  return `# ${title}

${intro}

${rows}
`;
}

function renderWarningMessage(warning, locale) {
  if (locale !== 'ko') {
    return warning.message;
  }

  const messages = {
    MISSING_RENDER_FOOTPRINT: '이 부품은 전기적으로 검증되었지만 아직 화면에 표시할 3D 외형 정보가 없습니다.',
    BREADBOARD_PLACEMENT_SURFACE_MISSING: '브레드보드에 꽂아야 하는 부품인데 배치 기준이 되는 브레드보드가 없습니다.',
    BREADBOARD_PLACEMENT_OUT_OF_BOUNDS: '이 부품이 브레드보드 영역 밖에 있어 실제 조립 위치처럼 신뢰하기 어렵습니다.',
    RENDER_CONNECTION_ENDPOINT_MISSING: '연결선의 시작점이나 끝점에 화면 좌표가 없어 전선을 정확히 표시할 수 없습니다.',
    RENDER_CONNECTION_TOO_SHORT: '연결선의 양 끝이 같은 위치에 가까워 전선이 보이지 않거나 실제 배선처럼 보이지 않을 수 있습니다.',
    BREADBOARD_PIN_ROW_COLLAPSE: '여러 핀이 같은 브레드보드 줄에 겹쳐 실제 조립처럼 신뢰하기 어렵습니다.',
    BREADBOARD_PIN_GRID_MISALIGNMENT: '핀이 브레드보드 구멍 위치에 맞지 않아 실제 조립 위치처럼 신뢰하기 어렵습니다.',
    BREADBOARD_PHYSICAL_NODE_CONFLICT: '논리적으로 연결되지 않은 핀들이 같은 브레드보드 구멍에 있어 실제 회로에서는 의도치 않게 서로 연결될 수 있습니다.',
    BREADBOARD_CONTINUITY_CONFLICT: '논리적으로 연결되지 않은 핀들이 같은 브레드보드 연결 줄에 있어 실제 회로에서는 의도치 않게 서로 연결될 수 있습니다.',
    BREADBOARD_RAIL_CONFLICT: '논리적으로 연결되지 않은 핀들이 같은 브레드보드 전원 레일에 있어 실제 회로에서는 의도치 않게 서로 연결될 수 있습니다.'
  };

  return messages[warning.code] || warning.message;
}
