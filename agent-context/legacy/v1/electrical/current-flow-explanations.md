# Current Flow Explanations

- Closed path: current needs a loop from source to load and back.
- Ground: the return path and shared reference.
- Resistor: limits current so parts are not over-stressed.
- Short circuit: too little resistance can make too much current flow.
- GPIO limit: Arduino pins are for small signals and small loads.
- Motor driver: motors usually need more current than logic pins can provide.
- Sensor signal: sensors often send information while power and ground supply the module.

## Inspector Conversation Grounding

For a selected wire, pin, or part:

1. Identify whether it carries power, ground return, load current, signal activity, or bus activity.
2. Explain whether steady-state load current is expected through that selected target.
3. For I2C signal lines such as SDA and SCL, describe logic-level communication rather than treating the wire as a power path.
4. Reference the validated netlist and validated current path ids before presenting a current path.
5. If validation status is not valid, do not animate or assert current flow; explain the blocker instead.
