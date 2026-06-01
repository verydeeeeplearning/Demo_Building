# Validation Errors

- UNKNOWN_PART: selected part is not in the registry.
- UNKNOWN_PIN: a connection uses a pin not defined by the part.
- UNKNOWN_COMPONENT: a connection references a missing component.
- DIRECT_POWER_SHORT: 5V is connected directly to GND.
- LED_WITHOUT_RESISTOR: LED path lacks a current-limiting resistor.
- MISSING_COMMON_GROUND: active parts do not share a return path.
- MOTOR_DIRECT_TO_GPIO: motor load is connected without a driver abstraction.
- I2C_LINES_SWAPPED: SDA and SCL are crossed.
- UNSUPPORTED_MAINS_VOLTAGE: request involves unsafe real-world mains wiring.
