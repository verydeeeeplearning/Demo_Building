# Context Source Bundle Backlog

## Current Supported Bundle Hardening

1. Arduino Uno Rev3 controller bundle
   - Claims: pin map, PWM pins, 5V/3.3V rails, per-pin current, board dimensions.
   - Sources: Arduino official specs, Arduino pinout, ATmega328P datasheet.

2. Breadboard half-size bundle
   - Claims: terminal strip continuity, center gap isolation, power rail continuity, 0.1 inch pitch.
   - Sources: Adafruit breadboard guide, SparkFun breadboard guide, physical measurement notes.

3. LED + resistor bundle
   - Claims: LED polarity, forward voltage teaching default, current limiting requirement, 220 ohm beginner default.
   - Sources: vendor LED tutorials, representative LED datasheet, H-eduware derived Ohm's law calculation.

4. OLED I2C bundle
   - Claims: VCC/GND/SDA/SCL pins, I2C behavior, common 3.3V/5V module compatibility warning, display current teaching default.
   - Sources: Adafruit SSD1306 guide, representative SSD1306 module guide.

5. Button, buzzer, servo bundles
   - Claims: pin roles, polarity, current warnings, PWM signal requirements.
   - Sources: vendor guides and representative product datasheets.

## Recently Promoted Source Bundles

The following previously planned candidates now have supported source bundles, v2 manifests, routing, validation, render, simulation, and eval coverage:

- `analog-led-dimmer`
- `light-sensor-triggered-output`
- `distance-sensor-display`
- `dht11-temperature-humidity-display`
- `analog-sensor-display-readout`
- `analog-sensor-threshold-output`
- `button-controlled-light-output`
- `sound-alert-output`
- `servo-motion-output`
- `fsr-pressure` and `thermistor-ntc` as the two-pin resistive-sensor divider extension inside the analog sensor bundles
- `digital-input-display-readout`
- `digital-input-threshold-output`
- `limit-switch`, `reed-switch`, `slide-switch`, `toggle-switch`, `ttp223-touch`, `hall-effect-sensor`, `ir-receiver`, `line-tracker`, `pir-hc-sr501`, `sw420-vibration`, `tilt-ball-sensor`, and `tcs3200-color` inside the digital input bundles
- `matrix-input-display-readout`
- `joystick-display-readout`
- `rotary-encoder-display-readout`
- `dip-switch-4`, `keypad-4x4`, `membrane-keypad-1x4`, `joystick-module`, and `rotary-encoder` inside the WP-03 matrix/multi-input bundles

Do not use these as context-gap examples unless a test is explicitly preserving an old regression fixture.

## Planned Capability Candidates

1. Display expansion
   - Required before support: I2C/SPI/LED-array protocol claims, footprint anchors, qualitative display simulation, and bus validation.

2. Remaining light and sound outputs
   - Required before support: current-limit or module-driver contracts, eye/current safety warnings where relevant, footprint anchors, and output-state simulation.

3. Motors, drivers, relays, and high-current outputs
   - Required before support: external supply topology, common-ground policy, flyback/protection claims, GPIO direct-drive blocking, and power-warning browser evidence.

4. Power, regulation, protection, and passive components
   - Required before support: polarity/current/voltage claims, passive-only simulation policy, unsafe mains blocking, and topology-specific validator coverage.

5. Controller board substitutions
   - Required before support: board-specific pin maps, voltage-domain policy, alias resolution, footprint anchors, and no Uno-only assumption leakage.

6. Prototyping and connector surfaces
   - Required before support: continuity models, connector pass-through semantics, placement constraints, and invisible-short DRC coverage.

7. Protocol sensor modules
   - Required before support: protocol pin roles, qualitative readout contracts, domain-specific safety restrictions, and representative eval/browser evidence.

8. Communication modules
   - Required before support: UART/SPI/differential-bus contracts, power warnings for radio/cellular modules, privacy-sensitive request handling, and no implied cloud/backend simulation.

9. Logic, interface, and IC expansion
   - Required before support: exact IC pin contracts, supply/ground validation, level-shifting policy, and topology-specific simulation primitives.

## Broad Visual Library Triage

Do not convert all visual library parts to supported. For each visual-only part, classify it as:

- `agent-ready`: full bundle exists.
- `planned`: useful educational target but bundle incomplete.
- `visual-only`: can be shown in the library but cannot be wired or simulated.
- `unsupported`: unsafe, too advanced, or outside H-eduware educational scope.
