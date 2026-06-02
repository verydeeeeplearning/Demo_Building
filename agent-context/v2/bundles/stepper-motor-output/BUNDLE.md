# Stepper Motor Output

Use for low-voltage educational stepper projects that need a driver before simulation.

Default:

- Arduino Uno drives `uln2003-driver` IN1-IN4.
- ULN2003 drives `stepper-28byj48`.
- VCC/GND/common ground are required.

Explicit alternative:

- `a4988-stepper` or `drv8825-stepper` may drive `nema17-stepper`.
- Require STEP and DIR from Arduino, VMOT/GND, and all four coil leads.

Validation:

- Reject direct stepper coil drive from GPIO.
- Require driver, phase/coil lines, common ground, and current warning.
- For STEP/DIR drivers, require both STEP and DIR signals.

Simulation:

- Use `stepper_motor_state`.
- Emit separate coil-current and control-signal paths.
- Motion is qualitative: direction, step count, and rotation state.

Non-goals:

Not for DC motors, servos, relays, mains loads, torque, speed, heat, current-limit tuning, or microstep physics.
