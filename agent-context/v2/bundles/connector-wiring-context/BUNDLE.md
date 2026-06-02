# Connector Wiring Context

Use this bundle when the student explicitly asks for 40-pin male/female headers or a 4-pin screw terminal block as low-voltage connector hardware.

Allowed parts:
- `header-male-40pin`
- `header-female-40pin`
- `screw-terminal-4pin`
- `jumper-wire`
- `breadboard-half`

Rules:
- This is state-only connector context. Do not create current-flow paths, source voltage, or pass-through nets just because a connector is present.
- Header strips and sockets expose terminal anchors only.
- 4-pin screw terminal is low-voltage connector context and must not be used for mains or wall outlet wiring.
- Polarity or pass-through behavior must be declared by another validated topology before it can affect current paths.

Runnable evidence:
- Valid render footprint for the selected connector.
- `connector_wiring_context_state` expected state.
- No fabricated current paths.
