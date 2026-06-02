# Validator Tool Contract

Tools:

- validate_schema(spec)
- validate_parts(spec)
- validate_connections(spec)
- build_netlist(spec)
- analyze_power_paths(netlist)
- estimate_current(spec, netlist)
- detect_faults(spec, netlist)
- validate_simulation_support(spec)
- validate_render_support(spec)

Each tool returns source version, authoritative flag, machine-readable issues, and concise student-facing explanations. Tools must not expose secrets.
