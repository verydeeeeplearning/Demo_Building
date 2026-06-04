import { randomUUID } from 'node:crypto';

import {
  buildTutorArtifactFingerprint,
  buildTutorThreadId,
  normalizeTutorSessionId,
  targetScopeId
} from '../../shared/tutorThreadScope.js';
import type { TutorMessageRequest } from './schemas.ts';

export type ResolvedTutorThreadScope = {
  sessionId: string;
  artifactFingerprint: string;
  targetScopeId: string;
  tutorThreadId: string;
  clientArtifactFingerprintMismatch: boolean;
  clientTargetScopeIdMismatch: boolean;
};

export async function resolveTutorThreadScope(
  request: TutorMessageRequest
): Promise<ResolvedTutorThreadScope> {
  const sessionId = normalizeTutorSessionId(request.sessionId, `session-${randomUUID()}`);
  const artifactFingerprint = await buildTutorArtifactFingerprint(request.artifacts);
  const resolvedTargetScopeId = targetScopeId(request.target);

  return {
    sessionId,
    artifactFingerprint,
    targetScopeId: resolvedTargetScopeId,
    tutorThreadId: buildTutorThreadId({
      sessionId,
      artifactFingerprint,
      targetId: resolvedTargetScopeId,
      locale: request.locale
    }),
    clientArtifactFingerprintMismatch: Boolean(
      request.artifactFingerprint && request.artifactFingerprint !== artifactFingerprint
    ),
    clientTargetScopeIdMismatch: Boolean(
      request.targetScopeId && request.targetScopeId !== resolvedTargetScopeId
    )
  };
}
