# Analog Sensor Display Readout

Use this bundle when the student wants Arduino Uno to read a supported low-voltage analog sensor or two-pin resistive sensor and show a qualitative value on a 0.96 inch I2C OLED.

Supported powered sensor modules: soil moisture, water level, TMP36, ACS712 low-voltage signal readout, rain, flame, MQ-2 gas, and sound sensor modules. Supported pins are VCC or VS, GND, and AO/OUT/S to Arduino A0. Four-pin modules may also expose DO, but the validated readout path uses the analog output.

Supported two-pin resistive sensors: FSR pressure sensor and NTC thermistor. They expose only A/B leads. Do not invent VCC, GND, or AO pins on the sensor body. Wire one lead to 5V, wire the other lead to Arduino A0 and to a fixed 10K reference resistor, then wire the other side of that resistor to GND.

Required wiring: powered modules need sensor power to 5V, sensor GND to common GND, sensor analog output to A0. Resistive sensors need an explicit voltage divider reference resistor with A0 at the divider midpoint. OLED VCC/GND go to safe supply and common ground, OLED SDA to A4/SDA, OLED SCL to A5/SCL.

Simulation: qualitative sensor value, sensor supply or divider current, analog signal activity, OLED supply and bus update. Do not claim calibrated force, calibrated temperature, fire/gas/water safety protection, or mains/current protection.
