// Deterministic, offline interview engine for the left AI panel.
//
// The product loop is: the student types a vague idea, the assistant interviews
// them with short questions, and each answer locks a design decision. This
// module is the pure state machine behind that loop. It runs fully offline
// (no network, no secrets) so the default test harness is reliable; a live
// model could later replace the canned question/answer text without changing
// the shape of the state.
//
// The demo path is preserved exactly, but copy is locale-aware so the same
// state machine can drive both Korean default UI and English fallback UI.

import { getLocale, t } from './i18n.js';

export const INTERVIEW_QUESTION = t('interview.questions.content', {}, 'ko');

// Ordered decision points. `goal` and `output` are inferred from the opening
// idea; the rest are asked one question at a time.
function flow(locale = getLocale()) {
  return [
    { id: 'goal', label: t('interview.labels.goal', {}, locale), kind: 'inferred' },
    { id: 'output', label: t('interview.labels.output', {}, locale), kind: 'inferred' },
    {
      id: 'content',
      label: t('interview.labels.content', {}, locale),
      kind: 'question',
      question: t('interview.questions.content', {}, locale),
      yes: t('interview.values.eventName', {}, locale),
      no: t('interview.values.customMessage', {}, locale)
    },
    {
      id: 'controller',
      label: t('interview.labels.controller', {}, locale),
      kind: 'question',
      question: t('interview.questions.controller', {}, locale),
      yes: t('interview.values.arduinoUno', {}, locale),
      no: t('interview.values.arduinoNano', {}, locale)
    },
    {
      id: 'power',
      label: t('interview.labels.power', {}, locale),
      kind: 'question',
      question: t('interview.questions.power', {}, locale),
      yes: t('interview.values.usb5v', {}, locale),
      no: t('interview.values.external5v', {}, locale)
    }
  ];
}

const TOTAL_STEPS = flow('en').length;

export function createInterview(locale = getLocale()) {
  return {
    status: 'idle', // idle -> interviewing -> ready
    idea: '',
    decisions: [], // [{ id, label, value, status: 'locked' }]
    pendingId: null,
    messages: [
      {
        role: 'assistant',
        text: t('interview.initial', {}, locale)
      }
    ]
  };
}

function inferOutput(idea, locale) {
  const text = idea.toLowerCase();
  if (/(screen|display|oled|lcd|text|show)/.test(text)) {
    return t('interview.values.oledScreen', {}, locale);
  }
  if (/(led|light|lamp|blink)/.test(text)) {
    return t('interview.values.ledIndicator', {}, locale);
  }
  if (/(motor|spin|move|wheel|fan)/.test(text)) {
    return t('interview.values.dcMotor', {}, locale);
  }
  if (/(buzz|sound|beep|alarm|tone)/.test(text)) {
    return t('interview.values.buzzer', {}, locale);
  }
  return t('interview.values.oledScreen', {}, locale);
}

function inferGoal(idea, output, locale) {
  const trimmed = idea.trim();
  const subject = trimmed.length > 0 ? `"${trimmed}"` : 'the idea';
  return t('interview.goal', { subject, output: output.toLowerCase() }, locale);
}

function lockDecision(decisions, id, value, locale) {
  const currentFlow = flow(locale);
  const step = currentFlow.find((item) => item.id === id);
  const next = decisions.filter((decision) => decision.id !== id);
  next.push({ id, label: step.label, value, status: 'locked' });
  // keep decisions in flow order for stable rendering
  return currentFlow.map((item) => next.find((decision) => decision.id === item.id)).filter(Boolean);
}

function nextQuestionStep(decisions, locale) {
  return flow(locale).find((step) => step.kind === 'question' && !decisions.some((d) => d.id === step.id));
}

// Begins the interview from the opening idea. Locks goal + output, then asks
// the first clarifying question.
export function startInterview(state, ideaText, locale = getLocale()) {
  const idea = (ideaText || '').toString().trim();
  const output = inferOutput(idea, locale);
  let decisions = lockDecision([], 'goal', inferGoal(idea, output, locale), locale);
  decisions = lockDecision(decisions, 'output', output, locale);

  const step = nextQuestionStep(decisions, locale);
  const messages = [
    { role: 'student', text: idea },
    { role: 'assistant', text: step.question }
  ];

  return {
    ...state,
    status: 'interviewing',
    idea,
    decisions,
    pendingId: step.id,
    messages
  };
}

// Answers the current pending question. `answer` may be 'yes' / 'no' (from quick
// replies) or free text. Advances to the next question, or to the ready state
// when every decision is locked.
export function answerInterview(state, answer, locale = getLocale()) {
  if (state.status !== 'interviewing' || !state.pendingId) {
    return state;
  }

  const step = flow(locale).find((s) => s.id === state.pendingId);
  const raw = (answer || '').toString().trim();
  const normalized = raw.toLowerCase();
  const isNo = /^(no|nope|nah|n)\b/.test(normalized) || normalized === 'no';
  let value;
  if (isNo) {
    value = step.no;
  } else if (/^(yes|yep|yeah|sure|ok|okay|y)\b/.test(normalized) || normalized === '' || normalized === 'yes') {
    value = step.yes;
  } else {
    // Free-text answer becomes the decision value verbatim (trimmed, capped).
    value = raw.length > 48 ? `${raw.slice(0, 45)}...` : raw;
  }

  const decisions = lockDecision(state.decisions, step.id, value, locale);
  const messages = state.messages.concat({ role: 'student', text: raw || (isNo ? t('aiPanel.no', {}, locale) : t('aiPanel.yes', {}, locale)) });

  const nextStep = nextQuestionStep(decisions, locale);
  if (nextStep) {
    return {
      ...state,
      decisions,
      pendingId: nextStep.id,
      messages: messages.concat({ role: 'assistant', text: nextStep.question })
    };
  }

  return {
    ...state,
    status: 'ready',
    decisions,
    pendingId: null,
    messages: messages.concat({
      role: 'assistant',
      text: t('interview.ready', {}, locale),
      action: 'build-demo-circuit'
    })
  };
}

// Progress as a 0-100 integer: how many of the decision points are locked.
export function interviewProgress(state) {
  if (!state || state.status === 'idle') {
    return 0;
  }
  const locked = state.decisions.filter((decision) => decision.status === 'locked').length;
  return Math.round((Math.min(locked, TOTAL_STEPS) / TOTAL_STEPS) * 100);
}

export function isInterviewReady(state) {
  return state?.status === 'ready';
}

export function totalDecisionPoints() {
  return TOTAL_STEPS;
}
