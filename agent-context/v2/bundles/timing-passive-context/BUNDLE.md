# Timing Passive Context

Use this bundle when the student asks for a 16 MHz crystal, quartz crystal, or timing passive as a low-voltage context part.

Current support level: supported.

Supported parts:

- 16 MHz crystal: two terminal clock-reference context with X1 and X2 labels.
- Optional ceramic capacitors may be shown as context parts, but no load-capacitor sizing is simulated.

Simulation contract:

- Render the crystal and terminal labels as educational context.
- Use state-only evidence. Do not animate oscillator current, square waves, startup, or calibrated timing.
- Do not claim exact frequency tolerance, phase noise, firmware timing, or crystal load design.

Build-ready requirements:

- The requested timing passive must have canonical part capability, render footprint, source claim, and state-only primitive.
