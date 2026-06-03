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
  assert.equal(t('solverGate.diagnosticTitle'), '3D 진단 시뮬레이션');
  assert.equal(t('solverGate.diagnosticTitle', {}, 'en'), '3D diagnostic simulation');
  assert.equal(t('solverGate.safeEquivalentTitle'), '안전한 대체 시뮬레이션');
  assert.equal(t('solverGate.safeEquivalentTitle', {}, 'en'), 'Safe equivalent simulation');
  assert.equal(t('solverGate.adjustment.diagnostic_simulation.label'), '검토용 3D 진단');
  assert.equal(t('solverGate.adjustment.diagnostic_simulation.title', {}, 'en'), '3D diagnostic review scene');
  assert.equal(t('solverGate.adjustment.placeholder_part_simulation.label'), '자리 맞춤 중');
  assert.equal(t('solverGate.adjustment.placeholder_part_simulation.body', {}, 'en'), 'The scene uses safe generic geometry for parts that still need exact footprint review.');
  assert.equal(t('solverGate.adjustment.safe_equivalent_simulation.label'), '안전 대체 회로');
  assert.equal(t('solverGate.adjustment.safe_equivalent_simulation.body', {}, 'en'), 'The original request is replaced with a safe low-voltage circuit, and claims apply only to the displayed equivalent.');
  assert.equal(t('solverGate.adjustment.state_only.title'), '상태 확인 3D 진단 시뮬레이션');
  assert.equal(t('solverGate.adjustment.state_only.body', {}, 'en'), 'The scene shows useful board, pin, layout, or output state for inspection while current animation stays off.');
  assert.equal(t('solverGate.claimScope.displayed_equivalent'), '표시된 안전 대체 회로 기준으로만 조립 가능 여부를 검토합니다.');
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
  assert.equal(t('publicShare.adjustment.diagnostic_simulation.label'), '검토용 3D 진단 가능');
  assert.equal(t('publicShare.adjustment.placeholder_part_simulation.label', {}, 'en'), 'Adjusted placeholder available');
  assert.equal(t('publicShare.adjustment.safe_equivalent_simulation.body'), '원래 요청 대신 안전한 대체 회로를 보여줍니다.');
  assert.equal(t('publicShare.adjustment.state_only.body', {}, 'en'), 'A static state and layout scene is available for inspection.');
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
    assert.equal(t('topbar.actions.share'), 'Share');
    assert.equal(setLocale('ko'), 'ko');
    assert.equal(values.get(LOCALE_STORAGE_KEY), 'ko');
    assert.equal(t('topbar.actions.share'), '공유');
  } finally {
    if (originalStorage) {
      globalThis.localStorage = originalStorage;
    } else {
      delete globalThis.localStorage;
    }
  }
});
