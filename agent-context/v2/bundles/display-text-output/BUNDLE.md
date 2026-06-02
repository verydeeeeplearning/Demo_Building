# Display Text Output

Use this bundle when the student wants an Arduino Uno to show short text on a 0.96 inch I2C OLED module.

Supported: Arduino Uno, breadboard, I2C OLED with VCC/GND/SDA/SCL, static text output, I2C signal explanation, supply current path.

Do not support: arbitrary graphical UI rendering, SPI displays, touchscreens, camera displays, or app-screen visualization requests.

Required checks: VCC to safe supply, GND common return, SDA to Arduino SDA, SCL to Arduino SCL, no swapped bus roles, no missing power or ground.

Simulation: static display state, I2C activity explanation, and educational current-flow overlay only.
