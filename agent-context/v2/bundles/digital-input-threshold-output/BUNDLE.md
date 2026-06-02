# Digital Input Threshold Output

Use this bundle when a digital switch or low-voltage digital sensor should control a current-limited LED output.

Supported input families:

- Passive switches: limit switch, reed switch, slide switch, toggle switch.
- Powered digital modules: TTP223 touch, Hall effect, PIR motion, line tracker, SW-420 vibration, tilt ball.

Supported wiring pattern:

- Passive switch input is a signal into an Arduino digital input with a defined reference, usually GND with internal pull-up behavior.
- Powered digital modules connect VCC, GND, and OUT/DO/SIG to an Arduino digital input.
- The LED output is a separate Arduino output path: digital output, 220 ohm resistor, LED anode, LED cathode to common ground.

Simulation contract:

- Input state can be toggled active/inactive.
- LED current appears only on the validated current-limited output path.
- Input signal activity is not shown as load current.

Do not use this bundle for analog brightness control, calibrated sensor measurement, pulse/frequency display, relays, motors, mains lamps, or high-current loads.
