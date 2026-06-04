import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRenderPlan } from '../../server/agent/circuitTools.ts';
import { compileRenderPlan as compileSplitRenderPlan } from '../../server/agent/circuit/renderPlan.ts';
import {
  CircuitSpecSchema,
  type CircuitSpec,
  type RenderPlan,
  type ValidationReport
} from '../../server/agent/schemas.ts';

const validReport: ValidationReport = {
  version: '2026-05-31',
  status: 'valid',
  errors: [],
  warnings: [],
  validatedCurrentPathIds: [],
  sourceVersion: '2026-05-31'
};

const compilers: Array<{
  name: string;
  compile: (
    spec: CircuitSpec,
    validationReport: ValidationReport,
    options?: { locale?: 'ko' | 'en' }
  ) => Promise<RenderPlan>;
}> = [
  { name: 'public circuitTools', compile: compileRenderPlan },
  { name: 'split renderPlan', compile: compileSplitRenderPlan }
];

for (const { name, compile } of compilers) {
  test(`${name} emits Korean-first connection education for Korean render plans`, async () => {
    const renderPlan = await compile(buttonBuzzerSpecWithoutEducation(), validReport, { locale: 'ko' });
    const copy = JSON.stringify({
      connections: renderPlan.connections.map((connection) => connection.education),
      floatingCards: renderPlan.floatingCards
    });

    assert.doesNotMatch(copy, /\bThis\b|validated circuit|simulated behavior|If this wire is missing/i);
    for (const label of ['버튼 입력', 'GND 기준', '부저 출력', '공통 GND']) {
      assert.match(copy, new RegExp(label));
    }

    const buzzerDrive = renderPlan.connections.find((connection) => connection.id === 'c3');
    assert.equal(buzzerDrive?.education.label, '부저 출력');
    assert.match(buzzerDrive?.education.what ?? '', /D9/);
    assert.match(buzzerDrive?.education.what ?? '', /\+/);
    assert.match(renderPlan.floatingCards.find((card) => card.connectionId === 'c3')?.title ?? '', /부저 출력/);
  });

  test(`${name} preserves existing English fallback for English render plans`, async () => {
    const renderPlan = await compile(buttonBuzzerSpecWithoutEducation(), validReport, { locale: 'en' });
    const firstConnection = renderPlan.connections[0]?.education;

    assert.equal(firstConnection?.label, 'BUTTON INPUT');
    assert.equal(firstConnection?.title, 'This button-input connection matters');
    assert.equal(firstConnection?.why, 'The validated circuit needs this path for the lesson behavior.');
    assert.equal(firstConnection?.missing, 'If this wire is missing, the simulated behavior may not work.');
  });
}

test('Korean render plans preserve explicitly Korean education copy', async () => {
  const spec = buttonBuzzerSpecWithoutEducation();
  spec.connections[0] = {
    ...spec.connections[0],
    education: {
      label: 'D2 버튼',
      title: '학생이 직접 누르는 입력선',
      what: 'Arduino D2와 버튼 A를 연결합니다.',
      why: '버튼 상태를 읽으려면 이 입력선이 필요합니다.',
      missing: '이 선이 빠지면 버튼을 눌러도 입력이 들어오지 않습니다.'
    }
  };

  const renderPlan = await compileRenderPlan(spec, validReport, { locale: 'ko' });
  assert.deepEqual(renderPlan.connections[0]?.education, spec.connections[0].education);
});

function buttonBuzzerSpecWithoutEducation(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'button-buzzer-education',
    title: '버튼 부저 회로',
    intent: {
      primaryGoal: '버튼을 누르면 부저가 울리는 회로',
      output: '부저',
      controller: 'arduino-uno',
      input: '버튼'
    },
    components: [
      { id: 'bb1', partId: 'breadboard-half', label: 'Breadboard', designator: 'BB1' },
      { id: 'u1', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' },
      { id: 'sw1', partId: 'button-tactile', label: 'Button', designator: 'SW1' },
      { id: 'bz1', partId: 'piezo-buzzer', label: 'Buzzer', designator: 'BZ1' }
    ],
    connections: [
      { id: 'c1', from: { componentId: 'u1', pin: 'D2' }, to: { componentId: 'sw1', pin: 'A' }, signal: 'button-input' },
      { id: 'c2', from: { componentId: 'sw1', pin: 'B' }, to: { componentId: 'u1', pin: 'GND' }, signal: 'ground-reference' },
      { id: 'c3', from: { componentId: 'u1', pin: 'D9' }, to: { componentId: 'bz1', pin: '+' }, signal: 'buzzer-drive' },
      { id: 'c4', from: { componentId: 'bz1', pin: '-' }, to: { componentId: 'u1', pin: 'GND' }, signal: 'common-ground' }
    ],
    behavior: { runText: '버튼을 누르면 부저가 울림' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}
