# Visual Part Simulation Coverage Report

Generated: 2026-06-01

This file is generated from the visual library, context crosswalk, and coverage target classifier. Update the source contracts, then regenerate this file rather than hand-editing rows.

## Snapshot

- Total visual parts: 132
- Explicit target states: 132/132
- Current simulation-ready parts: 131
- Current unsafe-blocked parts: 1
- Target achieved parts: 132
- Remaining target parts: 0
- Legacy visual-only compatibility count: 1
- Missing target state ids: none
- Missing work package ids: none

## Target State Counts

| Target state | Count |
| --- | ---: |
| simulation-ready | 131 |
| unsafe-blocked | 1 |

## Package Progress

| Package | Title | Achieved | Remaining | Complete | Next remaining ids |
| --- | --- | ---: | ---: | ---: | --- |
| WP-01 | Analog Sensor Display Generalization | 11/11 | 0 | 100% | - |
| WP-02 | Digital Sensor and Switch Generalization | 14/14 | 0 | 100% | - |
| WP-03 | Matrix and Multi-Input | 5/5 | 0 | 100% | - |
| WP-04 | Display Expansion | 11/11 | 0 | 100% | - |
| WP-05 | Light and Sound Outputs | 8/8 | 0 | 100% | - |
| WP-06 | Servo, Motor, Driver, Relay, High-Current | 18/18 | 0 | 100% | - |
| WP-07 | Power, Regulation, Protection, Passive Components | 19/19 | 0 | 100% | - |
| WP-08 | Controller Board Expansion | 12/12 | 0 | 100% | - |
| WP-09 | Prototyping and Connector Surfaces | 10/10 | 0 | 100% | - |
| WP-10 | Sensor Protocol Modules | 9/9 | 0 | 100% | - |
| WP-11 | Communication Modules | 8/8 | 0 | 100% | - |
| WP-12 | Logic, Interface, and IC Expansion | 7/7 | 0 | 100% | - |

## Part Rows

