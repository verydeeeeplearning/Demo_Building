# I2C Protocol Sensor Display Readout

Use this bundle for BMP280, HMC5883L, MPU-6050, or MAX30102 module requests where the student wants a qualitative sensor value or state shown on an I2C OLED or supported I2C character LCD.

Supported: Arduino Uno, breadboard, one explicit I2C protocol sensor, shared VCC/GND/SDA/SCL wiring, display VCC/GND/SDA/SCL, sensor supply current, I2C sensor bus activity, and display bus activity.

Required wiring: sensor VCC/VIN to safe low-voltage power, sensor GND to common GND, sensor SDA to A4/SDA, sensor SCL to A5/SCL, display SDA/SCL also on A4/A5, and common ground across controller, sensor, and display.

Simulation: qualitative classroom readout only. MAX30102 is not a medical device; compass/IMU/pressure readouts are not navigation, safety, or calibrated measurement equipment.
