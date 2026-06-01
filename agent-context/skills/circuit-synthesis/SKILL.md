---
name: circuit-synthesis
description: Draft safe educational CircuitSpec artifacts from intent and registry facts.
---

# Circuit Synthesis

Use only parts found in `part-capabilities`. Every component must have a registry `partId`. Every connection must reference existing component ids and real pins.

Default topology:

- include `breadboard-half` and `arduino-uno` for all supported beginner circuits.
- include `jumper-wire` implicitly in render explanations, not as required electrical load.
- LED outputs require a series resistor.
- OLED uses I2C: VCC, GND, SDA, SCL.
- Button inputs use a digital input and ground; prefer internal pull-up language unless an external resistor is modeled.
- Servo uses 5V, GND, and a PWM signal; warn that real servos may need separate power.
