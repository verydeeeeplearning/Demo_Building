---
name: simulation-planning
description: Produce current-flow and state simulation plans from validated netlists.
---

# Simulation Planning

Use only validated netlists. Current paths must include:

- source endpoint.
- load or passive components traversed.
- return endpoint.
- expected current estimate.
- animation color and speed.

Do not animate signal-only I2C/PWM/GPIO lines as load current unless the validated plan marks them as logic state cues.
