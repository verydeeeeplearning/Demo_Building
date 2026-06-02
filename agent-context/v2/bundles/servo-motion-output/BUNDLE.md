# Servo Motion Output

Use this bundle when the student wants a servo to rotate, sweep, or move to an angle from an Arduino PWM signal.

Supported wiring pattern:

- Arduino Uno 5V supplies the classroom SG90-style micro servo in the educational model.
- MG996R/high-torque servo requests are allowed only with a visible external-power warning; the simulation is qualitative and does not size a real supply.
- Arduino Uno GND connects to servo GND, and the same common-ground rule applies when discussing an external servo supply.
- Arduino Uno D9 or another PWM-capable pin connects to servo SIG/SIGNAL.
- Jumper wires and a breadboard may be used for the visual layout.

Simulation contract:

- The servo angle is shown as an educational motion state.
- Signal activity is represented qualitatively; it is not calibrated pulse-width timing.
- A current/power warning should remain visible because real servos can draw more current than a GPIO pin can supply; MG996R requests also need the high-torque/external-power warning.

Do not use this bundle for DC motors, steppers, relays, pumps, or torque/current sizing. Keep high-torque servo support qualitative.
