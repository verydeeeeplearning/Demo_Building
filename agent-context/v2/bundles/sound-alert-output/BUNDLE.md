# Sound Alert Output

Use this bundle when the student wants an Arduino-controlled buzzer, active buzzer, beep, tone, or simple alarm sound.

Supported wiring pattern:

- Arduino Uno digital/PWM-capable output drives the buzzer positive/VCC pin.
- Buzzer negative/GND pin returns to Arduino ground.
- Breadboard and jumper wires may be used for classroom layout.

Simulation contract:

- The buzzer is modeled as a low-current classroom piezo or active fixed-tone buzzer.
- The visible state is a beeping/pulsing sound cue plus a validated low-current path.
- The simulation does not model audio waveform fidelity, SPL, or amplifier behavior.

Do not use this bundle for speakers, high-power sound systems, microphones, or sound sensor input.
