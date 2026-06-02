# WP-01 Analog Sensor Promotion Proposal

Created: 2026-06-01

Scope: documentation-only proposal for promoting the 10 remaining WP-01 visual
parts to simulation-ready contracts. This file does not change central context
JSON, server code, tests, package metadata, or existing plan documents.

Inputs used:

- `docs/full_visual_part_simulation_coverage_plan.md`
- `docs/visual_part_simulation_coverage_report.md`
- `src/partLibraryData.js`
- Existing context conventions from `agent-context/registry/part-capabilities.json`,
  `agent-context/registry/visual-library-crosswalk.json`,
  `agent-context/electrical/topology-templates.json`, and
  `agent-context/simulation/primitives.json`

## Shared WP-01 Contract Rules

- Target support: `supportLevel: supported`, `supportTier: simulation-ready`.
- Target risk: low-voltage classroom simulation only unless noted otherwise.
- Default controller/display path: Arduino Uno 5V/GND, analog input on A0,
  optional digital threshold input on D2, OLED 0.96 I2C on A4/SDA and A5/SCL.
- Display readout topology proposal: `controller-analog-sensor-i2c-display`
  for T07 analog sensor to OLED display. This topology is a proposed sibling of
  the existing `controller-single-wire-sensor-i2c-display` and
  `controller-distance-sensor-i2c-display` templates.
- Threshold output topology: use existing `controller-analog-threshold-output`
  for T08 when the module exposes a threshold output or the controller computes
  a threshold from analog input.
- Analog-only topology proposal: `controller-analog-input-readout` for T06 when
  a circuit only reads the sensor value without display or output.
- Simulation paths must separate load current from information signals:
  sensor power paths are supply current, analog/digital pins are signal
  activity, OLED SDA/SCL are bus activity, and current-flow dots only appear on
  validator-approved supply or output paths.
- Source claims remain required before central integration. This proposal names
  the intended contracts but does not assert that source evidence has already
  been collected.

## Proposed Contracts

In each YAML block, `id` is the proposed canonical agent part id.

### soil-moisture

```yaml
visualPartId: soil-moisture
id: soil-moisture-sensor
label: Soil moisture sensor module
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - soil moisture
  - soil moisture sensor
  - soil probe
  - moisture probe
  - plant water sensor
  - analog moisture sensor
pins:
  - name: VCC
    role: power
    aliases: [5v, vcc, plus]
  - name: GND
    role: ground
    aliases: [ground, gnd, minus]
  - name: AO
    role: analog-output
    aliases: [analog out, analog signal, a0]
  - name: DO
    role: digital-output
    aliases: [digital out, threshold output]
protocols: [analog-input, digital-threshold, power]
requiredPassives: []
capabilities: [analog-input, moisture-sensor, threshold-input]
compatibleTopologies:
  - controller-analog-sensor-i2c-display
  - controller-analog-threshold-output
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-moisture-sensor
  nominalCurrentMa: 5
visualPartIds: [soil-moisture]
```

Risk notes: keep this as a 3.3V to 5V low-voltage module. The contract should
not encourage continuous probe energizing, water immersion outside the visual
classroom model, or direct connection to non-classroom power sources.

Simulation path expectations: animate `soil-moisture-supply-current` from
controller 5V through `VCC` and back through `GND`; animate
`soil-moisture-analog-signal` between `AO` and Arduino `A0` with expected signal
current 0 mA; optionally animate `soil-moisture-threshold-signal` from `DO` to a
digital input; OLED readout uses `display_sensor_value` with separate
`display-bus-activity`.

Safety truthfulness notes: present the value as a qualitative dry to wet reading,
not a calibrated volumetric water content measurement. Warn that real probes can
corrode and that this classroom simulation does not model soil chemistry,
electrolysis, or irrigation safety.

### water-level-sensor

```yaml
visualPartId: water-level-sensor
id: water-level-sensor
label: Water level sensor
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - water level
  - water level sensor
  - liquid level sensor
  - rain drop level strip
  - analog water sensor
pins:
  - name: VCC
    role: power
    aliases: [5v, vcc, plus]
  - name: GND
    role: ground
    aliases: [ground, gnd, minus]
  - name: S
    role: analog-output
    aliases: [signal, analog out, sensor output]
protocols: [analog-input, power]
requiredPassives: []
capabilities: [analog-input, water-level-sensor]
compatibleTopologies:
  - controller-analog-input-readout
  - controller-analog-sensor-i2c-display
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-water-level-sensor
  nominalCurrentMa: 5
visualPartIds: [water-level-sensor]
```

Risk notes: only allow low-voltage sensing against the classroom controller
rail. Block any request that mixes this part with mains, pumps, unisolated
external supplies, or real flood detection safety claims.

