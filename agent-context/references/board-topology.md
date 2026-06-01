# Board Topology

The default physical board is a half-size breadboard plus Arduino Uno.

- Breadboard rails can carry 5V and GND when explicitly connected.
- Arduino `5V` can feed small modules.
- Arduino `GND` must be common with every active module.
- Arduino `A4/SDA` and `A5/SCL` are used for I2C OLED.
- Digital pins `D2`, `D3`, `D8`, and `D9` are available in starter examples.
- PWM-capable `D9` is preferred for servo signal and LED dimming examples.
