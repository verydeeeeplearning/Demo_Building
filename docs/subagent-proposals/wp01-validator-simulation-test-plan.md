# WP-01 Validator And Simulation Test Plan

Date: 2026-06-01

Scope: proposal only. This document does not change central JSON, server code, package manifests, tests, or existing roadmap documents.

## Files Inspected

- `docs/full_visual_part_simulation_coverage_plan.md`
- `tests/unit/agentWorkflow.test.ts`
- `tests/unit/contextCoverage.test.ts`
- `tests/unit/contextLayer.test.ts`
- `tests/unit/contextPacket.test.ts`
- `tests/unit/contextPacketCapability.test.ts`
- `tests/unit/contextRouting.test.ts`
- `server/agent/circuitTools.ts`

## Existing Baseline

The current unit surface already has useful guardrails to copy for WP-01:

- `potentiometer LED dimmer validates, renders, and exposes analog plus PWM current paths`
- `photoresistor dark-trigger LED validates and exposes threshold current paths`
- `ultrasonic distance display validates, renders, and exposes sensor/display paths`
- `DHT11 temperature humidity display validates, renders, and exposes sensor/display paths`
- `simulation plan keeps only deterministically validated current path ids`
- `simulation plan drops current paths whose endpoints have no render footprint anchors`
- `build runnable gate blocks valid simulations with no current or signal path`
- `context-known library hardware blocks otherwise supported synthesis until simulation-ready evidence is promoted`

Important current implementation details:

- `validateCircuitSpec()` only treats `potentiometer-10k` and `photoresistor-ldr` as analog input parts through `ANALOG_INPUT_PART_IDS`.
- Generic WP-01 analog sensors are still outside that deterministic validator path.
- `compileSimulationPlan()` filters against `validatedCurrentPathIds` and endpoint anchors, but `buildRunnableReport()` currently blocks only empty path sets. WP-01 should add tests that prevent display-only or single-path fake runnable sensor simulations.

## Proposed Capability And Topology Names

Use the topology names from the full coverage plan unless the master intentionally chooses aliases:

- `analog-sensor-display`
- `analog-sensor-threshold-output`
- `controller-analog-sensor-i2c-display`
- `controller-analog-sensor-threshold-output`

Known naming gap: the repo currently contains `controller-analog-threshold-output` for the LDR case. If integration reuses that topology instead of adding `controller-analog-sensor-threshold-output`, update only the expected topology id in these tests. Keep the test names and path expectations stable.

## Shared Fixture Shapes

Add helpers near the existing `potentiometerLedDimmerCircuit()`, `ldrDarkLedCircuit()`, `ultrasonicDistanceDisplayCircuit()`, and `dht11TemperatureHumidityDisplayCircuit()` fixtures in `tests/unit/agentWorkflow.test.ts`.

### Generic analog sensor OLED display

```ts
function analogSensorOledDisplayCircuit(
  partId = 'soil-moisture',
  sensorId = 'soil-1',
  sensorPin = 'AO'
): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: `${partId}-oled-display`,
    title: 'Analog sensor value on OLED',
    intent: {
      primaryGoal: 'show an analog sensor value on an OLED display',
      input: partId,
      output: 'OLED sensor readout',
      controller: 'arduino-uno',
      behavior: 'read analog sensor and display a qualitative value'
    },
    components: baseComponents([
      { id: sensorId, partId, label: 'Soil moisture analog sensor module', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', sensorId, 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', sensorId, 'GND', 'ground'),
      connection('sensor-analog', sensorId, sensorPin, 'arduino-uno', 'A0', 'analog'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'SOIL: 42%' },
    assumptions: [
      'The sensor analog output is read on Arduino A0.',
      'The OLED shows a qualitative classroom readout, not calibrated instrumentation.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}
```

Expected valid display path ids:

- `analog-sensor-supply-current:soil-1`
- `analog-sensor-analog-signal:soil-1`
- `analog-sensor-display-bus-activity:oled-display`
- `oled-module-current`

