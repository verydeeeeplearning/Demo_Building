# Logic Interface Context

Use for explicit WP-12 ICs: 74HC595, PCF8574, ADS1115, MCP3008, NE555, LM358, I2C level shifter.

Supports Arduino Uno, breadboard, I2C readout display, visible power/ground and bus/control pins, qualitative overlays.

Wire common ground and visible power. I2C: SDA-A4/SDA, SCL-A5/SCL. SPI: CLK-D13, DIN-D11, DOUT-D12, CS-D10. 74HC595: SER, SRCLK, RCLK. Level shifter: HV, LV, GND, HV1/LV1.

Limits: qualitative only. No calibrated ADC, precision op-amp, exact 555 timing, hidden channels/outputs, or regulator/current-boost claims.
