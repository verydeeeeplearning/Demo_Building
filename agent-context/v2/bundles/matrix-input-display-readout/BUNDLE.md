# Matrix Input Display Readout

Deterministic claim: `matrix-input-display-readout-starter` supports Arduino Uno plus breadboard plus 0.96 inch I2C OLED readout for `dip-switch-4`, `keypad-4x4`, or `membrane-keypad-1x4` only when the manifest allowlist and source claims resolve.

Pin contract:

- 4-way DIP switch: each SxA/SxB pair is one passive switch; one side goes to a distinct Arduino digital input and the other side goes to a defined reference such as GND for internal pull-up lessons.
- 4x4 matrix keypad: R1-R4 and C1-C4 use distinct GPIO scan/sense lines; rows and columns cannot share controller pins.
- 1x4 membrane keypad: COM is the shared reference; K1-K4 are distinct Arduino digital inputs.
- OLED VCC/GND/SDA/SCL use the normal I2C contract with SDA on A4 and SCL on A5.

Validation expectations: enforce `matrix-input-lines-distinct`, `matrix-input-reference-defined`, I2C role match, common ground, and qualitative-only readout. Block floating passive inputs, duplicate row/column pins, missing OLED, unresolved source claims, missing footprints, or missing simulation primitives.

Simulation contract: show qualitative key/switch state, scan activity, OLED text update, and safe low-voltage current flow.

Non-goals/limits: no debounce physics, full keyboard entry, HID input, analog joystick axes, rotary quadrature, or high-voltage/high-current output.
