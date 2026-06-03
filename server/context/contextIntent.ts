// Intent + hardware-keyword extraction. Extracted verbatim from contextPacket.ts
// (PLAN_god_module_refactor, Phase C.2). Pure relocation — no behavior change.
import {
  IntentSpecV2Schema,
  type CapabilityGraphEntry,
  type IntentSpecV2
} from '../agent/schemas.ts';
import type { VisualLibraryPartMention } from './contextLayer.ts';
import { unique } from './contextUtils.ts';

export const ACTIVE_HARDWARE_KEYWORDS = [
  {
    partId: 'oled-i2c-096',
    output: 'display',
    protocol: 'i2c',
    terms: [
      'oled',
      'display',
      'screen',
      'text display',
      '화면',
      '디스플레이',
      '표시',
      '글자',
      '문자'
    ]
  },
  {
    partId: 'oled-13-i2c',
    output: 'display',
    protocol: 'i2c',
    terms: ['1.3 oled', 'oled 1.3', 'oled-13', 'large oled', '1.3인치 OLED', '큰 OLED']
  },
  {
    partId: 'lcd-16x2',
    output: 'display',
    protocol: 'i2c',
    terms: ['lcd 16x2', '16x2 lcd', 'character lcd', 'lcd display', 'LCD', '16x2 LCD', '문자 LCD']
  },
  {
    partId: 'lcd-20x4',
    output: 'display',
    protocol: 'i2c',
    terms: ['lcd 20x4', '20x4 lcd', 'large character lcd', '20x4 LCD', '큰 LCD']
  },
  {
    partId: '7seg-1digit',
    output: 'bare-seven-segment-display',
    protocol: 'gpio',
    terms: [
      '7seg-1digit',
      'single digit 7 segment',
      'single digit 7-segment',
      'one digit 7 segment',
      '1 digit 7 segment',
      '1-digit 7-segment',
      'bare 7 segment',
      'bare 7-segment',
      '세븐세그먼트 1자리',
      '1자리 세븐세그먼트',
      '1자리 7세그먼트',
      '한 자리 7세그먼트'
    ]
  },
  {
    partId: '7seg-4digit-tm1637',
    output: 'led-array-display',
    protocol: 'tm1637-two-wire',
    terms: [
      'tm1637',
      '7 segment',
      '7-segment',
      '4 digit display',
      '4-digit display',
      'numeric display',
      '세븐세그먼트',
      '4자리 표시기'
    ]
  },
  {
    partId: '8x8-matrix-max7219',
    output: 'led-array-display',
    protocol: 'spi-like',
    terms: [
      'max7219',
      '8x8 led matrix',
      '8x8 matrix',
      'led matrix',
      'dot matrix',
      'LED 매트릭스',
      '도트 매트릭스'
    ]
  },
  {
    partId: 'neopixel-ring-12',
    output: 'addressable-led-display',
    protocol: 'single-wire-data',
    terms: [
      'neopixel',
      'neopixel ring',
      'ws2812',
      'addressable led',
      'rgb led ring',
      'led ring',
      '네오픽셀',
      '주소지정 LED'
    ]
  },
  {
    partId: 'ws2812b-strip',
    output: 'addressable-led-display',
    protocol: 'single-wire-data',
    terms: [
      'ws2812b strip',
      'ws2812 strip',
      'addressable led strip',
      'neopixel strip',
      'rgb led strip',
      'LED 스트립',
      '주소지정 LED 스트립'
    ]
  },
  {
    partId: 'tft-18',
    output: 'spi-display',
    protocol: 'spi',
    terms: [
      'tft',
      'tft 1.8',
      '1.8 tft',
      'spi tft',
      'tft lcd',
      'color display',
      '컬러 TFT',
      'SPI TFT'
    ]
  },
  {
    partId: 'nokia-5110',
    output: 'spi-display',
    protocol: 'spi',
    terms: [
      'nokia 5110',
      'nokia lcd',
      'pcd8544',
      '84x48 lcd',
      'spi monochrome display',
      '노키아 5110'
    ]
  },
  {
    partId: 'epaper-213',
    output: 'spi-display',
    protocol: 'spi',
    terms: ['epaper', 'e-paper', 'e paper', 'e-ink', 'e ink', '2.13 epaper', '전자종이']
  },
  {
    partId: 'led-5mm',
    output: 'light',
    protocol: 'gpio',
    terms: ['led', 'light', 'lamp', 'blink', '불빛', '조명', '깜빡', '켜']
  },
  {
    partId: 'rgb-led-common-cathode',
    output: 'rgb-light',
    protocol: 'pwm',
    terms: [
      'rgb led',
      'common cathode rgb',
      'common cathode rgb led',
      'three color led',
      'full color led',
      'RGB LED',
      '공통 캐소드 RGB',
      'RGB LED 색'
    ]
  },
  {
    partId: 'laser-diode-module',
    output: 'laser-light',
    protocol: 'gpio',
    terms: ['laser', 'laser module', 'laser diode', 'red laser module', '레이저', '레이저 모듈']
  },
  {
    partId: 'button-tactile',
    input: 'button',
    protocol: 'gpio',
    terms: ['button', 'pushbutton', 'switch', 'press', '버튼', '스위치', '누르']
  },
  {
    partId: 'trimmer-pot',
    input: 'potentiometer',
    protocol: 'analog-input',
    terms: [
      'trimmer potentiometer',
      'trimmer pot',
      'trim pot',
      'trimmer',
      '반고정 가변저항',
      '트리머 가변저항'
    ]
  },
  {
    partId: 'piezo-buzzer',
    output: 'sound',
    protocol: 'gpio',
    terms: ['buzzer', 'beep', 'sound', 'alarm', 'tone', '부저', '소리', '알람', '삐']
  },
  {
    partId: 'active-buzzer',
    output: 'sound',
    protocol: 'gpio',
    terms: ['active buzzer', 'fixed tone buzzer', 'buzzer module', '액티브 부저', '능동 부저']
  },
  {
    partId: 'micro-servo',
    output: 'motion',
    protocol: 'pwm',
    terms: ['servo', 'servo arm', 'move', 'sweep', 'actuator', '서보', '서보모터', '움직', '회전']
  },
  {
    partId: 'mg996r-servo',
    output: 'motion',
    protocol: 'pwm',
    terms: [
      'mg996r',
      'mg996r servo',
      'metal gear servo',
      'high torque servo',
      'large servo',
      'MG996R 서보',
      '고토크 서보'
    ]
  },
  {
    partId: 'dc-motor-130',
    output: 'switched-load',
    protocol: 'low-side-switch',
    terms: ['dc motor', '130 motor', 'brushed motor', 'motor', 'DC 모터', '모터']
  },
  {
    partId: 'dc-fan-5v',
    output: 'switched-load',
    protocol: 'low-side-switch',
    terms: ['dc fan', '5v fan', 'cooling fan', 'fan', '팬', '쿨링팬']
  },
  {
    partId: 'mini-water-pump',
    output: 'switched-load',
    protocol: 'low-side-switch',
    terms: ['water pump', 'mini pump', 'pump', '워터펌프', '펌프']
  },
  {
    partId: 'solenoid-valve',
    output: 'switched-load',
    protocol: 'low-side-switch',
    terms: ['solenoid', 'solenoid valve', 'valve', '솔레노이드', '전자밸브']
  },
  {
    partId: 'vibration-motor',
    output: 'switched-load',
    protocol: 'gpio',
    terms: ['vibration motor', 'haptic motor', 'vibration module', '진동 모터', '진동모터']
  },
  {
    partId: 'irf520-mosfet',
    output: 'switched-load',
    protocol: 'low-side-switch',
    terms: ['irf520', 'irf520 mosfet', 'mosfet module', 'mosfet switch', '모스펫', 'MOSFET 모듈']
  },
  {
    partId: '2n2222-npn',
    output: 'switched-load',
    protocol: 'low-side-switch',
    terms: [
      '2n2222',
      '2n2222 transistor',
      'npn transistor',
      'transistor switch',
      '트랜지스터',
      'NPN 트랜지스터'
    ]
  },
  {
    partId: 'l298n-driver',
    output: 'hbridge-motor',
    protocol: 'h-bridge',
    terms: [
      'l298n',
      'l298n driver',
      'l298n motor driver',
      'h bridge',
      'h-bridge',
      'H브리지',
      'L298N 드라이버'
    ]
  },
  {
    partId: 'l293d-driver',
    output: 'hbridge-motor',
    protocol: 'h-bridge',
    terms: ['l293d', 'l293d driver', 'l293d motor driver', 'h bridge ic', 'L293D 드라이버']
  },
  {
    partId: 'relay-1ch',
    output: 'relay-output',
    protocol: 'relay-contact',
    terms: ['relay', 'relay module', '1 channel relay', 'single relay', '릴레이', '1채널 릴레이']
  },
  {
    partId: 'relay-4ch',
    output: 'relay-output',
    protocol: 'relay-contact',
    terms: ['4 channel relay', 'four channel relay', 'relay board', '4채널 릴레이', '릴레이 보드']
  },
  {
    partId: 'dht11',
    input: 'temperature-humidity-sensor',
    protocol: 'single-wire-data',
    terms: ['dht11', 'dht11 sensor', 'DHT11']
  },
  {
    partId: 'esp01-wifi',
    input: 'communication-module',
    protocol: 'uart',
    terms: ['esp01', 'esp-01', 'esp8266 wifi module', 'wifi module', '와이파이 모듈']
  },
  {
    partId: 'hc05-bluetooth',
    input: 'communication-module',
    protocol: 'uart',
    terms: ['hc05', 'hc-05', 'bluetooth module', 'serial bluetooth', '블루투스 모듈']
  },
  {
    partId: 'sim800l-gsm',
    input: 'communication-module',
    protocol: 'uart',
    terms: ['sim800l', 'gsm module', 'gprs module', 'cellular module', 'GSM 모듈']
  },
  {
    partId: 'lora-ra02',
    input: 'communication-module',
    protocol: 'spi',
    terms: ['lora', 'ra-02', 'sx1278', 'lora module', '로라 모듈']
  },
  {
    partId: 'nrf24l01-radio',
    input: 'communication-module',
    protocol: 'spi',
    terms: ['nrf24', 'nrf24l01', '2.4ghz radio', 'radio module', '무선 모듈']
  },
  {
    partId: 'mcp2515-can',
    input: 'communication-module',
    protocol: 'spi',
    terms: ['mcp2515', 'can bus module', 'can module', 'CAN 모듈']
  },
  {
    partId: 'rs485-module',
    input: 'communication-module',
    protocol: 'uart',
    terms: ['rs485', 'rs-485', 'max485', 'differential bus', 'RS485 모듈']
  },
  {
    partId: 'usb-host-shield',
    input: 'communication-module',
    protocol: 'spi',
    terms: ['usb host shield', 'max3421e', 'usb host module', 'USB 호스트']
  },
  {
    partId: 'soil-moisture',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['soil moisture', 'moisture sensor', 'soil sensor', '토양 습도', '토양센서']
  },
  {
    partId: 'water-level-sensor',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['water level', 'water sensor', '수위 센서', '물 높이']
  },
  {
    partId: 'tmp36-temp',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['tmp36', 'analog temperature', 'temperature sensor', '온도 센서']
  },
  {
    partId: 'rain-sensor',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['rain sensor', 'raindrop', '비 센서', '빗물']
  },
  {
    partId: 'sound-sensor',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['sound sensor', 'microphone sensor', '소리 센서', '마이크 센서']
  },
  {
    partId: 'flame-sensor',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['flame sensor', 'fire sensor', '불꽃 센서']
  },
  {
    partId: 'mq2-gas',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['mq2', 'gas sensor', 'smoke sensor', '가스 센서', '연기 센서']
  },
  {
    partId: 'acs712-current',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['acs712', 'current sensor', '전류 센서']
  },
  {
    partId: 'fsr-pressure',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: [
      'fsr',
      'force sensor',
      'pressure sensor',
      'force sensitive resistor',
      '압력 센서',
      '힘 센서'
    ]
  },
  {
    partId: 'thermistor-ntc',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: [
      'thermistor',
      'ntc',
      'ntc thermistor',
      'temperature resistor',
      '서미스터',
      'NTC',
      '온도 저항'
    ]
  },
  {
    partId: 'limit-switch',
    input: 'digital-input',
    protocol: 'gpio',
    terms: ['limit switch', 'endstop', 'microswitch', '리미트 스위치']
  },
  {
    partId: 'reed-switch',
    input: 'digital-input',
    protocol: 'gpio',
    terms: ['reed switch', 'magnetic switch', 'magnet switch', '리드 스위치', '자석 스위치']
  },
  {
    partId: 'slide-switch',
    input: 'digital-input',
    protocol: 'gpio',
    terms: ['slide switch', 'selector switch', '슬라이드 스위치']
  },
  {
    partId: 'toggle-switch',
    input: 'digital-input',
    protocol: 'gpio',
    terms: ['toggle switch', 'lever switch', '토글 스위치']
  },
  {
    partId: 'ttp223-touch',
    input: 'digital-input',
    protocol: 'gpio',
    terms: ['ttp223', 'touch sensor', 'capacitive touch', '터치 센서', '정전식 터치']
  },
  {
    partId: 'hall-effect-sensor',
    input: 'digital-sensor',
    protocol: 'gpio',
    terms: ['hall effect', 'hall sensor', 'magnet sensor', '홀 센서', '자기장 센서']
  },
  {
    partId: 'ir-receiver',
    input: 'digital-sensor',
    protocol: 'digital-pulse',
    terms: ['ir receiver', 'infrared receiver', 'remote receiver', '적외선 수신기', '리모컨 수신기']
  },
  {
    partId: 'line-tracker',
    input: 'digital-sensor',
    protocol: 'gpio',
    terms: ['line tracker', 'line tracking sensor', 'line sensor', '라인 트래커', '라인 센서']
  },
  {
    partId: 'pir-hc-sr501',
    input: 'digital-sensor',
    protocol: 'gpio',
    terms: ['pir', 'pir sensor', 'motion sensor', 'hc-sr501', '동작 감지', '모션 센서', 'PIR 센서']
  },
  {
    partId: 'sw420-vibration',
    input: 'digital-sensor',
    protocol: 'gpio',
    terms: ['sw420', 'sw-420', 'vibration sensor', 'shock sensor', '진동 센서', '충격 센서']
  },
  {
    partId: 'tilt-ball-sensor',
    input: 'digital-sensor',
    protocol: 'gpio',
    terms: ['tilt sensor', 'tilt ball', 'tilt switch', '기울기 센서', '틸트 센서']
  },
  {
    partId: 'tcs3200-color',
    input: 'digital-sensor',
    protocol: 'digital-pulse',
    terms: [
      'tcs3200',
      'color sensor',
      'colour sensor',
      'frequency color sensor',
      '컬러 센서',
      '색상 센서'
    ]
  },
  {
    partId: 'dip-switch-4',
    input: 'matrix-input',
    protocol: 'gpio',
    terms: ['dip switch', 'DIP switch', 'DIP 스위치', '딥 스위치', 'switch pattern']
  },
  {
    partId: 'keypad-4x4',
    input: 'matrix-input',
    protocol: 'matrix-scan',
    terms: ['keypad', '4x4 keypad', 'matrix keypad', '키패드', '매트릭스 키패드', '눌린 키']
  },
  {
    partId: 'membrane-keypad-1x4',
    input: 'matrix-input',
    protocol: 'gpio',
    terms: ['membrane keypad', '1x4 keypad', 'key strip', '멤브레인 키패드', '키 스트립']
  },
  {
    partId: 'joystick-module',
    input: 'joystick',
    protocol: 'analog-input',
    terms: [
      'joystick',
      'analog joystick',
      'thumb joystick',
      'x y position',
      '조이스틱',
      '아날로그 조이스틱'
    ]
  },
  {
    partId: 'rotary-encoder',
    input: 'rotary-encoder',
    protocol: 'gpio',
    terms: [
      'rotary encoder',
      'encoder knob',
      'quadrature encoder',
      'clk dt',
      '로터리 엔코더',
      '엔코더'
    ]
  },
  {
    partId: 'breadboard-psu',
    output: 'power',
    protocol: 'power',
    terms: [
      'breadboard power supply',
      'breadboard psu',
      'power module',
      '5v rail',
      '3.3v rail',
      '브레드보드 전원 모듈',
      '전원 모듈'
    ]
  },
  {
    partId: '9v-battery-clip',
    output: 'power',
    protocol: 'power',
    terms: ['9v battery', '9v clip', 'battery clip', '9V 배터리', '배터리 클립']
  },
  {
    partId: 'aa-battery-holder',
    output: 'power',
    protocol: 'power',
    terms: ['aa battery holder', '4x aa', '6v battery pack', 'AA 배터리 홀더', '건전지 홀더']
  },
  {
    partId: 'barrel-jack',
    output: 'power',
    protocol: 'power',
    terms: ['barrel jack', 'dc jack', 'adapter jack', 'DC 잭', '전원 잭']
  },
  {
    partId: 'screw-terminal-2pin',
    output: 'power',
    protocol: 'power',
    terms: [
      '2 pin screw terminal',
      '2-pin screw terminal',
      '2 pin terminal',
      '2핀 스크류 터미널',
      '2핀 터미널'
    ]
  },
  {
    partId: '7805-regulator',
    output: 'power',
    protocol: 'regulated-power',
    terms: [
      '7805',
      '7805 regulator',
      '5v regulator',
      'regulated 5v',
      '7805 레귤레이터',
      '전압 레귤레이터'
    ]
  },
  {
    partId: 'lipo-battery-1s',
    output: 'power',
    protocol: 'power',
    terms: [
      'lipo battery',
      '1s lipo',
      '3.7v lipo',
      'lithium polymer battery',
      'LiPo 배터리',
      '리튬폴리머 배터리'
    ]
  },
  {
    partId: 'ceramic-cap',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: [
      'ceramic capacitor',
      'ceramic cap',
      'decoupling capacitor',
      'bypass capacitor',
      '세라믹 콘덴서',
      '세라믹 캐패시터'
    ]
  },
  {
    partId: 'electrolytic-cap',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: [
      'electrolytic capacitor',
      'electrolytic cap',
      'polarized capacitor',
      'filter capacitor',
      '전해 콘덴서',
      '전해 캐패시터'
    ]
  },
  {
    partId: 'diode-1n4007',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['1n4007', 'rectifier diode', 'diode', 'protection diode', '다이오드', '정류 다이오드']
  },
  {
    partId: 'schottky-diode',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['schottky diode', '1n5819', 'reverse polarity diode', '쇼트키 다이오드']
  },
  {
    partId: 'zener-diode',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['zener diode', 'zener', 'clamp diode', '제너 다이오드']
  },
  {
    partId: 'polyfuse',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['polyfuse', 'resettable fuse', 'pptc fuse', 'ptc fuse', '폴리퓨즈', '퓨즈']
  },
  {
    partId: 'inductor-axial',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['inductor', 'axial inductor', 'coil', 'choke', '인덕터', '코일']
  },
  {
    partId: 'crystal-16mhz',
    output: 'timing-context',
    input: 'timing-passive',
    protocol: 'clock',
    terms: [
      '16mhz crystal',
      '16 mhz crystal',
      'quartz crystal',
      'clock crystal',
      'crystal oscillator',
      '크리스탈',
      '16MHz 크리스탈',
      '클럭 크리스탈'
    ]
  },
  {
    partId: 'breadboard-full',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: [
      'full size breadboard',
      'full-size breadboard',
      'full breadboard',
      'large breadboard',
      '풀사이즈 브레드보드',
      '대형 브레드보드'
    ]
  },
  {
    partId: 'breadboard-mini',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: [
      'mini breadboard',
      'small breadboard',
      'compact breadboard',
      '미니 브레드보드',
      '소형 브레드보드'
    ]
  },
  {
    partId: 'perfboard-5x7',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: ['perfboard', '5x7 perfboard', 'solderable prototyping board', '만능기판', '퍼프보드']
  },
  {
    partId: 'pcb-blank-single',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: ['blank pcb', 'single sided pcb', 'copper clad board', '빈 pcb', '단면 pcb']
  },
  {
    partId: 'proto-shield-uno',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'arduino-shield',
    terms: [
      'proto shield',
      'prototype shield',
      'uno prototype shield',
      'arduino prototype shield',
      '프로토 쉴드',
      '아두이노 프로토 쉴드'
    ]
  },
  {
    partId: 'header-male-40pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: [
      'male header',
      'male header pins',
      '40 pin male header',
      'header pins male',
      '수 헤더핀',
      '수 핀헤더'
    ]
  },
  {
    partId: 'header-female-40pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: [
      'female header',
      'female header pins',
      '40 pin female header',
      'socket header',
      '암 헤더핀',
      '암 핀헤더'
    ]
  },
  {
    partId: 'screw-terminal-4pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: [
      '4 pin screw terminal',
      '4-pin screw terminal',
      'four pin terminal block',
      '4 pin terminal block',
      '4핀 스크류 터미널',
      '4핀 터미널 블록'
    ]
  }
];

