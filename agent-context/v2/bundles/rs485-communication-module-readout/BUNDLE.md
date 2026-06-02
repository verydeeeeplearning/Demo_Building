# RS-485 Communication Module Readout

Use this bundle when the student explicitly asks for an RS-485/MAX485 transceiver module status or local bus activity on an I2C OLED or supported I2C character LCD.

Supported: Arduino Uno, breadboard, RS-485 module VCC/GND/RO/DI/DE, I2C display wiring, local direction/status state, UART-side signal activity, and display bus activity.

Required wiring: VCC to 5V, GND to common GND, RO to Arduino D0/RX, DI to Arduino D1/TX, DE to a digital output such as D3, display SDA to A4/SDA, and display SCL to A5/SCL.

Simulation: local transceiver direction/status only. Do not claim long-cable industrial network physics, termination design, noise immunity, or certification behavior.
