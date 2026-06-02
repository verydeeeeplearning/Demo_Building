# Rotary Encoder Display Readout

Deterministic claim: `rotary-encoder-display-readout-starter` supports Arduino Uno plus breadboard plus 0.96 inch I2C OLED readout for `rotary-encoder` only when the manifest allowlist and source claims resolve.

Pin contract:

- VCC connects to Arduino 5V and GND connects to Arduino GND.
- CLK, DT, and SW each connect to distinct Arduino digital inputs.
- CLK and DT are the simplified quadrature pair; SW is the push-button signal.
- OLED VCC/GND/SDA/SCL use the normal I2C contract with SDA on A4 and SCL on A5.

Validation expectations: enforce `encoder-quadrature-pins-defined`, digital input pin existence, power rail validity, common ground, I2C role match, and qualitative-only readout. Block missing encoder power/ground, missing or duplicate CLK/DT/SW digital inputs, missing OLED, unresolved source claims, missing footprints, or missing simulation primitives.

Simulation contract: show qualitative clockwise/counterclockwise step state, count/direction display text, SW press state, OLED updates, and safe current-flow visualization while keeping CLK/DT/SW activity separate from module supply.

Non-goals/limits: no contact bounce physics, exact quadrature timing, interrupt behavior, HID knob behavior, analog joystick axes, matrix keypad scanning, or high-voltage/high-current output.
