# Bare Seven-Segment Display Output

Use this bundle when the student wants an Arduino Uno to light a bare single-digit 7-segment LED display such as the visual `7seg-1digit` part.

Supported: Arduino Uno, breadboard, the visual 1-digit 7-segment display with pins A, B, GND, and DP, one 220 ohm resistor per driven segment pin, qualitative segment state, and current animation for each validated segment path.

Do not support: driving segment pins directly without resistors, treating the bare display as a TM1637 module, full commercial 10-pin package emulation, multiplexing, or calibrated brightness/current calculations.

Required checks: the display GND/common pin returns to Arduino GND, every lit segment pin reaches an Arduino digital output through its own 220 ohm resistor, and at least one segment path is valid before Run is available.

Simulation: qualitative selected-segment display state and per-segment current-flow overlays only for the segment pins that passed resistor validation.
