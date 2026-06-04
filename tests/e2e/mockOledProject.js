import { expect } from '@playwright/test';

const MOCK_OLED_PROMPT = 'Show RALPHTON BUSAN on an I2C OLED with Arduino Uno and a breadboard.';
const AGENT_MESSAGE_ROUTE = '**/api/agent/message';
const AGENT_HEALTH_ROUTE = '**/api/agent/health';

export function validOledAgentResultFixture() {
  return {
    sessionId: 'session-oled-e2e',
    mode: 'live',
    assistantMessages: [
      'Verified OLED text-display circuit draft ready. Arduino Uno powers the I2C OLED, shares ground, and sends SDA/SCL data for the RALPHTON BUSAN screen text.'
    ],
    agentEvents: [
      { type: 'coordinator', name: 'deepagents-coordinator', status: 'completed', summary: 'Created OLED text display draft.' }
    ],
    clarification: null,
    contextTrace: [
      { sourceId: 'memory:agent-operating-memory', sourceType: 'memory', reason: 'Loaded operating memory.', usedFields: ['validation-before-simulation'] },
      { sourceId: 'sources:support-bundle:display-text-output', sourceType: 'data', reason: 'I2C OLED text output has complete verified support data.', usedFields: ['bundleId', 'status', 'sourceClaimIds'], summary: 'complete' },
      { sourceId: 'registry:part-capabilities:oled-i2c-096', sourceType: 'registry', reason: 'Matched I2C OLED output.', usedFields: ['pins', 'protocols'] }
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
    requirementMarkdown: [
      '# Project Requirement: OLED Name Display',
      '',
      'Arduino Uno displays **RALPHTON BUSAN** on a 0.96 inch I2C OLED using a breadboard.',
      '',
      '## Connections',
      '',
      '- Arduino Uno 5V -> OLED VCC',
      '- Arduino Uno GND -> OLED GND',
      '- Arduino Uno A4/SDA -> OLED SDA',
      '- Arduino Uno A5/SCL -> OLED SCL'
    ].join('\n'),
    circuitSpec: {
      id: 'oled-name-display',
      title: 'OLED Name Display',
      intent: { primaryGoal: 'show RALPHTON BUSAN on an OLED display', output: 'oled-display', controller: 'arduino-uno' },
      components: [
        { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard' },
        { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
        { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED' }
      ],
      connections: [
        { id: 'oled-power', from: { componentId: 'arduino-uno', pin: '5V' }, to: { componentId: 'oled-display', pin: 'VCC' }, signal: 'power' },
        { id: 'oled-ground', from: { componentId: 'arduino-uno', pin: 'GND' }, to: { componentId: 'oled-display', pin: 'GND' }, signal: 'ground' },
        { id: 'oled-sda', from: { componentId: 'arduino-uno', pin: 'A4/SDA' }, to: { componentId: 'oled-display', pin: 'SDA' }, signal: 'i2c-data' },
        { id: 'oled-scl', from: { componentId: 'arduino-uno', pin: 'A5/SCL' }, to: { componentId: 'oled-display', pin: 'SCL' }, signal: 'i2c-clock' }
      ],
      behavior: { runText: 'RALPHTON BUSAN' },
      assumptions: ['The OLED module uses the standard Arduino Uno I2C pins A4/SDA and A5/SCL.'],
      unsupportedItems: [],
      clarificationNeeds: []
    },
    validationReport: {
      version: '2026-05-31',
      status: 'valid',
      errors: [],
      warnings: [],
      validatedCurrentPathIds: ['oled-module-current', 'oled-bus-activity'],
      sourceVersion: '2026-05-31'
    },
    renderPlan: {
      title: 'OLED Name Display',
      runText: 'RALPHTON BUSAN',
      parts: [
        { id: 'breadboard', type: 'breadboard', label: 'Half-size breadboard', pins: [], position: { x: 0, y: 0, z: 0 } },
        {
          id: 'arduino-uno',
          type: 'arduino',
          label: 'Arduino Uno',
          pins: [
            { name: '5V', role: 'power' },
            { name: 'GND', role: 'ground' },
            { name: 'A4/SDA', role: 'i2c-data' },
            { name: 'A5/SCL', role: 'i2c-clock' }
          ],
          position: { x: -1.8, y: 0.28, z: 0.1 }
        },
        {
          id: 'oled-display',
          type: 'oled',
          label: '0.96 inch I2C OLED',
          designator: 'DISP1',
          pins: [
            { name: 'VCC', role: 'power' },
            { name: 'GND', role: 'ground' },
            { name: 'SDA', role: 'i2c-data' },
            { name: 'SCL', role: 'i2c-clock' }
          ],
          position: { x: 1.45, y: 0.32, z: -0.35 }
        }
      ],
      connections: [
        renderConnection('oled-power', '5V POWER', 'OLED power', 'Arduino 5V powers the OLED module.', 'The OLED needs a stable 5V supply.', 'Without this wire the display stays off.', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power', '#ef4444'),
        renderConnection('oled-ground', 'GND', 'OLED ground return', 'This closes the OLED power loop back to Arduino ground.', 'I2C signals need a shared reference ground.', 'Without ground the display and bus are unreliable.', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground', '#20242a'),
        renderConnection('oled-sda', 'I2C SDA', 'I2C SDA data', 'Arduino A4/SDA sends text data to the OLED.', 'SDA carries the I2C data bits for the screen contents.', 'Without SDA the OLED cannot receive text.', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data', '#2f7df6'),
        renderConnection('oled-scl', 'I2C SCL', 'I2C SCL clock', 'Arduino A5/SCL clocks the OLED data transfer.', 'SCL tells the OLED when to sample each I2C data bit.', 'Without SCL the bus cannot synchronize.', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock', '#38a169')
      ],
      floatingCards: [],
      warnings: [],
      layout: {
        endpoints: {
          'arduino-uno:5V': { x: -1.22, y: 0.72, z: -0.36 },
          'arduino-uno:GND': { x: -1.36, y: 0.72, z: -0.64 },
          'arduino-uno:A4/SDA': { x: -1.16, y: 0.72, z: -0.52 },
          'arduino-uno:A5/SCL': { x: -1.08, y: 0.72, z: -0.58 },
          'oled-display:VCC': { x: 1.1, y: 0.72, z: -0.45 },
          'oled-display:GND': { x: 1.35, y: 0.72, z: -0.45 },
          'oled-display:SDA': { x: 1.6, y: 0.72, z: -0.45 },
          'oled-display:SCL': { x: 1.85, y: 0.72, z: -0.45 }
        }
      }
    },
    simulationPlan: {
      status: 'valid',
      runText: 'RALPHTON BUSAN',
      currentPaths: [
        {
          id: 'oled-module-current',
          kind: 'load-current',
          primitiveId: 'display_static_text',
          label: 'OLED module current',
          from: 'arduino-uno:5V',
          through: ['oled-display'],
          to: 'arduino-uno:GND',
          expectedCurrentMa: 18,
          animation: { color: '#ef4444', speed: 0.55 }
        },
        {
          id: 'oled-bus-activity',
          kind: 'signal-activity',
          primitiveId: 'i2c_bus_activity',
          label: 'I2C text data activity',
          from: 'arduino-uno:A4/SDA',
          through: ['oled-display'],
          to: 'oled-display:SDA',
          animation: { color: '#2f7df6', speed: 0.9 }
        }
      ],
      expectedStates: [
        { componentId: 'oled-display', state: 'shows RALPHTON BUSAN', primitiveId: 'display_static_text', explanation: 'The OLED receives I2C data and displays the requested text.' }
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
      renderPartCount: 3,
      currentPathCount: 2,
      expectedStateCount: 1
    },
    solverGateResult: {
      visibleSimulation: true,
      mode: 'verified_build_simulation',
      buildReady: true,
      buildReadyScope: 'original',
      simulationActivity: 'verified_current',
      benchConfirmed: false,
      repairLevel: 'none',
      presentationAdjustment: { kind: 'verified_build_simulation', reason: 'Fixture is a verified build simulation.' },
      controls: {
        runEnabled: true,
        currentAnimationEnabled: true,
        hardwareMoveEnabled: false,
        visualMoveEnabled: true,
        shareEnabled: true
      },
      attempts: [{
        attempt: 1,
        stage: 'placement',
        action: 'Existing render and simulation artifacts passed the strict build-ready gate.',
        result: 'passed',
        warnings: []
      }],
      verifiedClaims: ['render plan exposes 3 visible part(s)', 'build-ready runnable gate passed'],
      notVerified: ['bench test has not been performed'],
      visualWarnings: [],
      hardwareWarnings: [],
      repairSummary: ['No solver repair was required by the initial adapter.'],
      safeToRenderEvidence: ['render plan exposes 3 visible part(s)']
    }
  };
}

export async function loadMockOledProject(page) {
  await installOneShotMockOledAgent(page);
  await page.locator('#idea-input').fill(MOCK_OLED_PROMPT);
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.getByTestId('ai-typing')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('[data-action="confirm"]')).toBeVisible({ timeout: 10000 });

  await page.locator('#idea-input').fill('Build it');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  const buildProgress = page.getByTestId('build-progress');
  await expect(buildProgress).toBeVisible({ timeout: 10000 });
  await page.getByTestId('build-progress-skip').click();
  await expect(buildProgress).toHaveCount(0);
  await expect(page.getByTestId('requirement-markdown')).toBeVisible({ timeout: 10000 });
}

async function installOneShotMockOledAgent(page) {
  await page.route(AGENT_HEALTH_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        defaultMode: 'deepagents-live',
        provider: 'openai',
        model: 'mock-e2e',
        hasServerKey: true,
        requiredEnv: []
      })
    });
  });

  const handler = async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(validOledAgentResultFixture())
    });
    await page.unroute(AGENT_MESSAGE_ROUTE, handler).catch(() => {});
  };
  await page.route(AGENT_MESSAGE_ROUTE, handler);
}

function renderConnection(id, label, title, what, why, missing, fromPart, fromPin, toPart, toPin, signal, color) {
  return {
    id,
    from: { partId: fromPart, pin: fromPin },
    to: { partId: toPart, pin: toPin },
    signal,
    color,
    education: { label, title, what, why, missing }
  };
}
