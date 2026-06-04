export function buildTutorRequestKey({ target, targetId, artifactVersion, artifactFingerprint, locale, sequence }) {
  return [
    targetId || target?.id || 'target:none',
    artifactFingerprint || `version:${Number.isFinite(artifactVersion) ? artifactVersion : 0}`,
    locale || 'ko',
    Number.isFinite(sequence) ? sequence : 0
  ].join('|');
}

export function isFreshTutorResponse(requestKey, current) {
  return requestKey === buildTutorRequestKey(current);
}
