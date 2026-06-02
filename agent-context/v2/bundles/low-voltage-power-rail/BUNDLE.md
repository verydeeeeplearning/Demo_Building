# Low-Voltage Power Rail

Use this bundle for a breadboard power supply module, battery clip, AA holder, 1S LiPo battery, DC barrel jack, 2-pin screw terminal, or 7805 regulator powering breadboard rails.

Current support level: supported.

Supported parts:

- Breadboard power supply module: 5V or 3V3 output to the positive rail, GND to the ground rail.
- 9V battery clip, AA battery holder, 1S LiPo battery, DC barrel jack, and 2-pin screw terminal: qualitative low-voltage external source/connector with explicit polarity and power warning.
- 7805 regulator: IN from declared external low-voltage source, GND common, OUT to the positive 5V rail.

Simulation contract:

- Show rail state and polarity/ground evidence qualitatively.
- Do not animate load current for an unloaded rail.
- Do not claim battery capacity, adapter current limit, thermal design, dropout voltage, decoupling, or real regulator current capacity.
- LiPo requests must keep the power-warning visible and must not become charging, short-circuit, puncture, or high-current load instructions.
- Mains, wall-power, outlet, heater, or AC projects are blocked before render/run synthesis.

Build-ready requirements:

- Positive source/output pin reaches the breadboard positive rail.
- Ground pin reaches the breadboard ground rail.
- For a 7805, IN must reach a declared external low-voltage source, OUT must reach the positive rail, and GND must share the source and rail ground.
