# Joystick Display Readout

Deterministic claim: `joystick-display-readout-starter` supports Arduino Uno plus breadboard plus 0.96 inch I2C OLED readout for `joystick-module` only when the manifest allowlist and source claims resolve.

Pin contract:

- VCC connects to Arduino 5V and GND connects to Arduino GND.
- VRX connects to one Arduino analog input, normally A0.
- VRY connects to a different Arduino analog input, normally A1.
- SW connects to an Arduino digital input for the joystick push button.
- OLED VCC/GND/SDA/SCL use the normal I2C contract with SDA on A4 and SCL on A5.

Validation expectations: enforce `joystick-axis-pins-defined`, digital input pin existence for SW, power rail validity, common ground, I2C role match, and qualitative-only readout. Block missing joystick power/ground, missing or duplicate VRX/VRY analog inputs, missing OLED, unresolved source claims, missing footprints, or missing simulation primitives.

Simulation contract: expose X and Y qualitative position plus pressed/not-pressed SW state; keep supply current, analog axis activity, digital switch activity, OLED bus updates, and current-flow visualization separate.

Non-goals/limits: no HID/gamepad behavior, calibrated physical force, analog transient modeling, matrix keypad scanning, rotary quadrature, or high-voltage/high-current output.
