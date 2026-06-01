export function classifyStudentTurn(message, context = {}) {
  const text = normalizeTurnText(message);
  const hasBuildableDraft = Boolean(context.hasBuildableDraft);
  const hasCurrentArtifact = Boolean(context.hasCurrentArtifact);

  if (hasBuildableDraft && isNaturalConfirmation(text)) {
    return { route: 'confirm-current-draft', reason: 'natural-confirmation' };
  }

  if (hasCurrentArtifact && isRevisionRequest(text)) {
    return { route: 'revise-current-draft', reason: 'artifact-revision' };
  }

  if (hasCurrentArtifact && isCurrentArtifactQuestion(text)) {
    return { route: 'current-artifact-question', reason: 'artifact-grounded-question' };
  }

  return { route: 'synthesize-or-clarify', reason: 'new-or-ambiguous-design' };
}

export function normalizeTurnText(message) {
  return String(message || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?。！？]+$/g, '');
}

export function isNaturalConfirmation(message) {
  const text = normalizeTurnText(message);
  if (!text) {
    return false;
  }

  return /^(좋아|좋습니다|네|응|ㅇㅋ|오케이|확인|만들어줘|구현해줘|진행해줘|빌드해줘|build it|go ahead|yes|ok|okay|confirm)/i.test(text)
    || /(좋아|확인|그렇게|그걸로|이대로).*(구현|만들|진행|빌드|해줘|부탁)/i.test(text)
    || /(구현|만들|진행|빌드).*(부탁|해줘|해줘요|해주세요)/i.test(text);
}

export function isCurrentArtifactQuestion(message) {
  const text = normalizeTurnText(message);
  if (!text) {
    return false;
  }

  const questionSignals = /(괜찮|상관없|어떻게|왜|무슨|뭐|빠진|없는데|누락|연결|전선|와이어|wire|connection|missing|without|current|전류|시뮬레이션|simulation|동작|작동)/i;
  const questionShape = /[?？]$/.test(String(message || '').trim()) || /(니|나요|까요|해요|되나요|되니|있나|뭔가|뭐야)$/i.test(text);
  const designRequestSignals = /(만들어줘|구축|새로운|추가해줘|바꿔줘|수정해줘|교체|replace|add|change|make|build|modify)/i;

  return questionSignals.test(text) && (questionShape || /없는데|빠진|누락|missing|without/i.test(text)) && !designRequestSignals.test(text);
}

export function isRevisionRequest(message) {
  const text = normalizeTurnText(message);
  if (!text) {
    return false;
  }

  return /(추가해줘|추가|바꿔줘|변경|수정|고쳐|교체|대신|옆에|붙여|add|change|replace|modify|revise)/i.test(text);
}
