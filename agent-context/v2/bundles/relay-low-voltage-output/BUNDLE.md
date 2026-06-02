# Relay Low-voltage Output

Use for relay module lessons where Arduino controls the relay input side and the contact side switches only a safe low-voltage classroom load.

Default:

- Arduino Uno drives `relay-1ch` IN.
- Relay VCC/GND connect to 5V/GND.
- COM/NO switch a low-voltage LED plus 220 ohm resistor load.

Explicit alternative:

- `relay-4ch` may replace `relay-1ch`.
- Use IN1 plus COM1/NO1 for the simulated channel.

Validation:

- Reject mains, wall outlet, 110V, 220V, or AC relay loads.
- Require relay VCC, GND, input control, contact-side low-voltage load, and current limiting for LED loads.

Simulation:

- Use `relay_switch_state`.
- Emit separate relay control-signal and contact-load current paths.
- Contact state is qualitative.

Non-goals:

Not for real mains wiring, contact ratings, isolation, clearance, contact bounce, coil transients, or safety approval.
