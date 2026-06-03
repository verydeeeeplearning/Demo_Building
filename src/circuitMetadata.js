import { getLocale, t } from './i18n.js';

export function isLegalConnection(circuit, from, to) {
  return circuit.connections.some((connection) => {
    return (
      sameEndpoint(connection.from, from) &&
      sameEndpoint(connection.to, to)
    ) || (
      sameEndpoint(connection.from, to) &&
      sameEndpoint(connection.to, from)
    );
  });
}

function sameEndpoint(left, right) {
  return left.partId === right.partId && left.pin === right.pin;
}

export function createRequirementDocument(circuit, locale = getLocale()) {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  return {
    title: t('circuit.requirementTitle', {}, normalizedLocale),
    status: t('circuit.requirementStatus', {}, normalizedLocale),
    goal: t('circuit.goal', { runText: circuit.runText }, normalizedLocale),
    partsNeeded: t('circuit.partsNeeded', {}, normalizedLocale),
    behavior: t('circuit.behavior', { runText: circuit.runText }, normalizedLocale),
    assumptions: t('circuit.assumptions', {}, normalizedLocale),
    connections: circuit.connections.map((connection) => ({
      label: connection.education.label,
      summary: normalizedLocale === 'ko'
        ? `${connection.from.pin}을 ${connection.to.pin}에 연결합니다: ${connection.education.why}`
        : `${connection.from.pin} connects to ${connection.to.pin}: ${connection.education.why}`
    }))
  };
}

export function createRequirementMarkdown(circuit, locale = getLocale()) {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  const document = createRequirementDocument(circuit, normalizedLocale);
  const parts = document.partsNeeded.map((part) => `- ${part}`).join('\n');
  const assumptions = document.assumptions.map((assumption) => `- ${assumption}`).join('\n');
  const connections = document.connections
    .map((connection) => `- **${connection.label}**: ${connection.summary}`)
    .join('\n');
  const sections = t('circuit.sections', {}, normalizedLocale);

  return `# ${document.title}

_${t('circuit.statusLabel', {}, normalizedLocale)}: ${document.status}_

## ${sections.goal}

${document.goal}

## ${sections.parts}

${parts}

## ${sections.behavior}

${document.behavior}

## ${sections.connections}

${connections}

## ${sections.assumptions}

${assumptions}
`;
}
