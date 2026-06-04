import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadMockOledProject } from './mockOledProject.js';

async function distinctThumbnailColors(page, selector) {
  return page.evaluate(async (sel) => {
    const img = document.querySelector(sel);
    if (!img) return 0;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 168;
    canvas.height = img.naturalHeight || 124;
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let index = 0; index < data.length; index += 4) {
      colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    }
    return colors.size;
  }, selector);
}

function countNonBackgroundPixels(buffer) {
  const image = PNG.sync.read(buffer);
  const [r0, g0, b0] = image.data;
  let changed = 0;

  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    const a = image.data[index + 3];
    const distance = Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0);
    if (a > 0 && distance > 40) changed += 1;
  }

  return changed;
}

async function expectVisibleNonBlankStage(page, minPixels = 2000) {
  const canvas = page.getByTestId('stage-canvas');
  await expect(canvas).toBeVisible();
  expect(countNonBackgroundPixels(await canvas.screenshot())).toBeGreaterThan(minPixels);
}

async function readStageDebugSnapshot(canvas) {
  return canvas.evaluate((node) => node.__hEduwareStageDebug?.());
}

async function readStagePartScreenPoint(canvas, componentId) {
  return canvas.evaluate((node, id) => node.__hEduwareStagePartScreenPoint?.(id), componentId);
}

function boxCenter(box) {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2
  };
}

function vectorDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

function expectHorizontalBoundsWithin(inner, outer, tolerance = 0.08) {
  expect(inner.min.x).toBeGreaterThanOrEqual(outer.min.x - tolerance);
  expect(inner.max.x).toBeLessThanOrEqual(outer.max.x + tolerance);
  expect(inner.min.z).toBeGreaterThanOrEqual(outer.min.z - tolerance);
  expect(inner.max.z).toBeLessThanOrEqual(outer.max.z + tolerance);
}

function attachGuards(page) {
  const blockedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const isLocalApp = requestUrl.hostname === '127.0.0.1' && requestUrl.port === '4173';
    const isLocalAgent = requestUrl.hostname === '127.0.0.1' && requestUrl.port === '8787';
    const isLocalOfflineAgent = requestUrl.hostname === '127.0.0.1' && requestUrl.port === '8799';
    if (isLocalOfflineAgent) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          defaultMode: 'deepagents-unconfigured',
          provider: 'openai',
          model: null,
          hasServerKey: false,
          requiredEnv: ['OPENAI_API_KEY', 'H_EDUWARE_AGENT_MODEL']
        })
      });
      return;
    }
    if (isLocalApp || isLocalAgent) {
      await route.continue();
      return;
    }
    blockedRequests.push(requestUrl.toString());
    await route.abort();
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return { blockedRequests, consoleErrors, pageErrors };
}

function assertClean(guards) {
  expect(guards.blockedRequests).toEqual([]);
  expect(guards.consoleErrors).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
}

const INTERNAL_ADJUSTMENT_COPY_PATTERN = /diagnostic_simulation|placeholder_part_simulation|safe_equivalent_simulation|state_only|build-ready claim|current or signal path|context bundle evidence|support bundle|context-support-gap|canonical context|part-capability|simulation-primitive|validation status is|simulation status is|blocked|degraded/i;

function solverGateWithAdditiveFields(solverGateResult, overrides = {}) {
  const safeEquivalent = solverGateResult.mode === 'safe_equivalent_simulation';
  const placeholder = solverGateResult.mode === 'placeholder_part_simulation';
  const runEnabled = solverGateResult.buildReady === true && !safeEquivalent && !placeholder;
  const presentationAdjustment = overrides.presentationAdjustment ?? {
    kind: solverGateResult.simulationActivity === 'state_only' ? 'state_only' : solverGateResult.mode,
    reason: 'Fixture exposes the Phase 1 presentation adjustment contract.'
  };

  return {
    ...solverGateResult,
    presentationAdjustment,
    buildReadyScope: overrides.buildReadyScope ?? (safeEquivalent ? 'displayed_equivalent' : runEnabled ? 'original' : 'none'),
    safeToRenderEvidence: overrides.safeToRenderEvidence ?? solverGateResult.verifiedClaims?.filter((claim) => /render|visible|placeholder|state/i.test(claim)) ?? [],
    controls: {
      runEnabled,
      currentAnimationEnabled: runEnabled && solverGateResult.simulationActivity !== 'state_only',
      hardwareMoveEnabled: false,
      visualMoveEnabled: solverGateResult.visibleSimulation === true,
      shareEnabled: solverGateResult.visibleSimulation === true,
      ...(overrides.controls ?? {})
    }
  };
}

async function waitForAssistantSettled(page) {
  await expect(page.getByTestId('ai-typing')).toHaveCount(0);
  await expect.poll(async () => ((await page.locator('.message.assistant').last().textContent()) ?? '').trim().length).toBeGreaterThan(5);
}

async function loadAgentFixtureIntoPcb(page, fixture, message, options = {}) {
  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture)
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill(message);
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await waitForAssistantSettled(page);

  if (options.confirmBuild) {
    const confirmButton = page.locator('[data-action="confirm"]');
    await expect(confirmButton).toBeVisible();
    await page.locator('#idea-input').fill('좋아 구현 부탁해');
    await page.locator('[data-action="send-idea"]').getByRole('button').click();
    await waitForAssistantSettled(page);
    const buildProgress = page.getByTestId('build-progress');
    if (await buildProgress.count()) {
      await page.getByTestId('build-progress-skip').click();
      await expect(buildProgress).toHaveCount(0);
    }
  }

  await page.locator('[data-tab="PCB"]').click();
}

async function dismissWelcome(page) {
  await page.goto('/');
  await page.getByTestId('welcome-dismiss').click();
}

async function loadDemo(page) {
  await loadMockOledProject(page);
}

async function forceOfflineAgent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hEduwareAgentApiBase', 'http://127.0.0.1:8799');
  });
}

async function isAgentConfigured(request) {
  if (process.env.RUN_LIVE_E2E !== '1') return false;
  try {
    const response = await request.get('http://127.0.0.1:8787/api/agent/health');
    if (!response.ok()) return false;
    const health = await response.json();
    return Boolean(health.ok);
  } catch {
    return false;
  }
}

