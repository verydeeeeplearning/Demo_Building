# H-bridge Motor Output

Use for low-voltage educational DC motor projects that need direction control through an H-bridge driver.

Default:

- Arduino Uno drives `l298n-driver` ENA, IN1, and IN2.
- L298N OUT1/OUT2 drive `dc-motor-130`.
- VS/VCC/GND and common ground are required.

Explicit alternative:

- `l293d-driver` may replace `l298n-driver`.
- Require VCC1, VCC2, GND, EN1, IN1, IN2, OUT1, and OUT2.

Validation:

- Reject direct DC motor drive from GPIO.
- Require H-bridge driver, enable/direction control, motor output pair, common ground, and high-current warning.

Simulation:

- Use `hbridge_motor_state`.
- Emit separate motor-current and control-signal paths.
- Direction is qualitative: off, forward, reverse, or brake.

Non-goals:

Not for steppers, servos, relays, mains loads, stall current, torque, speed, braking physics, heat, or driver sizing.
