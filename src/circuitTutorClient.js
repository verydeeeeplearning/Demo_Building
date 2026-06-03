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
            contextTrace: circuit.contextTrace || []
          }
        })
      });

      if (response.ok) {
        return response.json();
      }
    } catch (error) {
      // Default classroom mode is deterministic and offline; server use is opt-in.
    }
  }

  return {
    mode: 'local',
    ...answerTutorQuestion({ circuit, target, question, locale, running })
  };
}

function shouldUseAgentServer() {
  try {
    return globalThis.localStorage?.getItem(SERVER_OPT_IN_KEY) === 'enabled';
  } catch (error) {
    return false;
  }
}