function validLedBlinkAgentResultFixture() {
  return {
    sessionId: 'session-led-e2e',
    mode: 'live',
    assistantMessages: [
      '검증 가능한 LED 깜빡이기 회로 초안입니다. Arduino Uno의 D9에서 220 ohm 저항을 거쳐 LED 애노드로 연결하고 LED 캐소드는 GND로 돌아갑니다.'
    ],
    agentEvents: [
      { type: 'coordinator', name: 'deepagents-coordinator', status: 'completed', summary: 'Created LED draft.' }
    ],
    clarification: null,
    contextTrace: [
      { sourceId: 'memory:agent-operating-memory', sourceType: 'memory', reason: 'Loaded operating memory.', usedFields: ['validation-before-simulation'] },
      { sourceId: 'sources:support-bundle:digital-light-output', sourceType: 'data', reason: 'digital-light-output has complete verified hardware support data.', usedFields: ['bundleId', 'status', 'sourceClaimIds'], summary: 'complete' },
      { sourceId: 'registry:part-capabilities:led-5mm', sourceType: 'registry', reason: 'Matched LED output.', usedFields: ['pins', 'requiredPassives'] }
    ],
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      sufficientFor: ['valid_circuit_synthesis'],
      synthesisEligibility: {
        status: 'eligible',
        reason: 'Canonical context coverage is sufficient for validated circuit synthesis.'
      },
      requiredSourceTypes: ['memory', 'registry', 'policy'],
      presentSourceTypes: ['memory', 'registry', 'policy'],
      missingSourceTypes: [],
      warnings: []
    },
    requirementMarkdown: '# Project Requirement: LED blinker\n\n## Connections\n\n- arduino-uno:D9 -> resistor-1:1\n- resistor-1:2 -> led-1:A\n- led-1:K -> arduino-uno:GND',
    circuitSpec: {
      id: 'led-blinker',
      title: 'LED blinker',
      intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
      components: [
        { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard' },
        { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
        { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor' },
        { id: 'led-1', partId: 'led-5mm', label: 'LED' }
      ],
      connections: [
        { id: 'd9-to-resistor', from: { componentId: 'arduino-uno', pin: 'D9' }, to: { componentId: 'resistor-1', pin: '1' }, signal: 'gpio' },
        { id: 'resistor-to-led', from: { componentId: 'resistor-1', pin: '2' }, to: { componentId: 'led-1', pin: 'A' }, signal: 'gpio' },
        { id: 'led-to-ground', from: { componentId: 'led-1', pin: 'K' }, to: { componentId: 'arduino-uno', pin: 'GND' }, signal: 'ground' }
      ],
      behavior: { runText: 'LED BLINK' },
      assumptions: ['A 220 ohm resistor limits LED current.'],
      unsupportedItems: [],
      clarificationNeeds: []
    },
    validationReport: {
      version: '2026-05-31',
      status: 'valid',
      errors: [],
      warnings: [],
      validatedCurrentPathIds: ['led-forward-current'],
      sourceVersion: '2026-05-31'
    },
    renderPlan: {
      title: 'LED blinker',
      runText: 'LED BLINK',
      parts: [
        { id: 'breadboard', type: 'breadboard', label: 'Half-size breadboard', pins: [], position: { x: 0, y: 0, z: 0 } },
        { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', pins: [{ name: 'D9', role: 'pwm-output' }, { name: 'GND', role: 'ground' }], position: { x: -1.8, y: 0.28, z: 0.1 } },
        { id: 'resistor-1', type: 'resistor', label: '220 ohm resistor', designator: 'R1', pins: [{ name: '1', role: 'passive-terminal' }, { name: '2', role: 'passive-terminal' }], position: { x: 0.65, y: 0.28, z: 0.2 } },
        { id: 'led-1', type: 'led', label: 'LED', designator: 'D1', pins: [{ name: 'A', role: 'anode' }, { name: 'K', role: 'cathode' }], position: { x: 1.25, y: 0.3, z: 0.2 } }
      ],
      connections: [
        {
          id: 'd9-to-resistor',
          from: { partId: 'arduino-uno', pin: 'D9' },
          to: { partId: 'resistor-1', pin: '1' },
          signal: 'gpio',
          color: '#2f7df6',
          education: { label: 'D9', title: 'Arduino 출력에서 저항으로', what: '이 선은 LED 전류 경로를 시작합니다.', why: '저항이 LED와 직렬로 들어가야 전류를 제한할 수 있습니다.', missing: '이 선이 빠지면 LED가 켜지지 않습니다.' }
        },
        {
          id: 'resistor-to-led',
          from: { partId: 'resistor-1', pin: '2' },
          to: { partId: 'led-1', pin: 'A' },
          signal: 'gpio',
          color: '#2f7df6',
          education: { label: 'LED A', title: '저항에서 LED 애노드로', what: '이 선은 전류가 제한된 LED 애노드에 신호를 보냅니다.', why: 'LED는 저항 뒤에서 안전하게 전류를 받아야 합니다.', missing: '이 선이 빠지면 LED 전류 경로가 열립니다.' }
        },
        {
          id: 'led-to-ground',
          from: { partId: 'led-1', pin: 'K' },
          to: { partId: 'arduino-uno', pin: 'GND' },
          signal: 'ground',
          color: '#20242a',
          education: { label: 'GND', title: 'LED 캐소드 GND 복귀', what: '이 선은 전류를 Arduino GND로 돌려보냅니다.', why: '전류는 닫힌 경로가 있어야 흐를 수 있습니다.', missing: '이 선이 빠지면 LED가 켜지지 않습니다.' }
        }
      ],
      floatingCards: [],
      warnings: [],
      layout: {
        endpoints: {
          'arduino-uno:D9': { x: -1.22, y: 0.72, z: -0.44 },
          'arduino-uno:GND': { x: -1.36, y: 0.72, z: -0.64 },
          'resistor-1:1': { x: 0.23, y: 0.36, z: 0.2 },
          'resistor-1:2': { x: 1.07, y: 0.36, z: 0.2 },
          'led-1:A': { x: 1.17, y: 0.42, z: 0.34 },
          'led-1:K': { x: 1.33, y: 0.42, z: 0.34 }
        }
      }
    },
    simulationPlan: {
      status: 'valid',
      runText: 'LED BLINK',
      currentPaths: [
        {
          id: 'led-forward-current',
          kind: 'load-current',
          primitiveId: 'digital_on_off',
          label: 'LED forward current',
          from: 'arduino-uno:D9',
          through: ['resistor-1', 'led-1'],
          to: 'arduino-uno:GND',
          expectedCurrentMa: 13.6,
          animation: { color: '#ff4d3d', speed: 0.8 }
        }
      ],
      expectedStates: [
        { componentId: 'led-1', state: 'blinking', primitiveId: 'digital_on_off', explanation: 'D9 alternates HIGH and LOW.' }
      ],
      warnings: []
    },
    buildRunnableReport: {
      status: 'runnable',
      runnable: true,
      reasons: [],
      validationStatus: 'valid',
      simulationStatus: 'valid',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: 4,
      currentPathCount: 1,
      expectedStateCount: 1
    },
    solverGateResult: {
      visibleSimulation: true,
      mode: 'verified_build_simulation',
      buildReady: true,
      simulationActivity: 'verified_current',
      benchConfirmed: false,
      repairLevel: 'none',
      attempts: [{
        attempt: 1,
        stage: 'placement',
        action: 'Existing render and simulation artifacts passed the strict build-ready gate.',
        result: 'passed',
        warnings: []
      }],
      verifiedClaims: ['render plan exposes 4 visible part(s)', 'build-ready runnable gate passed'],
      notVerified: ['bench test has not been performed'],
      visualWarnings: [],
      hardwareWarnings: [],
      repairSummary: ['No solver repair was required by the initial adapter.']
    }
  };
}

function validLookingButServerBlockedAgentResultFixture() {
  const fixture = validLedBlinkAgentResultFixture();
  return {
    ...fixture,
    sessionId: 'session-led-blocked-e2e',
    simulationPlan: {
      ...fixture.simulationPlan,
      currentPaths: []
    },
    buildRunnableReport: {
      status: 'blocked',
      runnable: false,
      reasons: ['simulation has no validated current or signal path'],
      validationStatus: 'valid',
      simulationStatus: 'valid',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: fixture.renderPlan.parts.length,
      currentPathCount: 0,
      expectedStateCount: fixture.simulationPlan.expectedStates.length
    },
    solverGateResult: solverGateWithAdditiveFields({
      visibleSimulation: true,
      mode: 'diagnostic_simulation',
      buildReady: false,
      simulationActivity: 'state_only',
      benchConfirmed: false,
      repairLevel: 'none',
      attempts: [{
        attempt: 1,
        stage: 'degrade',
        action: 'Expose the available scene as diagnostic while preserving strict build-ready blocking reasons.',
        result: 'degraded',
        warnings: ['build-ready claim is not verified', 'simulation has no validated current or signal path']
      }],
      verifiedClaims: ['render plan exposes 4 visible part(s)', 'simulation plan status is valid', '1 expected state(s) are available'],
      notVerified: ['build-ready claim is not verified', 'simulation has no validated current or signal path', 'bench test has not been performed'],
      visualWarnings: [],
      hardwareWarnings: [],
      repairSummary: ['Initial adapter preserved strict build-ready blocking while exposing solver-gate diagnostics.']
    }, {
      presentationAdjustment: {
        kind: 'state_only',
        stateEvidence: ['LED expected blinking state', 'Arduino Uno and breadboard context are visible'],
        reason: 'Expected state and board context are available even though build-ready is false.'
      },
      buildReadyScope: 'none',
      safeToRenderEvidence: ['render plan exposes 4 visible part(s)', '1 expected state(s) are available']
    })
  };
}

function placementResolutionFixture(baseFixture, requestedTransform) {
  const next = structuredClone(baseFixture);
  const ledPosition = { x: 1.85, y: 0.35, z: 0.55 };
  next.circuitSpec.components = next.circuitSpec.components.map((component) =>
    component.id === 'led-1'
      ? { ...component, position: ledPosition }
      : component
  );
  next.renderPlan.parts = next.renderPlan.parts.map((part) =>
    part.id === 'led-1'
      ? { ...part, position: ledPosition }
      : part
  );
  next.renderPlan.connections = next.renderPlan.connections.map((connection, index) => ({
    ...connection,
    route: [
      { x: index === 2 ? ledPosition.x : 0.2 + index * 0.25, y: 0.62, z: index === 2 ? ledPosition.z : 0.2 },
      { x: (ledPosition.x + index * 0.12) / 2, y: 1.18 + index * 0.08, z: ledPosition.z + 0.16 },
      { x: ledPosition.x + index * 0.04, y: 0.62, z: ledPosition.z }
    ]
  }));
  next.renderPlan.layout = {
    ...(next.renderPlan.layout ?? {}),
    endpoints: {
      ...(next.renderPlan.layout?.endpoints ?? {}),
      'led-1:A': { x: ledPosition.x - 0.08, y: ledPosition.y + 0.12, z: ledPosition.z + 0.14 },
      'led-1:K': { x: ledPosition.x + 0.08, y: ledPosition.y + 0.12, z: ledPosition.z + 0.14 }
    },
    solverAttempts: [{
      attempt: 1,
      stage: 'placement',
      action: 'Accepted student drag through deterministic placement resolver.',
      result: 'passed',
      warnings: []
    }]
  };
  return {
    status: 'resolved_build_ready',
    resolutionKind: 'resolved_build_ready',
    revision: 'placement-rev-led-1',
    requestedTransform,
    adjustedTransform: {
      ...(requestedTransform ?? {}),
      position: ledPosition
    },
    snapTarget: {
      surface: 'breadboard',
      regionId: 'breadboard-safe-region'
    },
    circuitSpec: next.circuitSpec,
    renderPlan: next.renderPlan,
    validationReport: next.validationReport,
    simulationPlan: next.simulationPlan,
    buildRunnableReport: next.buildRunnableReport,
    solverGateResult: solverGateWithAdditiveFields(next.solverGateResult, {
      controls: {
        hardwareMoveEnabled: true
      }
    }),
    warnings: [],
    solverAttempts: next.renderPlan.layout.solverAttempts
  };
}

function supportedLedAlternativeFixture(source = 'context-support-gap') {
  return {
    id: 'safe-low-voltage-led',
    goal: 'Arduino Uno + 5mm LED + 220Ω 저항으로 안전한 저전압 LED 회로 만들기',
    label: '안전한 Arduino LED 회로',
    reason: '검증된 부품과 시뮬레이션 경로가 준비된 안전한 대안입니다.',
    source,
    partIds: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire'],
    capabilityIds: ['digital-light-output']
  };
}

function sharedLedSnapshotFixture(shareId = 'd'.repeat(32)) {
  return {
    schemaVersion: 1,
    id: shareId,
    createdAt: '2026-06-01T00:00:00.000Z',
    locale: 'en',
    title: 'Shared LED Badge',
    summary: 'A validated LED badge circuit shared from H-eduware.',
    status: 'valid',
    source: 'agent',
    requirementMarkdown: '# Shared LED Badge\n\nThis LED circuit was shared from H-eduware.',
    circuit: {
      name: 'Shared LED Badge',
      description: 'Blink an LED badge safely.',
      components: [
        { id: 'arduino-uno', type: 'arduino', name: 'Arduino Uno', role: 'Controller board' },
        { id: 'led-1', type: 'led', name: 'Red LED', role: 'Output light' }
      ],
      connections: [
        { from: 'arduino-uno:D9', to: 'led-1:A', label: 'Digital signal' }
      ]
    },
    validation: {
      status: 'valid',
      warnings: [],
      unsupportedItems: []
    },
    buildRunnableReport: {
      status: 'runnable',
      runnable: true,
      reasons: [],
      validationStatus: 'valid',
      simulationStatus: 'valid',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: 2,
      currentPathCount: 1,
      expectedStateCount: 1
    },
    simulation: {
      available: true,
      runText: 'LED blink',
      explanation: 'Current flows from Arduino D9 through the LED path and returns to ground.',
      currentPathCount: 1
    },
    renderPlan: {
      title: 'Shared LED Badge',
      runText: 'LED blink',
      parts: [
        { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', description: 'Controller board.', pins: [] },
        { id: 'led-1', type: 'led', label: 'Red LED', description: 'Output LED.', pins: [] }
      ],
      connections: [
        {
          id: 'signal-led',
          from: { partId: 'arduino-uno', pin: 'D9' },
          to: { partId: 'led-1', pin: 'A' },
          signal: 'digital',
          color: '#f97316'
        }
      ],
      floatingCards: [],
      layout: {
        endpoints: {
          'arduino-uno:D9': { x: -1.2, y: 0.7, z: -0.4 },
          'led-1:A': { x: 1.2, y: 0.42, z: 0.34 }
        }
      }
    },
    contextEvidence: {
      coverageStatus: 'sufficient',
      score: 1,
      sourceTypes: ['registry', 'simulation'],
      warnings: []
    }
  };
}

function unsupportedUnsafeAgentResultFixture() {
  const fixture = validLedBlinkAgentResultFixture();
  return {
    ...fixture,
    sessionId: 'session-unsupported-e2e',
    mode: 'live',
    assistantMessages: [
      '원 요청(220V mains wiring, direct outlet connection)은 안전상 실제 배선이나 build-ready 회로로 만들지 않습니다. 대신 검증된 Arduino Uno + 5mm LED + 220Ω 저항의 안전한 저전압 대체 회로를 시뮬레이션으로 보여줄게요.'
    ],
    supportedAlternatives: [supportedLedAlternativeFixture('safety-policy')],
    agentEvents: [
      { type: 'coordinator', name: 'deepagents-coordinator', status: 'completed', summary: 'Created structured circuit draft through Deepagents.' },
      { type: 'validation', name: 'safety-policy', status: 'warning', summary: 'Unsafe high-voltage request refused before rendering.' }
    ],
    clarification: null,
    contextTrace: [
      { sourceId: 'policy:safety-policy', sourceType: 'policy', reason: 'Detected mains/high-voltage wording.', usedFields: ['low-voltage boundary'] },
      { sourceId: 'policy:unsupported-request-policy', sourceType: 'policy', reason: 'Blocked unsupported unsafe request.', usedFields: ['safe alternatives'] }
    ],
    contextCoverage: {
      status: 'insufficient',
      score: 1,
      sufficientFor: ['unsupported_response', 'unsafe_refusal', 'safe_equivalent_simulation'],
      synthesisEligibility: {
        status: 'ineligible',
        reason: 'Unsafe mains-voltage request is refused; safe equivalent simulation may be shown.'
      },
      requiredSourceTypes: ['memory', 'policy'],
      presentSourceTypes: ['memory', 'policy'],
      missingSourceTypes: [],
      warnings: []
    },
    requirementMarkdown: '# Project Requirement: Safe low-voltage LED equivalent\n\nThe original 220V request is not rendered or treated as build-ready hardware.\n\n## Connections\n\n- arduino-uno:D9 -> resistor-1:1\n- resistor-1:2 -> led-1:A\n- led-1:K -> arduino-uno:GND',
    circuitSpec: {
      ...fixture.circuitSpec,
      id: 'unsafe-mains-request-safe-equivalent-led',
      title: 'Safe Low-Voltage LED Equivalent',
      intent: {
        primaryGoal: 'simulate a safe Arduino LED circuit instead of the unsafe original request',
        output: 'led',
        controller: 'arduino-uno',
        behavior: 'safe-equivalent-low-voltage'
      },
      assumptions: [
        'The original request is not rendered or treated as build-ready hardware.',
        'Original blocked items: 220V mains wiring, direct outlet connection.',
        'This equivalent uses Arduino low-voltage GPIO, one 5mm LED, and a 220 ohm current-limiting resistor.'
      ],
      unsupportedItems: [],
      clarificationNeeds: []
    },
    renderPlan: {
      ...fixture.renderPlan,
      title: 'Safe Low-Voltage LED Equivalent',
      runText: 'SAFE EQUIVALENT LED ON'
    },
    simulationPlan: {
      ...fixture.simulationPlan,
      runText: 'SAFE EQUIVALENT LED ON'
    },
    solverGateResult: solverGateWithAdditiveFields({
      ...fixture.solverGateResult,
      mode: 'safe_equivalent_simulation',
      repairLevel: 'safe_equivalent',
      sourceSpecId: 'unsafe-mains-request',
      equivalentSpecId: 'unsafe-mains-request-safe-equivalent-led',
      verifiedClaims: [
        'render plan exposes 4 visible part(s)',
        'safe low-voltage equivalent circuit was validated instead of the unsafe original request',
        'build-ready runnable gate passed'
      ],
      notVerified: [
        'original unsafe request was not converted into wiring or build-ready hardware',
        'bench test has not been performed'
      ],
      repairSummary: ['Original unsafe request was replaced with a safe low-voltage equivalent simulation.']
    }, {
      presentationAdjustment: {
        kind: 'safe_equivalent_simulation',
        originalSpecId: 'unsafe-mains-request',
        equivalentSpecId: 'unsafe-mains-request-safe-equivalent-led',
        originalBuildReady: false,
        displayedEquivalentBuildReady: true,
        blockedOriginalReasons: ['220V mains wiring', 'direct outlet connection'],
        equivalenceClaims: ['low-voltage LED output demonstrates the classroom-safe behavior'],
        nonEquivalentWarnings: ['The original mains circuit is not shown or built.'],
        reason: 'Unsafe original request is replaced by a safe low-voltage equivalent.'
      },
      buildReadyScope: 'displayed_equivalent',
      controls: {
        runEnabled: false,
        currentAnimationEnabled: false
      },
      safeToRenderEvidence: ['safe low-voltage equivalent circuit was validated instead of the unsafe original request']
    })
  };
}

function plannedContextGapAgentResultFixture() {
  return {
    sessionId: 'session-context-gap-e2e',
    mode: 'live',
    assistantMessages: [
      'This hardware idea needs more verified H-eduware reference data before I can build a circuit simulation for it. Try a supported starter circuit, or add the missing part and validation data first.'
    ],
    supportedAlternatives: [supportedLedAlternativeFixture('context-support-gap')],
    agentEvents: [
      {
        type: 'validation',
        name: 'context-support-gap',
        status: 'warning',
        summary: 'This request needs more verified hardware data before circuit finalization: MCP3008 SPI ADC display is missing validation, 3D view, and simulation data.'
      }
    ],
    clarification: 'Choose a currently supported circuit, or add the missing verified hardware data before finalizing the circuit.',
    contextTrace: [
      { sourceId: 'visual-library:mcp3008-adc', sourceType: 'data', reason: 'Detected MCP3008 SPI ADC as a catalog-known but not simulation-ready visual part.', usedFields: ['supportTier', 'family'] },
      { sourceId: 'bundle:display-text-output', sourceType: 'data', reason: 'OLED display output is supported, but the requested MCP3008 SPI ADC is outside the selected simulation-ready bundle.', usedFields: ['allowedParts'] }
    ],
    contextCoverage: {
      status: 'insufficient',
      score: 0.55,
      sufficientFor: ['clarification_response'],
      synthesisEligibility: {
        status: 'ineligible',
        reason: 'Missing verified hardware data required for circuit finalization.'
      },
      requiredSourceTypes: ['memory', 'data', 'registry', 'validation', 'simulation', 'rendering'],
      presentSourceTypes: ['memory', 'data'],
      missingSourceTypes: ['registry', 'validation', 'simulation', 'rendering'],
      warnings: [
        'Context support gap: pin-known hardware mcp3008-adc is not simulation-ready.',
        'Verified support data gap: MCP3008 SPI ADC display has incomplete verified hardware support data.'
      ]
    },
    requirementMarkdown: '# Context support gap\n\nThe MCP3008 SPI ADC display request is not ready for validated circuit synthesis.',
    circuitSpec: {
      id: 'mcp3008-adc-display-context-gap',
      title: 'MCP3008 SPI ADC display support gap',
      intent: { primaryGoal: 'show MCP3008 ADC channel value on OLED', input: 'MCP3008 SPI ADC', output: 'display', controller: 'arduino-uno' },
      components: [
        { id: 'unsupported-request', partId: 'unsupported', label: 'Context-known hardware support gap' }
      ],
      connections: [],
      behavior: { runText: 'CONTEXT GAP' },
      assumptions: ['H-eduware needs canonical part, validation, render, and simulation data before synthesis.'],
      unsupportedItems: ['MCP3008 SPI ADC display context bundle is incomplete'],
      clarificationNeeds: ['Choose a supported starter circuit or add the missing context artifacts.']
    },
    validationReport: {
      version: '2026-06-01',
      status: 'unsupported',
      errors: ['CONTEXT_SUPPORT_GAP: MCP3008 SPI ADC display is context-known but not synthesis-ready.'],
      warnings: ['Current-flow animation is blocked until context coverage is sufficient; renderable parts may be shown as diagnostic context only.'],
      validatedCurrentPathIds: [],
      sourceVersion: '2026-06-01'
    },
    renderPlan: {
      title: 'MCP3008 SPI ADC display support gap',
      runText: 'CONTEXT GAP',
      parts: [
        {
          id: 'unsupported-request',
          type: 'unsupported',
          label: 'Context-known hardware support gap',
          description: 'Generic placeholder for a context-known part whose verified simulation bundle is incomplete.',
          pins: [],
          position: { x: 0, y: 0.18, z: 0 }
        }
      ],
      connections: [],
      floatingCards: [],
      warnings: [{
        code: 'DIAGNOSTIC_RENDER_ONLY',
        message: 'Validation status is unsupported; renderable hardware is shown for diagnosis only and is not build-ready.'
      }],
      layout: {
        endpoints: {},
        solverAttempts: [{
          attempt: 1,
          stage: 'degrade',
          action: 'Expose a generic diagnostic placeholder while preserving strict build-ready blocking reasons.',
          result: 'degraded',
          warnings: ['validation status is unsupported']
        }]
      }
    },
    simulationPlan: {
      status: 'unsupported',
      runText: 'CONTEXT GAP',
      currentPaths: [],
      expectedStates: [],
      warnings: ['Current-flow animation is blocked until the circuit has sufficient context coverage.']
    },
    buildRunnableReport: {
      status: 'blocked',
      runnable: false,
      reasons: ['validation status is unsupported', 'simulation status is unsupported'],
      validationStatus: 'unsupported',
      simulationStatus: 'unsupported',
      renderWarningCount: 1,
      renderBlockingWarningCount: 0,
      renderPartCount: 1,
      currentPathCount: 0,
      expectedStateCount: 0
    },
    solverGateResult: solverGateWithAdditiveFields({
      visibleSimulation: true,
      mode: 'diagnostic_simulation',
      buildReady: false,
      simulationActivity: 'diagnostic',
      benchConfirmed: false,
      repairLevel: 'none',
      attempts: [{
        attempt: 1,
        stage: 'degrade',
        action: 'Expose the available scene as diagnostic while preserving strict build-ready blocking reasons.',
        result: 'degraded',
        warnings: ['build-ready claim is not verified', 'validation status is unsupported']
      }],
      verifiedClaims: ['render plan exposes 1 visible part(s)'],
      notVerified: ['build-ready claim is not verified', 'validation status is unsupported', 'simulation status is unsupported', 'bench test has not been performed'],
      visualWarnings: [{
        code: 'DIAGNOSTIC_RENDER_ONLY',
        message: 'Validation status is unsupported; renderable hardware is shown for diagnosis only and is not build-ready.'
      }],
      hardwareWarnings: ['Current-flow animation is blocked until the circuit has sufficient context coverage.'],
      repairSummary: ['Diagnostic scene is visible while strict build-ready blocking remains in effect.']
    }, {
      presentationAdjustment: {
        kind: 'diagnostic_simulation',
        reason: 'Safe renderable context exists while synthesis evidence is incomplete.',
        visibleOverlays: ['review-only hardware marker']
      },
      buildReadyScope: 'none',
      safeToRenderEvidence: ['render plan exposes 1 visible part(s)']
    })
  };
}

function placeholderPartAgentResultFixture() {
  return {
    sessionId: 'session-placeholder-e2e',
    mode: 'live',
    assistantMessages: [
      '정확한 3D 외형 자료가 아직 준비되지 않은 부품이라 등록된 대체 부품 형태로 먼저 보여줄게요. 실행과 전류 흐름은 확인된 자료가 준비될 때까지 꺼둘게요.'
    ],
    supportedAlternatives: [supportedLedAlternativeFixture('placeholder-part')],
    agentEvents: [
      {
        type: 'validation',
        name: 'placeholder-part-simulation',
        status: 'warning',
        summary: 'Registered placeholder geometry is available while exact footprint evidence is incomplete.'
      }
    ],
    clarification: '정확한 부품 외형 자료를 추가하거나, 지원되는 LED starter 회로로 진행할 수 있어요.',
    contextTrace: [
      { sourceId: 'visual-library:placeholder-module', sourceType: 'data', reason: 'Registered generic placeholder geometry.', usedFields: ['placeholderFootprintId', 'safeToRender'] },
      { sourceId: 'registry:part-capabilities:known-sensor-module', sourceType: 'registry', reason: 'Known classroom-safe module category.', usedFields: ['supportTier', 'missingEvidence'] }
    ],
    contextCoverage: {
      status: 'insufficient',
      score: 0.7,
      sufficientFor: ['clarification_response', 'placeholder_part_simulation'],
      synthesisEligibility: {
        status: 'ineligible',
        reason: 'Exact render footprint evidence is not complete yet.'
      },
      requiredSourceTypes: ['memory', 'registry', 'rendering'],
      presentSourceTypes: ['memory', 'registry', 'rendering'],
      missingSourceTypes: [],
      warnings: ['Exact 3D footprint and pin geometry evidence are incomplete for this module.']
    },
    requirementMarkdown: '# Placeholder part simulation\n\nA registered placeholder part is visible for review while exact geometry remains unverified.',
    circuitSpec: {
      id: 'known-sensor-placeholder',
      title: 'Known Sensor Placeholder',
      intent: { primaryGoal: 'inspect a classroom-safe sensor module placeholder', input: 'sensor module', output: 'context view', controller: 'arduino-uno' },
      components: [
        { id: 'placeholder-sensor', partId: 'known-sensor-module', label: 'Sensor module placeholder', designator: 'S1' }
      ],
      connections: [],
      behavior: { runText: 'PLACEHOLDER VIEW' },
      assumptions: ['The generic placeholder is registered and safe to render.'],
      unsupportedItems: [],
      clarificationNeeds: ['Add exact footprint and pin geometry evidence before claiming a build-ready circuit.']
    },
    validationReport: {
      version: '2026-06-01',
      status: 'invalid',
      errors: ['Exact footprint evidence is incomplete for the requested module.'],
      warnings: ['The placeholder view is for visual context only.'],
      validatedCurrentPathIds: [],
      sourceVersion: '2026-06-01'
    },
    renderPlan: {
      title: 'Known Sensor Placeholder',
      runText: 'PLACEHOLDER VIEW',
      parts: [
        {
          id: 'placeholder-sensor',
          type: 'unsupported',
          label: 'Sensor module placeholder',
          description: 'Registered generic placeholder for a classroom-safe module whose exact 3D footprint is not ready.',
          placeholderFootprintId: 'placeholder-generic-module',
          exactGeometryClaim: false,
          pinGeometryClaim: false,
          pins: [],
          position: { x: 0, y: 0.2, z: 0 }
        }
      ],
      connections: [],
      floatingCards: [],
      warnings: [{
        code: 'MISSING_RENDER_FOOTPRINT',
        componentId: 'placeholder-sensor',
        message: 'Exact footprint is unavailable; registered placeholder geometry is shown.'
      }],
      layout: {
        endpoints: {},
        solverAttempts: [{
          attempt: 1,
          stage: 'placement',
          action: 'Use registered placeholder geometry while exact footprint evidence is incomplete.',
          result: 'degraded',
          warnings: ['exact geometry claim is not verified', 'pin geometry claim is not verified']
        }]
      }
    },
    simulationPlan: {
      status: 'invalid',
      runText: 'PLACEHOLDER VIEW',
      currentPaths: [],
      expectedStates: [],
      warnings: ['Exact simulation primitive evidence is incomplete for this placeholder part.']
    },
    buildRunnableReport: {
      status: 'blocked',
      runnable: false,
      reasons: ['exact geometry claim is not verified', 'pin geometry claim is not verified'],
      validationStatus: 'invalid',
      simulationStatus: 'invalid',
      renderWarningCount: 1,
      renderBlockingWarningCount: 0,
      renderPartCount: 1,
      currentPathCount: 0,
      expectedStateCount: 0
    },
    solverGateResult: solverGateWithAdditiveFields({
      visibleSimulation: true,
      mode: 'placeholder_part_simulation',
      buildReady: false,
      simulationActivity: 'diagnostic',
      benchConfirmed: false,
      repairLevel: 'placeholder',
      attempts: [{
        attempt: 1,
        stage: 'placement',
        action: 'Use registered placeholder geometry while exact footprint evidence is incomplete.',
        result: 'degraded',
        warnings: ['exact geometry claim is not verified', 'pin geometry claim is not verified']
      }],
      verifiedClaims: ['render plan exposes 1 visible part(s)', 'registered placeholder footprint placeholder-generic-module is available'],
      notVerified: ['exact geometry claim is not verified', 'pin geometry claim is not verified', 'bench test has not been performed'],
      visualWarnings: [{
        code: 'MISSING_RENDER_FOOTPRINT',
        componentId: 'placeholder-sensor',
        message: 'Exact footprint is unavailable; registered placeholder geometry is shown.'
      }],
      hardwareWarnings: ['Exact simulation primitive evidence is incomplete for this placeholder part.'],
      repairSummary: ['A registered placeholder footprint is shown while exact geometry remains review-only.']
    }, {
      presentationAdjustment: {
        kind: 'placeholder_part_simulation',
        placeholderPartIds: ['placeholder-sensor'],
        reason: 'Registered placeholder geometry is available while exact footprint evidence is missing.'
      },
      buildReadyScope: 'none',
      safeToRenderEvidence: ['registered placeholder footprint placeholder-generic-module is available']
    })
  };
}

function casualStartAgentResultFixture() {
  return {
    sessionId: 'session-casual-e2e',
    mode: 'live',
    assistantMessages: [
      '좋아요. 시작해 볼게요. 먼저 만들고 싶은 회로의 입력, 출력, 동작을 알려 주세요.'
    ],
    agentEvents: [
      {
        type: 'coordinator',
        name: 'requirement-analysis-agent',
        status: 'completed',
        summary: 'casual_chat: 구체적인 회로 목표 없이 작업 시작 의사를 표현했다.'
      }
    ],
    clarification: '만들고 싶은 회로의 입력, 출력, 동작을 한 문장으로 알려 주세요.',
    contextTrace: [
      {
        sourceId: 'memory:agent-operating-memory',
        sourceType: 'memory',
        reason: 'Requirement-analysis agent handled a casual start turn before synthesis.',
        usedFields: ['requirement-analysis']
      }
    ],
    contextCoverage: {
      status: 'insufficient',
      score: 0.25,
      sufficientFor: ['clarification_response'],
      synthesisEligibility: {
        status: 'ineligible',
        reason: 'No concrete circuit goal has been provided yet.'
      },
      requiredSourceTypes: ['memory'],
      presentSourceTypes: ['memory'],
      missingSourceTypes: [],
      warnings: ['Requirement analysis needs a concrete input, output, and behavior before synthesis.']
    },
    requirementMarkdown: '# Clarification needed\n\nA concrete circuit goal is required before wiring, rendering, or simulation.',
    circuitSpec: {
      id: 'clarification-needed',
      title: '회로 요청 구체화 필요',
      intent: { primaryGoal: '좋아 작업을 시작해보자', output: 'clarification-needed', controller: 'none', behavior: 'casual_chat' },
      components: [{ id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' }],
      connections: [],
      behavior: { runText: 'CLARIFY' },
      assumptions: ['No concrete circuit input, output, or hardware behavior was identified yet.'],
      unsupportedItems: ['clarification-required'],
      clarificationNeeds: ['만들고 싶은 회로의 입력, 출력, 동작을 한 문장으로 알려 주세요.']
    },
    validationReport: {
      version: '2026-06-01',
      status: 'unsupported',
      errors: ['Unsupported request item: clarification-required'],
      warnings: ['No render or current simulation is produced until a concrete circuit goal exists.'],
      validatedCurrentPathIds: [],
      sourceVersion: '2026-06-01'
    },
    renderPlan: {
      title: '회로 요청 구체화 필요',
      runText: 'CLARIFY',
      parts: [],
      connections: [],
      floatingCards: [],
      warnings: []
    },
    simulationPlan: {
      status: 'unsupported',
      runText: 'CLARIFY',
      currentPaths: [],
      expectedStates: [],
      warnings: []
    }
  };
}

function unknownHardwareClarificationAgentResultFixture() {
  const fixture = casualStartAgentResultFixture();
  return {
    ...fixture,
    sessionId: 'session-unknown-hardware-e2e',
    servingStatus: 'needs_clarification',
    assistantMessages: [
      'XYZ123 sensor is not in the verified H-eduware hardware registry yet. Choose a supported sensor or provide verified hardware data before I can build the circuit.'
    ],
    clarification: 'Choose a supported sensor before synthesis.',
    contextCoverage: {
      ...fixture.contextCoverage,
      sufficientFor: ['clarification_response', 'unsupported_response'],
      synthesisEligibility: {
        status: 'ineligible',
        reason: 'Unknown explicit hardware XYZ123 sensor requires clarification before synthesis.'
      },
      warnings: ['Context support gap: Unknown explicit hardware XYZ123 sensor.']
    },
    circuitSpec: {
      ...fixture.circuitSpec,
      id: 'unknown-hardware-clarification',
      title: 'Unknown hardware clarification',
      unsupportedItems: [],
      clarificationNeeds: ['XYZ123 sensor is not verified.']
    },
    validationReport: {
      ...fixture.validationReport,
      errors: ['Context support gap: XYZ123 sensor is not verified.']
    },
    buildRunnableReport: {
      status: 'blocked',
      runnable: false,
      reasons: ['Unknown explicit hardware XYZ123 sensor requires clarification before synthesis.'],
      validationStatus: 'unsupported',
      simulationStatus: 'unsupported',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: 0,
      currentPathCount: 0,
      expectedStateCount: 0
    }
  };
}

test('welcome popup shows on first visit and stays gone after reload', async ({ page }) => {
  const guards = attachGuards(page);

  await page.goto('/');
  await expect(page.getByTestId('welcome-popup')).toBeVisible();
  await expect(page.getByTestId('brand-lockup')).toBeVisible();

  await page.getByTestId('welcome-dismiss').click();
  await expect(page.getByTestId('welcome-popup')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect(page.getByTestId('welcome-popup')).toHaveCount(0);

  expect(guards.blockedRequests).toEqual([]);
  expect(guards.consoleErrors.filter((message) => !/502|Bad Gateway/i.test(message))).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
});

test('language toggle switches between Korean and English and persists after reload', async ({ page }) => {
  await dismissWelcome(page);

  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  await expect(page.locator('#idea-input')).toBeVisible();

  await page.getByRole('button', { name: 'ENG' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  await expect(page.getByLabel('Describe circuit idea')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  await expect(page.getByLabel('Describe circuit idea')).toBeVisible();

  await page.getByRole('button', { name: 'KOR' }).click();
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
});

test('language toggle preserves a built circuit artifact without mojibake', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(validLedBlinkAgentResultFixture())
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('LED 깜빡이기');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();
  await page.locator('#idea-input').fill('좋아 구현 부탁해');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.getByTestId('build-progress')).toBeVisible();
  await page.getByTestId('build-progress-skip').click();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/LED|D9|GND/);
  await page.getByRole('button', { name: 'ENG' }).click();
  await page.locator('[data-tab="Files"]').click();
  await expect(page.getByTestId('context-evidence-panel')).toContainText(/Circuit synthesis/);
  await expect(page.getByTestId('context-synthesis-eligibility')).toContainText(/^eligible:/);
  await expect(page.getByTestId('context-evidence-panel')).toContainText(/Response coverage/);
  await expect(page.getByTestId('context-response-coverage')).toContainText(/valid circuit synthesis/);
  await expect(page.locator('[data-action="run"]')).toBeEnabled();

  await page.getByRole('button', { name: 'ENG' }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/LED|D9|GND/);
  await page.locator('[data-tab="PCB"]').click();
  await expect(page.getByTestId('stage-canvas')).toBeVisible();
  await expect(page.getByTestId('connection-list')).toContainText(/D9|GND|LED/i);
  await page.getByTestId('inspector-target-selector').locator('[data-action="select-target"]').first().click();
  await expect(page.getByTestId('inspector-selected')).toContainText('Why it matters');

  await page.getByRole('button', { name: 'KOR' }).click();
  await expect(page.locator('[data-action="run"]')).toBeEnabled();
  await expect(page.getByTestId('stage-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector-selected')).toContainText('왜 필요한가');
  await expect(page.getByTestId('inspector-selected')).not.toContainText(/This wire|If missing|Current needs|Arduino output to resistor/i);
  await expect(page.getByTestId('connection-list')).not.toContainText(/This wire|Arduino output to resistor/i);
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/�|쨌/);

  assertClean(guards);
});

test('brand logo is an inline SVG in the topbar', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);

  const logo = page.getByTestId('brand-logo');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveJSProperty('tagName', 'svg');

  assertClean(guards);
});

test('part library browser renders 100+ three.js component thumbnails', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);

  await page.getByTestId('open-library').click();
  await expect(page.getByTestId('library-browser')).toBeVisible();

  const thumbs = page.getByTestId('library3d-thumb');
  await expect.poll(async () => thumbs.count()).toBeGreaterThanOrEqual(100);
  await expect(thumbs.first()).toBeVisible();
  expect(await distinctThumbnailColors(page, '[data-testid="library3d-thumb"]')).toBeGreaterThan(20);

  const fullCount = await thumbs.count();
  await page.getByTestId('library-search').fill('oled');
  await expect.poll(async () => thumbs.count()).toBeGreaterThan(0);
  await expect.poll(async () => thumbs.count()).toBeLessThan(fullCount);

  const oledAlt = await thumbs.first().getAttribute('alt');
  expect(oledAlt).toContain('OLED');
  expect(oledAlt).toMatch(/\d"/);

  await page.getByTestId('library-close').click();
  await expect(page.getByTestId('library-browser')).toHaveCount(0);

  assertClean(guards);
});

test('share button opens a clear modal instead of acting as a dead shell control', async ({ page }) => {
  const guards = attachGuards(page);
  let shareRequestBody = null;
  await page.route('http://127.0.0.1:8787/api/share/projects', async (route) => {
    shareRequestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shareId: 'c'.repeat(32),
        shareUrl: `http://127.0.0.1:4173/?share=${'c'.repeat(32)}`,
        createdAt: '2026-06-01T00:00:00.000Z'
      })
    });
  });
  await dismissWelcome(page);

  await expect(page.getByTestId('share-project')).toBeDisabled();
  await expect(page.getByTestId('share-modal')).toHaveCount(0);
  await expect(page).toHaveURL(/127\.0\.0\.1:4173/);

  await loadDemo(page);
  await page.getByTestId('share-project').focus();
  await expect(page.getByTestId('share-project')).toBeFocused();
  await page.getByTestId('share-project').click();
  await expect(page.getByTestId('share-modal')).toBeVisible();
  await expect(page.getByTestId('share-close')).toBeFocused();
  await expect(page.getByTestId('share-summary')).toContainText(/Arduino|OLED|회로|Circuit/i);
  await expect(page.getByTestId('share-copy')).toBeVisible();
  await page.getByTestId('share-create-link').click();
  await expect(page.getByTestId('share-link')).toHaveValue(/127\.0\.0\.1:4173\/\?share=c{32}/);
  await expect(page.getByTestId('share-copy-link')).toBeVisible();
  await expect(page.getByTestId('share-download-json')).toBeVisible();
  await expect(page.getByTestId('share-download-card')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('share-download-card').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const cardImage = PNG.sync.read(await readFile(await download.path()));
  expect(cardImage.width).toBe(1200);
  expect(cardImage.height).toBe(630);
  expect(countNonBackgroundPixels(PNG.sync.write(cardImage))).toBeGreaterThan(20000);
  await expect.poll(() => shareRequestBody).not.toBeNull();
  expect(shareRequestBody.snapshot.title).toMatch(/Arduino|OLED|회로|Circuit/i);
  expect(JSON.stringify(shareRequestBody.snapshot)).not.toMatch(/agentEvents|chatMessages|sk-proj-|OPENAI_API_KEY/);
  await page.getByTestId('share-close').click();
  await expect(page.getByTestId('share-modal')).toHaveCount(0);
  await expect(page.getByTestId('share-project')).toBeFocused();

  assertClean(guards);
});

