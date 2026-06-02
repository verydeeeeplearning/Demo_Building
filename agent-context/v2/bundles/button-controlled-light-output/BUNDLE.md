# Button Controlled Light Output

Use this bundle when the student wants a tactile button or switch input to control a current-limited LED.

Supported wiring pattern:

- Arduino Uno digital input reads the button.
- Button is tied to a defined reference so the input is not floating.
- Arduino Uno digital output drives a 5 mm LED through a 220 ohm series resistor.
- LED cathode returns to common ground.
- The button input and LED output share Arduino ground.

Simulation contract:

- The button state toggles the LED on/off state.
- Current-flow animation appears only on the validated LED load path.
- The simulation is educational and does not model contact bounce or firmware debounce timing.

Do not use this bundle for capacitive touch sensors, relays, mains lamps, or analog brightness control.
