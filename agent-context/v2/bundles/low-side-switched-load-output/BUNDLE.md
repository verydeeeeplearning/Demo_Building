# Low-side Switched Load Output

Use for beginner-safe low-voltage motor-like loads that must not be powered directly from Arduino GPIO.

Default:

- Arduino Uno digital/PWM output controls an `irf520-mosfet`.
- The IRF520 switches `dc-motor-130`.
- Load current and controller signal are separate paths.
- Common ground is required.

Explicit alternatives:

- `2n2222-npn` may replace IRF520 only with a base resistor.
- `dc-fan-5v`, `mini-water-pump`, `solenoid-valve`, and `vibration-motor` are qualitative switched-load variants.

Validation:

- Reject direct motor/fan/pump/solenoid GPIO drive.
- Require driver path, common ground, and high-current/flyback warnings.
- For `2n2222-npn`, require controller output -> resistor -> base.
- For `irf520-mosfet`, require VIN, GND, SIG, V+, and V-.

Simulation:

- Use `low_side_switched_load_state`.
- Emit separate load-current and control-signal paths.
- Output is qualitative: on/off, PWM, spin/vibrate/pump/valve state.

Non-goals:

Not for servos, steppers, H-bridges, relays, mains loads, sizing, flow, force, thermal, or battery design.