test('public share link renders a read-only project page and imports the snapshot', async ({ page }) => {
  const guards = attachGuards(page);
  const shareId = 'd'.repeat(32);
  await page.route(`http://127.0.0.1:8787/api/share/projects/${shareId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ snapshot: sharedLedSnapshotFixture(shareId) })
    });
  });

  await page.goto(`/?share=${shareId}`);
  await expect(page.getByTestId('public-share-view')).toBeVisible();
  await expect(page.getByTestId('ai-panel')).toHaveCount(0);
  await expect(page.getByTestId('public-share-title')).toContainText('Shared LED Badge');
  await expect(page.getByTestId('public-share-validation')).toContainText(/valid|검증/i);
  await expect(page.getByTestId('public-share-parts')).toContainText(/Arduino Uno|Red LED/);
  await expect(page.getByTestId('public-share-simulation')).toContainText(/Current flows|전류/i);

  await page.getByTestId('share-import').click();
  await expect(page.getByTestId('public-share-view')).toHaveCount(0);
  await expect(page.getByText('Shared LED Badge').first()).toBeVisible();
  await expect(page.locator('[data-stage-host]')).toBeVisible();

  assertClean(guards);
});

test('public share view shows a visual circuit card canvas alongside the metadata grid', async ({ page }) => {
  const guards = attachGuards(page);
  const shareId = 'd'.repeat(32);
  await page.route(`http://127.0.0.1:8787/api/share/projects/${shareId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ snapshot: sharedLedSnapshotFixture(shareId) })
    });
  });

  await page.goto(`/?share=${shareId}`);
  await expect(page.getByTestId('public-share-view')).toBeVisible();

  // The share card canvas must be present and sized correctly (1200x630)
  const card = page.getByTestId('share-card-canvas');
  await expect(card).toBeVisible();
  const cardWidth = await card.evaluate((el) => el.width);
  const cardHeight = await card.evaluate((el) => el.height);
  expect(cardWidth).toBe(1200);
  expect(cardHeight).toBe(630);

  // The canvas must have non-background pixels (i.e. something was drawn)
  const drawnPixels = await card.evaluate((el) => {
    const ctx = el.getContext('2d');
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    const [r0, g0, b0] = data;
    let changed = 0;
    for (let i = 0; i < data.length; i += 4) {
      const dist = Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0);
      if (data[i + 3] > 0 && dist > 40) changed += 1;
    }
    return changed;
  });
  expect(drawnPixels).toBeGreaterThan(20000);

  // The metadata grid must still be present alongside the card
  await expect(page.getByTestId('public-share-title')).toContainText('Shared LED Badge');
  await expect(page.getByTestId('public-share-parts')).toContainText(/Arduino Uno|Red LED/);

  assertClean(guards);
});

