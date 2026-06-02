# Simulation Recipes

## OLED

Current path: Arduino 5V -> OLED VCC -> OLED module -> OLED GND -> Arduino GND. I2C lines are logic cues, not load-current paths.

## LED

Current path: Arduino digital output -> resistor -> LED anode/cathode -> Arduino GND. Estimate current as `(5V - LED forward voltage) / resistance`.

## Button

State model: not pressed means internal pull-up reads HIGH; pressed connects input to GND and reads LOW.

## Buzzer

Current path: Arduino digital output -> buzzer -> Arduino GND. Warn if current estimate exceeds GPIO target.

## Servo

Current path: Arduino 5V -> servo power -> servo ground -> Arduino GND. Signal path: PWM pin -> servo signal. Warn about real external power.
