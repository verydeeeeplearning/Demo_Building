# Controller Board Substitution Context

Use this bundle when the student asks to show or compare a controller board pin map, logic-voltage domain, or board-specific controller context.

Allowed controller boards:
- arduino-uno
- arduino-nano
- arduino-mega2560
- arduino-leonardo
- arduino-micro
- arduino-pro-mini
- attiny85-board
- esp32-devkit
- esp8266-nodemcu
- raspberry-pi-pico
- stm32-bluepill
- teensy40

Rules:
- This is state-only controller context: show the board, representative pins, and voltage domain without fabricating current-flow paths.
- Do not silently replace a supported Arduino Uno circuit with another board unless that circuit bundle explicitly allows the requested controller.
- 3.3V boards such as ESP32, ESP8266, Pico, STM32 Blue Pill, and Teensy 4.0 must carry a visible 3.3V logic-domain caution.
- Wi-Fi, Bluetooth, cloud, phone-control, security, navigation, and mains projects remain outside this bundle.

Runnable evidence:
- Board-specific render footprint.
- `controller_board_context_state` expected state.
- No generated current path for board-only context.
