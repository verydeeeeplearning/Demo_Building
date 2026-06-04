export type TutorQuestionIntent = {
  mentionedPart: string | null;
  targetPart: string | null;
  isVoltageSafetyQuestion: boolean;
  shouldRetarget: boolean;
  confidence: 'high' | 'medium' | 'none';
};

export function classifyTutorQuestionIntent(
  question: string,
  context?: { target?: Record<string, unknown> | null }
): TutorQuestionIntent;

export function isLedVoltageSafetyIntent(intent: TutorQuestionIntent | null | undefined): boolean;

export function ledVoltageSafetyAnswer(locale: 'ko' | 'en' | string): string;