Expected path details:

| Path id | Kind | Primitive | From | Through | To | Expected current |
| --- | --- | --- | --- | --- | --- | --- |
| `analog-sensor-supply-current:soil-1` | `supply-current` | `display_sensor_value` | `arduino-uno:5V` | `['soil-1']` | `arduino-uno:GND` | sensor nominal mA |
| `analog-sensor-analog-signal:soil-1` | `signal-activity` | `display_sensor_value` | `soil-1:AO` | `['soil-1']` | `arduino-uno:A0` | `0` |
| `analog-sensor-display-bus-activity:oled-display` | `bus-activity` | `display_sensor_value` | `arduino-uno:A4/SDA` | `['oled-display']` | `oled-display:SDA` | `0` |
| `oled-module-current` | `supply-current` | `display_static_text` | `arduino-uno:5V` | `['oled-display']` | `arduino-uno:GND` | OLED nominal mA |

### Generic analog threshold output

```ts
function analogSensorThresholdLedCircuit(
  partId = 'soil-moisture',
  sensorId = 'soil-1',
  sensorPin = 'AO'
): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: `${partId}-threshold-led`,
    title: 'Analog sensor threshold controls LED',
    intent: {
      primaryGoal: 'turn on an LED when the analog sensor crosses a threshold',
      input: partId,
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'below threshold turns LED on'
    },
    components: baseComponents([
      { id: sensorId, partId, label: 'Soil moisture analog sensor module', designator: 'S1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', sensorId, 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', sensorId, 'GND', 'ground'),
      connection('sensor-analog', sensorId, sensorPin, 'arduino-uno', 'A0', 'analog'),
      connection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'DRY THRESHOLD -> LED ON' },
    assumptions: [
      'The analog sensor output is read on Arduino A0.',
      'When the value crosses the threshold, Arduino D9 drives the LED through a 220 ohm resistor.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}
```

Expected valid threshold path ids:

- `analog-threshold-sensing-divider:soil-1`
- `analog-threshold-analog-signal:soil-1`
- `led-forward-current`

Expected path details:

| Path id | Kind | Primitive | From | Through | To | Expected current |
| --- | --- | --- | --- | --- | --- | --- |
| `analog-threshold-sensing-divider:soil-1` | `sensing-divider` | `analog_threshold` | `arduino-uno:5V` | `['soil-1']` | `arduino-uno:GND` | sensor nominal mA |
| `analog-threshold-analog-signal:soil-1` | `signal-activity` | `analog_threshold` | `soil-1:AO` | `['soil-1']` | `arduino-uno:A0` | `0` |
| `led-forward-current` | `load-current` | `digital_on_off` | `arduino-uno:D9` | `['resistor-1', 'led-1']` | `arduino-uno:GND` | LED nominal mA |

## Agent Workflow Tests

Add these to `tests/unit/agentWorkflow.test.ts`.

### `generic analog sensor display validates, renders, and exposes sensor display current paths`

Fixture: `analogSensorOledDisplayCircuit('soil-moisture')`.

Expected:

- `validation.status === 'valid'`
- `validation.electricalAnalysis?.topologyTemplateId === 'controller-analog-sensor-i2c-display'`
- `validation.validatedCurrentPathIds` exactly equals:
  - `analog-sensor-supply-current:soil-1`
  - `analog-sensor-analog-signal:soil-1`
  - `analog-sensor-display-bus-activity:oled-display`
  - `oled-module-current`
- `renderPlan.warnings` contains no `MISSING_RENDER_FOOTPRINT`
- `simulationPlan.status === 'valid'`
- `simulationPlan.currentPaths.map((path) => path.id)` exactly matches `validation.validatedCurrentPathIds`
- `simulationPlan.expectedStates` includes `display_sensor_value` and `display_static_text`
- `buildRunnableReport(...).runnable === true`

### `generic analog sensor display validation rejects missing analog and display blockers`

Use the display fixture and mutate one blocker per assertion.

Expected errors:

