import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INTERVIEW_QUESTION,
  createInterview,
  startInterview,
  answerInterview,
  interviewProgress,
  isInterviewReady,
  totalDecisionPoints
} from '../../src/interviewEngine.js';

test('a fresh interview starts idle at 0% progress', () => {
  const interview = createInterview();
  assert.equal(interview.status, 'idle');
  assert.equal(interview.decisions.length, 0);
  assert.equal(interviewProgress(interview), 0);
  assert.equal(isInterviewReady(interview), false);
});

test('starting from the demo idea asks the locked first question', () => {
  const interview = startInterview(createInterview(), 'show some text on a little screen');

  assert.equal(interview.status, 'interviewing');
  assert.equal(interview.messages[0].role, 'student');
  assert.equal(interview.messages[0].text, 'show some text on a little screen');
  assert.equal(interview.messages.at(-1).role, 'assistant');
  assert.equal(interview.messages.at(-1).text, INTERVIEW_QUESTION);
  assert.equal(interview.messages.at(-1).text, '화면에는 행사 이름을 표시하면 될까요?');

  // goal + output are inferred and locked immediately
  const ids = interview.decisions.map((decision) => decision.id);
  assert.deepEqual(ids, ['goal', 'output']);
  assert.equal(interview.decisions.find((d) => d.id === 'output').value, 'OLED 화면');
  assert.ok(interviewProgress(interview) > 0 && interviewProgress(interview) < 100);
});

test('answering each question advances progress to a build-ready state', () => {
  let interview = startInterview(createInterview(), 'show some text on a little screen');
  const startProgress = interviewProgress(interview);

  interview = answerInterview(interview, 'yes'); // content
  assert.ok(interviewProgress(interview) > startProgress, 'progress advances after an answer');
  assert.equal(interview.decisions.find((d) => d.id === 'content').value, '행사 이름(RALPHTON BUSAN)');

  interview = answerInterview(interview, 'yes'); // controller
  interview = answerInterview(interview, 'yes'); // power

  assert.equal(isInterviewReady(interview), true);
  assert.equal(interviewProgress(interview), 100);
  assert.equal(interview.decisions.length, totalDecisionPoints());
  assert.equal(interview.messages.at(-1).action, 'build-demo-circuit');
});

test('a "no" answer selects the alternate decision value', () => {
  let interview = startInterview(createInterview(), 'show some text on a little screen');
  interview = answerInterview(interview, 'no'); // content -> custom message
  assert.equal(interview.decisions.find((d) => d.id === 'content').value, '짧은 사용자 지정 문구');
});

test('free-text answers become the decision value', () => {
  let interview = startInterview(createInterview(), 'blink an LED');
  assert.equal(interview.decisions.find((d) => d.id === 'output').value, 'LED 표시등');
  interview = answerInterview(interview, 'show my class number');
  assert.equal(interview.decisions.find((d) => d.id === 'content').value, 'show my class number');
});

test('inference maps idea keywords to output devices', () => {
  assert.equal(
    startInterview(createInterview(), 'spin a motor').decisions.find((d) => d.id === 'output').value,
    'DC 모터'
  );
  assert.equal(
    startInterview(createInterview(), 'make a beep alarm').decisions.find((d) => d.id === 'output').value,
    '부저'
  );
});

test('English locale keeps the previous deterministic interview copy', () => {
  const interview = startInterview(createInterview('en'), 'show some text on a little screen', 'en');

  assert.equal(interview.messages.at(-1).text, 'Do you want the screen to show the event name?');
  assert.equal(interview.decisions.find((d) => d.id === 'output').value, 'OLED screen');
});
