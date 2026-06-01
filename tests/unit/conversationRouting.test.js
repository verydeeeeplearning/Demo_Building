import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyStudentTurn,
  isCurrentArtifactQuestion,
  isNaturalConfirmation,
  isRevisionRequest
} from '../../src/conversationRouting.js';

test('natural Korean confirmation routes to current draft build when a buildable draft exists', () => {
  assert.equal(isNaturalConfirmation('좋아 구현 부탁해'), true);
  assert.deepEqual(
    classifyStudentTurn('좋아 구현 부탁해', {
      hasBuildableDraft: true,
      hasCurrentArtifact: true
    }),
    { route: 'confirm-current-draft', reason: 'natural-confirmation' }
  );
});

test('current circuit wiring questions route to artifact-grounded QA', () => {
  assert.equal(isCurrentArtifactQuestion('전선 연결이 안되도 상관없니?'), true);
  assert.deepEqual(
    classifyStudentTurn('전선 연결이 안되도 상관없니?', {
      hasBuildableDraft: true,
      hasCurrentArtifact: true
    }),
    { route: 'current-artifact-question', reason: 'artifact-grounded-question' }
  );
});

test('student critique about missing wires still routes to artifact-grounded QA', () => {
  const message = '너가 만들어준 LED 깜빡이기 회로 시뮬레이션에는 전선이 없는데?';

  assert.equal(isCurrentArtifactQuestion(message), true);
  assert.deepEqual(
    classifyStudentTurn(message, {
      hasBuildableDraft: false,
      hasCurrentArtifact: true
    }),
    { route: 'current-artifact-question', reason: 'artifact-grounded-question' }
  );
});

test('revision requests remain synthesis or revision work, not tutor QA', () => {
  assert.equal(isRevisionRequest('LED 옆에 버튼도 추가해줘'), true);
  assert.deepEqual(
    classifyStudentTurn('LED 옆에 버튼도 추가해줘', {
      hasBuildableDraft: true,
      hasCurrentArtifact: true
    }),
    { route: 'revise-current-draft', reason: 'artifact-revision' }
  );
});

test('ambiguous first turn stays on synthesize-or-clarify route', () => {
  assert.deepEqual(
    classifyStudentTurn('새로운 회로를 구축하고 싶은데', {
      hasBuildableDraft: false,
      hasCurrentArtifact: false
    }),
    { route: 'synthesize-or-clarify', reason: 'new-or-ambiguous-design' }
  );
});
