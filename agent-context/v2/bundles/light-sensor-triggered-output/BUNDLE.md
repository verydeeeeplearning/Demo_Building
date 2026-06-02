# Light Sensor Triggered Output

Use this bundle when the student asks for a photoresistor, LDR, light sensor, or dark-room trigger that turns an LED on or off.

Current support level: supported for the classroom model.

Supported wiring pattern:

- Arduino Uno 5V -> photoresistor module VCC
- Arduino Uno GND -> photoresistor module GND
- Photoresistor AO -> Arduino Uno A0
- Arduino Uno D9 -> 220 ohm resistor -> LED anode
- LED cathode -> Arduino Uno GND

Simulation contract:

- The photoresistor module is modeled as a low-current analog sensing path.
- The A0 value is compared against a simple threshold such as dark -> LED on.
- The LED output current is shown only on the validated current-limited LED path.

Limitations: Do not claim calibrated lux, ADC noise, exact divider resistance, or real sensor response time.
