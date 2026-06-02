# Addressable LED Display Output

Use this bundle when the student wants an Arduino Uno to show a qualitative RGB color pattern on a NeoPixel or WS2812-style addressable LED ring or strip.

Supported: Arduino Uno, breadboard, NeoPixel Ring 12 LED or short WS2812B strip with 5V/GND/DIN, qualitative single-color, rainbow, or chase pattern output, module supply current, and DIN signal activity.

Do not support: powering full-brightness LED strips from an Arduino I/O pin, calibrated power-budget calculations, WS2812 timing emulation, or arbitrary LED counts outside the supported visual ring/strip footprints.

Required checks: 5V to safe supply, GND common return, DIN to Arduino digital output, and a student-facing current warning for high brightness or many LEDs.

Simulation: qualitative RGB pattern state, display supply-current overlay, and DIN single-wire data pulses only after wiring validation passes.