| Done | Package | Visual part | Family | Risk | Current tier | Target | Remaining reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| x | WP-06 | 2n2222-npn | discrete-switch-ic | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-12 | 74hc595-shift | logic-or-interface-ic | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | 7805-regulator | power-regulation-ic | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | 7seg-1digit | display-led-array | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | 7seg-4digit-tm1637 | display-led-array | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | 8x8-matrix-max7219 | display-led-array | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | 9v-battery-clip | power-source-or-connector | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | a4988-stepper | driver-ic | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | aa-battery-holder | power-source-or-connector | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | acs712-current | sensor-analog | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | active-buzzer | sound-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-12 | ads1115-adc | analog-interface-ic | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | arduino-leonardo | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | arduino-mega2560 | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | arduino-micro | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | arduino-nano | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | arduino-pro-mini | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | arduino-uno-r3 | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | attiny85-board | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | barrel-jack | power-source-or-connector | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | bmp280 | sensor-i2c-or-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | breadboard-full | prototyping-surface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | breadboard-half | prototyping-surface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | breadboard-mini | prototyping-surface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | breadboard-psu | power-source-or-connector | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | ceramic-cap | capacitive-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | crystal-16mhz | frequency-or-inductive-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | dc-fan-5v | motor-or-inductive-output | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | dc-motor-130 | motor-or-inductive-output | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | dht11 | sensor | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | dht22 | sensor | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | diode-1n4007 | protection-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-03 | dip-switch-4 | matrix-or-multi-input | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | drv8825-stepper | driver-ic | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | dupont-jumper-wires | prototyping-surface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | electrolytic-cap | capacitive-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | epaper-213 | display-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | esp01-wifi | wireless-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | esp32-devkit | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | esp8266-nodemcu | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | flame-sensor | sensor-analog-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | fsr-pressure | sensor-analog | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | gps-neo6m | sensor-serial | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | hall-effect-sensor | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | hc05-bluetooth | wireless-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | header-female-40pin | connector-wiring | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | header-male-40pin | connector-wiring | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | hmc5883l | sensor-i2c-or-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | hx711-loadcell | sensor-i2c-or-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-12 | i2c-level-shifter | level-shifter-interface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | inductor-axial | frequency-or-inductive-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | ir-receiver | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | irf520-mosfet | driver-ic | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-03 | joystick-module | human-input-analog | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-03 | keypad-4x4 | matrix-or-multi-input | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | l293d-driver | driver-ic | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | l298n-driver | driver-ic | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | laser-diode-module | light-output | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | lcd-16x2 | display-i2c | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | lcd-20x4 | display-i2c | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | ldr-module | sensor-analog-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | led-5mm-blue | light-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | led-5mm-green | light-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | led-5mm-red | light-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | limit-switch | human-input-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | line-tracker | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | lipo-battery-1s | power-source-or-connector | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-12 | lm358-opamp | analog-interface-ic | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | lora-ra02 | wireless-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | max30102-pulse | sensor-i2c-or-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | mcp2515-can | wired-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-12 | mcp3008-adc | analog-interface-ic | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-03 | membrane-keypad-1x4 | matrix-or-multi-input | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | mg996r-servo | servo-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | mini-water-pump | motor-or-inductive-output | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | mpu6050 | sensor-i2c-or-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | mq2-gas | sensor-analog-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-12 | ne555-timer | logic-or-interface-ic | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | nema17-stepper | motor-or-inductive-output | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | neopixel-ring-12 | display-led-array | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | nokia-5110 | display-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | nrf24l01-radio | wireless-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | oled-096-i2c | display-i2c | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | oled-13-i2c | display-i2c | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | passive-buzzer | sound-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | pcb-blank-single | prototyping-surface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-12 | pcf8574-expander | logic-or-interface-ic | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | perfboard-5x7 | prototyping-surface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | pir-hc-sr501 | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | polyfuse | protection-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | potentiometer | adjustable-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | proto-shield-uno | prototyping-surface | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | push-button | human-input-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | rain-sensor | sensor-analog-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | raspberry-pi-pico | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-10 | rc522-rfid | sensor-i2c-or-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | reed-switch | human-input-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | relay-1ch | relay-output | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | relay-4ch | relay-output | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | resistor-axial | resistive-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | rgb-led-common-cathode | light-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-03 | rotary-encoder | human-input-analog | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | rs485-module | wired-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | schottky-diode | protection-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | screw-terminal-2pin | power-source-or-connector | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-09 | screw-terminal-4pin | prototyping-surface | power-warning | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | sg90-servo | servo-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | sim800l-gsm | wireless-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | slide-switch | human-input-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | soil-moisture | sensor-analog-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | solenoid-valve | motor-or-inductive-output | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | sound-sensor | sensor-analog-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | stepper-28byj48 | motor-or-inductive-output | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | stm32-bluepill | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | sw420-vibration | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | tcs3200-color | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-08 | teensy40 | controller-board | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-04 | tft-18 | display-spi | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | thermistor-ntc | sensor-analog | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | tilt-ball-sensor | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | tmp36-temp | sensor-analog | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | toggle-switch | human-input-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | trimmer-pot | adjustable-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | ttp223-touch | human-input-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-06 | uln2003-driver | driver-ic | high-current | simulation-ready | simulation-ready | target achieved |
| x | WP-02 | ultrasonic-hcsr04 | sensor-digital | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-11 | usb-host-shield | wired-communication | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | varistor-mov | protection-passive | mains-unsafe | unsafe-blocked | unsafe-blocked | target achieved |
| x | WP-06 | vibration-motor | motor-or-inductive-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-01 | water-level-sensor | sensor-analog | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-05 | ws2812b-strip | light-output | low-voltage | simulation-ready | simulation-ready | target achieved |
| x | WP-07 | zener-diode | protection-passive | low-voltage | simulation-ready | simulation-ready | target achieved |
