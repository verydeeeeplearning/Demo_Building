# Netlist Rules

Wires merge endpoints into nodes. Power rails become supply nodes after connection to a supply. Ground rails become ground nodes after connection to a ground endpoint. Switches may change connectivity by state. Modules may be modeled as internal black-box loads when their registry model supports it.

I2C, PWM, and GPIO signal wires are signal edges. They may be animated as logic cues, but only validated power/load paths become current-flow paths.