test('public share link blocks valid-looking snapshots without runnable evidence', async ({ page }) => {
  const guards = attachGuards(page);
  const shareId = 'e'.repeat(32);
  const snapshot = sharedLedSnapshotFixture(shareId);
  delete snapshot.buildRunnableReport;
  await page.route(`http://127.0.0.1:8787/api/share/projects/${shareId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ snapshot })
    });
  });

  await page.goto(`/?share=${shareId}`);
  await expect(page.getByTestId('public-share-view')).toBeVisible();
  await expect(page.getByTestId('public-share-validation')).toContainText(/invalid|draft|초안|검증/i);
  await expect(page.getByTestId('public-share-simulation')).toContainText(/No simulation|시뮬레이션 없음/i);
  await expect(page.getByTestId('public-share-simulation')).not.toContainText(/Current flows|전류가 흐름/i);

  await page.getByTestId('share-import').click();
  await expect(page.getByTestId('public-share-view')).toHaveCount(0);
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/not validated|needs review|non-running|검토|비실행/i);
  await expect(page.locator('[data-stage-host]')).toHaveCount(0);

  assertClean(guards);
});

test('public share link imports diagnostic scenes without enabling run', async ({ page }) => {
  const guards = attachGuards(page);
  const shareId = 'f'.repeat(32);
  const snapshot = sharedLedSnapshotFixture(shareId);
  snapshot.status = 'invalid';
  snapshot.validation.status = 'invalid';
  snapshot.validation.warnings = ['render is diagnostic only'];
  snapshot.buildRunnableReport = {
    ...snapshot.buildRunnableReport,
    status: 'blocked',
    runnable: false,
    reasons: ['render is diagnostic only'],
    currentPathCount: 0,
    expectedStateCount: 0
  };
  snapshot.solverGateResult = {
    mode: 'diagnostic',
    visibleSimulation: true,
    buildReady: false,
    simulationActivity: 'diagnostic',
    notVerified: ['current-flow simulation is not verified']
  };
  snapshot.simulation.available = false;
  snapshot.simulation.currentPathCount = 0;
  snapshot.simulation.explanation = '3D diagnostic scene is available, but current-flow simulation is blocked.';
  await page.route(`http://127.0.0.1:8787/api/share/projects/${shareId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ snapshot })
    });
  });

  await page.goto(`/?share=${shareId}`);
  await expect(page.getByTestId('public-share-view')).toBeVisible();
  await expect(page.getByTestId('public-share-validation')).toContainText(/invalid|draft|초안|검증/i);
  await expect(page.getByTestId('public-share-simulation')).toContainText(/3D diagnostic|3D 진단/i);
  await expect(page.getByTestId('public-share-simulation')).not.toContainText(/Current flows|전류가 흐름/i);

  await page.getByTestId('share-import').click();
  await expect(page.getByTestId('public-share-view')).toHaveCount(0);
  await expectVisibleNonBlankStage(page);
  await expect(page.getByTestId('solver-gate-status')).toBeVisible();
  await expect(page.getByTestId('solver-gate-status')).not.toContainText(/diagnostic_simulation|current-flow simulation is not verified|validation status|build-ready claim/i);
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  await expect(page.getByTestId('simulation-toggle')).toBeDisabled();
  await expect(page.getByTestId('simulation-step')).toBeDisabled();

  assertClean(guards);
});