Simulation path expectations: animate `water-level-supply-current` through
`VCC` and `GND`; animate `water-level-analog-signal` from `S` to Arduino `A0`;
map a slider to low, medium, and high level states; OLED display text is driven
by `display_sensor_value`.

Safety truthfulness notes: describe the reading as an educational water-contact
or level trend. Do not claim precise depth, leak protection, potable-water
safety, or reliable flood alarm behavior.

### tmp36-temp

```yaml
visualPartId: tmp36-temp
id: tmp36-temperature-sensor
label: TMP36 analog temperature sensor
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - tmp36
  - tmp36 temperature sensor
  - analog temperature sensor
  - temperature sensor
  - celsius temperature sensor
pins:
  - name: VS
    role: power
    aliases: [vcc, supply, 5v, 3v3]
  - name: GND
    role: ground
    aliases: [ground, gnd]
  - name: OUT
    role: analog-output
    aliases: [vout, analog out, signal]
protocols: [analog-input, power]
requiredPassives: []
capabilities: [analog-input, temperature-sensor]
compatibleTopologies:
  - controller-analog-input-readout
  - controller-analog-sensor-i2c-display
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-temperature-voltage-sensor
  nominalCurrentMa: 0.05
visualPartIds: [tmp36-temp]
```

Risk notes: enforce the low-voltage supply range once source claims are added.
The TO-92 pin orientation must be source-verified before render pin anchors are
merged, because swapped `VS`, `OUT`, and `GND` is a likely student wiring error.

Simulation path expectations: animate `tmp36-supply-current` through `VS` and
`GND`; animate `tmp36-analog-signal` from `OUT` to Arduino `A0`; display a
simulated temperature value on OLED via `display_sensor_value`; threshold flows
may map the analog value to an LED or buzzer only after the output path validates
separately.

Safety truthfulness notes: show classroom temperature changes in degrees C, but
do not imply laboratory calibration, medical suitability, or exact thermal
response time.

### fsr-pressure

```yaml
visualPartId: fsr-pressure
id: fsr-force-sensor
label: FSR force sensor
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - fsr
  - force sensor
  - force sensing resistor
  - pressure sensor
  - pressure pad
  - analog pressure sensor
pins:
  - name: A
    role: resistive-terminal
    aliases: [terminal a, lead 1]
  - name: B
    role: resistive-terminal
    aliases: [terminal b, lead 2]
protocols: [analog-input, voltage-divider, passive-resistive]
requiredPassives:
  - id: divider-fixed-resistor
    role: voltage-divider-reference
    proposedCanonicalPartId: resistor-10k
    note: Add or generalize a fixed-resistor contract before central integration; do not reuse the existing LED-oriented resistor-220 contract as the default divider reference.
capabilities: [analog-input, resistive-sensor, force-sensor, voltage-divider]
compatibleTopologies:
  - controller-analog-input-readout
  - controller-analog-sensor-i2c-display
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: resistive-force-divider
  nominalCurrentMa: 0.5
visualPartIds: [fsr-pressure]
```

Risk notes: the FSR is passive and low-voltage, but it must not be connected
directly between 5V and ground without a validated divider path. The central
integration should avoid pretending the existing `resistor-220` is the ideal
divider value unless the context layer gains a canonical 10k or configurable
fixed resistor.

Simulation path expectations: animate `fsr-divider-current` through the
validated divider path; animate `fsr-analog-signal` from the divider midpoint to
Arduino `A0`; map the pressure slider to qualitative light, medium, and firm
states; OLED display uses `display_sensor_value`.

Safety truthfulness notes: present force as a qualitative pressure trend. Do not
claim accurate newtons, weight scale behavior, or durability limits.

### thermistor-ntc

```yaml
visualPartId: thermistor-ntc
id: ntc-thermistor
label: NTC thermistor
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - thermistor
  - ntc
  - ntc thermistor
  - temperature resistor
  - analog temperature resistor
pins:
  - name: A
    role: resistive-terminal
    aliases: [terminal a, lead 1]
  - name: B
    role: resistive-terminal
    aliases: [terminal b, lead 2]
protocols: [analog-input, voltage-divider, passive-resistive]
requiredPassives:
  - id: divider-fixed-resistor
    role: voltage-divider-reference
    proposedCanonicalPartId: resistor-10k
    note: Add or generalize a fixed-resistor contract before central integration; do not reuse the existing LED-oriented resistor-220 contract as the default divider reference.
capabilities: [analog-input, resistive-sensor, temperature-sensor, voltage-divider]
compatibleTopologies:
  - controller-analog-input-readout
  - controller-analog-sensor-i2c-display
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: resistive-temperature-divider
  nominalCurrentMa: 0.5
visualPartIds: [thermistor-ntc]
```

Risk notes: low-voltage passive part only. Require a divider and common ground;
block direct use as a powered module because `src/partLibraryData.js` exposes
only two terminals.

