const KO_PART_COPY = {
  'arduino-uno-r3': {
    name: 'Arduino Uno R3',
    description: 'ATmega328P 기반의 가장 대표적인 입문용 마이크로컨트롤러 보드입니다.'
  },
  'arduino-nano': {
    name: 'Arduino Nano',
    description: '미니 USB 커넥터가 있는 브레드보드 친화형 소형 ATmega328P 보드입니다.'
  },
  'arduino-mega2560': {
    name: 'Arduino Mega 2560',
    description: '디지털 I/O 54개를 갖춘 ATmega2560 대형 보드로 복잡한 프로젝트에 적합합니다.'
  },
  'arduino-leonardo': {
    name: 'Arduino Leonardo',
    description: '컴퓨터에서 USB 키보드나 마우스처럼 인식될 수 있는 ATmega32u4 보드입니다.'
  },
  'arduino-pro-mini': {
    name: 'Arduino Pro Mini',
    description: 'USB 칩을 덜어낸 최소형 ATmega328P 보드로 작은 제작물에 쓰기 좋습니다.'
  },
  'arduino-micro': {
    name: 'Arduino Micro',
    description: '기본 USB HID를 지원하는 작고 얇은 ATmega32u4 개발 보드입니다.'
  },
  'esp32-devkit': {
    name: 'ESP32 DevKit V1',
    description: 'WiFi와 Bluetooth를 내장한 듀얼 코어 SoC 보드로 IoT 수업에 적합합니다.'
  },
  'esp8266-nodemcu': {
    name: 'NodeMCU ESP8266',
    description: 'ESP8266 기반의 저가 WiFi 보드로 Lua와 Arduino 개발 환경을 사용할 수 있습니다.'
  },
  'raspberry-pi-pico': {
    name: 'Raspberry Pi Pico',
    description: 'RP2040 듀얼 코어 ARM Cortex-M0+ 마이크로컨트롤러 보드입니다.'
  },
  'stm32-bluepill': {
    name: 'STM32 Blue Pill',
    description: 'STM32F103C8T6 ARM Cortex-M3 기반의 저렴한 고급 학습용 보드입니다.'
  },
  'attiny85-board': {
    name: 'ATtiny85 Digispark',
    description: 'USB 포트에 바로 꽂을 수 있는 초소형 ATtiny85 개발 보드입니다.'
  },
  'teensy40': {
    name: 'Teensy 4.0',
    description: '600MHz ARM Cortex-M7을 사용하는 고성능 USB 개발 보드입니다.'
  },
  'oled-096-i2c': {
    name: 'OLED 0.96" I2C 디스플레이',
    description: 'I2C로 통신하는 128x64 흑백 OLED 화면으로 작은 상태 표시창에 좋습니다.'
  },
  'oled-13-i2c': {
    name: 'OLED 1.3" I2C 디스플레이',
    description: '더 크게 읽을 수 있는 1.3인치 128x64 OLED 디스플레이입니다.'
  },
  'lcd-16x2': {
    name: '16x2 LCD 디스플레이',
    description: '파란 백라이트와 I2C 어댑터를 쓰는 16열 2행 문자 LCD입니다.'
  },
  'lcd-20x4': {
    name: '20x4 LCD 디스플레이',
    description: '20자씩 4줄을 표시할 수 있는 대형 문자 LCD 모듈입니다.'
  },
  'tft-18': {
    name: 'TFT LCD 1.8" SPI',
    description: 'SPI로 제어하는 128x160 컬러 TFT 화면으로 이미지와 그래픽 표시가 가능합니다.'
  },
  '7seg-1digit': {
    name: '7세그먼트 1자리 표시기',
    description: '숫자 한 자리를 표시하는 빨간색 7세그먼트 LED 표시기입니다.'
  },
  '7seg-4digit-tm1637': {
    name: 'TM1637 4자리 7세그먼트',
    description: '2선식 인터페이스로 제어하는 4자리 7세그먼트 표시 모듈입니다.'
  },
  '8x8-matrix-max7219': {
    name: 'MAX7219 8x8 LED 매트릭스',
    description: 'MAX7219 SPI 컨트롤러로 구동되는 8x8 빨간색 LED 도트 매트릭스입니다.'
  },
  'nokia-5110': {
    name: 'Nokia 5110 LCD',
    description: 'PCD8544 컨트롤러를 쓰는 84x48 흑백 LCD 모듈입니다.'
  },
  'epaper-213': {
    name: 'E-Paper 2.13" HAT',
    description: '전원을 꺼도 화면이 유지되는 저전력 250x122 전자종이 디스플레이입니다.'
  },
  'neopixel-ring-12': {
    name: 'NeoPixel 12 LED 링',
    description: '개별 제어 가능한 WS2812B RGB LED 12개가 원형 PCB에 배치된 모듈입니다.'
  },
  'ldr-module': {
    name: 'LDR 조도 센서 모듈',
    description: '밝을수록 더 높은 아날로그 전압을 내는 광저항 기반 조도 센서입니다.'
  },
  'pir-hc-sr501': {
    name: 'HC-SR501 PIR 모션 센서',
    description: '따뜻한 물체의 움직임을 최대 약 7m까지 감지하는 적외선 모션 센서입니다.'
  },
  'ultrasonic-hcsr04': {
    name: 'HC-SR04 초음파 거리 센서',
    description: '초음파 반사 시간을 이용해 약 2cm에서 400cm까지 거리를 측정합니다.'
  },
  dht11: {
    name: 'DHT11 온습도 센서',
    description: '온도와 습도를 디지털로 읽는 기본형 센서입니다.'
  },
  dht22: {
    name: 'DHT22 온습도 센서',
    description: 'DHT11보다 정확도가 높은 디지털 온습도 센서입니다.'
  },
  bmp280: {
    name: 'BMP280 기압 센서',
    description: 'I2C 또는 SPI로 기압과 온도를 읽는 디지털 센서입니다.'
  },
  mpu6050: {
    name: 'MPU-6050 IMU',
    description: '3축 자이로와 3축 가속도계를 한 칩에 담은 6축 관성 센서입니다.'
  },
  hmc5883l: {
    name: 'HMC5883L 나침반 센서',
    description: '자기장의 방향을 측정하는 3축 디지털 나침반 모듈입니다.'
  },
  'soil-moisture': {
    name: '토양 수분 센서',
    description: '식물 관리 프로젝트에서 흙의 수분 함량을 측정하는 프로브입니다.'
  },
  'mq2-gas': {
    name: 'MQ-2 가스 센서',
    description: '공기 중 가연성 가스, 연기, LPG 농도를 감지하는 센서입니다.'
  },
  'flame-sensor': {
    name: '불꽃 감지 센서',
    description: '적외선으로 약 100cm 안의 불꽃이나 화염을 감지하는 모듈입니다.'
  },
  'sound-sensor': {
    name: '소리 감지 센서',
    description: '마이크를 이용해 소리의 존재나 대략적인 크기를 감지하는 모듈입니다.'
  },
  'ir-receiver': {
    name: 'IR 수신 모듈',
    description: '38kHz 적외선 리모컨 신호를 받아 디지털 펄스로 출력합니다.'
  },
  'hall-effect-sensor': {
    name: '홀 효과 센서',
    description: '자기장의 존재를 감지해 디지털 또는 아날로그 신호로 출력합니다.'
  },
  'tcs3200-color': {
    name: 'TCS3200 컬러 센서',
    description: '포토다이오드 배열과 주파수 출력을 이용해 RGB 색 강도를 감지합니다.'
  },
  'hx711-loadcell': {
    name: 'HX711 로드셀 증폭기',
    description: '무게 측정용 로드셀에 쓰는 정밀 24비트 ADC 증폭 모듈입니다.'
  },
  'gps-neo6m': {
    name: 'NEO-6M GPS 모듈',
    description: '위치와 시간 정보를 NMEA 문장으로 출력하는 GPS 수신 모듈입니다.'
  },
  'rc522-rfid': {
    name: 'RC522 RFID 모듈',
    description: '13.56MHz MIFARE 카드와 키태그를 SPI로 읽고 쓰는 모듈입니다.'
  },
  'max30102-pulse': {
    name: 'MAX30102 맥박 산소 센서',
    description: '빨간 LED와 IR LED로 심박수와 혈중 산소 포화도 변화를 측정합니다.'
  },
  'acs712-current': {
    name: 'ACS712 전류 센서',
    description: '홀 효과를 이용해 AC 또는 DC 전류를 최대 30A까지 측정하는 센서입니다.'
  },
  'water-level-sensor': {
    name: '수위 센서',
    description: '노출된 도체 패턴의 저항 변화를 이용해 물의 존재나 깊이를 감지합니다.'
  },
  'sw420-vibration': {
    name: 'SW-420 진동 센서',
    description: '충격이나 움직임이 있을 때 트리거되는 스프링 기반 진동 센서입니다.'
  },
  'line-tracker': {
    name: '라인 트래킹 센서',
    description: '흰 바탕의 검은 선을 감지해 로봇 주행에 사용하는 IR 반사 센서입니다.'
  },
  'rain-sensor': {
    name: '빗물 감지 센서',
    description: '센서판의 도전 패턴 사이 저항 변화를 이용해 비를 감지합니다.'
  },
  'tilt-ball-sensor': {
    name: '볼 틸트 스위치',
    description: '기울어졌을 때 금속 볼이 접점을 닫아 회로를 연결하는 단순 센서입니다.'
  },
  'tmp36-temp': {
    name: 'TMP36 온도 센서',
    description: '섭씨 온도에 비례하는 아날로그 전압을 출력하는 온도 센서입니다.'
  },
  'thermistor-ntc': {
    name: 'NTC 서미스터',
    description: '온도가 올라가면 저항이 낮아지는 음의 온도 계수 저항입니다.'
  },
  'fsr-pressure': {
    name: 'FSR 압력 센서',
    description: '누르는 힘이 커질수록 저항이 낮아지는 힘 감지 저항 센서입니다.'
  },
  'led-5mm-red': {
    name: '5mm 빨간색 LED',
    description: '20mA에서 약 2V의 순방향 전압을 갖는 표준 5mm 빨간색 LED입니다.'
  },
  'led-5mm-green': {
    name: '5mm 초록색 LED',
    description: '상태 표시와 기초 회로 실습에 자주 쓰는 표준 5mm 초록색 LED입니다.'
  },
  'led-5mm-blue': {
    name: '5mm 파란색 LED',
    description: '약 3.2V 순방향 전압을 갖는 표준 5mm 파란색 LED입니다.'
  },
  'rgb-led-common-cathode': {
    name: '공통 캐소드 RGB LED',
    description: '빨강, 초록, 파랑 애노드를 따로 제어하고 캐소드를 공유하는 3색 LED입니다.'
  },
  'ws2812b-strip': {
    name: 'WS2812B LED 스트립',
    description: '각 LED에 컨트롤러가 들어 있어 LED마다 색을 따로 제어할 수 있는 RGB 스트립입니다.'
  },
  'sg90-servo': {
    name: 'SG90 마이크로 서보',
    description: '약 180도 회전이 가능한 9g급 경량 서보 모터로 로봇 실습에 많이 씁니다.'
  },
  'mg996r-servo': {
    name: 'MG996R 메탈 기어 서보',
    description: '큰 힘이 필요한 로봇 팔에 쓰기 좋은 고토크 메탈 기어 서보입니다.'
  },
  'dc-motor-130': {
    name: '130 DC 모터',
    description: '장난감 자동차나 소형 팬 프로젝트에 흔히 쓰는 3V-6V 브러시 DC 모터입니다.'
  },
  'stepper-28byj48': {
    name: '28BYJ-48 스테퍼 모터',
    description: 'ULN2003 드라이버와 함께 쓰는 5선식 유니폴라 기어드 스테퍼 모터입니다.'
  },
  'nema17-stepper': {
    name: 'NEMA 17 스테퍼 모터',
    description: '3D 프린터와 정밀 위치 제어에 널리 쓰이는 200스텝 양극성 스테퍼 모터입니다.'
  },
  'passive-buzzer': {
    name: '패시브 부저',
    description: '여러 음을 내기 위해 PWM 신호가 필요한 피에조 부저입니다.'
  },
  'active-buzzer': {
    name: '액티브 부저',
    description: '내장 발진기가 있어 전원을 주면 정해진 주파수로 울리는 피에조 부저입니다.'
  },
  'relay-1ch': {
    name: '1채널 릴레이 모듈',
    description: '5V 로직 신호로 높은 전압의 부하를 켜고 끄는 단일 릴레이 보드입니다.'
  },
  'relay-4ch': {
    name: '4채널 릴레이 모듈',
    description: '여러 고전압 장치를 독립적으로 제어할 수 있는 4개 릴레이 모듈입니다.'
  },
  'laser-diode-module': {
    name: '레이저 다이오드 모듈',
    description: '포인터나 감지 실험에 쓰는 5mW 650nm 빨간색 레이저 모듈입니다.'
  },
  'vibration-motor': {
    name: '진동 모터 모듈',
    description: '전원을 주면 촉각 피드백을 만드는 동전형 진동 모터 모듈입니다.'
  },
  'mini-water-pump': {
    name: '미니 워터 펌프',
    description: '관수나 유체 이동 프로젝트에 쓰는 소형 수중 DC 펌프입니다.'
  },
  'dc-fan-5v': {
    name: '5V DC 냉각 팬',
    description: '부품 냉각에 쓰는 30mm x 30mm 소형 5V 브러시리스 DC 팬입니다.'
  },
  'solenoid-valve': {
    name: '솔레노이드 밸브',
    description: '전기 신호로 열고 닫아 물이나 공기의 흐름을 제어하는 밸브입니다.'
  },
  'l298n-driver': {
    name: 'L298N 모터 드라이버',
    description: 'DC 모터 2개 또는 스테퍼 모터 1개를 구동할 수 있는 듀얼 H-브리지 모듈입니다.'
  },
  'uln2003-driver': {
    name: 'ULN2003 스테퍼 드라이버',
    description: '28BYJ-48 스테퍼 모터 구동에 많이 쓰는 7채널 달링턴 트랜지스터 배열 모듈입니다.'
  },
  'a4988-stepper': {
    name: 'A4988 스테퍼 드라이버',
    description: '최대 1/16 마이크로스텝을 지원하는 양극성 스테퍼 모터 드라이버입니다.'
  },
  'drv8825-stepper': {
    name: 'DRV8825 스테퍼 드라이버',
    description: '전류 제한을 조절할 수 있는 고전류 1/32 마이크로스텝 드라이버입니다.'
  },
  '74hc595-shift': {
    name: '74HC595 시프트 레지스터',
    description: '핀 3개로 GPIO 출력을 늘릴 수 있는 8비트 직렬 입력 병렬 출력 IC입니다.'
  },
  'ne555-timer': {
    name: 'NE555 타이머 IC',
    description: '단안정, 쌍안정, 발진 회로에 두루 쓰이는 대표적인 타이머 IC입니다.'
  },
  'lm358-opamp': {
    name: 'LM358 연산 증폭기',
    description: '신호 처리와 비교 회로에 쓰는 범용 듀얼 연산 증폭기 IC입니다.'
  },
  '7805-regulator': {
    name: '7805 전압 레귤레이터',
    description: '7V-35V 입력에서 안정적인 5V를 출력하는 선형 전압 레귤레이터입니다.'
  },
  'irf520-mosfet': {
    name: 'IRF520 MOSFET 모듈',
    description: '로직 신호로 비교적 큰 전류의 부하를 스위칭하는 N채널 MOSFET 모듈입니다.'
  },
  '2n2222-npn': {
    name: '2N2222 NPN 트랜지스터',
    description: '최대 약 600mA 스위칭과 증폭에 쓰는 범용 NPN 바이폴라 트랜지스터입니다.'
  },
  'ads1115-adc': {
    name: 'ADS1115 ADC 모듈',
    description: 'I2C로 연결하는 16비트 4채널 ADC와 프로그램 가능 이득 증폭기 모듈입니다.'
  },
  'pcf8574-expander': {
    name: 'PCF8574 I2C 확장기',
    description: 'I2C 주소를 설정해 입출력 핀 8개를 추가하는 GPIO 확장 IC입니다.'
  },
  'mcp3008-adc': {
    name: 'MCP3008 SPI ADC',
    description: '아날로그 입력을 추가할 때 쓰는 10비트 8채널 SPI ADC입니다.'
  },
  'l293d-driver': {
    name: 'L293D 모터 드라이버 IC',
    description: '내장 다이오드가 있는 쿼드 하프 브리지 IC로 DC 모터 2개를 제어합니다.'
  },
  'resistor-axial': {
    name: '축형 저항',
    description: '1Ω부터 10MΩ까지 다양한 값으로 쓰는 탄소피막 또는 금속피막 리드 저항입니다.'
  },
  'electrolytic-cap': {
    name: '전해 커패시터',
    description: '필터링과 에너지 저장에 쓰는 극성 알루미늄 전해 커패시터입니다.'
  },
  'ceramic-cap': {
    name: '세라믹 커패시터',
    description: '디커플링과 고주파 필터링에 쓰는 무극성 세라믹 디스크 커패시터입니다.'
  },
  potentiometer: {
    name: '10K 가변저항',
    description: '0에서 10KΩ까지 저항을 조절할 수 있는 3단자 회전식 가변저항입니다.'
  },
  'trimmer-pot': {
    name: '트리머 가변저항',
    description: '회로 보정용으로 드라이버를 사용해 값을 맞추는 소형 가변저항입니다.'
  },
  'inductor-axial': {
    name: '축형 인덕터',
    description: '에너지 저장, 필터링, RF 회로에 쓰는 축형 권선 인덕터입니다.'
  },
  'diode-1n4007': {
    name: '1N4007 정류 다이오드',
    description: '1A, 1000V 피크 역전압 정격의 범용 실리콘 정류 다이오드입니다.'
  },
  'zener-diode': {
    name: '제너 다이오드',
    description: '특정 항복 전압에서 역방향으로 도통해 기준 전압을 만드는 다이오드입니다.'
  },
  'schottky-diode': {
    name: '1N5819 쇼트키 다이오드',
    description: '순방향 전압이 낮고 빠르게 스위칭되어 역극성 보호에 적합합니다.'
  },
  'crystal-16mhz': {
    name: '16MHz 크리스털',
    description: '마이크로컨트롤러에 정확한 16MHz 클록을 제공하는 석영 발진자입니다.'
  },
  polyfuse: {
    name: '폴리퓨즈 / 리셋 가능 퓨즈',
    description: '과전류에서 저항이 커지고 식으면 다시 회복되는 PPTC 보호 소자입니다.'
  },
  'varistor-mov': {
    name: '바리스터(MOV)',
    description: '전압 스파이크를 클램프해 회로를 순간 과전압으로부터 보호합니다.'
  },
  'push-button': {
    name: '택트 푸시 버튼',
    description: '누르는 동안 회로를 닫는 순간 동작형 촉각 스위치입니다.'
  },
  'slide-switch': {
    name: '슬라이드 스위치',
    description: '회로에서 두 위치를 전환하는 3단자 슬라이드 스위치입니다.'
  },
  'toggle-switch': {
    name: '토글 스위치',
    description: '레버 위치가 기계적으로 유지되어 켜짐과 꺼짐 상태를 선택하는 스위치입니다.'
  },
  'dip-switch-4': {
    name: '4구 DIP 스위치',
    description: '설정 선택에 쓰는 DIP 패키지의 독립 단극 스위치 4개 묶음입니다.'
  },
  'joystick-module': {
    name: '아날로그 조이스틱 모듈',
    description: '게임 조작처럼 쓸 수 있는 2축 아날로그 조이스틱과 중앙 버튼 모듈입니다.'
  },
  'keypad-4x4': {
    name: '4x4 매트릭스 키패드',
    description: '행과 열을 스캔해 16개 버튼 입력을 읽는 멤브레인 키패드입니다.'
  },
  'rotary-encoder': {
    name: '로터리 엔코더 모듈',
    description: '회전 방향과 클릭을 감지하는 증분형 로터리 엔코더입니다.'
  },
  'limit-switch': {
    name: '리미트 스위치',
    description: '움직이는 부품이 끝 위치에 도달했을 때 눌려 동작하는 기계식 스위치입니다.'
  },
  'reed-switch': {
    name: '리드 스위치',
    description: '자석이 가까워지면 유리 캡슐 안의 접점이 닫히는 자기식 스위치입니다.'
  },
  'ttp223-touch': {
    name: 'TTP223 정전식 터치 센서',
    description: '기계 접점 없이 손가락 접촉을 감지하는 정전식 터치 모듈입니다.'
  },
  'membrane-keypad-1x4': {
    name: '1x4 멤브레인 키패드',
    description: '간단한 메뉴나 미디어 제어에 쓰기 좋은 얇은 4버튼 키패드 스트립입니다.'
  },
  '9v-battery-clip': {
    name: '9V 배터리와 클립',
    description: '휴대용 전원 실습에 쓰는 PP3 9V 알카라인 배터리와 스냅 커넥터입니다.'
  },
  'aa-battery-holder': {
    name: 'AA 배터리 홀더 4구',
    description: 'AA 알카라인 배터리 4개로 약 6V를 제공하는 리드선형 배터리 홀더입니다.'
  },
  'lipo-battery-1s': {
    name: '1S 1000mAh LiPo 배터리',
    description: '소형 휴대용 프로젝트에 쓰는 단일 셀 3.7V 리튬 폴리머 배터리입니다.'
  },
  'breadboard-psu': {
    name: '브레드보드 전원 모듈',
    description: '브레드보드에 꽂아 3.3V와 5V 전원 레일을 선택 제공하는 모듈입니다.'
  },
  'barrel-jack': {
    name: 'DC 배럴 잭',
    description: '전원 어댑터를 연결하는 표준 5.5mm/2.1mm DC 전원 소켓입니다.'
  },
  'screw-terminal-2pin': {
    name: '2핀 스크루 터미널',
    description: '전선을 나사로 단단히 고정하는 PCB 장착형 2핀 터미널 블록입니다.'
  },
  'hc05-bluetooth': {
    name: 'HC-05 Bluetooth 모듈',
    description: '최대 약 10m 무선 UART 통신에 쓰는 클래식 Bluetooth 직렬 모듈입니다.'
  },
  'esp01-wifi': {
    name: 'ESP-01 WiFi 모듈',
    description: 'AT 명령으로 무선 연결을 추가하는 소형 ESP8266 기반 WiFi 모듈입니다.'
  },
  'nrf24l01-radio': {
    name: 'NRF24L01 2.4GHz 무선 모듈',
    description: '저전력 2.4GHz 무선 통신을 지원하는 트랜시버 모듈입니다.'
  },
  'lora-ra02': {
    name: 'LoRa Ra-02 모듈',
    description: '장거리 저전력 IoT 링크에 쓰는 SX1278 LoRa 확산 스펙트럼 무선 모듈입니다.'
  },
  'sim800l-gsm': {
    name: 'SIM800L GSM 모듈',
    description: 'SMS, 통화, 모바일 데이터 실습에 쓰는 쿼드밴드 GSM/GPRS 모듈입니다.'
  },
  'rs485-module': {
    name: 'RS-485 트랜시버 모듈',
    description: '장거리 차동 RS-485 직렬 통신을 위한 MAX485 기반 모듈입니다.'
  },
  'mcp2515-can': {
    name: 'MCP2515 CAN 버스 모듈',
    description: '마이크로컨트롤러를 CAN 버스 네트워크에 연결하는 SPI-CAN 컨트롤러 모듈입니다.'
  },
  'usb-host-shield': {
    name: 'USB Host Shield Mini',
    description: 'Arduino가 USB 호스트로 동작해 USB 장치를 연결할 수 있게 하는 MAX3421E 기반 실드입니다.'
  },
  'breadboard-half': {
    name: '하프 사이즈 브레드보드',
    description: '빠른 회로 프로토타입 제작에 쓰는 400타이 포인트 무납땜 브레드보드입니다.'
  },
  'breadboard-full': {
    name: '풀 사이즈 브레드보드',
    description: '듀얼 전원 레일과 830타이 포인트를 갖춘 큰 무납땜 브레드보드입니다.'
  },
  'breadboard-mini': {
    name: '미니 브레드보드',
    description: '아주 작은 프로토타입 배치에 쓰는 170타이 포인트 미니 브레드보드입니다.'
  },
  'perfboard-5x7': {
    name: '5x7cm 만능기판',
    description: '영구 회로를 납땜하기 위한 5x7cm 구리 패드 만능기판입니다.'
  },
  'header-male-40pin': {
    name: '40핀 수 헤더',
    description: '필요한 길이로 잘라 쓰는 2.54mm 피치 단열 수 헤더 핀입니다.'
  },
  'header-female-40pin': {
    name: '40핀 암 헤더',
    description: '보드 적층이나 연결에 쓰는 2.54mm 피치 단열 암 헤더 소켓입니다.'
  },
  'dupont-jumper-wires': {
    name: '듀폰 점퍼선 M-M',
    description: '브레드보드 부품을 연결하는 20cm 수-수 점퍼선 세트입니다.'
  },
  'screw-terminal-4pin': {
    name: '4핀 스크루 터미널 블록',
    description: '여러 전선을 나사로 안정적으로 고정하는 PCB 장착형 4핀 터미널입니다.'
  },
  'proto-shield-uno': {
    name: 'Uno 프로토타입 실드',
    description: 'Arduino Uno 위에 쌓아 쓰는 빈 프로토타입 실드와 작은 온보드 브레드보드입니다.'
  },
  'pcb-blank-single': {
    name: '단면 빈 PCB',
    description: '직접 에칭해 회로를 만들 수 있는 단면 구리 클래드 빈 PCB 보드입니다.'
  },
  'i2c-level-shifter': {
    name: 'I2C 레벨 시프터',
    description: '3.3V와 5V I2C 또는 SPI 장치를 안전하게 연결하는 양방향 로직 레벨 변환기입니다.'
  }
};

export function localizeLibraryPart(part, locale = 'ko') {
  if (locale !== 'ko') {
    return part;
  }

  const copy = KO_PART_COPY[part.id];
  if (!copy) {
    return part;
  }

  return {
    ...part,
    name: copy.name,
    description: copy.description
  };
}

export function searchableLibraryText(part, locale = 'ko') {
  const localized = localizeLibraryPart(part, locale);
  return [
    part.id,
    part.name,
    part.description,
    part.category,
    localized.name,
    localized.description
  ].join(' ').toLowerCase();
}

export function missingKoreanLibraryPartIds(parts) {
  return parts.filter((part) => !KO_PART_COPY[part.id]).map((part) => part.id);
}
