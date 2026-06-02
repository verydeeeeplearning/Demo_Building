# Digital Input Display Readout

Use this bundle when the student wants a low-voltage digital switch or digital sensor state shown on an OLED display.

Supported input families:

- Passive switches: limit switch, reed switch, slide switch, toggle switch.
- Powered digital modules: TTP223 touch, Hall effect, PIR motion, line tracker, SW-420 vibration, tilt ball.
- Pulse/frequency style digital sensors: IR receiver and TCS3200 color sensor, represented as qualitative pulse activity.

Supported wiring pattern:

- Passive switch input uses one terminal/common pin to an Arduino digital input and another terminal to a defined reference, normally GND with internal pull-up behavior.
- Powered modules connect VCC to Arduino 5V, GND to Arduino GND, and OUT/DO/SIG to an Arduino digital input.
- TCS3200 also needs explicit control pins for the simplified S0/S2 visual-library subset.
- OLED connects through the normal I2C VCC/GND/SDA/SCL contract.

Simulation contract:

- Input state is shown as active/inactive or qualitative pulse activity.
- Sensor supply current and input signal activity are separate from display I2C activity.
- The simulator does not decode IR remote protocols, debounce switch contacts, or calibrate TCS3200 RGB color.

Do not use this bundle for analog sensor values, DHT temperature/humidity timing, HC-SR04 trigger/echo distance, or mains/high-current outputs.
