import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCALE_STORAGE_KEY,
  getLocale,
  normalizeLocale,
  setLocale,
  t
} from '../../src/i18n.js';

test('i18n defaults to Korean and falls back to English only for missing keys', () => {
  assert.equal(getLocale(), 'ko');
  assert.equal(t('topbar.actions.run'), '실행');
  assert.equal(t('topbar.actions.run', {}, 'en'), 'Run');
  assert.equal(t('evidence.contextCoverage'), '참고 자료 확인');
  assert.equal(t('evidence.contextCoverage', {}, 'en'), 'Context coverage');
  assert.equal(t('evidence.synthesisEligibility', {}, 'en'), 'Circuit synthesis');
  assert.equal(t('evidence.responseCoverage', {}, 'en'), 'Response coverage');
  assert.equal(t('evidence.purpose.valid_circuit_synthesis', {}, 'en'), 'valid circuit synthesis');
  assert.equal(t('evidence.eligibility.eligible', {}, 'en'), 'eligible');
  assert.equal(t('evidence.eligibility.ineligible', {}, 'en'), 'not eligible');
  assert.equal(t('evidence.contextSources'), '참고한 자료');
  assert.equal(t('evidence.simulationBasis'), '동작 확인 기준');
  assert.equal(t('evidence.validationWarnings', {}, 'en'), 'Validation warnings');
  assert.equal(t('simulationControls.play'), '전류 보기');
  assert.equal(t('simulationControls.pause'), '일시정지');
  assert.equal(t('simulationControls.step', {}, 'en'), 'Step through');
  assert.equal(t('simulationControls.selectedPath', {}, 'en'), 'Selected flow');
  assert.equal(t('files.explorerKicker'), '프로젝트 문서');
  assert.equal(t('inspector.kicker'), '회로 설명');
  assert.equal(t('inspector.partsTitle'), '부품함');
  assert.equal(t('inspector.chatTitle'), '회로에 대해 물어보기');
  assert.equal(t('inspector.chatToggleOpen'), '회로 질문');
  assert.equal(t('inspector.currentSelection'), '현재 선택');
  assert.equal(t('inspector.targetSelectorTitle'), '연결 선택');
  assert.equal(t('inspector.hardwareTitle', {}, 'en'), 'Hardware');
  assert.equal(t('inspector.connectionsTitle', {}, 'en'), 'Connections');
  assert.equal(t('inspector.targetSelectorTitle', {}, 'en'), 'Select a connection');
  assert.equal(t('inspector.chatToggleOpen', {}, 'en'), 'Ask');
  assert.equal(t('inspector.openChat', {}, 'en'), 'Ask about this part');
  assert.equal(t('inspector.closeChat', {}, 'en'), 'Close');
  assert.equal(t('inspector.emptyChat', {}, 'en'), 'Ask a question. Answers use the selected part or connection.');
  assert.equal(t('share.createLink'), '공개 링크 만들기');
  assert.equal(t('share.downloadCard'), '이미지 저장');
  assert.equal(t('share.downloadJson', {}, 'en'), 'Download JSON');
  assert.equal(t('publicShare.import'), '이 회로에서 시작');
  assert.equal(t('publicShare.import', {}, 'en'), 'Start from this circuit');
  assert.equal(t('publicShare.simulationAvailable'), '시뮬레이션 가능');
  assert.equal(t('publicShare.simulationAvailable', {}, 'en'), 'Simulation available');
  assert.equal(t('does.not.exist'), 'does.not.exist');
});

test('i18n normalizes unsupported locale values safely', () => {
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('ko'), 'ko');
  assert.equal(normalizeLocale('EN'), 'en');
  assert.equal(normalizeLocale('fr'), 'ko');
  assert.equal(normalizeLocale(null), 'ko');
});

test('setLocale persists the selected language when localStorage is available', () => {
  const values = new Map();
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  try {
    assert.equal(setLocale('en'), 'en');
    assert.equal(values.get(LOCALE_STORAGE_KEY), 'en');
    assert.equal(t('topbar.actions.demo'), 'Demo');
    assert.equal(setLocale('ko'), 'ko');
    assert.equal(values.get(LOCALE_STORAGE_KEY), 'ko');
    assert.equal(t('topbar.actions.demo'), '데모');
  } finally {
    if (originalStorage) {
      globalThis.localStorage = originalStorage;
    } else {
      delete globalThis.localStorage;
    }
  }
});
