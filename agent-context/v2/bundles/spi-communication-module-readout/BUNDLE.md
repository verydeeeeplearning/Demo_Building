# SPI Communication Module Readout

Use this bundle when the student explicitly asks for LoRa Ra-02, NRF24L01, MCP2515 CAN, or USB Host Shield status on an I2C OLED or supported I2C character LCD.

Supported: Arduino Uno, breadboard, module power/GND, SPI clock/data/select activity, I2C display wiring, and qualitative local module status.

Required wiring: module power to a safe rail, GND to common GND, SCK to D13, MOSI/SI/DIN to D11, MISO/SO when present to D12, chip-select to D10, display SDA to A4/SDA, and display SCL to A5/SCL.

Simulation: local SPI/bus state only. Do not claim real RF range, vehicle CAN behavior, USB device enumeration, cloud networking, or security effects.
