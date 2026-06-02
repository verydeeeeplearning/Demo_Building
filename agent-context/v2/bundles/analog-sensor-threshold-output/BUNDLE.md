# Analog Sensor Threshold Output

Use this bundle when the student wants a supported analog sensor module or two-pin resistive sensor to control a current-limited LED using an Arduino threshold.

Supported powered sensor modules: soil moisture, water level, TMP36, ACS712 low-voltage signal readout, rain, flame, MQ-2 gas, and sound sensor modules. The deterministic path uses sensor AO/OUT/S to Arduino A0, then Arduino D3/D8 drives a 220 ohm resistor and LED.

Supported two-pin resistive sensors: FSR pressure sensor and NTC thermistor. They expose only A/B leads. Do not invent VCC, GND, or AO pins on the sensor body. Wire one lead to 5V, wire the other lead to Arduino A0 and to a fixed 10K reference resistor, then wire the other side of that resistor to GND.

Required wiring: powered modules need sensor power to 5V, sensor GND to common GND, sensor analog output to A0. Resistive sensors need an explicit voltage divider reference resistor with A0 at the divider midpoint. Arduino digital output goes through a 220 ohm resistor to LED anode, LED cathode returns to GND.

Simulation: qualitative threshold state, sensor supply or divider current, analog signal activity, LED forward current, and state overlay. Do not claim real alarms, gas/fire protection, calibrated force, calibrated temperature, or mains/current protection.
