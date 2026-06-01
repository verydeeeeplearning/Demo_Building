# Render Plan Contract

Render plans are declarative data, not code. They contain parts, pin endpoints, connections, floating cards, and optional layout anchors.

Only validated `CircuitSpec` objects may compile to render plans. Unknown footprints must fail render support validation instead of falling back to invented geometry.
