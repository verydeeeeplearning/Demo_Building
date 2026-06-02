import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';

const root = new URL('../', import.meta.url);
const outDir = new URL('../docs/evidence/hardware-adjustment/', import.meta.url);
const appUrl = 'http://127.0.0.1:4173/';

await mkdir(outDir, { recursive: true });

const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await waitForApp();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  await captureDemoBaseline(page);
  await captureVisualMove(page);
  await captureHardwareMove(page);
  await browser.close();
} finally {
  server.kill('SIGTERM');
}

async function waitForApp() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(appUrl);
      if (response.ok) return;
    } catch {
      // Keep waiting while Vite starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Timed out waiting for Vite evidence server.');
}

async function resetApp(page) {
  await page.goto(appUrl);
  const dismiss = page.getByTestId('welcome-dismiss');
  if (await dismiss.count()) {
    await dismiss.click();
  }
}

async function captureStage(page, filename) {
  const stage = page.getByTestId('center-stage');
  await stage.screenshot({ path: new URL(filename, outDir).pathname });
}

async function captureDemoBaseline(page) {
  await resetApp(page);
  await page.locator('[data-action="load-demo"]').first().click();
  await page.locator('[data-tab="PCB"]').click();
  await page.getByTestId('stage-canvas').waitFor({ state: 'visible' });
  await captureStage(page, '01-demo-baseline.png');
}

async function captureVisualMove(page) {
  await resetApp(page);
  await page.locator('[data-action="load-demo"]').first().click();
  await page.locator('[data-tab="PCB"]').click();
  const canvas = page.getByTestId('stage-canvas');
  await canvas.waitFor({ state: 'visible' });
  await page.getByTestId('visual-move-toggle').click();
  const point = await canvas.evaluate((node) => node.__hEduwareStagePartScreenPoint?.('oled-display'));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 96, point.y - 28, { steps: 12 });
  await page.mouse.up();
  await captureStage(page, '02-visual-move-preview.png');
}

async function captureHardwareMove(page) {
  const fixture = validLedFixture();
  await page.route('http://127.0.0.1:8787/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'evidence-fixture', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/message', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture)
    });
  });
  await page.route('http://127.0.0.1:8787/api/agent/placement', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(placementResolution(fixture, body.requestedTransform))
    });
  });
  await resetApp(page);
  await page.locator('#idea-input').fill('LED 깜빡이기 회로 만들어줘');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await page.getByTestId('ai-typing').waitFor({ state: 'detached' });
  await page.locator('#idea-input').fill('좋아 구현 부탁해');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await page.getByTestId('ai-typing').waitFor({ state: 'detached' });
  const buildProgress = page.getByTestId('build-progress');
  if (await buildProgress.count()) {
    await page.getByTestId('build-progress-skip').click();
  }
  await page.locator('[data-tab="PCB"]').click();
  const canvas = page.getByTestId('stage-canvas');
  await canvas.waitFor({ state: 'visible' });
  await page.getByTestId('hardware-move-toggle').click();
  const point = await canvas.evaluate((node) => node.__hEduwareStagePartScreenPoint?.('led-1'));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 90, point.y - 24, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await captureStage(page, '03-hardware-move-resolved.png');
}