test('AI chat accepts casual start messages without pretending they are circuit drafts', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(casualStartAgentResultFixture())
    });
  });
  await dismissWelcome(page);

  await page.locator('#idea-input').fill('좋아 작업을 시작해보자');
  await page.locator('#idea-input').press('Enter');

  await expect(page.getByTestId('interview-progress')).toBeVisible();
  await expect(page.locator('.message.assistant').last()).toBeVisible();
  await expect(page.getByTestId('ai-typing')).toHaveCount(0);
  await expect.poll(async () => ((await page.locator('.message.assistant').last().textContent()) ?? '').trim().length).toBeGreaterThan(10);
  const assistantText = await page.locator('.message.assistant').last().textContent();

  expect(assistantText).not.toContain('OPENAI_API_KEY');
  expect(assistantText).not.toContain('H_EDUWARE_AGENT_MODEL');
  expect(assistantText).not.toMatch(/structured circuit draft|회로 초안을 구조화/i);
  expect(assistantText).toMatch(/회로|입력|출력|동작|circuit/i);
  await expect(page.locator('[data-action="confirm"]')).toHaveCount(0);

  assertClean(guards);
});

test('unknown hardware request asks for clarification instead of showing build confirmation', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(unknownHardwareClarificationAgentResultFixture())
    });
  });
  await dismissWelcome(page);

  await page.locator('#idea-input').fill('Use XYZ123 sensor to show value on OLED.');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expect(page.locator('.message.assistant').last()).toContainText(/XYZ123|verified|supported sensor/i);
  await expect(page.getByTestId('serving-status')).toHaveAttribute('data-status', 'needs_clarification');
  await expect(page.locator('[data-action="confirm"]')).toHaveCount(0);
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  await expect(page.getByTestId('stage-canvas')).toHaveCount(0);

  assertClean(guards);
});

test('AI runtime warns when the live agent server is older than source files', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        defaultMode: 'deepagents-live',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        hasServerKey: true,
        serverStartedAt: '2026-05-31T12:00:00.000Z',
        serverUptimeMs: 120000,
        sourceStatus: {
          stale: true,
          checkedAt: '2026-05-31T12:05:00.000Z',
          newestSourceModifiedAt: '2026-05-31T12:04:00.000Z',
          staleSourceFiles: [{ id: 'agent:circuit-tools', modifiedAt: '2026-05-31T12:04:00.000Z' }],
          errors: []
        }
      })
    });
  });

  await dismissWelcome(page);

  await expect(page.locator('.ai-runtime strong')).toContainText(/재시작|restart/);
  await expect(page.getByTestId('runtime-stale-warning')).toBeVisible();
  await expect(page.getByTestId('runtime-stale-warning')).toContainText(/서버|server/i);

  assertClean(guards);
});

test('AI runtime warns when live agent health cannot report source freshness', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        defaultMode: 'deepagents-live',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        hasServerKey: true
      })
    });
  });

  await dismissWelcome(page);

  await expect(page.locator('.ai-runtime strong')).toContainText(/재시작|restart/);
  await expect(page.getByTestId('runtime-stale-warning')).toBeVisible();
  await expect(page.getByTestId('runtime-stale-warning')).toContainText(/health|최신 코드|server/i);

  assertClean(guards);
});

test('LED draft follow-up keeps state, builds on natural confirmation, and answers wiring critique', async ({ page }) => {
  const guards = attachGuards(page);
  const messageRequests = [];

  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    messageRequests.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(validLedBlinkAgentResultFixture())
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/explain-target', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'main-chat-tutor-fallback',
        mode: 'local',
        servingStatus: 'live_tutor_fallback',
        fallbackReason: 'live tutor failed',
        message: 'The LED path is grounded by the built circuit: D9 drives the LED through the resistor, then returns to GND.',
        grounding: ['validation-report', 'simulation-plan'],
        suggestedQuestions: []
      })
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('LED 깜빡이기');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();
  await expect(page.locator('.message.assistant').last()).toContainText(/LED|D9|저항/);

  await page.locator('#idea-input').fill('좋아 구현 부탁해');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.getByTestId('build-progress')).toBeVisible();
  await page.getByTestId('build-progress-skip').click();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/LED|D9|GND/);
  await expect(page.getByTestId('context-evidence-panel')).toBeVisible();
  await expect(page.getByTestId('source-bundle-evidence')).toContainText(/digital-light-output/);
  await expect(page.getByTestId('source-bundle-evidence')).toContainText(/준비|ready/i);
  await page.getByTestId('file-explorer').getByText(/참고 자료|Context trace/).click();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/검증 자료|Verified support data/);
  await expect(page.getByTestId('requirement-markdown')).toContainText(/digital-light-output/);

  await page.locator('#idea-input').fill('전선 연결이 안되도 상관없니?');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/LED|연결|wire|missing|GND|D9/i);
  await expect(page.locator('.message.assistant').last().getByTestId('tutor-status')).toHaveAttribute('data-status', 'live_tutor_fallback');
  await expect(page.locator('.message.assistant').last()).not.toContainText(/structured circuit draft|Deepagents did not return/i);

  await page.locator('[data-tab="PCB"]').click();
  await expect(page.getByTestId('stage-canvas')).toBeVisible();
  await expect(page.getByTestId('connection-list')).toContainText(/D9|GND|LED/i);
  expect(messageRequests).toHaveLength(1);

  assertClean(guards);
});

test('server-blocked valid-looking drafts load as diagnostic simulations without becoming build-ready', async ({ page }) => {
  const guards = attachGuards(page);
  const messageRequests = [];

  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    messageRequests.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(validLookingButServerBlockedAgentResultFixture())
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('LED 깜빡이기');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/LED|D9|저항/);
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();
  await expect(page.locator('[data-action="run"]')).toBeDisabled();

  await page.locator('#idea-input').fill('좋아 구현 부탁해');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/3D 진단 시뮬레이션|전류 흐름/);
  await expectVisibleNonBlankStage(page);
  await expect(page.getByTestId('solver-gate-status')).toContainText(/3D 진단 시뮬레이션/);
  await expect(page.getByTestId('solver-gate-status')).not.toContainText(/diagnostic_simulation|build-ready claim is not verified|simulation has no validated current or signal path/i);
  await expect(page.getByTestId('simulation-toggle')).toBeDisabled();
  await expect(page.getByTestId('simulation-step')).toBeDisabled();
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  expect(messageRequests).toHaveLength(1);

  await page.locator('#idea-input').fill('LED 하나 더 추가해줘');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expect.poll(() => messageRequests.length).toBe(2);
  expect(messageRequests[1].conversationContext.currentArtifact).toMatchObject({
    source: 'built-project',
    solverGateResult: {
      visibleSimulation: true,
      buildReady: false
    }
  });
  expect(messageRequests[1].conversationContext.currentArtifact.renderPlan.layout.endpoints['arduino-uno:D9']).toMatchObject({ x: -1.22 });
  expect(messageRequests[1].conversationContext.lastSupportedGoal).toMatch(/blink an LED/);
  expect(messageRequests[1].conversationContext.pendingSupportedAlternative).toBeUndefined();
  expect(messageRequests[1].conversationContext.awaitingBuildConfirmation).toBe(false);

  assertClean(guards);
});

