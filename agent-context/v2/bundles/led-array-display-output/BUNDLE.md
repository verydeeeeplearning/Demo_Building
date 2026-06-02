# LED Array Display Output

Use this bundle when the student wants an Arduino Uno to show a number or simple pattern on a powered LED-array display module such as TM1637 4-digit 7-segment or MAX7219 8x8 LED matrix.

Supported: Arduino Uno, breadboard, TM1637 display with VCC/GND/CLK/DIO, MAX7219 matrix with VCC/GND/CLK/CS/DIN, qualitative number or pattern output, display supply current, and data/clock/control signal activity.

Do not support: bare one-digit 7-segment displays without per-segment current limiting, direct LED matrices without a driver module, pixel-accurate driver timing, or high-brightness current calculations.

Required checks: display VCC to safe 5V, GND common return, data line to Arduino digital output, clock line to Arduino digital output, and CS/select line for MAX7219. TM1637 uses CLK and DIO only.

Simulation: qualitative visible number or LED matrix pattern, display supply-current overlay, and separate signal pulses for data, clock, and select.