Simulation path expectations: animate `thermistor-divider-current` only after
the divider is complete; animate `thermistor-analog-signal` from the divider
midpoint to Arduino `A0`; display colder, room, and warmer educational states on
the OLED.

Safety truthfulness notes: do not claim calibrated temperature until beta value,
nominal resistance, and divider resistor source claims exist. The first
simulation-ready path should teach resistance changes qualitatively.

### acs712-current

```yaml
visualPartId: acs712-current
id: acs712-current-sensor
label: ACS712 current sensor module
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - acs712
  - current sensor
  - hall current sensor
  - analog current sensor
  - current monitor
pins:
  - name: VCC
    role: power
    aliases: [5v, vcc, plus]
  - name: GND
    role: ground
    aliases: [ground, gnd, minus]
  - name: OUT
    role: analog-output
    aliases: [analog out, signal, vout]
protocols: [analog-input, power]
requiredPassives: []
capabilities: [analog-input, current-sensor]
compatibleTopologies:
  - controller-analog-input-readout
  - controller-analog-sensor-i2c-display
forbiddenTopologies:
  - mains-current-measurement
  - high-current-load-inline-measurement
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-current-sensor-readout
  nominalCurrentMa: 10
visualPartIds: [acs712-current]
```

Risk notes: this proposal models only the low-voltage logic side present in
`src/partLibraryData.js` (`VCC`, `GND`, `OUT`). Real ACS712 modules include a
separate measured-current path; central integration should not invent or render
those terminals without source claims and should block mains or high-current
student requests.

Simulation path expectations: animate `acs712-supply-current` through `VCC` and
`GND`; animate `acs712-analog-signal` from `OUT` to Arduino `A0`; display a
simulated current value as an educational variable. Do not animate measured-load
current through the module unless a future deterministic low-voltage load
topology explicitly validates it.

Safety truthfulness notes: never present this as a safe way for students to
measure wall power, household appliances, batteries above the classroom
low-voltage scope, or unknown loads. The first promotion should be a readout
demo, not a real current-measurement instruction.

### rain-sensor

```yaml
visualPartId: rain-sensor
id: rain-sensor-module
label: Rain sensor module
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - rain sensor
  - raindrop sensor
  - rain module
  - water drop sensor
  - analog rain sensor
pins:
  - name: VCC
    role: power
    aliases: [5v, vcc, plus]
  - name: GND
    role: ground
    aliases: [ground, gnd, minus]
  - name: AO
    role: analog-output
    aliases: [analog out, analog signal, a0]
  - name: DO
    role: digital-output
    aliases: [digital out, threshold output]
protocols: [analog-input, digital-threshold, power]
requiredPassives: []
capabilities: [analog-input, rain-sensor, threshold-input]
compatibleTopologies:
  - controller-analog-sensor-i2c-display
  - controller-analog-threshold-output
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-rain-sensor
  nominalCurrentMa: 5
visualPartIds: [rain-sensor]
```

Risk notes: low-voltage educational contact sensor only. Do not route this into
real outdoor wiring, pumps, relays, roof systems, or mains-connected rain alarm
requests.

Simulation path expectations: animate `rain-sensor-supply-current`; animate
`rain-sensor-analog-signal` from `AO` to Arduino `A0`; optionally animate
`rain-sensor-threshold-signal` from `DO` to a digital input; display dry,
damp, and raining states with `display_sensor_value`.

Safety truthfulness notes: describe the result as rain/wetness indication, not
weatherproof instrumentation or reliable precipitation measurement.

### flame-sensor

```yaml
visualPartId: flame-sensor
id: flame-sensor-module
label: Flame sensor module
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - flame sensor
  - fire sensor
  - infrared flame sensor
  - ir flame detector
  - analog flame sensor
pins:
  - name: VCC
    role: power
    aliases: [5v, vcc, plus]
  - name: GND
    role: ground
    aliases: [ground, gnd, minus]
  - name: AO
    role: analog-output
    aliases: [analog out, analog signal, a0]
  - name: DO
    role: digital-output
    aliases: [digital out, threshold output]
protocols: [analog-input, digital-threshold, power]
requiredPassives: []
capabilities: [analog-input, flame-sensor, threshold-input]
compatibleTopologies:
  - controller-analog-sensor-i2c-display
  - controller-analog-threshold-output
forbiddenTopologies:
  - life-safety-fire-alarm
  - mains-controlled-fire-response
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-flame-sensor
  nominalCurrentMa: 5
visualPartIds: [flame-sensor]
```

Risk notes: the module is low-voltage, but fire detection is safety-critical.
Permit only classroom IR/flame proximity demonstration prompts; block real fire
alarm, evacuation, gas shutoff, or mains response designs.

