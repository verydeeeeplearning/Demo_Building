// Interactive narrowing (client view). On an 'awaiting_input' turn the agent paused (LangGraph
// interrupt) and returns clarificationRequest.options — grounded choices the student taps to narrow.
// Selecting an option resumes the paused server thread (resume = option.id: a category id to drill
// down, or a capabilityId to build). Framework-free + unit-testable; escapeHtml is injected.

export function clarificationOptionsForDisplay(result) {
  if (!result || result.responseKind !== 'awaiting_input') {
    return [];
  }
  const options = result.clarificationRequest?.options;
  return Array.isArray(options)
    ? options.filter((option) => option && typeof option.label === 'string' && option.label.trim().length > 0)
    : [];
}

export function clarificationQuestion(result) {
  return result?.clarificationRequest?.question ?? '';
}

// The value sent as `resume` when this option is tapped (a category id or a capabilityId).
export function resumeValueForOption(option) {
  return option?.id ?? null;
}

export function renderClarificationOptions(options, { escapeHtml }) {
  if (!options.length) {
    return '';
  }
  const buttons = options
    .map((option, index) =>
      `<button class="reply-chip clarify-chip" type="button" data-action="clarify-option" data-option-index="${index}">${escapeHtml(option.label)}</button>`
    )
    .join('');
  return `<div class="quick-replies clarify-choices" data-testid="clarify-options">${buttons}</div>`;
}
