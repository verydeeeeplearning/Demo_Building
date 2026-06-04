export function buildTutorRequestKey({ target, artifactVersion, locale, sequence }) {
  return [
    target?.id || 'target:none',
    Number.isFinite(artifactVersion) ? artifactVersion : 0,
    locale || 'ko',
    Number.isFinite(sequence) ? sequence : 0
  ].join('|');
}

export function isFreshTutorResponse(requestKey, current) {
  return requestKey === buildTutorRequestKey(current);
}