function validLedFixture() {
  return {
    traceId: 'trace-evidence-led',
    sessionId: 'session-evidence-led',
    mode: 'live',
    assistantMessages: ['검증 가능한 LED 깜빡이기 회로 초안입니다.'],
    agentEvents: [],
    clarification: null,
    contextTrace: [{
      sourceId: 'registry:part-capabilities:led-5mm',
      sourceType: 'registry',
      reason: 'LED fixture for evidence capture',
      usedFields: ['pins', 'simulationModel']
    }],
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      sufficientFor: ['valid_circuit_synthesis'],
      synthesisEligibility: { status: 'eligible', reason: 'fixture' },
      requiredSourceTypes: ['registry'],
      presentSourceTypes: ['registry'],
      missingSourceTypes: [],
      warnings: []
    },
    requirementMarkdown: '# LED blinker\n\nArduino D9 drives an LED through a 220 ohm resistor.',
    circuitSpec: {
      id: 'evidence-led',
      title: 'LED blinker',
      intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
      components: [
        { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard' },
        { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
        { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor' },
        { id: 'led-1', partId: 'led-5mm', label: 'LED' }
      ],
      connections: [
        connection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio'),
        connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
        connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
      ],
      behavior: { runText: 'LED BLINK' },
      assumptions: ['A 220 ohm resistor limits LED current.'],
      unsupportedItems: [],
      clarificationNeeds: []
    },
    validationReport: { version: '2026-05-31', status: 'valid', errors: [], warnings: [], validatedCurrentPathIds: ['led-forward-current'], sourceVersion: '2026-05-31' },
    renderPlan: ledRenderPlan({ x: 1.25, y: 0.3, z: 0.2 }),
    simulationPlan: {
      status: 'valid',
      runText: 'LED BLINK',
      currentPaths: [{
        id: 'led-forward-current',
        kind: 'load-current',
        primitiveId: 'digital_on_off',
        label: 'LED forward current',
        from: 'arduino-uno:D9',
        through: ['resistor-1', 'led-1'],
        to: 'arduino-uno:GND',
        expectedCurrentMa: 13.6,
        animation: { color: '#ff4d3d', speed: 0.8 }
      }],
      expectedStates: [{ componentId: 'led-1', state: 'blinking', primitiveId: 'digital_on_off' }],
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
      attempts: [],
      verifiedClaims: ['render plan exposes 4 visible part(s)', 'build-ready runnable gate passed'],
      notVerified: ['bench test has not been performed'],
      visualWarnings: [],
      hardwareWarnings: [],
      repairSummary: ['No solver repair was required.']
    }
  };
}

function placementResolution(fixture, requestedTransform) {
  const moved = { x: 1.85, y: 0.35, z: 0.55 };
  const nextRenderPlan = ledRenderPlan(moved);
  return {
    status: 'resolved_build_ready',
    resolutionKind: 'resolved_build_ready',
    revision: 'evidence-placement-led',
    requestedTransform,
    adjustedTransform: { ...(requestedTransform ?? {}), position: moved },
    snapTarget: { surface: 'breadboard', regionId: 'breadboard-safe-region' },
    circuitSpec: {
      ...fixture.circuitSpec,
      components: fixture.circuitSpec.components.map((component) =>
        component.id === 'led-1' ? { ...component, position: moved } : component
      )
    },
    renderPlan: nextRenderPlan,
    validationReport: fixture.validationReport,
    simulationPlan: fixture.simulationPlan,
    buildRunnableReport: fixture.buildRunnableReport,
    solverGateResult: fixture.solverGateResult,
    warnings: [],
    solverAttempts: [{ attempt: 1, stage: 'placement', action: 'Resolved student drag.', result: 'passed', warnings: [] }]
  };
}

function ledRenderPlan(ledPosition) {
  return {
    title: 'LED blinker',
    runText: 'LED BLINK',
    parts: [
      { id: 'breadboard', type: 'breadboard', label: 'Half-size breadboard', pins: [], position: { x: 0, y: 0, z: 0 } },
      { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', pins: [{ name: 'D9', role: 'pwm-output' }, { name: 'GND', role: 'ground' }], position: { x: -1.8, y: 0.28, z: 0.1 } },
      { id: 'resistor-1', type: 'resistor', label: '220 ohm resistor', designator: 'R1', pins: [{ name: '1', role: 'passive-terminal' }, { name: '2', role: 'passive-terminal' }], position: { x: 0.65, y: 0.28, z: 0.2 } },
      { id: 'led-1', type: 'led', label: 'LED', designator: 'D1', pins: [{ name: 'A', role: 'anode' }, { name: 'K', role: 'cathode' }], position: ledPosition }
    ],
    connections: [
      renderConnection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio', '#2f7df6', ledPosition),
      renderConnection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio', '#2f7df6', ledPosition),
      renderConnection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground', '#20242a', ledPosition)
    ],
    floatingCards: [],
    warnings: [],
    layout: {
      endpoints: {
        'arduino-uno:D9': { x: -1.22, y: 0.72, z: -0.44 },
        'arduino-uno:GND': { x: -1.36, y: 0.72, z: -0.64 },
        'resistor-1:1': { x: 0.23, y: 0.36, z: 0.2 },
        'resistor-1:2': { x: 1.07, y: 0.36, z: 0.2 },
        'led-1:A': { x: ledPosition.x - 0.08, y: ledPosition.y + 0.12, z: ledPosition.z + 0.14 },
        'led-1:K': { x: ledPosition.x + 0.08, y: ledPosition.y + 0.12, z: ledPosition.z + 0.14 }
      }
    }
  };
}

function connection(id, fromId, fromPin, toId, toPin, signal) {
  return { id, from: { componentId: fromId, pin: fromPin }, to: { componentId: toId, pin: toPin }, signal };
}

function renderConnection(id, fromId, fromPin, toId, toPin, signal, color, ledPosition) {
  return {
    id,
    from: { partId: fromId, pin: fromPin },
    to: { partId: toId, pin: toPin },
    signal,
    color,
    route: [
      { x: fromId === 'led-1' ? ledPosition.x : 0.2, y: 0.62, z: fromId === 'led-1' ? ledPosition.z : 0.2 },
      { x: ledPosition.x / 2, y: 1.1, z: ledPosition.z + 0.18 },
      { x: toId === 'led-1' ? ledPosition.x : 0.8, y: 0.62, z: toId === 'led-1' ? ledPosition.z : 0.2 }
    ],
    education: { label: id, title: id, what: 'Verified evidence fixture wire.', why: 'Used for evidence capture.', missing: 'The path would open.' }
  };
}
