# Passive Protection Context

Use this bundle when the student asks for a ceramic capacitor, electrolytic capacitor, diode, Schottky diode, Zener diode, polyfuse, or axial inductor as a low-voltage passive context part.

Current support level: supported.

Supported parts:

- Ceramic capacitor and inductor: non-polar passive context with labeled terminals.
- Electrolytic capacitor, rectifier diode, Schottky diode, and Zener diode: polarized passive context with visible plus/minus or anode/cathode orientation.
- Polyfuse: low-voltage protection context only.

Simulation contract:

- Render the part, pins, polarity, and educational role.
- Use state-only evidence. Do not animate active current flow for passive-only circuits.
- Do not claim capacitance, inductance, diode drop, clamp voltage, fuse trip current, surge protection, heat, RF, or flyback design performance.
- MOV/varistor, mains, wall-power, outlet, heater, or AC protection projects are blocked before render/run synthesis.

Build-ready requirements:

- The requested passive part must have a canonical part capability, render footprint, source claim, and state-only primitive.
- Polarized parts must keep their pin orientation visible.
