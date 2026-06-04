export type TutorAuthoritySnapshot = Record<string, unknown>;

export function buildTutorAuthoritySnapshot(artifacts?: Record<string, unknown>): TutorAuthoritySnapshot;

export function buildTutorArtifactFingerprint(artifacts?: Record<string, unknown>): Promise<string>;

export function normalizeTutorSessionId(value: unknown, fallback?: string): string;

export function targetScopeId(target: unknown): string;

export function buildTutorThreadId(options: {
  sessionId?: string;
  artifactFingerprint?: string;
  targetId?: string;
  locale?: 'ko' | 'en' | string;
}): string;

export function encodeThreadPart(value: unknown): string;
