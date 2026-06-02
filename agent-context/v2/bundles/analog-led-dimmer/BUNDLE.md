# Analog LED Dimmer

Use this bundle when the student asks for a potentiometer, trimmer potentiometer, dial, or knob to control LED brightness.

Current support level: supported for the classroom model.

Supported wiring pattern:

- Arduino Uno 5V -> potentiometer VCC
- Arduino Uno GND -> potentiometer GND
- Potentiometer OUT -> Arduino Uno A0
- For a trimmer potentiometer alternative, use A -> 5V, B -> GND, and W -> Arduino Uno A0.
- Arduino Uno D9 PWM -> 220 ohm resistor -> LED anode
- LED cathode -> Arduino Uno GND

Simulation contract:

- The potentiometer or trimmer potentiometer is modeled as a low-current analog voltage divider.
- The knob or trim value maps to PWM duty and LED brightness qualitatively.
- The LED current path remains the same validated current-limited path used by starter LED circuits.

Limitations: Do not claim calibrated analog voltage, real ADC noise, or measured luminous intensity.