test('post-build revision request carries the current circuit artifact to the agent', async ({ page }) => {
  const guards = attachGuards(page);
  const messageRequests = [];

  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    messageRequests.push(body);
    const fixture = validLedBlinkAgentResultFixture();
    const isRevision = /버튼|button/i.test(body.message || '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...fixture,
        assistantMessages: [
          isRevision
            ? '현재 LED 깜빡이기 회로를 기준으로 버튼 입력을 추가하는 수정 초안입니다. 기존 LED, 저항, GND 연결을 유지하면서 버튼 입력 회로를 더합니다.'
            : fixture.assistantMessages[0]
        ],
        clarification: isRevision ? '현재 LED 회로에 버튼을 풀다운 입력으로 추가할까요?' : fixture.clarification
      })
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('LED 깜빡이기');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();

  await page.locator('#idea-input').fill('좋아 구현 부탁해');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.getByTestId('build-progress')).toBeVisible();
  await page.getByTestId('build-progress-skip').click();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/LED|D9|GND/);

  await page.locator('#idea-input').fill('LED 옆에 버튼도 추가해줘');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/현재 LED|버튼|button/i);

  expect(messageRequests).toHaveLength(2);
  const revisionRequest = messageRequests[1];
  expect(revisionRequest.conversationContext.currentArtifact.source).toBe('built-project');
  expect(revisionRequest.conversationContext.currentArtifact.circuitSpec).toBeTruthy();
  expect(revisionRequest.conversationContext.currentArtifact.simulationPlan).toBeTruthy();
  expect(revisionRequest.conversationContext.lastSupportedGoal).toMatch(/LED|blink/i);
  expect(revisionRequest.message).toContain('LED 옆에 버튼도 추가해줘');
  expect(revisionRequest.conversationContext.recentTurns.map((turn) => turn.text).join('\n')).toContain('LED 깜빡이기');

  assertClean(guards);
});

test('unsafe requests show a safe equivalent simulation without building the original request', async ({ page }) => {
  const guards = attachGuards(page);
  const messageRequests = [];

  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    messageRequests.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(unsupportedUnsafeAgentResultFixture())
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/explain-target', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'The verified safe-equivalent circuit has the LED, resistor, and GND return path connected; the original 220V wiring is not built.',
        mode: 'live',
        servingStatus: 'live_tutor_answer',
        suggestedQuestions: []
      })
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('220V 콘센트에 직접 연결해서 LED 켜고 싶어');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/안전|저전압|220V|대체 회로|시뮬레이션/i);
  await expect(page.getByTestId('interview-decisions')).toBeVisible();
  await expect(page.getByTestId('interview-decisions')).not.toContainText(/structured circuit draft|DEEPAGENTS COORDINATOR|coordinator/i);
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  await page.locator('[data-tab="PCB"]').click();
  await expectVisibleNonBlankStage(page);
  await expect(page.getByTestId('solver-gate-status')).toContainText(/안전|대체|safe|equivalent/i);
  await expect(page.getByTestId('simulation-toggle')).toBeDisabled();
  await expect(page.getByTestId('simulation-step')).toBeDisabled();
  await expect(page.getByTestId('build-progress')).toHaveCount(0);

  expect(messageRequests).toHaveLength(1);
  expect(messageRequests[0].message).toContain('220V');

  await page.locator('#idea-input').fill('전선 연결이 안되도 상관없니?');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/검증된 회로|전선|LED|GND|전류/i);

  expect(messageRequests).toHaveLength(1);

  assertClean(guards);
});

test('planned context gaps show student-friendly decision text without internal validation jargon', async ({ page }) => {
  const guards = attachGuards(page);
  const messageRequests = [];

  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    messageRequests.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...plannedContextGapAgentResultFixture(),
        assistantMessages: [
          '아직 이 센서 회로는 준비된 검증 자료가 부족해요. 대신 지원되는 Arduino Uno + 5mm LED + 220Ω 저항 기반의 디지털 LED 깜박임 회로로 진행할까요?'
        ]
      })
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('Show MCP3008 ADC channel value on the OLED display');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expect(page.locator('.message.assistant').last()).toContainText(/Arduino Uno|LED|220/);
  await expect(page.getByTestId('interview-decisions')).toBeVisible();
  await expect(page.getByTestId('interview-decisions')).toContainText(/지원|확인|Support|check/i);
  await expect(page.getByTestId('interview-decisions')).not.toContainText(/context-support-gap|canonical context|valid synthesis|support bundle|part-capability|simulation-primitive|artifact/i);
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  await page.locator('[data-tab="PCB"]').click();
  await expectVisibleNonBlankStage(page, 1000);
  await expect(page.getByTestId('solver-gate-status')).toContainText(/3D 진단|diagnostic/i);
  await expect(page.getByTestId('solver-gate-status')).not.toContainText(/context-support-gap|canonical context|valid synthesis|support bundle|part-capability|simulation-primitive|artifact|validation status is unsupported|simulation status is unsupported/i);
  await expect(page.getByTestId('render-warning-panel')).not.toContainText(/DIAGNOSTIC_RENDER_ONLY|context-support-gap|canonical context|valid synthesis|support bundle|part-capability|simulation-primitive|artifact|Validation status is unsupported/i);
  await expect(page.getByTestId('simulation-toggle')).toBeDisabled();

  await page.locator('#idea-input').fill('그래 그걸로 진행해보자');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expectVisibleNonBlankStage(page, 1000);
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  expect(messageRequests).toHaveLength(1);

  assertClean(guards);
});

for (const adjustmentCase of [
  {
    name: 'diagnostic_simulation',
    fixture: () => plannedContextGapAgentResultFixture(),
    message: 'Show MCP3008 ADC channel value on the OLED display',
    expectedMode: 'diagnostic_simulation',
    expectedActivity: 'diagnostic',
    expectedStatusText: /3D 진단|diagnostic/i,
    minPixels: 1000
  },
  {
    name: 'placeholder_part_simulation',
    fixture: () => placeholderPartAgentResultFixture(),
    message: 'Show this known classroom sensor module even though its exact 3D model is not ready',
    expectedMode: 'placeholder_part_simulation',
    expectedActivity: 'diagnostic',
    expectedStatusText: /자리 맞춤|대체 부품|placeholder/i,
    minPixels: 1000
  },
  {
    name: 'safe_equivalent_simulation',
    fixture: () => unsupportedUnsafeAgentResultFixture(),
    message: '220V 콘센트에 직접 연결해서 LED 켜고 싶어',
    expectedMode: 'safe_equivalent_simulation',
    expectedActivity: 'verified_current',
    expectedStatusText: /안전|대체|safe|equivalent/i,
    minPixels: 2000
  },
  {
    name: 'state_only',
    fixture: () => validLookingButServerBlockedAgentResultFixture(),
    message: 'LED 깜빡이기',
    expectedMode: 'diagnostic_simulation',
    expectedActivity: 'state_only',
    expectedStatusText: /상태 확인|3D 진단|3D 검토|state|diagnostic|review/i,
    minPixels: 2000,
    confirmBuild: true
  }
]) {
  test(`Phase 1 adjustment matrix presents ${adjustmentCase.name} without enabling unsupported controls`, async ({ page }) => {
    const guards = attachGuards(page);
    const fixture = adjustmentCase.fixture();

    expect(fixture.solverGateResult.visibleSimulation).toBe(true);
    expect(fixture.solverGateResult.mode).toBe(adjustmentCase.expectedMode);
    expect(fixture.solverGateResult.simulationActivity).toBe(adjustmentCase.expectedActivity);
    expect(fixture.solverGateResult.controls).toMatchObject({
      runEnabled: false,
      currentAnimationEnabled: false
    });
    expect(fixture.solverGateResult.safeToRenderEvidence.length).toBeGreaterThan(0);
    if (adjustmentCase.name === 'state_only') {
      expect(fixture.solverGateResult.buildReady).toBe(false);
      expect(fixture.simulationPlan.currentPaths).toHaveLength(0);
      expect(fixture.simulationPlan.expectedStates.length).toBeGreaterThan(0);
      expect(fixture.buildRunnableReport.expectedStateCount).toBeGreaterThan(0);
      expect(fixture.solverGateResult.presentationAdjustment).toMatchObject({
        kind: 'state_only'
      });
    }

    await loadAgentFixtureIntoPcb(page, fixture, adjustmentCase.message, {
      confirmBuild: adjustmentCase.confirmBuild === true
    });

    await expectVisibleNonBlankStage(page, adjustmentCase.minPixels);
    await expect(page.getByTestId('solver-gate-status')).toBeVisible();
    await expect(page.getByTestId('solver-gate-status')).toContainText(adjustmentCase.expectedStatusText);
    await expect(page.getByTestId('solver-gate-status')).not.toContainText(INTERNAL_ADJUSTMENT_COPY_PATTERN);
    await expect(page.locator('.message.assistant').last()).not.toContainText(INTERNAL_ADJUSTMENT_COPY_PATTERN);
    if (await page.getByTestId('render-warning-panel').isVisible().catch(() => false)) {
      await expect(page.getByTestId('render-warning-panel')).not.toContainText(INTERNAL_ADJUSTMENT_COPY_PATTERN);
    }
    await expect(page.getByTestId('simulation-toggle')).toBeDisabled();
    await expect(page.getByTestId('simulation-step')).toBeDisabled();
    await expect(page.locator('[data-action="run"]')).toBeDisabled();

    assertClean(guards);
  });
}

test('AI chat sends recent conversation context across requirement follow-ups', async ({ page }) => {
  const guards = attachGuards(page);
  const messageRequests = [];
  const assistantReplies = [
    '센서값을 표시하는 방향으로 진행할 수 있어요. 온도/습도, 조도, 거리 중 어떤 센서를 쓸까요?',
    '온도와 습도를 입력으로 쓰는 방향은 이해했어요. LED 밝기나 화면 표시 중 어떤 값이 변하면 좋을까요?',
    '지원되는 Arduino Uno + 5mm LED + 220Ω 저항 기반의 디지털 LED 깜박임 또는 ON/OFF 회로로 진행할까요?'
  ];

  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    messageRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...plannedContextGapAgentResultFixture(),
        assistantMessages: [assistantReplies[Math.min(messageRequests.length - 1, assistantReplies.length - 1)]],
        supportedAlternatives: messageRequests.length >= 3 ? [supportedLedAlternativeFixture('context-support-gap')] : [],
        clarification: null
      })
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('센서값 표시하기 해보자 어떤 센서들이 있어?');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/온도\/습도|센서/);

  await page.locator('#idea-input').fill('온도랑 습도를 기반으로 값이 변하는 걸로 해보자');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/LED 밝기|화면 표시/);

  await page.locator('#idea-input').fill('그래 너가 제안해준대로 진행해보자');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/디지털 LED|ON\/OFF/);

  expect(messageRequests).toHaveLength(3);
  expect(messageRequests[1].conversationContext.recentTurns.map((turn) => turn.text).join('\n')).toContain('온도/습도');
  expect(messageRequests[2].conversationContext.recentTurns.map((turn) => turn.text).join('\n')).toContain('LED 밝기나 화면 표시');
  expect(messageRequests[2].conversationContext.recentTurns.map((turn) => turn.text).join('\n')).toContain('온도랑 습도');

  assertClean(guards);
});

test('unsafe request keeps a safety response when the agent returns a structured-output error', async ({ page }) => {
  const guards = attachGuards(page);

  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        errorCode: 'AGENT_STRUCTURED_OUTPUT_MISSING',
        error: 'Deepagents did not return a structured circuit draft.'
      })
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('220V 콘센트에 직접 연결해서 LED 켜고 싶어');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/고전압|감전|화재|저전압|Arduino 5V/i);
  await expect(page.locator('.message.assistant').last()).not.toContainText(/structured circuit draft|Deepagents did not return/i);
  await expect(page.locator('[data-action="confirm"]')).toHaveCount(0);
  await expect(page.locator('[data-action="run"]')).toBeDisabled();
  await expect(page.getByTestId('stage-canvas')).toHaveCount(0);

  expect(guards.blockedRequests).toEqual([]);
  expect(guards.consoleErrors.filter((message) => !/502|Bad Gateway/i.test(message))).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
});

test('user idea text is rendered escaped, never injected as markup', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);

  const payload = '<img src=x onerror="window.__xss=1"> "quoted" & <b>bold</b>';
  await page.locator('#idea-input').fill(payload);
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  const studentMessage = page.locator('.message.student p');
  await expect(studentMessage).toContainText(payload);
  expect(await page.locator('.thread img').count()).toBe(0);
  expect(await page.locator('.thread b').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  assertClean(guards);
});

