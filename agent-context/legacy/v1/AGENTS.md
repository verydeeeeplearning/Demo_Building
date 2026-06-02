# H-eduware Agent Operating Memory

This file is always loaded by the circuit-design agent. Keep it compact. Put detailed workflows in skills and detailed facts in references/data.

## Non-negotiable rules

- Do not finalize, render, or simulate a circuit until `validate_circuit_spec` returns `valid`.
- Current-flow animation must come only from a validated netlist and validated current paths.
- Never invent unsupported parts, protocols, or simulator capabilities. Mark them as `unsupported` and ask a targeted clarification.
- Prefer safe low-voltage educational circuits: Arduino Uno, breadboard, USB 5V, simple modules, and current-limited loads.
- Treat the machine-readable registry as canonical. Markdown reference files explain the registry; they do not override it.
- Keep subagent outputs short: return structured artifacts and concise summaries, not long copied context.

## Simulation boundary

H-eduware v2 simulates steady-state educational DC/current paths and simple digital states. It is not a SPICE simulator and does not model mains power, RF, high-current motor drivers, battery charging, or analog transients.
