# Distance Sensor Display

Use this bundle when the student wants an Arduino Uno to read an HC-SR04 ultrasonic distance sensor and show the distance on a 0.96 inch I2C OLED.

Supported: Arduino Uno, breadboard, HC-SR04 VCC/GND/TRIG/ECHO, OLED VCC/GND/SDA/SCL, educational distance readout state, sensor supply current, trigger/echo signal activity, OLED supply and bus explanation.

Do not support: calibrated physics, multiple ultrasonic sensors, autonomous robots, blind navigation, or non-HC-SR04 distance modules.

Required wiring: HC-SR04 VCC to 5V, GND to common GND, TRIG to Arduino digital output D3, ECHO to Arduino digital input D2, OLED VCC/GND to safe supply and common ground, OLED SDA to A4/SDA, OLED SCL to A5/SCL.

Simulation: qualitative distance slider/readout, trigger pulse, echo pulse, OLED update, and current-flow overlay only. Do not claim centimeter-perfect timing.