export const ACTIVE_UNSAFE_PATTERNS = [
  {
    pattern: /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b/i,
    signal: 'high-voltage mains power'
  },
  {
    pattern:
      /\b(stepper|nema\s*17|nema17)\b.*\b(directly|direct|without\s+a?\s*driver|no\s+driver)\b|\b(directly|direct|without\s+a?\s*driver|no\s+driver)\b.*\b(stepper|nema\s*17|nema17)\b/i,
    signal: 'unsupported direct stepper GPIO drive'
  },
  {
    pattern:
      /\b(dc\s*motor|motor|fan|pump|solenoid)\b.*\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b|\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b.*\b(dc\s*motor|motor|fan|pump|solenoid)\b/i,
    signal: 'unsupported direct motor GPIO drive'
  },
  {
    pattern:
      /drone|autopilot|gps navigation|bluetooth drone|autonomous robot|무인\s*드론|자율\s*주행|gps\s*경로/i,
    signal: 'unsupported autonomous wireless project'
  },
  {
    pattern:
      /wi[-\s]?fi door lock|wifi door lock|smart lock|unlock my house|phone door lock|와이파이\s*도어락|스마트\s*도어락|현관문\s*잠금/i,
    signal: 'unsupported home security actuator'
  },
  {
    pattern: /radio tracker|gps tracker|track(?:ing)? device|위치\s*추적|무선\s*추적/i,
    signal: 'unsupported tracking or radio project'
  },
  {
    pattern:
      /\b(spo2|blood\s+oxygen|pulse\s+oximeter|heart\s+(?:condition|monitor|diagnosis)|diagnos(?:e|is)|medical)\b|\bmax30102\b.*\b(health\s*monitor|medical|diagnos(?:e|is)|spo2|blood\s+oxygen)\b|\b(health\s*monitor|medical|diagnos(?:e|is)|spo2|blood\s+oxygen)\b.*\bmax30102\b|혈중\s*산소|의료|진단|건강\s*모니터/i,
    signal: 'unsupported medical sensor claim'
  },
  {
    pattern:
      /\b(gps|neo-?6m)\b.*\b(navigation|navigate|autopilot|route guidance|tracking|tracker|safety|collision avoidance)\b|\b(navigation|navigate|autopilot|route guidance|tracking|tracker|collision avoidance)\b.*\b(gps|neo-?6m)\b|GPS.*(?:추적|길찾기|항법|자율)|(?:추적|길찾기|항법|자율).*GPS/i,
    signal: 'unsupported navigation or tracking claim'
  },
  {
    pattern:
      /\b(rc522|rfid)\b.*\b(door lock|security|access control|payment|authentication|alarm)\b|\b(door lock|security|access control|payment|authentication|alarm)\b.*\b(rc522|rfid)\b|RFID.*(?:보안|결제|인증|도어락|출입)|(?:보안|결제|인증|도어락|출입).*RFID/i,
    signal: 'unsupported security or payment claim'
  },
  {
    pattern:
      /\b(hx711|load\s*cell|weight\s+sensor)\b.*\b(certified|legal for trade|calibrated scale|exact weight)\b|\b(certified|legal for trade|calibrated scale|exact weight)\b.*\b(hx711|load\s*cell|weight\s+sensor)\b|로드셀.*(?:인증|정확한\s*무게|거래용|검정)|(?:인증|정확한\s*무게|거래용|검정).*로드셀/i,
    signal: 'unsupported certified measurement claim'
  },
  {
    pattern:
      /\b(?:esp-?01|wifi|wi-fi|hc-?05|bluetooth|sim800l|gsm|lora|nrf24l01?|radio)\b.*\b(?:cloud|internet|backend|phone pairing|pair(?:ing)? with my phone|sms|call|real\s+range|tracking|security|door\s+lock)\b|\b(?:cloud|internet|backend|phone pairing|pair(?:ing)? with my phone|sms|call|real\s+range|tracking|security|door\s+lock)\b.*\b(?:esp-?01|wifi|wi-fi|hc-?05|bluetooth|sim800l|gsm|lora|nrf24l01?|radio)\b|(?:와이파이|블루투스|GSM|로라|무선).*?(?:클라우드|인터넷|문자|전화|추적|보안|도어락)|(?:클라우드|인터넷|문자|전화|추적|보안|도어락).*?(?:와이파이|블루투스|GSM|로라|무선)/i,
    signal: 'unsupported wireless network overclaim'
  },
  {
    pattern:
      /\b(?:usb\s+host|usb-host|max3421e)\b.*\b(?:enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s+drive|real\s+usb)\b|\b(?:enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s+drive|real\s+usb)\b.*\b(?:usb\s+host|usb-host|max3421e)\b|USB\s*호스트.*(?:키보드|마우스|저장장치|실제\s*USB)/i,
    signal: 'unsupported USB host device overclaim'
  },
  {
    pattern:
      /\b(?:rs-?485|max485|mcp2515|can\s+bus)\b.*\b(?:certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b|\b(?:certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b.*\b(?:rs-?485|max485|mcp2515|can\s+bus)\b|(?:RS485|CAN).*?(?:인증|산업용\s*네트워크|차량\s*제어|안전\s*필수)|(?:인증|산업용\s*네트워크|차량\s*제어|안전\s*필수).*?(?:RS485|CAN)/i,
    signal: 'unsupported certified communication network claim'
  },
  {
    pattern:
      /\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b.*\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b|\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b.*\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b|(?:ADC|오피앰프|연산\s*증폭기).*?(?:정밀|보정|인증|정확한\s*전압|의료)|(?:정밀|보정|인증|정확한\s*전압|의료).*?(?:ADC|오피앰프|연산\s*증폭기)/i,
    signal: 'precision analog overclaim'
  },
  {
    pattern:
      /\b(?:ne555|555\s+timer|timer\s+ic)\b.*\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b|\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b.*\b(?:ne555|555\s+timer|timer\s+ic)\b|(?:NE555|555\s*타이머).*?(?:정확|정밀|보정).*?(?:주파수|듀티|파형)/i,
    signal: 'timer frequency overclaim'
  },
  {
    pattern:
      /\b(?:level\s+shifter|logic\s+level\s+converter)\b.*\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b|\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b.*\b(?:level\s+shifter|logic\s+level\s+converter)\b|레벨\s*시프터.*?(?:전원\s*공급|레귤레이터|전류\s*증폭)/i,
    signal: 'level shifter overclaim'
  },
  { pattern: /\b(?:mov|varistor)\b|바리스터|서지\s*보호/i, signal: 'mains protection component' },
  {
    pattern:
      /\b(?:lipo|lithium\s*polymer)\b.*\b(?:charge|charger|charging|short|puncture|pierce|high\s*current)\b|\b(?:charge|charger|charging|short|puncture|pierce|high\s*current)\b.*\b(?:lipo|lithium\s*polymer)\b|LiPo.*(?:충전|쇼트|단락|구멍|고전류)|(?:충전|쇼트|단락|구멍|고전류).*LiPo/i,
    signal: 'unsafe LiPo battery handling'
  },
  { pattern: /콘센트|가정용\s*전원|교류|220볼트|110볼트/i, signal: 'high-voltage mains power' },
  { pattern: /heater|히터|난방|발열|가열|fire|화재/i, signal: 'unsafe thermal or hazardous load' }
];

export function buildIntentSignals({
  intentHints,
  unsupportedSignals,
  capabilityMatches
}: {
  intentHints: ReturnType<typeof inferIntentHints>;
  unsupportedSignals: string[];
  capabilityMatches: CapabilityGraphEntry[];
}) {
  return unique([
    ...intentHints.inputModalities,
    ...intentHints.outputModalities,
    ...intentHints.protocols,
    ...intentHints.safetyConcerns,
    ...unsupportedSignals,
    ...capabilityMatches.flatMap((capability) => [
      ...capability.inputModalities,
      ...capability.outputModalities,
      ...capability.protocols
    ])
  ]);
}

export function expandSearchQuery(message: string) {
  const matchedTerms = ACTIVE_HARDWARE_KEYWORDS.filter((entry) =>
    matchesHardwareKeyword(entry, message)
  )
    .flatMap((entry) => [entry.partId, entry.output, entry.input, entry.protocol, ...entry.terms])
    .filter(Boolean);
  return unique([message, 'arduino', 'breadboard', ...matchedTerms]).join(' ');
}

export function detectExplicitHardwarePartIds(
  message: string,
  visualLibraryMentions: VisualLibraryPartMention[]
) {
  const explicitPartIds = new Set(
    unique([
      ...ACTIVE_HARDWARE_KEYWORDS.filter((entry) => matchesHardwareKeyword(entry, message)).map(
        (entry) => entry.partId
      ),
      ...visualLibraryMentions
        .map((mention) => mention.agentPartId)
        .filter((partId): partId is string => Boolean(partId))
    ])
  );

  if (
    /\b(?:trimmer\s+potentiometer|trimmer\s+pot|trim\s+pot|trimmer)\b|반고정\s*가변저항|트리머\s*가변저항/i.test(
      message
    )
  ) {
    explicitPartIds.add('trimmer-pot');
    explicitPartIds.delete('potentiometer-10k');
  }

  if (
    /\bbreadboard\s+(?:power\s+)?(?:supply|psu)\b|\bpower\s+module\b|브레드보드\s*전원|전원\s*모듈/i.test(
      message
    )
  ) {
    explicitPartIds.add('breadboard-psu');
  }
  if (/\b9\s*v\s+battery\b|\b9v\s+(?:battery|clip)\b|9V\s*배터리|배터리\s*클립/i.test(message)) {
    explicitPartIds.add('9v-battery-clip');
  }
  if (
    /\baa\s+battery\s+holder\b|\b4x\s*aa\b|\b6v\s+battery\s+pack\b|AA\s*배터리\s*홀더|건전지\s*홀더/i.test(
      message
    )
  ) {
    explicitPartIds.add('aa-battery-holder');
  }
  if (/\bbarrel\s+jack\b|\bdc\s+jack\b|\badapter\s+jack\b|DC\s*잭|전원\s*잭/i.test(message)) {
    explicitPartIds.add('barrel-jack');
  }
  if (
    /\b(?:full[-\s]*size\s+breadboard|full\s+breadboard|large\s+breadboard)\b|풀사이즈\s*브레드보드|대형\s*브레드보드/i.test(
      message
    )
  ) {
    explicitPartIds.add('breadboard-full');
  }
  if (
    /\b(?:mini\s+breadboard|small\s+breadboard|compact\s+breadboard)\b|미니\s*브레드보드|소형\s*브레드보드/i.test(
      message
    )
  ) {
    explicitPartIds.add('breadboard-mini');
  }
  if (
    /\b(?:perfboard|5x7\s+perfboard|solderable\s+prototyping\s+board)\b|만능기판|퍼프보드/i.test(
      message
    )
  ) {
    explicitPartIds.add('perfboard-5x7');
  }
  if (
    /\b(?:blank\s+pcb|single[-\s]*sided\s+pcb|copper\s+clad\s+board)\b|빈\s*pcb|단면\s*pcb/i.test(
      message
    )
  ) {
    explicitPartIds.add('pcb-blank-single');
  }
  if (
    /\b(?:proto\s+shield|prototype\s+shield|uno\s+prototype\s+shield|arduino\s+prototype\s+shield)\b|프로토\s*쉴드|아두이노\s*프로토\s*쉴드/i.test(
      message
    )
  ) {
    explicitPartIds.add('proto-shield-uno');
  }
  if (
    /\b(?:male\s+header(?:\s+pins)?|40\s*pin\s+male\s+header|header\s+pins\s+male)\b|수\s*(?:헤더핀|핀헤더)/i.test(
      message
    )
  ) {
    explicitPartIds.add('header-male-40pin');
  }
  if (
    /\b(?:female\s+header(?:\s+pins)?|40\s*pin\s+female\s+header|socket\s+header)\b|암\s*(?:헤더핀|핀헤더)/i.test(
      message
    )
  ) {
    explicitPartIds.add('header-female-40pin');
  }
  if (
    /\b(?:4\s*pin\s+screw\s+terminal|4-pin\s+screw\s+terminal|four\s+pin\s+terminal\s+block|4\s*pin\s+terminal\s+block)\b|4핀\s*(?:스크류\s*터미널|터미널\s*블록)/i.test(
      message
    )
  ) {
    explicitPartIds.add('screw-terminal-4pin');
  }
  if (
    /\b(?:2\s*pin\s+screw\s+terminal|2-pin\s+screw\s+terminal|2\s*pin\s+terminal)\b|2핀\s*(?:스크류\s*터미널|터미널)/i.test(
      message
    )
  ) {
    explicitPartIds.add('screw-terminal-2pin');
  }
  if (
    /\b7805\b|\b5v\s+regulator\b|\bregulated\s+5v\b|7805\s*레귤레이터|전압\s*레귤레이터/i.test(
      message
    )
  ) {
    explicitPartIds.add('7805-regulator');
  }
  if (
    /\b(?:lipo\s+battery|1s\s+lipo|3\.7v\s+lipo|lithium\s+polymer\s+battery)\b|LiPo\s*배터리|리튬폴리머\s*배터리/i.test(
      message
    )
  ) {
    explicitPartIds.add('lipo-battery-1s');
  }
  if (
    /\b(?:ceramic\s+cap(?:acitor)?|decoupling\s+capacitor|bypass\s+capacitor)\b|세라믹\s*(?:콘덴서|캐패시터)/i.test(
      message
    )
  ) {
    explicitPartIds.add('ceramic-cap');
  }
  if (
    /\b(?:electrolytic\s+cap(?:acitor)?|polarized\s+capacitor|filter\s+capacitor)\b|전해\s*(?:콘덴서|캐패시터)/i.test(
      message
    )
  ) {
    explicitPartIds.add('electrolytic-cap');
  }
  if (/\b(?:1n4007|rectifier\s+diode|protection\s+diode)\b|정류\s*다이오드/i.test(message)) {
    explicitPartIds.add('diode-1n4007');
  } else if (/\bdiode\b|다이오드/i.test(message)) {
    explicitPartIds.add('diode-1n4007');
  }
  if (
    /\b(?:schottky\s+diode|1n5819|reverse\s+polarity\s+diode)\b|쇼트키\s*다이오드/i.test(message)
  ) {
    explicitPartIds.add('schottky-diode');
    explicitPartIds.delete('diode-1n4007');
  }
  if (/\b(?:zener\s+diode|zener|clamp\s+diode)\b|제너\s*다이오드/i.test(message)) {
    explicitPartIds.add('zener-diode');
    explicitPartIds.delete('diode-1n4007');
  }
  if (/\b(?:polyfuse|resettable\s+fuse|pptc\s+fuse|ptc\s+fuse)\b|폴리퓨즈|퓨즈/i.test(message)) {
    explicitPartIds.add('polyfuse');
  }
  if (/\b(?:axial\s+inductor|inductor|coil|choke)\b|인덕터|코일/i.test(message)) {
    explicitPartIds.add('inductor-axial');
  }
  if (
    /\b(?:16\s*mhz\s+crystal|16mhz\s+crystal|quartz\s+crystal|clock\s+crystal|crystal\s+oscillator)\b|(?:16MHz\s*)?크리스탈|클럭\s*크리스탈/i.test(
      message
    )
  ) {
    explicitPartIds.add('crystal-16mhz');
  }
  if (/\b(?:esp-?01|esp8266\s+wifi\s+module|wifi\s+module)\b|와이파이\s*모듈/i.test(message)) {
    explicitPartIds.add('esp01-wifi');
  }
  if (/\b(?:hc-?05|bluetooth\s+module|serial\s+bluetooth)\b|블루투스\s*모듈/i.test(message)) {
    explicitPartIds.add('hc05-bluetooth');
  }
  if (/\b(?:sim800l|gsm\s+module|gprs\s+module|cellular\s+module)\b|GSM\s*모듈/i.test(message)) {
    explicitPartIds.add('sim800l-gsm');
  }
  if (/\b(?:lora|ra-?02|sx1278|lora\s+module)\b|로라\s*모듈/i.test(message)) {
    explicitPartIds.add('lora-ra02');
  }
  if (/\b(?:nrf24l01?|2\.4ghz\s+radio|radio\s+module)\b|무선\s*모듈/i.test(message)) {
    explicitPartIds.add('nrf24l01-radio');
  }
  if (/\b(?:mcp2515|can\s+bus\s+module|can\s+module)\b|CAN\s*모듈/i.test(message)) {
    explicitPartIds.add('mcp2515-can');
  }
  if (/\b(?:rs-?485|max485|differential\s+bus)\b|RS485\s*모듈/i.test(message)) {
    explicitPartIds.add('rs485-module');
  }
  if (
    /\b(?:usb\s+host\s+shield|usb-host\s+shield|max3421e|usb\s+host\s+module)\b|USB\s*호스트/i.test(
      message
    )
  ) {
    explicitPartIds.add('usb-host-shield');
  }
  if (
    /\b(?:74hc595|shift\s+register|sipo|serial-in\s+parallel-out)\b|시프트\s*레지스터/i.test(
      message
    )
  ) {
    explicitPartIds.add('74hc595-shift');
  }
  if (
    /\b(?:pcf8574|i2c\s+expander|gpio\s+expander|io\s+expander|i\/o\s+expander)\b|I2C\s*확장기/i.test(
      message
    )
  ) {
    explicitPartIds.add('pcf8574-expander');
  }
  if (/\b(?:ads1115|i2c\s+adc|external\s+adc|adc\s+module)\b|ADC\s*모듈/i.test(message)) {
    explicitPartIds.add('ads1115-adc');
  }
  if (/\b(?:mcp3008|spi\s+adc)\b/i.test(message)) {
    explicitPartIds.add('mcp3008-adc');
  }
  if (/\b(?:ne555|555\s+timer|timer\s+ic)\b|타이머\s*IC/i.test(message)) {
    explicitPartIds.add('ne555-timer');
  }
  if (
    /\b(?:lm358|op\s*amp|op-amp|operational\s+amplifier)\b|오피앰프|연산\s*증폭기/i.test(message)
  ) {
    explicitPartIds.add('lm358-opamp');
  }
  if (
    /\b(?:i2c\s+level\s+shifter|level\s+shifter|logic\s+level\s+converter|3\.3v\s+5v\s+logic)\b|레벨\s*시프터/i.test(
      message
    )
  ) {
    explicitPartIds.add('i2c-level-shifter');
  }

  return explicitPartIds;
}

export function inferIntentHints(message: string, capabilityMatches: CapabilityGraphEntry[] = []) {
  const outputModalities = unique([
    ...capabilityMatches.flatMap((capability) => capability.outputModalities),
    ...ACTIVE_HARDWARE_KEYWORDS.filter(
      (entry) => entry.output && matchesHardwareKeyword(entry, message)
    ).map((entry) => entry.output as string)
  ]);
  const inputModalities = unique([
    ...capabilityMatches.flatMap((capability) => capability.inputModalities),
    ...ACTIVE_HARDWARE_KEYWORDS.filter(
      (entry) => entry.input && matchesHardwareKeyword(entry, message)
    ).map((entry) => entry.input as string)
  ]);
  const protocols = unique([
    ...capabilityMatches.flatMap((capability) => capability.protocols),
    ...ACTIVE_HARDWARE_KEYWORDS.filter(
      (entry) =>
        matchesHardwareKeyword(entry, message) || message.toLowerCase().includes(entry.protocol)
    ).map((entry) => entry.protocol)
  ]);
  const safetyConcerns = detectUnsupportedSignals(message);
  const ambiguity =
    capabilityMatches.length === 0 &&
    outputModalities.length === 0 &&
    inputModalities.length === 0 &&
    safetyConcerns.length === 0
      ? ['No concrete input or output hardware was identified yet.']
      : [];
  if (needsSpecificTemperatureHumiditySensor(message)) {
    ambiguity.push('Temperature/humidity readout needs a specific supported sensor such as DHT11.');
  }

  return {
    outputModalities,
    inputModalities,
    protocols,
    powerAssumptions:
      safetyConcerns.length > 0 ? [] : ['beginner-safe Arduino 5V low-voltage classroom circuit'],
    safetyConcerns,
    ambiguity
  };
}

export function needsSpecificTemperatureHumiditySensor(message: string) {
  const asksForTemperatureHumidity =
    /temperature.*humidity|humidity.*temperature|temp(?:erature)?\s+humidity|온습도|온도.*습도|습도.*온도/i.test(
      message
    );
  if (!asksForTemperatureHumidity) {
    return false;
  }
  return !/dht11|dht22|bmp280|tmp36/i.test(message);
}

export function extractIntentSignals({
  message,
  locale,
  intentHints,
  capabilityMatches,
  unsupportedSignals,
  supportGaps
}: {
  message: string;
  locale: 'ko' | 'en';
  intentHints: ReturnType<typeof inferIntentHints>;
  capabilityMatches: CapabilityGraphEntry[];
  unsupportedSignals: string[];
  supportGaps: string[];
}): IntentSpecV2 {
  const inputModalities = unique(intentHints.inputModalities);
  const outputModalities = unique(intentHints.outputModalities);
  const protocols = new Set(intentHints.protocols);
  const behaviors = inferIntentBehaviors(message, inputModalities, outputModalities, protocols);
  const ambiguities = unique([
    ...intentHints.ambiguity,
    ...supportGaps.map((gap) => `Capability is planned, partial, or unsupported: ${gap}`)
  ]);
  const controllerAssumptions =
    /arduino|uno/i.test(message) ||
    capabilityMatches.some((capability) => capability.requiredParts.includes('arduino-uno'))
      ? ['arduino-compatible']
      : ['arduino-compatible', 'controller not explicitly specified'];
  const confidence =
    capabilityMatches.length > 0
      ? supportGaps.length > 0
        ? 0.62
        : 0.82
      : ambiguities.length > 0
        ? 0.35
        : 0.5;

  return IntentSpecV2Schema.parse({
    studentGoal: message,
    behaviors,
    inputModalities,
    outputModalities,
    controllerAssumptions,
    powerAssumptions: intentHints.powerAssumptions,
    ambiguities,
    safetySignals: intentHints.safetyConcerns,
    unsupportedSignals,
    language: inferLanguage(locale, message),
    confidence
  });
}

export function inferIntentBehaviors(
  message: string,
  inputModalities: string[],
  outputModalities: string[],
  protocols: Set<string>
) {
  const lower = message.toLowerCase();
  const action = outputModalities.includes('display')
    ? 'show display output'
    : outputModalities.includes('sound')
      ? 'drive sound output'
      : outputModalities.includes('motion')
        ? 'drive motion output'
        : outputModalities.includes('light')
          ? 'drive light output'
          : 'produce requested circuit behavior';
  const trigger = inputModalities.includes('button')
    ? 'button press'
    : inputModalities.includes('joystick')
      ? 'joystick position or switch changes'
      : inputModalities.includes('rotary-encoder')
        ? 'rotary encoder direction or switch changes'
        : inputModalities.includes('matrix-input')
          ? 'key or switch matrix state changes'
          : inputModalities.includes('digital-input') || inputModalities.includes('digital-sensor')
            ? 'digital input state changes'
            : inputModalities.includes('light-sensor') || lower.includes('dark')
              ? 'ambient light changes'
              : inputModalities.includes('temperature-humidity-sensor')
                ? 'temperature and humidity reading changes'
                : inputModalities.length > 0
                  ? `${inputModalities[0]} input changes`
                  : 'student runs the circuit';
  const timing =
    inputModalities.includes('joystick') ||
    inputModalities.includes('analog') ||
    inputModalities.includes('analog-sensor') ||
    inputModalities.includes('potentiometer') ||
    inputModalities.includes('light-sensor')
      ? 'analog'
      : inputModalities.includes('temperature-humidity-sensor')
        ? 'steady-state'
        : inputModalities.includes('matrix-input') ||
            inputModalities.includes('rotary-encoder') ||
            inputModalities.includes('digital-input') ||
            inputModalities.includes('digital-sensor')
          ? 'event-driven'
          : protocols.has('pwm')
            ? 'pwm'
            : inputModalities.includes('button')
              ? 'momentary'
              : 'steady-state';

  return [
    {
      trigger,
      action,
      timing
    }
  ];
}

export function inferLanguage(locale: 'ko' | 'en', message: string): IntentSpecV2['language'] {
  const hasHangul = /[\u3131-\uD79D]/.test(message);
  const hasLatin = /[a-z]/i.test(message);
  if (hasHangul && hasLatin) return 'mixed';
  if (hasHangul) return 'ko';
  if (hasLatin) return 'en';
  return locale;
}

export function detectUnsupportedSignals(message: string) {
  const signals = ACTIVE_UNSAFE_PATTERNS.filter((entry) => entry.pattern.test(message)).map(
    (entry) => entry.signal
  );
  if (signals.includes('high-voltage mains power')) {
    return signals.filter((signal) => signal !== 'mains protection component');
  }
  return signals;
}

export function hasAnyTerm(message: string, terms: string[]) {
  const normalized = message.toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  return terms.some((term) => {
    const normalizedTerm = term.toLowerCase();
    if (normalizedTerm === 'led') {
      return tokens.has('led');
    }
    if (/^[a-z0-9]+$/.test(normalizedTerm)) {
      return tokens.has(normalizedTerm);
    }
    return normalized.includes(normalizedTerm);
  });
}

export function matchesHardwareKeyword(
  entry: (typeof ACTIVE_HARDWARE_KEYWORDS)[number],
  message: string
) {
  if (!hasAnyTerm(message, entry.terms)) {
    return false;
  }
  if (
    entry.partId === 'led-5mm' &&
    /\b(rgb|ws2812b?|neopixel|laser|strip|matrix|max7219|8x8|led\s+matrix)\b|공통\s*캐소드|레이저|스트립|매트릭스/i.test(
      message
    )
  ) {
    return false;
  }
  if (
    entry.partId === 'piezo-buzzer' &&
    /\b(active\s+buzzer|fixed\s+tone\s+buzzer|buzzer\s+module|sound\s+sensor)\b|액티브\s*부저|능동\s*부저|소리\s*센서/i.test(
      message
    )
  ) {
    return false;
  }
  if (
    entry.partId === 'button-tactile' &&
    /\b(limit\s+switch|dip\s+switch|keypad|matrix\s+keypad|membrane\s+keypad|relay|relay\s+module|switch\s+(?:a\s+)?(?:low[-\s]?voltage\s+)?(?:load|led\s+load|motor|lamp))\b|리미트\s*스위치|DIP\s*스위치|딥\s*스위치|키패드|매트릭스\s*키패드|멤브레인\s*키패드|릴레이/i.test(
      message
    )
  ) {
    return false;
  }
  if (
    entry.partId === 'micro-servo' &&
    /\b(mg996r|metal\s+gear\s+servo|high\s+torque\s+servo|large\s+servo)\b|MG996R\s*서보|고토크\s*서보/i.test(
      message
    )
  ) {
    return false;
  }
  if (
    entry.partId === 'dc-motor-130' &&
    /\b(servo|stepper|28byj|nema\s*17|nema17)\b|서보|스테퍼|스텝\s*모터/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'fsr-pressure' &&
    /\b(bmp280|bme280|barometric|air\s+pressure|atmospheric\s+pressure)\b/i.test(message)
  ) {
    return false;
  }
  if (entry.partId === 'neopixel-ring-12' && /\bstrip\b|스트립/i.test(message)) {
    return false;
  }
  if (entry.partId === 'ws2812b-strip' && /\bring\b|링/i.test(message)) {
    return false;
  }
  if (entry.partId === 'lcd-16x2' && /\b20\s*x\s*4\b|20x4/i.test(message)) {
    return false;
  }
  if (
    entry.partId === 'lcd-16x2' &&
    /\b(nokia\s*5110|pcd8544|tft|spi\s+tft|e-?paper|e-?ink|epaper)\b/i.test(message)
  ) {
    return false;
  }
  if (entry.partId === 'lcd-20x4' && /\b16\s*x\s*2\b|16x2/i.test(message)) {
    return false;
  }
  if (
    entry.partId === '7seg-4digit-tm1637' &&
    /\b(single|one|1)\s*-?\s*digit\b|bare\s+7\s*-?\s*segment|7seg-1digit|1자리/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === '7seg-1digit' &&
    /\b(tm1637|4\s*-?\s*digit|4자리|four\s*-?\s*digit|max7219|matrix)\b/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'oled-i2c-096' &&
    /\b(1\.3|1\.3\s*inch|oled-13|large\s+oled|16\s*x\s*2|20\s*x\s*4|16x2|20x4|lcd|tm1637|max7219|7\s*segment|7-segment|seven\s+segment|neopixel|ws2812|led\s*matrix|8x8|spi|tft|nokia\s*5110|pcd8544|e-?paper|e-?ink|sck|cs)\b|1\.3\s*인치|큰\s*OLED|(?:7|세븐)\s*세그먼트/i.test(
      message
    )
  ) {
    return false;
  }
  if (entry.partId !== 'oled-i2c-096' || !/\bscreen\b/i.test(message)) {
    return true;
  }
  return hasAnyTerm(message, ['oled', 'display', 'text display', 'show text', 'display message']);
}

export function pruneCapabilityMatchesForExplicitHardware(
  matches: CapabilityGraphEntry[],
  message: string
) {
  if (
    /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b|콘센트|가정용\s*전원|교류|220볼트|110볼트/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) => match.supportLevel === 'unsupported' || match.id === 'high-voltage-load-control'
    );
  }

  if (
    /\b(dc\s*motor|motor|fan|pump|solenoid)\b.*\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b|\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b.*\b(dc\s*motor|motor|fan|pump|solenoid)\b/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) => !['hbridge-motor-output', 'servo-motion-output'].includes(match.id)
    );
  }

  const ids = new Set(matches.map((match) => match.id));
  if (
    /\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b.*\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b|\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b.*\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b|(?:ADC|오피앰프|연산\s*증폭기).*?(?:정밀|보정|인증|정확한\s*전압|의료)|(?:정밀|보정|인증|정확한\s*전압|의료).*?(?:ADC|오피앰프|연산\s*증폭기)/i.test(
      message
    ) ||
    /\b(?:ne555|555\s+timer|timer\s+ic)\b.*\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b|\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b.*\b(?:ne555|555\s+timer|timer\s+ic)\b|(?:NE555|555\s*타이머).*?(?:정확|정밀|보정).*?(?:주파수|듀티|파형)/i.test(
      message
    ) ||
    /\b(?:level\s+shifter|logic\s+level\s+converter)\b.*\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b|\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b.*\b(?:level\s+shifter|logic\s+level\s+converter)\b|레벨\s*시프터.*?(?:전원\s*공급|레귤레이터|전류\s*증폭)/i.test(
      message
    )
  ) {
    return matches.filter((match) => match.supportLevel === 'unsupported');
  }
  if (
    ids.has('logic-interface-context') &&
    /\b(?:74hc595|shift\s+register|pcf8574|i2c\s+expander|gpio\s+expander|ads1115|mcp3008|external\s+adc|spi\s+adc|i2c\s+adc|ne555|555\s+timer|lm358|op-?amp|operational\s+amplifier|level\s+shifter|logic\s+level\s+converter)\b|시프트\s*레지스터|I2C\s*확장기|ADC\s*모듈|타이머\s*IC|오피앰프|레벨\s*시프터/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) =>
        ![
          'display-text-output',
          'analog-sensor-display-readout',
          'analog-sensor-threshold-output',
          'i2c-sensor-display-readout',
          'spi-sensor-display-readout',
          'digital-input-display-readout',
          'digital-input-threshold-output',
          'timing-passive-context',
          'low-voltage-power-rail',
          'connector-wiring-context',
          'controller-board-substitution',
          'digital-light-output',
          'led-array-display-output',
          'spi-display-output'
        ].includes(match.id)
    );
  }
  if (
    ids.has('low-voltage-power-rail') &&
    /\b(power\s+rail|breadboard\s+psu|breadboard\s+power|power\s+module|5\s*v\s+rail|3\.3\s*v\s+rail|9\s*v\s+battery|aa\s+battery|lipo\s+battery|1s\s+lipo|barrel\s+jack|dc\s+jack|2\s*pin\s+screw\s+terminal|2-pin\s+screw\s+terminal|7805|regulator|regulated\s+5\s*v)\b|전원\s*레일|브레드보드\s*전원|전원\s*모듈|9V\s*배터리|AA\s*배터리|LiPo\s*배터리|DC\s*잭|2핀\s*스크류\s*터미널|7805\s*레귤레이터/i.test(
      message
    ) &&
    !/\b(h\s*-?\s*bridge|l298n|l293d|motor\s+driver|relay|stepper|28byj|nema\s*17|nema17|uln2003|a4988|drv8825)\b|H브리지|릴레이|스테퍼|스텝\s*모터/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) =>
        ![
          'digital-light-output',
          'button-controlled-light-output',
          'low-side-switched-load-output',
          'relay-low-voltage-output',
          'hbridge-motor-output',
          'stepper-motor-output'
        ].includes(match.id)
    );
  }
  if (
    (ids.has('passive-protection-context') || ids.has('timing-passive-context')) &&
    /\b(capacitor|cap|diode|zener|schottky|polyfuse|fuse|inductor|coil|crystal|quartz)\b|콘덴서|캐패시터|다이오드|제너|쇼트키|폴리퓨즈|퓨즈|인덕터|코일|크리스탈/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) =>
        !['digital-light-output', 'button-controlled-light-output', 'sound-alert-output'].includes(
          match.id
        )
    );
  }
  if (
    ids.has('matrix-input-display-readout') &&
    /\b(dip\s+switch|keypad|matrix\s+keypad|membrane\s+keypad)\b|DIP\s*스위치|딥\s*스위치|키패드|매트릭스\s*키패드|멤브레인\s*키패드/i.test(
      message
    ) &&
    !/\b(led|light|lamp|neopixel|ws2812|rgb|glow|blink)\b|LED|불|빛|조명|깜빡/i.test(message)
  ) {
    return matches.filter(
      (match) => !['button-controlled-light-output', 'digital-light-output'].includes(match.id)
    );
  }
  if (
    ids.has('sound-alert-output') &&
    /\b(buzzer|beep|tone|sound|piezo)\b|부저|삐|소리/i.test(message) &&
    !/\b(led|light|lamp|neopixel|ws2812|rgb|glow|blink)\b|LED|불|빛|조명|깜빡/i.test(message)
  ) {
    return matches.filter(
      (match) => !['button-controlled-light-output', 'digital-light-output'].includes(match.id)
    );
  }
  if (
    (ids.has('prototyping-surface-context') || ids.has('connector-wiring-context')) &&
    /\b(breadboard|perfboard|pcb|proto(?:type)?\s+shield|header|terminal\s+block|screw\s+terminal|connector)\b|브레드보드|만능기판|기판|프로토\s*쉴드|헤더핀|핀헤더|터미널|커넥터/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) =>
        ![
          'digital-light-output',
          'button-controlled-light-output',
          'sound-alert-output',
          'display-text-output',
          'low-voltage-power-rail'
        ].includes(match.id)
    );
  }
  if (
    ids.has('bare-seven-segment-display-output') &&
    /\b(7seg-1digit|bare\s+(?:7|seven)\s*-?\s*segment|(single|one|1)\s*-?\s*digit\s+(?:7|seven)\s*-?\s*segment|per\s+segment\s+resistor|decimal\s+point)\b|1자리\s*(?:7|세븐)\s*세그먼트|한\s*자리\s*(?:7|세븐)\s*세그먼트/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) =>
        !['display-text-output', 'digital-light-output', 'led-array-display-output'].includes(
          match.id
        )
    );
  }
  if (
    ids.has('spi-display-output') &&
    /\b(spi|tft|nokia\s*5110|pcd8544|e-?paper|e-?ink|epaper|sck|cs)\b/i.test(message)
  ) {
    return matches.filter((match) => match.id !== 'display-text-output');
  }
  if (
    [...ids].some((id) =>
      [
        'dht22-temperature-humidity-display',
        'i2c-sensor-display-readout',
        'clocked-data-sensor-display-readout',
        'spi-sensor-display-readout',
        'uart-sensor-display-readout',
        'uart-communication-module-readout',
        'spi-communication-module-readout',
        'rs485-communication-module-readout'
      ].includes(id)
    ) &&
    /\b(dht22|bmp280|mpu6050|mpu-6050|hmc5883l|hx711|load\s*cell|gps|neo-?6m|rc522|rfid|max30102|esp-?01|hc-?05|bluetooth|wifi|sim800l|gsm|lora|ra-?02|nrf24l01?|mcp2515|can\s+bus|rs-?485|max485|usb\s+host)\b|로드셀|무게\s*센서|GPS|RFID|맥박\s*센서|블루투스|와이파이|로라|무선\s*모듈|CAN\s*모듈|RS485|USB\s*호스트/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) =>
        ![
          'display-text-output',
          'analog-sensor-display-readout',
          'analog-sensor-threshold-output',
          'digital-input-display-readout',
          'digital-input-threshold-output',
          'sound-alert-output',
          'digital-light-output'
        ].includes(match.id)
    );
  }
  if (ids.has('servo-motion-output') && /\bservo\b|서보/i.test(message)) {
    return matches.filter((match) => match.id !== 'low-side-switched-load-output');
  }
  if (
    ids.has('low-side-switched-load-output') &&
    /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b|콘센트|가정용\s*전원|교류|220볼트|110볼트/i.test(
      message
    )
  ) {
    return matches.filter((match) => match.id !== 'low-side-switched-load-output');
  }
  if (
    ids.has('hbridge-motor-output') &&
    /\b(h\s*-?\s*bridge|l298n|l293d|forward\s+reverse|direction\s+control)\b|H브리지|정역회전/i.test(
      message
    )
  ) {
    return matches.filter(
      (match) =>
        !['low-side-switched-load-output', 'servo-motion-output', 'stepper-motor-output'].includes(
          match.id
        )
    );
  }
  if (
    ids.has('relay-low-voltage-output') &&
    /\b(relay|relay\s+module|relay\s+board)\b|릴레이/i.test(message)
  ) {
    return matches.filter(
      (match) =>
        ![
          'button-controlled-light-output',
          'digital-light-output',
          'low-side-switched-load-output',
          'servo-motion-output',
          'stepper-motor-output'
        ].includes(match.id)
    );
  }
  if (
    ids.has('stepper-motor-output') &&
    /\b(stepper|28byj|nema\s*17|nema17|uln2003|a4988|drv8825)\b|스테퍼|스텝\s*모터/i.test(message)
  ) {
    return matches.filter(
      (match) => !['low-side-switched-load-output', 'servo-motion-output'].includes(match.id)
    );
  }
  return matches;
}
