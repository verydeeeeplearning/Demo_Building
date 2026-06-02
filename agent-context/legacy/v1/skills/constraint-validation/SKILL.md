---
name: constraint-validation
description: Validate CircuitSpec before rendering or simulation.
---

# Constraint Validation

Validation is authoritative. Check, in order:

1. Schema shape.
2. Supported part ids.
3. Component ids referenced by connections.
4. Pin existence and protocol compatibility.
5. Power and ground presence.
6. Direct 5V-to-GND shorts.
7. Current-limiting requirements.
8. Simulation support for every active load.

Invalid specs must be repaired or returned with explicit errors. Unsupported specs must not render final circuits.
