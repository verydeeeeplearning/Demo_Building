// Pure student-facing decision mapping (PLAN_react_routing_and_clean_chat Phase 5).
//
// The agent/runtime emits internal events — tool calls (validate_circuit_spec, build_netlist, …),
// coordinator notes, validation gates. The chat thread must NOT dump these raw: internal tool-call
// events are dropped, duplicates are collapsed, and a conversational (chat) reply shows none at all.
// Extracted from src/main.js so it can be unit-tested without the three.js / DOM app shell.

// Internal tool names the runtime may surface as events — never shown to students as "decisions".
const INTERNAL_TOOL_NAMES = new Set([
  'assess_request_scope',
  'load_context_index',
  'read_context_doc',
  'search_part_capabilities',
  'load_support_bundle_evidence',
  'validate_circuit_spec',
  'build_netlist',
  'estimate_current_paths',
  'detect_faults',
  'compile_render_plan',
  'compile_simulation_plan',
  'compile_requirement_markdown'
]);

/** True for raw internal tool-call events that should never reach the student decision panel. */
export function isInternalToolEvent(event) {
  if (!event) {
    return true;
  }
  if (event.type === 'tool') {
    return true;
  }
  return INTERNAL_TOOL_NAMES.has(String(event.name || ''));
}

/** A conversational reply has no "확정된 조건"; otherwise map events to a few clean decision rows. */
export function decisionsForResult(result, locale = 'ko') {
  if (result?.responseKind === 'chat') {
    return [];
  }
  return agentEventsToDecisions(result?.agentEvents || [], locale);
}

export function agentEventsToDecisions(events, locale = 'ko') {
  const seenLabels = new Set();
  return (Array.isArray(events) ? events : [])
    .filter((event) => !isInternalToolEvent(event))
    .map((event) => ({
      id: event.name,
      label: studentFacingEventLabel(event.name, locale),
      value: studentFacingEventSummary(event.summary || event.status, locale),
      status: event.status === 'error' ? 'warning' : 'locked'
    }))
    .filter((decision) => {
      // Collapse duplicate rows (e.g. two coordinator events both labelled "요청 정리").
      if (seenLabels.has(decision.label)) {
        return false;
      }
      seenLabels.add(decision.label);
      return true;
    })
    .slice(0, 6);
}

export function studentFacingEventLabel(name, locale) {
  const key = String(name || '').toLowerCase();
  const labels = {
    ko: [
      [/context[-_ ]?support[-_ ]?gap|support[-_ ]?gap/, '지원 준비 확인'],
      [/safety/, '안전 확인'],
      [/unsupported|support/, '지원 범위 확인'],
      [/intent/, '요구사항 확인'],
      [/validator|validation|constraint/, '회로 검토'],
      [/simulation/, '시뮬레이션 확인'],
      [/render|visual/, '화면 준비'],
      [/context|retriever|trace/, '참고 자료 확인'],
      [/coordinator|deepagents|agent/, '요청 정리']
    ],
    en: [
      [/context[-_ ]?support[-_ ]?gap|support[-_ ]?gap/, 'Support readiness check'],
      [/safety/, 'Safety check'],
      [/unsupported|support/, 'Support check'],
      [/intent/, 'Requirement check'],
      [/validator|validation|constraint/, 'Circuit review'],
      [/simulation/, 'Simulation check'],
      [/render|visual/, 'View preparation'],
      [/context|retriever|trace/, 'Reference check'],
      [/coordinator|deepagents|agent/, 'Request review']
    ]
  };

  const match = labels[locale === 'ko' ? 'ko' : 'en'].find(([pattern]) => pattern.test(key));
  if (match) {
    return match[1];
  }

  return key
    .replaceAll('-', ' ')
    .replace(/\b(deepagents?|agent|coordinator|subagent|tool)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || (locale === 'ko' ? '확인' : 'Check');
}

export function studentFacingEventSummary(summary, locale) {
  const raw = String(summary || '').trim();
  if (!raw) {
    return locale === 'ko' ? '확인했습니다.' : 'Checked.';
  }

  // Internal route labels must never leak into the student panel.
  if (/^(synthesize_circuit|clarify_requirements|unsupported_or_gap|casual_chat)\b/i.test(raw)) {
    return locale === 'ko'
      ? '요청을 검토하고 회로로 만들 수 있는지 확인했습니다.'
      : 'Reviewed whether the request can become a circuit.';
  }

  if (/context[-_ ]?support[-_ ]?gap|canonical context|valid synthesis|planned capability|part[-_ ]?capability|render[-_ ]?footprint|simulation[-_ ]?primitive|context coverage|support gap|support bundle|verified support data/i.test(raw)) {
    return locale === 'ko'
      ? '아직 검증 자료가 부족해 회로를 만들기 전에 지원 범위를 확인했습니다.'
      : 'Checked that this request needs more verified context before circuit synthesis.';
  }

  if (/blocked|degraded|hard gate|cannot proceed|strict .*gate/i.test(raw)) {
    return locale === 'ko'
      ? '안전하게 볼 수 있도록 장면을 자동으로 검토 상태로 조정했습니다.'
      : 'Automatically adjusted the scene into a safe review state.';
  }

  if (/structured circuit draft|deepagents|coordinator|subagent|tool call|trace|stack/i.test(raw)) {
    return locale === 'ko'
      ? '요청을 검토하고 회로로 만들 수 있는지 확인했습니다.'
      : 'Reviewed whether the request can become a circuit.';
  }

  return raw
    .replace(/\bDeepagents?\b/g, 'AI')
    .replace(/\b(coordinator|subagent|tool call|trace)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
