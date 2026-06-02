# Digital Light Output

Use this bundle when the student wants an Arduino-controlled LED, RGB LED, blinking light, or low-voltage laser module.

Supported: Arduino Uno digital output, breadboard, 5 mm LED with 220 ohm series resistor, common-cathode RGB LED with one resistor per driven channel, low-voltage laser module with VCC/GND/S, jumper wires, simple on/off, blink, qualitative RGB color, and qualitative beam behavior.

Do not support: calibrated analog brightness control, calibrated RGB color science, mains lamps, high-power LED strips, optical power or eye-safety classification, or sensors in this bundle.

Required checks: LED polarity, resistor in series, closed path from Arduino output through resistor and LED to GND, one resistor per RGB channel, laser module VCC/GND/S wiring, common ground, no direct 5V-to-GND short.

Simulation: educational current-flow animation, LED on/off or blink state, qualitative RGB channel mix, and qualitative laser beam state only. This is not SPICE, optical modeling, or transient LED modeling.
