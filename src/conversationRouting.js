export function classifyStudentTurn(message, context = {}) {
  const text = normalizeTurnText(message);
  const hasBuildableDraft = Boolean(context.hasBuildableDraft);
  const hasCurrentArtifact = Boolean(context.hasCurrentArtifact);

  if (hasBuildableDraft && isNaturalConfirmation(message)) {
    return { route: 'confirm-current-draft', reason: 'natural-confirmation' };
  }

  if (hasCurrentArtifact && isRevisionRequest(message)) {
    return { route: 'revise-current-draft', reason: 'artifact-revision' };
  }

  if (hasCurrentArtifact && isCurrentArtifactQuestion(message)) {
    return { route: 'current-artifact-question', reason: 'artifact-grounded-question' };
  }

  if (isGeneralChat(message)) {
    return { route: 'general-chat', reason: 'social-or-meta-chat' };
  }

  return { route: 'synthesize-or-clarify', reason: 'new-or-ambiguous-design' };
}

export function normalizeTurnText(message) {
  return String(message || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?]+$/g, '');
}

export function isNaturalConfirmation(message) {
  const text = normalizeTurnText(message);
  if (!text) {
    return false;
  }

  return /^(build it|go ahead|yes|ok|okay|confirm|좋아|좋습니다|네|응|진행|구현|만들어|빌드)/i.test(text)
    || /(confirm|go ahead|build|진행|구현|만들|빌드|확인)/i.test(text);
}

export function isCurrentArtifactQuestion(message) {
  const text = normalizeTurnText(message);
  const raw = String(message || '');
  if (/\bled\b/i.test(text) && /[?？]/.test(raw) && /(wire|missing|without|없|누락|꾩|녿|\?)/i.test(raw)) {
    return true;
  }
  if (!text || /(add|change|replace|modify|revise|build|make|create|추가|변경|수정|교체|만들|구현)/i.test(text)) {
    return false;
  }
  if (/꾩꽑/.test(raw) && /(녿|없|누락)/.test(raw)) {
    return true;
  }
  const questionSignals = /(wire|connection|missing|without|current|simulation|run|why|how|what|where|전선|연결|누락|전류|시뮬레이션|동작|왜|어떻게|뭐|무엇)/i;
  const questionShape = /[?？]$/.test(raw.trim())
    || /(인가|인가요|하나요|되나요|되니|없니|뭐야|무엇이야|어디야)$/i.test(text);
  const mojibakeQuestionSignals = /(\?꾩|꾩꽑|\?곌|곌껐|\?녿|녿뒗|鍮좎쭊|\?꾨씫|\?쒕|臾댁뒯)/i;

  return (questionSignals.test(text) || mojibakeQuestionSignals.test(text))
    && (questionShape || /[?？]/.test(raw) || /(missing|without|없|누락|鍮좎쭊|\?꾨씫|녿뒗)/i.test(text));
}

export function isRevisionRequest(message) {
  const text = normalizeTurnText(message);
  if (!text) {
    return false;
  }

  return /(add|change|replace|modify|revise|추가|변경|수정|교체|바꿔|고쳐|붙여|異붽|諛붽|援먯껜|怨좎퀜|遺숈)/i.test(text);
}

export function isGeneralChat(message) {
  const text = normalizeTurnText(message);
  if (!text || hasDesignMutationSignal(text)) {
    return false;
  }

  return /^(thanks|thank you|thx|hello|hi|hey|ok thanks|okay thanks|what can i ask next|what can you do|help|고마워|감사|안녕|안녕하세요|뭘 물어볼 수 있어)/i.test(text);
}

export function isCircuitModificationRequest(message) {
  return isRevisionRequest(message);
}

function hasDesignMutationSignal(text) {
  return /(add|change|replace|modify|revise|build|make|create|wire|connect|show|display|sensor|button|buzzer|led|oled|motor|servo|relay|추가|변경|수정|교체|만들|구현|연결|표시)/i.test(text);
}
