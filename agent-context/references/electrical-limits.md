# Electrical Limits

Supported v2 circuits are low-voltage classroom circuits centered on Arduino Uno USB 5V.

- Arduino 5V rail nominal: 5V.
- Arduino GPIO signal nominal: 5V logic.
- Conservative GPIO current target: under 20 mA.
- LED circuits require current-limiting resistance.
- Servo circuits are allowed as conceptual demos but should warn that real servos can exceed USB power.
- Requests involving mains voltage, battery charging, high-current motor drivers, RF, or drones are unsupported in v1.

Use the registry's machine-readable `maxCurrentMa`, `requiresCurrentLimiting`, and `simulationModel` fields for final decisions.
