import { answerTutorQuestion } from './circuitInspector.js';

const SERVER_OPT_IN_KEY = 'hEduwareAgentServer';
// Same-origin in the production build (served by the agent server); the local
// standalone server only in dev.
const TUTOR_PATH = '/api/agent/explain-target';
const DEFAULT_ENDPOINT = import.meta.env?.PROD
  ? TUTOR_PATH
  : `http://127.0.0.1:8787${TUTOR_PATH}`;

export async function askCircuitTutor({ circuit, target, question, locale, running }) {
  if (shouldUseAgentServer()) {
    try {
      const response = await fetch(DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale,
          question,
          running,
          circuitTitle: circuit.title,
          selectedTarget: target,
          target,
          artifacts: {
            circuitSpec: circuit.circuitSpec,
            validationReport: circuit.validationReport,
            simulationPlan: circuit.simulationPlan,
            contextCoverage: circuit.contextCoverage,
            buildRunnableReport: circuit.buildRunnableReport,
            solverGateResult: circuit.solverGateResult,
            contextTrace: circuit.contextTrace || []
          }
        })
      });

      if (response.ok) {
        return parseTutorResponse(await response.json());
      }
      throw new Error(`tutor server returned ${response.status}`);
    } catch (error) {
      return {
        ...localTutorResponse({ circuit, target, question, locale, running }),
        servingStatus: 'live_tutor_fallback',
        fallbackReason: redactTutorFallbackReason(error)
      };
    }
  }

  return localTutorResponse({ circuit, target, question, locale, running });
}

function localTutorResponse({ circuit, target, question, locale, running }) {
  return {
    ...answerTutorQuestion({ circuit, target, question, locale, running }),
    mode: 'local',
    servingStatus: 'local_tutor_answer'
  };
}

function parseTutorResponse(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('malformed tutor response');
  }
  if (!['local', 'live'].includes(value.mode)) {
    throw new Error('malformed tutor response mode');
  }
  if (typeof value.message !== 'string' || value.message.trim().length === 0) {
    throw new Error('malformed tutor response message');
  }
  if (
    value.servingStatus !== undefined
    && !['local_tutor_answer', 'live_tutor_answer', 'live_tutor_fallback'].includes(value.servingStatus)
  ) {
    throw new Error('malformed tutor response serving status');
  }
  if (value.fallbackReason !== undefined && typeof value.fallbackReason !== 'string') {
    throw new Error('malformed tutor response fallback reason');
  }
  if (typeof value.fallbackReason === 'string' && value.fallbackReason.length > 240) {
    throw new Error('malformed tutor response fallback reason');
  }
  if (value.suggestedQuestions !== undefined && !isStringArray(value.suggestedQuestions)) {
    throw new Error('malformed tutor response suggested questions');
  }
  if (value.grounding !== undefined && !isStringArray(value.grounding)) {
    throw new Error('malformed tutor response grounding');
  }
  return {
    ...value,
    message: value.message.trim(),
    fallbackReason: typeof value.fallbackReason === 'string'
      ? redactTutorFallbackReason(value.fallbackReason)
      : value.fallbackReason,
    suggestedQuestions: value.suggestedQuestions ?? [],
    grounding: value.grounding ?? []
  };
}

function redactTutorFallbackReason(error) {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : 'server unavailable';
  const sanitized = raw
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL/g, '[redacted-config]')
    .slice(0, 180);
  if (/^malformed tutor response/i.test(sanitized)) {
    return sanitized;
  }
  if (/^tutor server returned \d+/i.test(sanitized)) {
    return sanitized;
  }
  return sanitized.includes('[redacted')
    ? 'tutor server unavailable [redacted]'
    : 'tutor server unavailable';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function shouldUseAgentServer() {
  try {
    return globalThis.localStorage?.getItem(SERVER_OPT_IN_KEY) === 'enabled';
  } catch (error) {
    return false;
  }
}