Simulation path expectations: animate `flame-sensor-supply-current`; animate
`flame-sensor-analog-signal` from `AO` to Arduino `A0`; optionally animate
`flame-sensor-threshold-signal` from `DO`; threshold output paths must validate
the LED or buzzer load separately before current dots appear.

Safety truthfulness notes: label outputs as simulated IR intensity or flame-like
signal, not verified fire detection. Do not imply life-safety reliability,
range guarantees, or certified alarm behavior.

### mq2-gas

```yaml
visualPartId: mq2-gas
id: mq2-gas-sensor
label: MQ-2 gas sensor module
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - mq2
  - mq-2
  - gas sensor
  - smoke sensor
  - lpg sensor
  - combustible gas sensor
  - analog gas sensor
pins:
  - name: VCC
    role: power
    aliases: [5v, vcc, plus]
  - name: GND
    role: ground
    aliases: [ground, gnd, minus]
  - name: AO
    role: analog-output
    aliases: [analog out, analog signal, a0]
  - name: DO
    role: digital-output
    aliases: [digital out, threshold output]
protocols: [analog-input, digital-threshold, power]
requiredPassives: []
capabilities: [analog-input, gas-sensor, smoke-sensor, threshold-input]
compatibleTopologies:
  - controller-analog-sensor-i2c-display
  - controller-analog-threshold-output
forbiddenTopologies:
  - life-safety-gas-alarm
  - mains-controlled-gas-response
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-gas-sensor
  nominalCurrentMa: 150
visualPartIds: [mq2-gas]
```

Risk notes: use only a 5V low-voltage classroom rail, but surface a power-budget
caution because MQ-style modules use a heater and can draw much more current
than simple analog sensors. Do not power it from a GPIO pin. Consider
`riskLevel: power-warning` during central integration if the project's risk
classifier is updated from the current WP-01 low-voltage target.

Simulation path expectations: animate `mq2-supply-current` as module supply
current only after power/ground validation; animate `mq2-analog-signal` from
`AO` to Arduino `A0`; optionally animate `mq2-threshold-signal` from `DO`;
display qualitative clean, smoke-like, and high gas states.

Safety truthfulness notes: never claim real gas concentration, ppm accuracy,
calibration, warm-up completion, or life-safety alarm suitability. The
simulation should call it a classroom gas/smoke response demo.

### sound-sensor

```yaml
visualPartId: sound-sensor
id: sound-sensor-module
label: Sound detection sensor module
kind: input
family: analog-input
supportLevel: supported
supportTier: simulation-ready
riskLevel: low-voltage
aliases:
  - sound sensor
  - microphone sensor
  - sound detection sensor
  - clap sensor
  - volume sensor
  - analog sound sensor
pins:
  - name: VCC
    role: power
    aliases: [5v, vcc, plus]
  - name: GND
    role: ground
    aliases: [ground, gnd, minus]
  - name: AO
    role: analog-output
    aliases: [analog out, analog signal, a0]
  - name: DO
    role: digital-output
    aliases: [digital out, threshold output]
protocols: [analog-input, digital-threshold, power]
requiredPassives: []
capabilities: [analog-input, sound-sensor, microphone-module, threshold-input]
compatibleTopologies:
  - controller-analog-sensor-i2c-display
  - controller-analog-threshold-output
compatibleSimulationPrimitives:
  - display_sensor_value
  - analog_threshold
  - current_flow_animation
simulationModel:
  type: analog-sound-sensor
  nominalCurrentMa: 5
visualPartIds: [sound-sensor]
```

Risk notes: low-voltage module only. Do not imply audio recording, voice
recognition, or privacy-sensitive capture; the beginner demo should be sound
level or clap detection.

Simulation path expectations: animate `sound-sensor-supply-current`; animate
`sound-sensor-analog-signal` from `AO` to Arduino `A0`; optionally animate
`sound-sensor-threshold-signal` from `DO`; use slider states quiet, normal, and
loud with OLED display or threshold output.

Safety truthfulness notes: present amplitude as qualitative. Do not claim
decibel accuracy, frequency analysis, speech recognition, or calibrated sound
meter behavior.

## Integration Gaps For Master

- Source claims are still needed for pin maps, voltage/current limits, and
  safety facts before any central JSON promotion.
- `controller-analog-sensor-i2c-display` and `controller-analog-input-readout`
  are proposed topology ids; central topology integration must either add these
  templates or intentionally map the parts to an existing equivalent.
- FSR and NTC thermistor need a source-backed fixed divider resistor value. The
  current canonical resistor is `resistor-220`, which is useful for LEDs but not
  an ideal analog divider reference.
- ACS712 metadata currently exposes only the low-voltage side. Do not add
  measured-current terminals or high-current render paths without source claims
  and a deterministic safety policy.
- MQ-2 may deserve a `power-warning` risk treatment because of heater current,
  even though the current WP-01 coverage row classifies it as low-voltage.