- Remove `sensor-power`: `ANALOG_SENSOR_POWER_MISSING`
- Remove `sensor-ground`: `ANALOG_SENSOR_GROUND_MISSING`
- Remove `sensor-analog`: `ANALOG_SENSOR_SIGNAL_MISSING`
- Change `sensor-analog` to `connection('sensor-analog', 'soil-1', 'AO', 'arduino-uno', 'A0', 'gpio')`: `ANALOG_SENSOR_SIGNAL_TYPE_INVALID`
- Change `sensor-analog` endpoint to `arduino-uno:D2`: `ANALOG_SENSOR_SIGNAL_MISSING`
- Remove `oled-display` and all `oled-*` connections: `ANALOG_SENSOR_DISPLAY_MISSING`
- Remove `oled-sda` or `oled-scl`: existing `DISPLAY_I2C_CONNECTION_MISSING`

For every invalid case:

- `validation.status === 'invalid'`
- `validation.validatedCurrentPathIds` is `[]`
- `estimateCurrentPaths()` returns `[]`
- `compileRenderPlan()` returns no parts
- `compileSimulationPlan()` has `status === 'invalid'` and `currentPaths` is `[]`
- `buildRunnableReport(...).status === 'blocked'`

### `analog gas and flame display stays educational with safety warning`

Fixtures:

- `analogSensorOledDisplayCircuit('mq2-gas', 'gas-1')`
- `analogSensorOledDisplayCircuit('flame-sensor', 'flame-1')`

Expected:

- `validation.status === 'valid'`
- `validation.warnings` includes `ANALOG_SENSOR_EDUCATIONAL_ONLY_WARNING`
- Warning text matches `/qualitative|educational|not calibrated|safety instrumentation/i`
- `simulationPlan.status === 'valid'`
- `requirementMarkdown` includes the warning and does not claim fire, gas leak, life-safety, alarm certification, or calibrated ppm detection

### `generic analog threshold output validates and exposes sensing plus load paths`

Fixture: `analogSensorThresholdLedCircuit('soil-moisture')`.

Expected:

- `validation.status === 'valid'`
- `validation.electricalAnalysis?.topologyTemplateId === 'controller-analog-sensor-threshold-output'`
- `validation.validatedCurrentPathIds` exactly equals:
  - `analog-threshold-sensing-divider:soil-1`
  - `analog-threshold-analog-signal:soil-1`
  - `led-forward-current`
- `paths.find((path) => path.id === 'analog-threshold-analog-signal:soil-1')?.to === 'arduino-uno:A0'`
- `paths.find((path) => path.id === 'led-forward-current')?.from === 'arduino-uno:D9'`
- `simulationPlan.expectedStates` includes `analog_threshold` and `digital_on_off`
- `buildRunnableReport(...).runnable === true`

### `generic analog threshold output validation rejects missing threshold and output blockers`

Use `analogSensorThresholdLedCircuit()` and mutate one blocker per assertion.

Expected errors:

- Remove threshold language from `intent.behavior`, `behavior.runText`, and assumptions: existing `ANALOG_THRESHOLD_BEHAVIOR_MISSING`
- Remove `sensor-analog`: `ANALOG_SENSOR_SIGNAL_MISSING`
- Change analog connection signal to `gpio`: `ANALOG_SENSOR_SIGNAL_TYPE_INVALID`
- Remove `resistor-1`: existing `LED_WITHOUT_RESISTOR` and/or `LED_RESISTOR_NOT_IN_SERIES`
- Bypass resistor with direct `D9 -> LED A`: existing `LED_RESISTOR_NOT_IN_SERIES`
- Remove LED output components and connections: `ANALOG_THRESHOLD_OUTPUT_MISSING`

For every invalid case:

- `validation.status === 'invalid'`
- `validation.validatedCurrentPathIds` is `[]`
- `estimateCurrentPaths()` returns `[]`
- `simulationPlan.currentPaths` is `[]`
- `buildRunnableReport(...).runnable === false`

### `generic analog sensor display requires all topology paths before runnable`