test('sending an idea shows a typing indicator before the assistant reply', async ({ page, request }) => {
  const guards = attachGuards(page);
  const configured = await isAgentConfigured(request);
  let releaseHealth = () => {};
  if (!configured) {
    await forceOfflineAgent(page);
    const healthGate = new Promise((resolve) => {
      releaseHealth = resolve;
    });
    await page.route('http://127.0.0.1:8799/api/agent/health', async (route) => {
      await healthGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          defaultMode: 'deepagents-unconfigured',
          provider: 'openai',
          model: null,
          hasServerKey: false,
          requiredEnv: ['OPENAI_API_KEY', 'H_EDUWARE_AGENT_MODEL']
        })
      });
    });
  }
  await dismissWelcome(page);

  await page.locator('#idea-input').fill('show some text on a little screen');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expect(page.getByTestId('ai-typing')).toBeVisible();
  releaseHealth();
  await expect(page.locator('.message.assistant').last()).toBeVisible({ timeout: configured ? 90000 : 10000 });
  await expect(page.getByTestId('ai-typing')).toHaveCount(0, { timeout: configured ? 90000 : 10000 });
  const assistantText = await page.locator('.message.assistant').last().textContent();
  if (configured) {
    expect(assistantText).not.toContain('OPENAI_API_KEY');
  } else {
    expect(assistantText).toMatch(/OPENAI_API_KEY|server|서버|Deepagents/i);
  }

  assertClean(guards);
});

test('confirming a live Deepagents circuit opens a live, interactive center build-progress popup', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'live build confirmation is covered on desktop');
  test.skip(!(await isAgentConfigured(request)), 'requires a configured live Deepagents model');
  const guards = attachGuards(page);
  await dismissWelcome(page);

  await page.locator('#idea-input').fill('Arduino Uno와 브레드보드로 I2C OLED에 HELLO STEM을 표시하는 회로를 만들어줘');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('[data-action="confirm"]')).toBeVisible({ timeout: 90000 });
  await page.locator('[data-action="confirm"]').click();

  const popup = page.getByTestId('build-progress');
  await expect(popup).toBeVisible();
  await expect(page.getByTestId('build-step').first()).toBeVisible();

  const readPercent = async () =>
    Number((await page.getByTestId('build-progress-value').textContent()).replace('%', ''));

  await expect.poll(readPercent).toBeGreaterThan(0);

  const pause = page.getByTestId('build-progress-pause');
  await pause.click();
  const paused = await readPercent();
  await page.waitForTimeout(700);
  expect(await readPercent()).toBe(paused);

  await pause.click();
  await page.getByTestId('build-progress-skip').click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByTestId('requirement-markdown')).toBeVisible();

  assertClean(guards);
});

test('the 3D circuit renders solder joints and detailed wire connectors', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();

  const canvas = page.getByTestId('stage-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-renderer', 'three');
  await expect(canvas).toHaveAttribute('data-render-ready', 'true');
  await expect(canvas).toHaveAttribute('data-interaction-mode', 'orbit');

  const solder = Number(await canvas.getAttribute('data-solder-count'));
  const connectors = Number(await canvas.getAttribute('data-connector-count'));
  const partGroups = Number(await canvas.getAttribute('data-part-group-count'));
  const wireGroups = Number(await canvas.getAttribute('data-wire-group-count'));
  const labelGroups = Number(await canvas.getAttribute('data-label-group-count'));
  const libraryParts = Number(await canvas.getAttribute('data-library-part-count'));
  expect(solder).toBeGreaterThanOrEqual(16);
  expect(connectors).toBe(8);
  expect(partGroups).toBeGreaterThanOrEqual(3);
  expect(wireGroups).toBeGreaterThanOrEqual(4);
  expect(labelGroups).toBeGreaterThanOrEqual(3);
  expect(libraryParts).toBe(0);

  const debugSnapshot = await canvas.evaluate((node) => node.__hEduwareStageDebug?.());
  expect(debugSnapshot.partGroupIds).toEqual(expect.arrayContaining(['arduino-uno', 'breadboard', 'oled-display']));
  expect(debugSnapshot.partGroupIds).not.toEqual(expect.arrayContaining(['photo-sensor', 'dc-motor']));
  expect(debugSnapshot.wireGroupIds).toEqual(expect.arrayContaining(['oled-power', 'oled-ground']));
  expect(debugSnapshot.labelGroupIds).toEqual(expect.arrayContaining(['arduino-uno', 'breadboard', 'oled-display']));
  expect(debugSnapshot.partWorldBounds['arduino-uno'].size.x).toBeGreaterThan(0.5);
  expect(debugSnapshot.wireRouteHash).toBe(await canvas.getAttribute('data-wire-route-hash'));
  expect(debugSnapshot.visualTransformRevision).toBe(0);

  assertClean(guards);
});

test('PCB tab puts the circuit canvas in the initial viewport on narrow screens', async ({ page }) => {
  const guards = attachGuards(page);
  await page.setViewportSize({ width: 893, height: 881 });
  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();

  const canvas = page.getByTestId('stage-canvas');
  await expect(canvas).toHaveAttribute('data-render-ready', 'true');
  await expect(canvas).toHaveAttribute('data-library-part-count', '0');
  await expect(canvas).toHaveAttribute('data-camera-fit', 'scene-bounds');

  const canvasBox = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(canvasBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(canvasBox.y).toBeLessThan(viewport.height * 0.85);
  expect(canvasBox.y + Math.min(canvasBox.height, 120)).toBeGreaterThan(0);
  expect(canvasBox.height).toBeLessThanOrEqual(viewport.height - canvasBox.y + 8);
  expect(countNonBackgroundPixels(await canvas.screenshot())).toBeGreaterThan(5000);

  assertClean(guards);
});

test('browser verification protocol covers files, PCB, inspector tutor, and run output', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8787/api/agent/explain-target', async (route) => {
    const body = route.request().postDataJSON();
    const label = body?.target?.label ?? body?.selectedTarget?.label ?? 'selected circuit target';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'tutor-browser-verification',
        mode: 'live',
        servingStatus: 'live_tutor_answer',
        message: `Live tutor answer grounded in ${label}.`,
        grounding: [body?.target?.id ?? 'target'],
        suggestedQuestions: []
      })
    });
  });
  await dismissWelcome(page);
  await loadDemo(page);

  const bodyText = await page.locator('body').textContent();
  expect(bodyText).not.toMatch(/sk-|OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL/);

  await page.locator('[data-tab="Files"]').click();
  await expect(page.getByTestId('requirement-markdown')).toBeVisible();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/Arduino|아두이노/);
  await expect(page.getByTestId('requirement-markdown')).toContainText(/OLED/);
  await expect(page.getByTestId('file-explorer')).toBeVisible();

  await page.locator('[data-tab="PCB"]').click();
  const canvas = page.getByTestId('stage-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-renderer', 'three');
  await expect(canvas).toHaveAttribute('data-render-ready', 'true');
  expect(countNonBackgroundPixels(await canvas.screenshot())).toBeGreaterThan(5000);
  await canvas.evaluate((node) => {
    node.dataset.persistMarker = 'before-inspector';
  });

  await expect(page.getByTestId('floating-card')).toHaveCount(0);
  await expect(page.locator('.floating-cards')).toHaveCount(0);
  await expect(page.getByTestId('circuit-hover-tooltip')).toHaveCount(1);
  await expect(page.getByTestId('connection-list')).toBeVisible();
  await expect(page.getByTestId('circuit-chat-toggle')).toBeVisible();
  await expect(page.getByTestId('circuit-chat-toggle')).toContainText(/회로 질문|Ask/);
  await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
  await page.getByTestId('circuit-chat-toggle').click();
  await expect.poll(() => canvas.evaluate((node) => node.dataset.persistMarker)).toBe('before-inspector');
  await expect(page.getByTestId('tutor-chat')).toBeVisible();
  await expect(page.getByTestId('tutor-chat')).toContainText(/전체 회로|Whole circuit/);
  await expect(page.locator('[data-action="ask-tutor"] input')).toBeFocused();
  await page.getByTestId('circuit-chat-toggle').click();
  await expect.poll(() => canvas.evaluate((node) => node.dataset.persistMarker)).toBe('before-inspector');
  await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
  await page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]').click();
  await expect.poll(() => canvas.evaluate((node) => node.dataset.persistMarker)).toBe('before-inspector');
  await expect(page.getByTestId('inspector-selected')).toContainText('I2C SDA');
  await page.getByTestId('circuit-chat-toggle').click();
  await expect(page.getByTestId('tutor-chat')).toBeVisible();
  await expect(page.getByTestId('tutor-chat')).toContainText('I2C SDA');
  await page.getByTestId('inspector-suggestions').getByRole('button').first().click();
  await expect(page.getByTestId('tutor-thread')).toContainText('I2C SDA');
  await page.getByTestId('circuit-chat-toggle').click();
  await expect(page.getByTestId('tutor-chat')).toHaveCount(0);

  await page.locator('[data-inspect-type="part"][data-inspect-id="oled-display"]').click();
  await expect(page.getByTestId('inspector-selected')).toContainText('OLED');

  await expect(page.locator('[data-action="run"]')).toBeEnabled();
  await page.locator('[data-action="run"]').click();
  await expect(page.getByTestId('oled-output')).toHaveText('RALPHTON BUSAN');
  await expect(page.getByText(/전류|Current|Run|실행/i).first()).toBeVisible();

  assertClean(guards);
});

test('circuit inspector lets students discuss a selected simulated connection', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8787/api/agent/explain-target', async (route) => {
    const body = route.request().postDataJSON();
    const label = body?.target?.label ?? body?.selectedTarget?.label ?? 'selected circuit target';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'tutor-inspector-discussion',
        mode: 'live',
        servingStatus: 'live_tutor_answer',
        message: `Live tutor answer grounded in ${label}.`,
        grounding: [body?.target?.id ?? 'target'],
        suggestedQuestions: []
      })
    });
  });
  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();

  await expect(page.getByTestId('circuit-inspector')).toBeVisible();
  await expect(page.getByTestId('circuit-chat-toggle')).toBeVisible();
  await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
  const sdaConnection = page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]');
  await expect(sdaConnection).toBeVisible();
  await sdaConnection.click();
  await expect(page.getByTestId('inspector-selected')).toContainText('I2C SDA');
  await sdaConnection.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector-selected')).toContainText('I2C SDA');

  await expect(page.locator('[data-action="open-circuit-chat"]')).toBeVisible();
  await page.getByTestId('circuit-chat-toggle').click();
  await expect(page.getByTestId('tutor-chat')).toBeVisible();
  await expect(page.getByTestId('tutor-chat')).toContainText('I2C SDA');
  await page.getByTestId('inspector-suggestions').getByRole('button').first().click();
  await expect(page.getByTestId('tutor-message')).toHaveCount(2);
  await expect(page.getByTestId('tutor-thread')).toContainText('I2C SDA');
  await page.getByTestId('circuit-chat-toggle').click();
  await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
  await expect(page.getByTestId('inspector-selected')).toContainText('I2C SDA');

  await page.locator('[data-inspect-type="part"][data-inspect-id="oled-display"]').click();
  await expect(page.getByTestId('inspector-selected')).toContainText('OLED');

  assertClean(guards);
});

test('circuit inspector renders live tutor suggested questions when server mode is enabled', async ({ page }) => {
  const guards = attachGuards(page);
  let tutorRequestBody = null;
  await page.route('http://127.0.0.1:8787/api/agent/explain-target', async (route) => {
    tutorRequestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'tutor-live-e2e',
        mode: 'live',
        servingStatus: 'live_tutor_answer',
        message: 'Live tutor answer grounded in the selected I2C SDA connection.',
        grounding: ['connection:oled-sda', 'live-deepagents-tutor'],
        suggestedQuestions: ['Why is SDA paired with SCL?', 'How can I verify this signal?']
      })
    });
  });

  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();
  await page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]').click();
  await page.getByTestId('circuit-chat-toggle').click();

  await page.getByTestId('inspector-suggestions').getByRole('button').first().click();
  await expect(page.getByTestId('tutor-thread')).toContainText('Live tutor answer grounded');
  await expect(page.getByTestId('tutor-status')).toHaveAttribute('data-status', 'live_tutor_answer');
  await expect(page.getByTestId('inspector-suggestions')).toContainText('Why is SDA paired with SCL?');
  await expect(page.getByTestId('inspector-suggestions')).toContainText('How can I verify this signal?');
  await expect.poll(() => tutorRequestBody?.artifacts?.contextCoverage?.synthesisEligibility?.status).toBe('eligible');
  await expect.poll(() => tutorRequestBody?.artifacts?.buildRunnableReport?.runnable).toBe(true);
  await expect.poll(() => tutorRequestBody?.artifacts?.solverGateResult?.buildReady).toBe(true);

  assertClean(guards);
});

