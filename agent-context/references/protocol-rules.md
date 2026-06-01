# Protocol Rules

## GPIO

GPIO connects one Arduino digital pin to one simple input or output signal. Loads still need a power path and ground return.

## I2C

I2C requires common ground plus SDA and SCL. For Arduino Uno, use `A4/SDA` and `A5/SCL`.

## PWM

PWM is allowed for LED brightness and servo signal examples. PWM does not replace power and ground wiring.

## Unsupported Protocols

Bluetooth, Wi-Fi, GPS, drone autopilot, RF, and high-current motor control are unsupported in the first Deepagents/context-layer implementation.