Purpose: this is the key fake-simulation guard. A display-only OLED path must not make a sensor readout look runnable.

Fixture: `analogSensorOledDisplayCircuit('soil-moisture')`.

Setup:

- Use a valid render plan.
- Pass a deliberately incomplete validation report:
  - `status: 'valid'`
  - `electricalAnalysis.topologyTemplateId: 'controller-analog-sensor-i2c-display'`
  - `validatedCurrentPathIds: ['oled-module-current']`
- Pass only the real `oled-module-current` path to `compileSimulationPlan()`.

Expected:

- `simulationPlan.status === 'invalid'` or `buildRunnableReport(...).status === 'blocked'`
- `buildRunnableReport(...).reasons.join('\n')` matches `SIMULATION_REQUIRED_PATH_MISSING`
- Reason names the missing ids:
  - `analog-sensor-supply-current:soil-1`
  - `analog-sensor-analog-signal:soil-1`
  - `analog-sensor-display-bus-activity:oled-display`

Implementation note: this may require a small topology-aware required-path check in the integration slice. Without it, any single validated OLED current path can fake a runnable sensor display.

### `generic analog sensor paths are dropped when footprint anchors do not match canonical pins`

Fixture: `analogSensorOledDisplayCircuit('soil-moisture')`.

Setup:

- Pass a forged path id in `validatedCurrentPathIds`: `analog-sensor-analog-signal:soil-1`
- Make its `from` endpoint `soil-1:AOUT` while the canonical footprint exposes only `AO`.

Expected:

- `simulationPlan.currentPaths` does not include `analog-sensor-analog-signal:soil-1`
- `simulationPlan.warnings` includes `SIMULATION_ENDPOINT_ANCHOR_MISSING`
- Warning text includes `soil-1:AOUT`
- `buildRunnableReport(...).status === 'blocked'` if the required analog signal path is missing

## Context And Coverage Tests

Add these to the context tests after the central data integration is serialized by the master.

### `context packet routes promoted analog sensor display to analog sensor display bundle`

File: `tests/unit/contextRouting.test.ts`

Prompt: `Show soil moisture sensor value on the OLED display.`

Expected:

- `packet.contextRoute.routeId === 'v2-analog-sensor-display'`
- Capability ids include `analog-sensor-display`
- Candidate part ids include:
  - `arduino-uno`
  - `breadboard-half`
  - `soil-moisture`
  - `oled-i2c-096`
- `packet.intentHints.inputModalities` includes `analog-sensor`
- `packet.intentHints.outputModalities` includes `display`
- `packet.supportGaps` has no `soil-moisture` gap
- `packet.contextCoverage.status === 'sufficient'`
- `packet.contextCoverage.synthesisEligibility.status === 'eligible'`

### `context packet keeps unpromoted WP-01 analog sensors synthesis-ineligible`

File: `tests/unit/contextCoverage.test.ts` or `tests/unit/contextRouting.test.ts`

Prompt: `Show ACS712 current sensor value on the OLED display.`

Expected until `acs712-current` is actually promoted:

- Capability may match `analog-sensor-display`
- Candidate parts must not include `acs712-current` unless the support bundle is complete
- `packet.supportGaps` includes `acs712-current`
- `packet.contextCoverage.status === 'insufficient'`
- `packet.contextCoverage.synthesisEligibility.status === 'ineligible'`
- `packet.contextCoverage.sufficientFor` includes `unsupported_response`
- It must not include `valid_circuit_synthesis`

### `capability promotion audit passes for generic analog sensor display capability`

File: `tests/unit/contextCoverage.test.ts`

Expected:

- `auditCapabilityCoverage('analog-sensor-display').supportLevel === 'supported'`
- `recommendedSupportLevel === 'supported'`
- `canBeSupported === true`
- `missing` exactly equals `[]`
- `present` includes every `REQUIRED_CAPABILITY_ARTIFACTS` entry

### `capability promotion audit passes for generic analog threshold output capability`