test('keyboard user can select an inspector target without canvas picking', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);
  await loadDemo(page);
  await page.getByRole('button', { name: 'ENG' }).click();
  await page.locator('[data-tab="PCB"]').click();

  const selector = page.getByTestId('inspector-target-selector');
  await expect(selector).toBeVisible();
  await expect(selector).toContainText('I2C SDA');

  const sdaTarget = selector.locator('[data-action="select-target"][data-target-id="connection:oled-sda"]');
  await sdaTarget.focus();
  await expect(sdaTarget).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('selected-target-chip')).toContainText('I2C SDA');
  await expect(page.getByTestId('inspector-selected')).toContainText('I2C SDA');
  await expect(page.getByTestId('inspector-target-selector')).toHaveCount(0);

  assertClean(guards);
});

test('current flow replay controls step through circuit connections', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();

  await expect(page.getByTestId('simulation-toggle')).toBeVisible();
  await expect(page.getByTestId('simulation-toggle')).toContainText(/전류 보기|Show current/);
  await expect(page.getByTestId('simulation-step')).toBeVisible();

  await page.getByTestId('simulation-toggle').click();
  await expect(page.getByTestId('simulation-toggle')).toContainText(/일시정지|Pause/);
  await expect(page.getByTestId('oled-output')).toHaveText('RALPHTON BUSAN');

  await page.getByTestId('simulation-step').click();
  await expect(page.getByTestId('selected-target-chip')).toBeVisible();
  await expect(page.getByTestId('selected-target-chip')).toContainText(/5V POWER|5V/);
  await expect(page.getByTestId('inspector-selected')).toContainText(/5V POWER|5V/);
  await expect(page.getByTestId('stage-canvas')).toHaveAttribute('data-selected-target', 'connection:oled-power');

  await page.getByTestId('simulation-step').click();
  await expect(page.getByTestId('selected-target-chip')).toContainText(/GND/);
  await expect(page.getByTestId('stage-canvas')).toHaveAttribute('data-selected-target', 'connection:oled-ground');

  assertClean(guards);
});

test('visual move drags the OLED without changing the canonical circuit spec', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();

  const canvas = page.getByTestId('stage-canvas');
  const runButton = page.locator('[data-action="run"]');
  const visualMoveToggle = page.getByTestId('visual-move-toggle');
  const visualReset = page.getByTestId('visual-arrangement-reset');
  const visualUndo = page.getByTestId('visual-arrangement-undo');

  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-renderer', 'three');
  await expect(canvas).toHaveAttribute('data-interaction-mode', 'orbit');
  await expect(visualMoveToggle).toBeVisible();
  await expect(visualReset).toBeVisible();
  await expect(visualUndo).toBeVisible();

  await page.locator('[data-inspect-type="part"][data-inspect-id="oled-display"]').click();
  await expect(page.getByTestId('inspector-selected')).toContainText('OLED');

  const baselineDebug = await readStageDebugSnapshot(canvas);
  expect(baselineDebug).toBeTruthy();
  const baselineOledBounds = baselineDebug.partWorldBounds['oled-display'];
  const baselineOledPosition = baselineDebug.partPositions['oled-display'];
  const baselineCircuitSpecHash = baselineDebug.circuitSpecHash;
  const baselineWireRouteHash = baselineDebug.wireRouteHash;
  const baselineRunEnabled = await runButton.isEnabled();
  const baselinePreviewHash = baselineDebug.previewWireRouteHash;

  expect(baselineDebug.interactionMode).toBe('orbit');
  expect(baselineDebug.visualTransformRevision).toBe(0);
  expect(baselinePreviewHash).toBe('');
  expect(baselineOledBounds).not.toBeNull();
  const baselineCenter = boxCenter(baselineOledBounds);

  await visualMoveToggle.click();
  await expect(canvas).toHaveAttribute('data-interaction-mode', 'visual_move');

  const screenPoint = await readStagePartScreenPoint(canvas, 'oled-display');
  expect(screenPoint).toBeTruthy();

  const dragAttempts = [
    { startX: screenPoint.x, startY: screenPoint.y, deltaX: 88, deltaY: -28 },
    { startX: screenPoint.x, startY: screenPoint.y, deltaX: -72, deltaY: -24 },
    { startX: screenPoint.x, startY: screenPoint.y, deltaX: 96, deltaY: -18 }
  ];

  let movedDebug = null;
  for (const attempt of dragAttempts) {
    const startX = attempt.startX;
    const startY = attempt.startY;
    const endX = startX + attempt.deltaX;
    const endY = startY + attempt.deltaY;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const snapshot = await readStageDebugSnapshot(canvas);
    if (!snapshot) {
      continue;
    }
    const snapshotOledBounds = snapshot.partWorldBounds['oled-display'];
    if (!snapshotOledBounds) {
      continue;
    }
    if (
      snapshot.visualTransformRevision > baselineDebug.visualTransformRevision
      && snapshot.previewWireRouteHash
      && snapshot.previewWireRouteHash !== baselinePreviewHash
      && vectorDistance(boxCenter(snapshotOledBounds), baselineCenter) > 0.05
    ) {
      movedDebug = snapshot;
      break;
    }
  }

  expect(movedDebug).not.toBeNull();
  expect(movedDebug.interactionMode).toBe('visual_move');
  expect(movedDebug.visualTransformRevision).toBeGreaterThan(baselineDebug.visualTransformRevision);
  expect(movedDebug.previewWireRouteHash).not.toBe('');
  expect(movedDebug.previewWireRouteHash).not.toBe(baselinePreviewHash);
  expect(movedDebug.circuitSpecHash).toBe(baselineCircuitSpecHash);
  expect(movedDebug.wireRouteHash).toBe(baselineWireRouteHash);
  expect(movedDebug.partPositions['oled-display']).toEqual(baselineOledPosition);
  expect(vectorDistance(boxCenter(movedDebug.partWorldBounds['oled-display']), baselineCenter)).toBeGreaterThan(0.05);
  expectHorizontalBoundsWithin(
    movedDebug.partWorldBounds['oled-display'],
    movedDebug.partWorldBounds.breadboard
  );
  expect(baselineRunEnabled).toBe(true);
  await expect(runButton).toBeDisabled();
  await expect(page.getByTestId('simulation-toggle')).toBeDisabled();
  await expect(page.getByTestId('visual-arrangement-status')).toBeVisible();

  await visualReset.click();
  await expect.poll(async () => (await readStageDebugSnapshot(canvas)).visualTransformRevision).toBeGreaterThan(movedDebug.visualTransformRevision);

  const resetDebug = await readStageDebugSnapshot(canvas);
  expect(resetDebug.interactionMode).toBe('visual_move');
  expect(resetDebug.previewWireRouteHash).toBe('');
  expect(resetDebug.circuitSpecHash).toBe(baselineCircuitSpecHash);
  expect(resetDebug.wireRouteHash).toBe(baselineWireRouteHash);
  expect(resetDebug.partPositions['oled-display']).toEqual(baselineOledPosition);
  expect(vectorDistance(boxCenter(resetDebug.partWorldBounds['oled-display']), baselineCenter)).toBeLessThan(0.08);
  await expect(runButton).toBeEnabled();
  await expect(page.getByTestId('simulation-toggle')).toBeEnabled();
  await expect(page.getByTestId('visual-arrangement-status')).toBeHidden();

  assertClean(guards);
});

test('hardware move resolves a dragged part through the placement API and replaces the canonical render plan', async ({ page }) => {
  const guards = attachGuards(page);
  const fixture = validLedBlinkAgentResultFixture();
  const placementRequests = [];

  await page.route('http://127.0.0.1:8787/api/agent/placement', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    placementRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(placementResolutionFixture(fixture, body.requestedTransform))
    });
  });

  await loadAgentFixtureIntoPcb(page, fixture, 'LED 깜빡이기 회로 만들어줘', { confirmBuild: true });

  const canvas = page.getByTestId('stage-canvas');
  const hardwareMoveToggle = page.getByTestId('hardware-move-toggle');
  const runButton = page.locator('[data-action="run"]');
  await expect(canvas).toBeVisible();
  await expect(hardwareMoveToggle).toBeVisible();
  await expect(hardwareMoveToggle).toBeEnabled();
  await expect(runButton).toBeEnabled();

  const baselineDebug = await readStageDebugSnapshot(canvas);
  const baselineCircuitSpecHash = baselineDebug.circuitSpecHash;
  const baselineWireRouteHash = baselineDebug.wireRouteHash;
  const baselineLedPosition = baselineDebug.partPositions['led-1'];
  const baselineLedCenter = boxCenter(baselineDebug.partWorldBounds['led-1']);
  const screenPoint = await readStagePartScreenPoint(canvas, 'led-1');
  expect(screenPoint).toBeTruthy();

  await hardwareMoveToggle.click();
  await expect(canvas).toHaveAttribute('data-interaction-mode', 'hardware_move');
  await page.mouse.move(screenPoint.x, screenPoint.y);
  await page.mouse.down();
  await page.mouse.move(screenPoint.x + 90, screenPoint.y - 24, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => placementRequests.length).toBe(1);
  expect(placementRequests[0]).toMatchObject({
    componentId: 'led-1',
    coordinateSpace: 'render_world',
    interactionSource: 'student_drag',
    snapPreference: 'nearest_legal'
  });
  expect(placementRequests[0].baseArtifact.circuitSpec.id).toBe(fixture.circuitSpec.id);
  expect(placementRequests[0]).not.toHaveProperty('accepted');
  expect(placementRequests[0]).not.toHaveProperty('blocked');

  let resolvedDebug = null;
  await expect.poll(async () => {
    const snapshot = await readStageDebugSnapshot(canvas);
    const ledPosition = snapshot?.partPositions?.['led-1'];
    if (!snapshot || !ledPosition) {
      return false;
    }
    if (JSON.stringify(ledPosition) === JSON.stringify(baselineLedPosition)) {
      return false;
    }
    resolvedDebug = snapshot;
    return true;
  }).toBe(true);
  expect(resolvedDebug.interactionMode).toBe('hardware_move');
  expect(resolvedDebug.buildReady).toBe(true);
  expect(resolvedDebug.circuitSpecHash).not.toBe(baselineCircuitSpecHash);
  expect(resolvedDebug.wireRouteHash).not.toBe(baselineWireRouteHash);
  expect(resolvedDebug.previewWireRouteHash).toBe('');
  expect(vectorDistance(boxCenter(resolvedDebug.partWorldBounds['led-1']), baselineLedCenter)).toBeGreaterThan(0.05);
  expectHorizontalBoundsWithin(
    resolvedDebug.partWorldBounds['led-1'],
    resolvedDebug.partWorldBounds.breadboard
  );
  await expect(runButton).toBeEnabled();
  await expect(page.getByTestId('placement-resolving-status')).toBeHidden();
  await expect(page.getByTestId('placement-error-status')).toBeHidden();

  assertClean(guards);
});

test('circuit chat drawer stays separate from hardware on desktop and compact on mobile', async ({ page }, testInfo) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();

  await page.getByTestId('circuit-chat-toggle').click();
  const drawer = page.getByTestId('tutor-chat');
  await expect(drawer).toBeVisible();

  const drawerBox = await drawer.boundingBox();
  const railBox = await page.getByTestId('circuit-inspector').boundingBox();
  const selectedBox = await page.getByTestId('inspector-selected').boundingBox();
  const viewport = page.viewportSize();
  expect(drawerBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(selectedBox).not.toBeNull();
  expect(viewport).not.toBeNull();

  if (testInfo.project.name.includes('mobile')) {
    const computedMaxHeight = await drawer.evaluate((node) => Number.parseFloat(getComputedStyle(node).maxHeight));
    expect(computedMaxHeight).toBeLessThanOrEqual(viewport.height * 0.64);
    expect(drawerBox.y).toBeGreaterThanOrEqual(viewport.height * 0.25);
    expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual(viewport.height - 4);
  } else {
    expect(drawerBox.x).toBeGreaterThanOrEqual(railBox.x - 1);
    expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(railBox.x + railBox.width + 1);
    expect(drawerBox.y).toBeGreaterThan(selectedBox.y + selectedBox.height - 1);
  }

  assertClean(guards);
});

test('closing circuit chat returns keyboard focus to the question toggle', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);
  await loadDemo(page);
  await page.locator('[data-tab="PCB"]').click();

  const toggle = page.getByTestId('circuit-chat-toggle');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tutor-chat')).toBeVisible();
  await expect(page.locator('[data-action="ask-tutor"] input')).toBeFocused();

  await page.getByRole('button', { name: /질문 닫기|Close/ }).click();
  await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
  await expect(page.getByTestId('circuit-chat-toggle')).toBeFocused();

  assertClean(guards);
});
