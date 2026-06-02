# Prototyping Surface Context

Use this bundle when the student explicitly asks for a full-size breadboard, mini breadboard, perfboard, blank PCB, or Uno prototype shield as the build surface.

Allowed parts:
- `breadboard-full`
- `breadboard-mini`
- `perfboard-5x7`
- `pcb-blank-single`
- `proto-shield-uno`
- `breadboard-half`
- `jumper-wire`

Rules:
- This is state-only placement context. Do not create current-flow paths just because a surface is present.
- Full/mini breadboards are rendered as distinct surfaces; rail continuity must still be declared by topology/tool evidence.
- Perfboard and blank PCB do not inherit solderless breadboard row continuity.
- Proto shield is a prototyping surface/pass-through context, not a standalone controller.
- Block mains, wall-outlet, and high-risk fabrication requests.

Runnable evidence:
- Valid render footprint for the selected surface.
- `prototyping_surface_context_state` expected state.
- No fabricated current paths.