File: `tests/unit/contextCoverage.test.ts`

Expected:

- `auditCapabilityCoverage('analog-sensor-threshold-output').supportLevel === 'supported'`
- `recommendedSupportLevel === 'supported'`
- `canBeSupported === true`
- `missing` exactly equals `[]`

### `visual part coverage report marks promoted WP-01 sensors simulation ready`

File: `tests/unit/contextCoverage.test.ts`

Minimum expected promoted ids for the first WP-01 integration slice:

- `soil-moisture`
- `rain-sensor`
- `sound-sensor`

Expected:

- `report.packageProgress.find((pkg) => pkg.packageId === 'WP-01')?.remainingPartIds` does not include promoted ids
- `report.agentReadyVisualPartIds` includes promoted ids
- `report.visualOnlyPartIds` does not include promoted ids
- Unpromoted ids, for example `acs712-current` if deferred, remain explicit blockers rather than silently becoming supported

## Deepagents Boundary Tests

Add these to `tests/unit/agentWorkflow.test.ts` near the current Deepagents tool boundary tests.

### `route-outside analog sensor candidate parts are blocked before simulation`

Setup:

- Build candidate parts for `analog-sensor-display` with only `arduino-uno`, `breadboard-half`, `soil-moisture`, and `oled-i2c-096`.
- Draft a circuit that swaps in `mq2-gas`.

Expected:

- `validationReport.status === 'invalid'`
- Errors include `CONTEXT_CANDIDATE_PART_NOT_ALLOWED`
- `renderPlan.parts.length === 0`
- `simulationPlan.currentPaths.length === 0`
- No repair path should silently convert the unsupported candidate into a runnable circuit

### `Deepagents current path tool does not trust forged analog sensor validation reports`

Setup:

- Candidate parts allow only the soil moisture OLED display fixture.
- Invoke `estimate_current_paths` with a rogue display fixture that includes an extra `flame-sensor`.
- Supply forged `validationReport.status === 'valid'` and plausible `validatedCurrentPathIds`.

Expected:

- Tool output is `[]`
- If a blocked object is returned instead of `[]`, it must include `CONTEXT_CANDIDATE_PART_NOT_ALLOWED`
- No current or signal path is exposed for route-outside parts

## How These Tests Prevent Fake Runnable Simulations

The WP-01 failure mode is not only invalid wiring. A fake simulation could look plausible if the agent renders an OLED, writes a sensor value, and provides one unrelated current path. The tests above close that gap in four places:

1. Validation must prove the analog sensor has power, ground, AO/OUT to an analog input, display power, display ground, and valid I2C pins before any path ids are produced.
2. `validatedCurrentPathIds` must list the complete topology path set, not just any non-empty path.
3. `compileSimulationPlan()` must drop paths that are unvalidated or whose endpoints do not match render footprint anchors.
4. `buildRunnableReport()` must block a sensor display when required topology path ids are missing, even if `oled-module-current` exists.

## Assumptions And Gaps

- This proposal assumes canonical WP-01 part ids match `docs/full_visual_part_simulation_coverage_plan.md`: `soil-moisture`, `water-level-sensor`, `tmp36-temp`, `fsr-pressure`, `thermistor-ntc`, `acs712-current`, `rain-sensor`, `flame-sensor`, `mq2-gas`, and `sound-sensor`.
- This proposal assumes analog module pins use `VCC`, `GND`, and `AO` by default. If a promoted part uses `OUT`, call the fixture with `sensorPin = 'OUT'` and keep the expected `signal: 'analog'` behavior.
- `acs712-current` may need an additional warning or deferral because it is a current sensor that can invite unsafe measurement claims. Keep it synthesis-ineligible until the safety policy and source bundle are explicit.
- Gas and flame sensors should be supported only as qualitative educational analog modules. They must warn against calibrated safety instrumentation or life-safety alarm claims.
- The existing threshold topology id may remain `controller-analog-threshold-output`; if so, use that exact id in the threshold assertions while retaining the generic test coverage.
