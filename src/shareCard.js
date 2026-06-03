import { redactShareText } from './shareSnapshot.js';

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

export function createShareCardModel(snapshot, locale = 'ko') {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  const runnable = shareRunnable(snapshot);
  const diagnosticVisible = !runnable && shareDiagnosticVisible(snapshot);
  const validation = runnable ? snapshot.validation?.status || snapshot.status || 'draft' : 'invalid';
  const parts = (snapshot.circuit?.components || [])
    .slice(0, 5)
    .map((part) => truncate(redactShareText(part.name || part.id || 'Part'), 34));

  return {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    brand: 'H-eduware',
    kicker: normalizedLocale === 'en' ? 'Shared circuit' : '공유 회로',
    title: truncate(redactShareText(snapshot.title || 'H-eduware circuit'), 72),
    summary: truncate(redactShareText(snapshot.summary || snapshot.circuit?.description || ''), 180),
    badge: badgeLabel(validation, normalizedLocale),
    parts,
    simulation: truncate(
      redactShareText(runnable && snapshot.simulation?.available
        ? snapshot.simulation.explanation
        : diagnosticVisible ? diagnosticSimulationCopy(normalizedLocale) : unavailableSimulationCopy(normalizedLocale)),
      170
    ),
    footer: footerLabel(validation, normalizedLocale)
  };
}

function shareRunnable(snapshot) {
  const report = snapshot.buildRunnableReport;
  if (report) {
    return report.runnable === true;
  }
  return false;
}

function shareDiagnosticVisible(snapshot) {
  return snapshot.solverGateResult?.visibleSimulation === true
    && snapshot.solverGateResult?.buildReady !== true
    && Array.isArray(snapshot.renderPlan?.parts)
    && snapshot.renderPlan.parts.length > 0;
}

export function renderShareCardCanvas(snapshot, locale = 'ko', canvas = document.createElement('canvas')) {
  const model = createShareCardModel(snapshot, locale);
  canvas.width = model.width;
  canvas.height = model.height;
  const context = canvas.getContext('2d');
  drawShareCard(context, model);
  return canvas;
}

export function downloadShareCard(snapshot, locale = 'ko', fileName = 'h-eduware-circuit.png') {
  const canvas = renderShareCardCanvas(snapshot, locale);
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = fileName;
  link.click();
}

function drawShareCard(context, model) {
  context.fillStyle = '#f7f3ec';
  context.fillRect(0, 0, model.width, model.height);

  context.fillStyle = '#17171d';
  roundedRect(context, 58, 58, 1084, 514, 30);
  context.fill();

  context.fillStyle = '#ee9a84';
  context.font = '700 24px Inter, Arial, sans-serif';
  context.fillText(model.brand.toUpperCase(), 94, 112);

  context.fillStyle = '#f7f3ec';
  context.font = '700 68px Inter, Arial, sans-serif';
  drawWrappedText(context, model.title, 92, 190, 760, 78, 2);

  context.fillStyle = 'rgba(247, 243, 236, 0.78)';
  context.font = '400 28px Inter, Arial, sans-serif';
  drawWrappedText(context, model.summary, 96, 330, 650, 38, 3);

  context.fillStyle = '#ee9a84';
  roundedRect(context, 94, 462, 230, 56, 28);
  context.fill();
  context.fillStyle = '#17171d';
  context.font = '700 22px Inter, Arial, sans-serif';
  context.fillText(model.badge, 122, 497);

  context.strokeStyle = 'rgba(247, 243, 236, 0.24)';
  context.lineWidth = 2;
  roundedRect(context, 790, 112, 296, 176, 20);
  context.stroke();
  context.fillStyle = '#ee9a84';
  context.font = '700 18px Inter, Arial, sans-serif';
  context.fillText('PARTS', 822, 152);
  context.fillStyle = '#f7f3ec';
  context.font = '500 22px Inter, Arial, sans-serif';
  model.parts.forEach((part, index) => {
    context.fillText(part, 822, 194 + index * 30);
  });

  context.strokeStyle = 'rgba(247, 243, 236, 0.24)';
  roundedRect(context, 790, 318, 296, 150, 20);
  context.stroke();
  context.fillStyle = '#ee9a84';
  context.font = '700 18px Inter, Arial, sans-serif';
  context.fillText('SIMULATION', 822, 358);
  context.fillStyle = 'rgba(247, 243, 236, 0.86)';
  context.font = '400 20px Inter, Arial, sans-serif';
  drawWrappedText(context, model.simulation, 822, 392, 230, 28, 3);

  context.fillStyle = 'rgba(247, 243, 236, 0.62)';
  context.font = '400 20px Inter, Arial, sans-serif';
  context.fillText(model.footer, 94, 548);
}

function badgeLabel(validation, locale) {
  if (validation === 'valid') {
    return locale === 'en' ? 'Validated' : '검증 완료';
  }
  if (validation === 'warning') {
    return locale === 'en' ? 'Warnings' : '주의 필요';
  }
  return locale === 'en' ? 'Needs review' : '검증 필요';
}

function footerLabel(validation, locale) {
  if (validation === 'valid') {
    return locale === 'en'
      ? 'Designed, validated, and shared with H-eduware'
      : 'H-eduware에서 설계하고 검증한 회로';
  }
  if (validation === 'warning') {
    return locale === 'en'
      ? 'Shared with validation warnings from H-eduware'
      : 'H-eduware에서 검증 주의 사항과 함께 공유된 회로';
  }
  return locale === 'en'
    ? 'Shared as a draft that needs review'
    : '아직 검토가 필요한 초안 회로';
}

function unavailableSimulationCopy(locale) {
  return locale === 'en'
    ? 'Simulation is not available for this shared snapshot.'
    : '이 공유 회로에는 시뮬레이션 정보가 없습니다.';
}

function diagnosticSimulationCopy(locale) {
  return locale === 'en'
    ? '3D diagnostic scene available. Run and current-flow simulation need review.'
    : '3D 진단 장면을 볼 수 있습니다. 실행과 전류 흐름은 검토가 필요합니다.';
}

function truncate(value, maxLength) {
  const text = redactShareText(value).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = word;
      if (lines >= maxLines) return;
    } else {
      line = test;
    }
  }

  if (line && lines < maxLines) {
    context.fillText(line, x, y + lines * lineHeight);
  }
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
