# DHT11 Temperature/Humidity Display

Use this bundle when the student wants an Arduino Uno to read a DHT11 temperature and humidity sensor and show the readings on a 0.96 inch I2C OLED.

Supported: Arduino Uno, breadboard, DHT11 VCC/GND/DAT, OLED VCC/GND/SDA/SCL, educational temperature/humidity readout state, DHT11 supply current, DHT11 data-line activity, OLED supply and bus explanation.

Do not support: DHT22, BMP280, TMP36, calibrated weather-station accuracy, fast sampling, multiple environmental sensors, or cloud/IoT logging.

Required wiring: DHT11 VCC to 5V, GND to common GND, DAT to an Arduino digital input such as D2, OLED VCC/GND to safe supply and common ground, OLED SDA to A4/SDA, OLED SCL to A5/SCL.

Simulation: qualitative temperature/humidity readout, DHT11 data pulse, OLED update, and current-flow overlay only. Do not claim bit-accurate one-wire timing or calibrated environmental measurements.
