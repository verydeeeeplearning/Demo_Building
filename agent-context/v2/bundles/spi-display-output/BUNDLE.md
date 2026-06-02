# SPI Display Output

Use this bundle when the student wants an Arduino Uno to show qualitative text, images, icons, or graphics on a low-voltage SPI display module such as a 1.8 inch TFT, Nokia 5110 LCD, or 2.13 inch e-paper display.

Supported: Arduino Uno, breadboard, TFT 1.8 with VCC/GND/SCK/SDA/CS/RS, Nokia 5110 with VCC/GND/CLK/DIN/CE/DC, E-Paper 2.13 with VCC/GND/SCK/SDI/CS/RST, display supply current, and SPI data/clock/select/control signal activity.

Do not support: I2C OLED/LCD wiring inside this bundle, pixel-perfect frame buffer rendering, calibrated color rendering, e-paper waveform physics, or high-refresh animation claims.

Required checks: display VCC to safe controller power, display GND to common ground, data line to Arduino digital output, clock line to Arduino digital output, chip-select/enable line to Arduino digital output, and command/reset control pins when present.

Simulation: qualitative visible text, icon, retained image, or graphic state; display supply-current overlay; and separate signal pulses for data, clock, select, and optional control/reset.
