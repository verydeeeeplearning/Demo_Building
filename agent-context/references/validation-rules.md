# Validation Rules

Validation prevents agent loopholes:

- Unknown registry part: unsupported.
- Unknown component id in connection: invalid.
- Unknown pin: invalid.
- Missing ground for active load: invalid.
- 5V connected directly to GND: invalid.
- LED without resistor: invalid.
- Load current above supported model limit: invalid or warning depending on registry support.
- Unsupported simulator model: unsupported.

The repair loop may add a missing resistor or ground wire only when the student intent clearly implies a beginner-safe circuit. It may not invent advanced hardware.
