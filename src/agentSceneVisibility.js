// Pure agent-result scene-visibility predicates (PLAN_intent_gate.md US-4).
//
// A front-intent-gate conversational reply (responseKind === 'chat') carries a placeholder circuit
// that must NEVER be rendered as a 3D scene — the student just gets the message in the chat thread.
// These predicates are dependency-free so they unit-test without the three.js / DOM app shell.

/** True when the agent result is a conversational reply rather than a circuit. */
export function isChatResult(result) {
  return result?.responseKind === 'chat';
}

/**
 * Decides whether an agent result should reveal the 3D scene, from the result shape alone.
 * The solver-gate visible-scene decision stays in the app shell and is passed in as `solverGateVisible`.
 * Chat replies always hide the scene; otherwise a scene shows when the render plan has parts.
 */
export function canShowAgentSceneFromResult(result, solverGateVisible = false) {
  if (isChatResult(result)) {
    return false;
  }
  if (solverGateVisible) {
    return true;
  }
  return Array.isArray(result?.renderPlan?.parts) && result.renderPlan.parts.length > 0;
}
