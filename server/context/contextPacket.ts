import {
  getPartRegistry,
  detectVisualLibraryPartMentions,
  loadContextBundleV2,
  loadContextIndex,
  loadContextV2Index,
  loadContextV2Routes,
  loadRenderFootprints,
  loadSimulationPrimitives,
  matchCapabilities,
  resolveContextSourceId,
  searchPartCapabilities
} from './contextLayer.ts';
import { loadCapabilityGraph } from './capabilityGraph.ts';
import {
  ContextPacketSchema,
  ContextRouteSchema,
  IntentSpecV2Schema,
  RetrievalPlanSchema,
  type AgentMessageRequest,
  type AgentConversationContext,
  type CapabilityGraphEntry,
  type ContextCoverageReport,
  type ContextPacket,
  type ContextRoute,
  type ContextTraceEntry,
  type IntentSpecV2,
  type PartCapability,
  type RenderFootprintEntry,
  type RetrievalPlan,
  type SimulationPrimitive,
  type SupportBundleEvidence
} from '../agent/schemas.ts';
import type {
  ContextBundleV2,
  ContextIndex,
  ContextV2Routes,
  VisualLibraryPartMention
} from './contextLayer.ts';
import {
  buildSupportBundleEvidence,
  bundleEvidenceBlocksSynthesis
} from './supportBundleEvidence.ts';
import {
  buildKnownHardwareTerms,
  detectUnresolvedHardwareMentions,
  type UnresolvedHardwareMention
} from './unresolvedHardwareMentions.ts';
// Type-only import: the pipeline-mode flag is resolved by the caller and passed via deps, so the
// context layer keeps no runtime dependency on the agent layer.
import type { AgentPipelineMode } from '../agent/agentPipelineMode.ts';
import { selectContextByComposition } from './compositionSelection.ts';

type BuildContextPacketInput = Pick<AgentMessageRequest, 'message' | 'locale' | 'conversationContext'> & {
  // Re-grounding seam: when the student narrows to a specific capability (HITL clarification), force it
  // to the top of the matches so route/bundle/candidateParts/coverage ground to that capability rather
  // than the fuzzy match of the original (often vague) message. Unknown/unsupported ids are ignored.
  forceCapabilityId?: string;
};

// Phase 0.5 seam: the part registry is injectable so tests can double/grow the catalog (the
// catalog-growth test doubles it). Production passes nothing -> the real cached `getPartRegistry`.
type PartRegistrySource = () => Promise<PartCapability[]>;
export type ContextPacketDeps = {
  registrySource?: PartRegistrySource;
  // Pipeline mode (legacy|shadow|next). `legacy` (default) preserves the exact current routing;
  // shadow|next enable tier-aware route selection (Phase 1). Resolved by the caller.
  pipelineMode?: AgentPipelineMode;
};

type ContextV2Route = ContextV2Routes['routes'][number];

const BASE_CONTEXT_IDS = [
  'agent-operating-memory',
  'safety-policy',
  'board-topology',
  'protocol-rules',
  'validation-rules',
  'simulation-recipes',
  'rendering-footprints',
  'simulation-truthfulness-policy'
];

const HARDWARE_KEYWORDS = [
  {
    partId: 'oled-i2c-096',
    output: 'display',
    protocol: 'i2c',
    terms: ['oled', 'display', 'screen', 'text display', '화면', '디스플레이', '표시', '글자', '문자']
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
    terms: ['7seg-1digit', 'single digit 7 segment', 'single digit 7-segment', 'one digit 7 segment', '1 digit 7 segment', '1-digit 7-segment', 'bare 7 segment', 'bare 7-segment', '세븐세그먼트 1자리', '1자리 세븐세그먼트', '1자리 7세그먼트', '한 자리 7세그먼트']
  },
  {
    partId: '7seg-4digit-tm1637',
    output: 'led-array-display',
    protocol: 'tm1637-two-wire',
    terms: ['tm1637', '7 segment', '7-segment', '4 digit display', '4-digit display', 'numeric display', '세븐세그먼트', '4자리 표시기']
  },
  {
    partId: '8x8-matrix-max7219',
    output: 'led-array-display',
    protocol: 'spi-like',
    terms: ['max7219', '8x8 led matrix', '8x8 matrix', 'led matrix', 'dot matrix', 'LED 매트릭스', '도트 매트릭스']
  },
  {
    partId: 'neopixel-ring-12',
    output: 'addressable-led-display',
    protocol: 'single-wire-data',
    terms: ['neopixel', 'neopixel ring', 'ws2812', 'addressable led', 'rgb led ring', 'led ring', '네오픽셀', '주소지정 LED']
  },
  {
    partId: 'ws2812b-strip',
    output: 'addressable-led-display',
    protocol: 'single-wire-data',
    terms: ['ws2812b strip', 'ws2812 strip', 'addressable led strip', 'neopixel strip', 'rgb led strip', 'LED 스트립', '주소지정 LED 스트립']
  },
  {
    partId: 'tft-18',
    output: 'spi-display',
    protocol: 'spi',
    terms: ['tft', 'tft 1.8', '1.8 tft', 'spi tft', 'tft lcd', 'color display', '컬러 TFT', 'SPI TFT']
  },
  {
    partId: 'nokia-5110',
    output: 'spi-display',
    protocol: 'spi',
    terms: ['nokia 5110', 'nokia lcd', 'pcd8544', '84x48 lcd', 'spi monochrome display', '노키아 5110']
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
    terms: ['led', 'light', 'lamp', 'blink', '불', '조명', '깜빡', '켜']
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
    terms: ['trimmer potentiometer', 'trimmer pot', 'trim pot', 'trimmer', '반고정 가변저항', '트리머 가변저항']
  },
  {
    partId: 'piezo-buzzer',
    output: 'sound',
    protocol: 'gpio',
    terms: ['buzzer', 'beep', 'sound', 'alarm', 'tone', '부저', '소리', '알람', '삐']
  },
  {
    partId: 'micro-servo',
    output: 'motion',
    protocol: 'pwm',
    terms: ['servo', 'servo arm', 'move', 'sweep', 'actuator', '서보', '움직', '회전']
  },
  {
    partId: 'mg996r-servo',
    output: 'motion',
    protocol: 'pwm',
    terms: ['mg996r', 'mg996r servo', 'metal gear servo', 'high torque servo', 'large servo', 'MG996R 서보', '고토크 서보']
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
    terms: ['2n2222', '2n2222 transistor', 'npn transistor', 'transistor switch', '트랜지스터', 'NPN 트랜지스터']
  },
  {
    partId: 'l298n-driver',
    output: 'hbridge-motor',
    protocol: 'h-bridge',
    terms: ['l298n', 'l298n driver', 'l298n motor driver', 'h bridge', 'h-bridge', 'H브리지', 'L298N 드라이버']
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
    partId: 'stepper-28byj48',
    output: 'stepper-motion',
    protocol: 'four-phase-stepper',
    terms: ['28byj', '28byj-48', '28byj48', 'unipolar stepper', 'gear stepper', '스테퍼', '스텝 모터']
  },
  {
    partId: 'nema17-stepper',
    output: 'stepper-motion',
    protocol: 'step-dir',
    terms: ['nema17', 'nema 17', 'nema17 stepper', 'bipolar stepper', 'NEMA17 스테퍼']
  },
  {
    partId: 'uln2003-driver',
    output: 'stepper-motion',
    protocol: 'four-phase-stepper',
    terms: ['uln2003', 'uln2003 driver', '28byj driver', 'ULN2003 드라이버']
  },
  {
    partId: 'a4988-stepper',
    output: 'stepper-motion',
    protocol: 'step-dir',
    terms: ['a4988', 'a4988 stepper', 'a4988 driver', 'A4988 드라이버']
  },
  {
    partId: 'drv8825-stepper',
    output: 'stepper-motion',
    protocol: 'step-dir',
    terms: ['drv8825', 'drv8825 stepper', 'drv8825 driver', 'DRV8825 드라이버']
  },
  {
    partId: 'dht11',
    input: 'temperature-humidity-sensor',
    protocol: 'single-wire-data',
    terms: ['dht11', 'dht11 sensor', 'DHT11']
  },
  {
    partId: 'dht22',
    input: 'temperature-humidity-sensor',
    protocol: 'single-wire-data',
    terms: ['dht22', 'dht22 sensor', 'am2302', 'DHT22', 'DHT22 온습도']
  },
  {
    partId: 'bmp280',
    input: 'protocol-sensor',
    protocol: 'i2c',
    terms: ['bmp280', 'barometric pressure', 'pressure sensor', 'BMP280 압력 센서']
  },
  {
    partId: 'mpu6050',
    input: 'protocol-sensor',
    protocol: 'i2c',
    terms: ['mpu6050', 'mpu-6050', 'imu', 'accelerometer', 'gyro', '자이로 센서', 'IMU 센서']
  },
  {
    partId: 'hmc5883l',
    input: 'protocol-sensor',
    protocol: 'i2c',
    terms: ['hmc5883l', 'compass sensor', 'magnetometer', 'digital compass', '나침반 센서']
  },
  {
    partId: 'hx711-loadcell',
    input: 'protocol-sensor',
    protocol: 'clocked-data',
    terms: ['hx711', 'load cell', 'loadcell', 'weight sensor', '로드셀', '무게 센서']
  },
  {
    partId: 'gps-neo6m',
    input: 'protocol-sensor',
    protocol: 'uart',
    terms: ['gps', 'neo6m', 'neo-6m', 'nmea', 'gps module', 'GPS 모듈']
  },
  {
    partId: 'rc522-rfid',
    input: 'protocol-sensor',
    protocol: 'spi',
    terms: ['rc522', 'rfid', 'mfrc522', 'rfid reader', 'RFID 리더']
  },
  {
    partId: 'max30102-pulse',
    input: 'protocol-sensor',
    protocol: 'i2c',
    terms: ['max30102', 'pulse sensor', 'heart rate sensor', 'optical pulse', '맥박 센서']
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
    partId: '74hc595-shift',
    input: 'logic-interface',
    output: 'interface-state',
    protocol: 'gpio',
    terms: ['74hc595', 'shift register', 'sipo', 'serial-in parallel-out', '시프트 레지스터']
  },
  {
    partId: 'pcf8574-expander',
    input: 'logic-interface',
    output: 'interface-state',
    protocol: 'i2c',
    terms: ['pcf8574', 'i2c expander', 'gpio expander', 'io expander', 'I2C 확장기']
  },
  {
    partId: 'ads1115-adc',
    input: 'external-adc-interface',
    output: 'qualitative-readout',
    protocol: 'i2c',
    terms: ['ads1115', 'i2c adc', 'external adc', 'adc module', 'ADC 모듈']
  },
  {
    partId: 'mcp3008-adc',
    input: 'external-adc-interface',
    output: 'qualitative-readout',
    protocol: 'spi',
    terms: ['mcp3008', 'spi adc', 'external adc', 'adc interface', 'SPI ADC']
  },
  {
    partId: 'ne555-timer',
    input: 'timer-interface',
    output: 'interface-state',
    protocol: 'gpio',
    terms: ['ne555', '555 timer', 'timer ic', '타이머 IC']
  },
  {
    partId: 'lm358-opamp',
    input: 'opamp-interface',
    output: 'qualitative-readout',
    protocol: 'analog-context',
    terms: ['lm358', 'op amp', 'op-amp', 'operational amplifier', '오피앰프']
  },
  {
    partId: 'i2c-level-shifter',
    input: 'level-shifter-interface',
    output: 'voltage-domain-context',
    protocol: 'level-shift',
    terms: ['level shifter', 'i2c level shifter', 'logic level converter', '3.3v 5v logic', '레벨 시프터']
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
    terms: ['fsr', 'force sensor', 'pressure sensor', 'force sensitive resistor', '압력 센서', '힘 센서']
  },
  {
    partId: 'thermistor-ntc',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['thermistor', 'ntc', 'ntc thermistor', 'temperature resistor', '서미스터', 'NTC', '온도 저항']
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
    terms: ['tcs3200', 'color sensor', 'colour sensor', 'frequency color sensor', '컬러 센서', '색상 센서']
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
    terms: ['joystick', 'analog joystick', 'thumb joystick', 'x y position', '조이스틱', '아날로그 조이스틱']
  },
  {
    partId: 'rotary-encoder',
    input: 'rotary-encoder',
    protocol: 'gpio',
    terms: ['rotary encoder', 'encoder knob', 'quadrature encoder', 'clk dt', '로터리 엔코더', '엔코더']
  },
  {
    partId: 'breadboard-psu',
    output: 'power',
    protocol: 'power',
    terms: ['breadboard power supply', 'breadboard psu', 'power module', '5v rail', '3.3v rail', '브레드보드 전원 모듈', '전원 모듈']
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
    terms: ['2 pin screw terminal', '2-pin screw terminal', '2 pin terminal', '2핀 스크류 터미널', '2핀 터미널']
  },
  {
    partId: '7805-regulator',
    output: 'power',
    protocol: 'regulated-power',
    terms: ['7805', '7805 regulator', '5v regulator', 'regulated 5v', '7805 레귤레이터', '전압 레귤레이터']
  },
  {
    partId: 'lipo-battery-1s',
    output: 'power',
    protocol: 'power',
    terms: ['lipo battery', '1s lipo', '3.7v lipo', 'lithium polymer battery', 'LiPo 배터리', '리튬폴리머 배터리']
  },
  {
    partId: 'ceramic-cap',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['ceramic capacitor', 'ceramic cap', 'decoupling capacitor', 'bypass capacitor', '세라믹 콘덴서', '세라믹 캐패시터']
  },
  {
    partId: 'electrolytic-cap',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['electrolytic capacitor', 'electrolytic cap', 'polarized capacitor', 'filter capacitor', '전해 콘덴서', '전해 캐패시터']
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
    terms: ['16mhz crystal', '16 mhz crystal', 'quartz crystal', 'clock crystal', 'crystal oscillator', '크리스탈', '16MHz 크리스탈', '클럭 크리스탈']
  },
  {
    partId: 'breadboard-full',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: ['full size breadboard', 'full-size breadboard', 'full breadboard', 'large breadboard', '풀사이즈 브레드보드', '대형 브레드보드']
  },
  {
    partId: 'breadboard-mini',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: ['mini breadboard', 'small breadboard', 'compact breadboard', '미니 브레드보드', '소형 브레드보드']
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
    terms: ['proto shield', 'prototype shield', 'uno prototype shield', 'arduino prototype shield', '프로토 쉴드', '아두이노 프로토 쉴드']
  },
  {
    partId: 'header-male-40pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: ['male header', 'male header pins', '40 pin male header', 'header pins male', '수 헤더핀', '수 핀헤더']
  },
  {
    partId: 'header-female-40pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: ['female header', 'female header pins', '40 pin female header', 'socket header', '암 헤더핀', '암 핀헤더']
  },
  {
    partId: 'screw-terminal-4pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: ['4 pin screw terminal', '4-pin screw terminal', 'four pin terminal block', '4 pin terminal block', '4핀 스크류 터미널', '4핀 터미널 블록']
  }
];

const ACTIVE_HARDWARE_KEYWORDS = [
  {
    partId: 'oled-i2c-096',
    output: 'display',
    protocol: 'i2c',
    terms: ['oled', 'display', 'screen', 'text display', '화면', '디스플레이', '표시', '글자', '문자']
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
    terms: ['7seg-1digit', 'single digit 7 segment', 'single digit 7-segment', 'one digit 7 segment', '1 digit 7 segment', '1-digit 7-segment', 'bare 7 segment', 'bare 7-segment', '세븐세그먼트 1자리', '1자리 세븐세그먼트', '1자리 7세그먼트', '한 자리 7세그먼트']
  },
  {
    partId: '7seg-4digit-tm1637',
    output: 'led-array-display',
    protocol: 'tm1637-two-wire',
    terms: ['tm1637', '7 segment', '7-segment', '4 digit display', '4-digit display', 'numeric display', '세븐세그먼트', '4자리 표시기']
  },
  {
    partId: '8x8-matrix-max7219',
    output: 'led-array-display',
    protocol: 'spi-like',
    terms: ['max7219', '8x8 led matrix', '8x8 matrix', 'led matrix', 'dot matrix', 'LED 매트릭스', '도트 매트릭스']
  },
  {
    partId: 'neopixel-ring-12',
    output: 'addressable-led-display',
    protocol: 'single-wire-data',
    terms: ['neopixel', 'neopixel ring', 'ws2812', 'addressable led', 'rgb led ring', 'led ring', '네오픽셀', '주소지정 LED']
  },
  {
    partId: 'ws2812b-strip',
    output: 'addressable-led-display',
    protocol: 'single-wire-data',
    terms: ['ws2812b strip', 'ws2812 strip', 'addressable led strip', 'neopixel strip', 'rgb led strip', 'LED 스트립', '주소지정 LED 스트립']
  },
  {
    partId: 'tft-18',
    output: 'spi-display',
    protocol: 'spi',
    terms: ['tft', 'tft 1.8', '1.8 tft', 'spi tft', 'tft lcd', 'color display', '컬러 TFT', 'SPI TFT']
  },
  {
    partId: 'nokia-5110',
    output: 'spi-display',
    protocol: 'spi',
    terms: ['nokia 5110', 'nokia lcd', 'pcd8544', '84x48 lcd', 'spi monochrome display', '노키아 5110']
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
    terms: ['rgb led', 'common cathode rgb', 'common cathode rgb led', 'three color led', 'full color led', 'RGB LED', '공통 캐소드 RGB', 'RGB LED 색']
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
    terms: ['trimmer potentiometer', 'trimmer pot', 'trim pot', 'trimmer', '반고정 가변저항', '트리머 가변저항']
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
    terms: ['mg996r', 'mg996r servo', 'metal gear servo', 'high torque servo', 'large servo', 'MG996R 서보', '고토크 서보']
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
    terms: ['2n2222', '2n2222 transistor', 'npn transistor', 'transistor switch', '트랜지스터', 'NPN 트랜지스터']
  },
  {
    partId: 'l298n-driver',
    output: 'hbridge-motor',
    protocol: 'h-bridge',
    terms: ['l298n', 'l298n driver', 'l298n motor driver', 'h bridge', 'h-bridge', 'H브리지', 'L298N 드라이버']
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
    terms: ['fsr', 'force sensor', 'pressure sensor', 'force sensitive resistor', '압력 센서', '힘 센서']
  },
  {
    partId: 'thermistor-ntc',
    input: 'analog-sensor',
    protocol: 'analog-input',
    terms: ['thermistor', 'ntc', 'ntc thermistor', 'temperature resistor', '서미스터', 'NTC', '온도 저항']
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
    terms: ['tcs3200', 'color sensor', 'colour sensor', 'frequency color sensor', '컬러 센서', '색상 센서']
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
    terms: ['joystick', 'analog joystick', 'thumb joystick', 'x y position', '조이스틱', '아날로그 조이스틱']
  },
  {
    partId: 'rotary-encoder',
    input: 'rotary-encoder',
    protocol: 'gpio',
    terms: ['rotary encoder', 'encoder knob', 'quadrature encoder', 'clk dt', '로터리 엔코더', '엔코더']
  },
  {
    partId: 'breadboard-psu',
    output: 'power',
    protocol: 'power',
    terms: ['breadboard power supply', 'breadboard psu', 'power module', '5v rail', '3.3v rail', '브레드보드 전원 모듈', '전원 모듈']
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
    terms: ['2 pin screw terminal', '2-pin screw terminal', '2 pin terminal', '2핀 스크류 터미널', '2핀 터미널']
  },
  {
    partId: '7805-regulator',
    output: 'power',
    protocol: 'regulated-power',
    terms: ['7805', '7805 regulator', '5v regulator', 'regulated 5v', '7805 레귤레이터', '전압 레귤레이터']
  },
  {
    partId: 'lipo-battery-1s',
    output: 'power',
    protocol: 'power',
    terms: ['lipo battery', '1s lipo', '3.7v lipo', 'lithium polymer battery', 'LiPo 배터리', '리튬폴리머 배터리']
  },
  {
    partId: 'ceramic-cap',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['ceramic capacitor', 'ceramic cap', 'decoupling capacitor', 'bypass capacitor', '세라믹 콘덴서', '세라믹 캐패시터']
  },
  {
    partId: 'electrolytic-cap',
    output: 'passive-context',
    input: 'passive-protection',
    protocol: 'passive',
    terms: ['electrolytic capacitor', 'electrolytic cap', 'polarized capacitor', 'filter capacitor', '전해 콘덴서', '전해 캐패시터']
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
    terms: ['16mhz crystal', '16 mhz crystal', 'quartz crystal', 'clock crystal', 'crystal oscillator', '크리스탈', '16MHz 크리스탈', '클럭 크리스탈']
  },
  {
    partId: 'breadboard-full',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: ['full size breadboard', 'full-size breadboard', 'full breadboard', 'large breadboard', '풀사이즈 브레드보드', '대형 브레드보드']
  },
  {
    partId: 'breadboard-mini',
    output: 'prototyping-context',
    input: 'prototyping-surface',
    protocol: 'prototyping',
    terms: ['mini breadboard', 'small breadboard', 'compact breadboard', '미니 브레드보드', '소형 브레드보드']
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
    terms: ['proto shield', 'prototype shield', 'uno prototype shield', 'arduino prototype shield', '프로토 쉴드', '아두이노 프로토 쉴드']
  },
  {
    partId: 'header-male-40pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: ['male header', 'male header pins', '40 pin male header', 'header pins male', '수 헤더핀', '수 핀헤더']
  },
  {
    partId: 'header-female-40pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: ['female header', 'female header pins', '40 pin female header', 'socket header', '암 헤더핀', '암 핀헤더']
  },
  {
    partId: 'screw-terminal-4pin',
    output: 'connector-context',
    input: 'connector-wiring',
    protocol: 'connector',
    terms: ['4 pin screw terminal', '4-pin screw terminal', 'four pin terminal block', '4 pin terminal block', '4핀 스크류 터미널', '4핀 터미널 블록']
  }
];

const UNSAFE_PATTERNS = [
  { pattern: /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b/i, signal: 'high-voltage mains power' },
  { pattern: /\b(stepper|nema\s*17|nema17)\b.*\b(directly|direct|without\s+a?\s*driver|no\s+driver)\b|\b(directly|direct|without\s+a?\s*driver|no\s+driver)\b.*\b(stepper|nema\s*17|nema17)\b/i, signal: 'unsupported direct stepper GPIO drive' },
  { pattern: /\b(dc\s*motor|motor|fan|pump|solenoid)\b.*\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b|\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b.*\b(dc\s*motor|motor|fan|pump|solenoid)\b/i, signal: 'unsupported direct motor GPIO drive' },
  { pattern: /drone|autopilot|gps navigation|bluetooth drone|autonomous robot/i, signal: 'unsupported autonomous wireless project' },
  { pattern: /wi[-\s]?fi door lock|wifi door lock|smart lock|unlock my house|phone door lock/i, signal: 'unsupported home security actuator' },
  { pattern: /radio tracker|gps tracker|track(?:ing)? device/i, signal: 'unsupported tracking or radio project' },
  { pattern: /\b(spo2|blood\s+oxygen|pulse\s+oximeter|heart\s+(?:condition|monitor|diagnosis)|diagnos(?:e|is)|medical)\b|\bmax30102\b.*\b(health\s*monitor|medical|diagnos(?:e|is)|spo2|blood\s+oxygen)\b|\b(health\s*monitor|medical|diagnos(?:e|is)|spo2|blood\s+oxygen)\b.*\bmax30102\b/i, signal: 'unsupported medical sensor claim' },
  { pattern: /\b(gps|neo-?6m)\b.*\b(navigation|navigate|autopilot|route guidance|tracking|tracker|safety|collision avoidance)\b|\b(navigation|navigate|autopilot|route guidance|tracking|tracker|collision avoidance)\b.*\b(gps|neo-?6m)\b/i, signal: 'unsupported navigation or tracking claim' },
  { pattern: /\b(rc522|rfid)\b.*\b(door lock|security|access control|payment|authentication|alarm)\b|\b(door lock|security|access control|payment|authentication|alarm)\b.*\b(rc522|rfid)\b/i, signal: 'unsupported security or payment claim' },
  { pattern: /\b(hx711|load\s*cell|weight\s+sensor)\b.*\b(certified|legal for trade|calibrated scale|exact weight)\b|\b(certified|legal for trade|calibrated scale|exact weight)\b.*\b(hx711|load\s*cell|weight\s+sensor)\b/i, signal: 'unsupported certified measurement claim' },
  { pattern: /\b(?:esp-?01|wifi|wi-fi|hc-?05|bluetooth|sim800l|gsm|lora|nrf24l01?|radio)\b.*\b(?:cloud|internet|backend|phone pairing|pair(?:ing)? with my phone|sms|call|real\s+range|tracking|security|door\s+lock)\b|\b(?:cloud|internet|backend|phone pairing|pair(?:ing)? with my phone|sms|call|real\s+range|tracking|security|door\s+lock)\b.*\b(?:esp-?01|wifi|wi-fi|hc-?05|bluetooth|sim800l|gsm|lora|nrf24l01?|radio)\b/i, signal: 'unsupported wireless network overclaim' },
  { pattern: /\b(?:usb\s+host|usb-host|max3421e)\b.*\b(?:enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s+drive|real\s+usb)\b|\b(?:enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s+drive|real\s+usb)\b.*\b(?:usb\s+host|usb-host|max3421e)\b/i, signal: 'unsupported USB host device overclaim' },
  { pattern: /\b(?:rs-?485|max485|mcp2515|can\s+bus)\b.*\b(?:certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b|\b(?:certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b.*\b(?:rs-?485|max485|mcp2515|can\s+bus)\b/i, signal: 'unsupported certified communication network claim' },
  { pattern: /\b(?:mov|varistor)\b|바리스터|서지\s*보호/i, signal: 'mains protection component' },
  { pattern: /\b(?:lipo|lithium\s*polymer)\b.*\b(?:charge|charger|charging|short|puncture|pierce|high\s*current)\b|\b(?:charge|charger|charging|short|puncture|pierce|high\s*current)\b.*\b(?:lipo|lithium\s*polymer)\b/i, signal: 'unsafe LiPo battery handling' },
  { pattern: /콘센트|가정용\s*전원|교류|220볼트|110볼트/i, signal: 'high-voltage mains power' },
  { pattern: /heater|히터|열선|납땜|폭발|폭죽|fire/i, signal: 'unsafe thermal or hazardous load' }
];

const ACTIVE_UNSAFE_PATTERNS = [
  { pattern: /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b/i, signal: 'high-voltage mains power' },
  { pattern: /\b(stepper|nema\s*17|nema17)\b.*\b(directly|direct|without\s+a?\s*driver|no\s+driver)\b|\b(directly|direct|without\s+a?\s*driver|no\s+driver)\b.*\b(stepper|nema\s*17|nema17)\b/i, signal: 'unsupported direct stepper GPIO drive' },
  { pattern: /\b(dc\s*motor|motor|fan|pump|solenoid)\b.*\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b|\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b.*\b(dc\s*motor|motor|fan|pump|solenoid)\b/i, signal: 'unsupported direct motor GPIO drive' },
  { pattern: /drone|autopilot|gps navigation|bluetooth drone|autonomous robot|무인\s*드론|자율\s*주행|gps\s*경로/i, signal: 'unsupported autonomous wireless project' },
  { pattern: /wi[-\s]?fi door lock|wifi door lock|smart lock|unlock my house|phone door lock|와이파이\s*도어락|스마트\s*도어락|현관문\s*잠금/i, signal: 'unsupported home security actuator' },
  { pattern: /radio tracker|gps tracker|track(?:ing)? device|위치\s*추적|무선\s*추적/i, signal: 'unsupported tracking or radio project' },
  { pattern: /\b(spo2|blood\s+oxygen|pulse\s+oximeter|heart\s+(?:condition|monitor|diagnosis)|diagnos(?:e|is)|medical)\b|\bmax30102\b.*\b(health\s*monitor|medical|diagnos(?:e|is)|spo2|blood\s+oxygen)\b|\b(health\s*monitor|medical|diagnos(?:e|is)|spo2|blood\s+oxygen)\b.*\bmax30102\b|혈중\s*산소|의료|진단|건강\s*모니터/i, signal: 'unsupported medical sensor claim' },
  { pattern: /\b(gps|neo-?6m)\b.*\b(navigation|navigate|autopilot|route guidance|tracking|tracker|safety|collision avoidance)\b|\b(navigation|navigate|autopilot|route guidance|tracking|tracker|collision avoidance)\b.*\b(gps|neo-?6m)\b|GPS.*(?:추적|길찾기|항법|자율)|(?:추적|길찾기|항법|자율).*GPS/i, signal: 'unsupported navigation or tracking claim' },
  { pattern: /\b(rc522|rfid)\b.*\b(door lock|security|access control|payment|authentication|alarm)\b|\b(door lock|security|access control|payment|authentication|alarm)\b.*\b(rc522|rfid)\b|RFID.*(?:보안|결제|인증|도어락|출입)|(?:보안|결제|인증|도어락|출입).*RFID/i, signal: 'unsupported security or payment claim' },
  { pattern: /\b(hx711|load\s*cell|weight\s+sensor)\b.*\b(certified|legal for trade|calibrated scale|exact weight)\b|\b(certified|legal for trade|calibrated scale|exact weight)\b.*\b(hx711|load\s*cell|weight\s+sensor)\b|로드셀.*(?:인증|정확한\s*무게|거래용|검정)|(?:인증|정확한\s*무게|거래용|검정).*로드셀/i, signal: 'unsupported certified measurement claim' },
  { pattern: /\b(?:esp-?01|wifi|wi-fi|hc-?05|bluetooth|sim800l|gsm|lora|nrf24l01?|radio)\b.*\b(?:cloud|internet|backend|phone pairing|pair(?:ing)? with my phone|sms|call|real\s+range|tracking|security|door\s+lock)\b|\b(?:cloud|internet|backend|phone pairing|pair(?:ing)? with my phone|sms|call|real\s+range|tracking|security|door\s+lock)\b.*\b(?:esp-?01|wifi|wi-fi|hc-?05|bluetooth|sim800l|gsm|lora|nrf24l01?|radio)\b|(?:와이파이|블루투스|GSM|로라|무선).*?(?:클라우드|인터넷|문자|전화|추적|보안|도어락)|(?:클라우드|인터넷|문자|전화|추적|보안|도어락).*?(?:와이파이|블루투스|GSM|로라|무선)/i, signal: 'unsupported wireless network overclaim' },
  { pattern: /\b(?:usb\s+host|usb-host|max3421e)\b.*\b(?:enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s+drive|real\s+usb)\b|\b(?:enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s+drive|real\s+usb)\b.*\b(?:usb\s+host|usb-host|max3421e)\b|USB\s*호스트.*(?:키보드|마우스|저장장치|실제\s*USB)/i, signal: 'unsupported USB host device overclaim' },
  { pattern: /\b(?:rs-?485|max485|mcp2515|can\s+bus)\b.*\b(?:certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b|\b(?:certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b.*\b(?:rs-?485|max485|mcp2515|can\s+bus)\b|(?:RS485|CAN).*?(?:인증|산업용\s*네트워크|차량\s*제어|안전\s*필수)|(?:인증|산업용\s*네트워크|차량\s*제어|안전\s*필수).*?(?:RS485|CAN)/i, signal: 'unsupported certified communication network claim' },
  { pattern: /\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b.*\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b|\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b.*\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b|(?:ADC|오피앰프|연산\s*증폭기).*?(?:정밀|보정|인증|정확한\s*전압|의료)|(?:정밀|보정|인증|정확한\s*전압|의료).*?(?:ADC|오피앰프|연산\s*증폭기)/i, signal: 'precision analog overclaim' },
  { pattern: /\b(?:ne555|555\s+timer|timer\s+ic)\b.*\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b|\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b.*\b(?:ne555|555\s+timer|timer\s+ic)\b|(?:NE555|555\s*타이머).*?(?:정확|정밀|보정).*?(?:주파수|듀티|파형)/i, signal: 'timer frequency overclaim' },
  { pattern: /\b(?:level\s+shifter|logic\s+level\s+converter)\b.*\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b|\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b.*\b(?:level\s+shifter|logic\s+level\s+converter)\b|레벨\s*시프터.*?(?:전원\s*공급|레귤레이터|전류\s*증폭)/i, signal: 'level shifter overclaim' },
  { pattern: /\b(?:mov|varistor)\b|바리스터|서지\s*보호/i, signal: 'mains protection component' },
  { pattern: /\b(?:lipo|lithium\s*polymer)\b.*\b(?:charge|charger|charging|short|puncture|pierce|high\s*current)\b|\b(?:charge|charger|charging|short|puncture|pierce|high\s*current)\b.*\b(?:lipo|lithium\s*polymer)\b|LiPo.*(?:충전|쇼트|단락|구멍|고전류)|(?:충전|쇼트|단락|구멍|고전류).*LiPo/i, signal: 'unsafe LiPo battery handling' },
  { pattern: /콘센트|가정용\s*전원|교류|220볼트|110볼트/i, signal: 'high-voltage mains power' },
  { pattern: /heater|히터|난방|발열|가열|fire|화재/i, signal: 'unsafe thermal or hazardous load' }
];

export async function buildContextPacket(
  input: BuildContextPacketInput,
  deps: ContextPacketDeps = {}
): Promise<ContextPacket> {
  const registrySource = deps.registrySource ?? getPartRegistry;
  const pipelineMode = deps.pipelineMode ?? 'legacy';
  const locale = input.locale ?? 'ko';
  const message = input.message;
  const conversationContext = input.conversationContext;
  const contextualMessage = buildContextualRoutingMessage(input);
  const [index, rawCapabilityMatches, contextV2Index, visualLibraryMentions] = await Promise.all([
    loadContextIndex(),
    matchCapabilities(contextualMessage),
    loadContextV2Index(),
    detectVisualLibraryPartMentions(contextualMessage)
  ]);
  const capabilityMatches = await applyForcedCapabilityMatch(
    pruneCapabilityMatchesForExplicitHardware(rawCapabilityMatches, contextualMessage),
    input.forceCapabilityId
  );

  const intentHints = inferIntentHints(contextualMessage, capabilityMatches);
  const unsupportedSignals = detectUnsupportedSignals(contextualMessage);
  const initialSupportGaps = unique([
    ...buildSupportGaps(capabilityMatches),
    ...buildVisualLibrarySupportGaps(visualLibraryMentions)
  ]);
  const intentSignals = buildIntentSignals({
    intentHints,
    unsupportedSignals,
    capabilityMatches
  });
  const contextRouteV2 = await selectContextRouteV2({
    capabilityMatches,
    intentSignals,
    ambiguity: intentHints.ambiguity.length > 0,
    unsafe: unsupportedSignals.length > 0,
    pipelineMode
  });
  const selectedBundles = await Promise.all(
    contextRouteV2.bundleIds.map((bundleId) => loadContextBundleV2(bundleId))
  );
  const selectedBundlesAreBuildReady = selectedBundles.length > 0
    && selectedBundles.every((bundle) => bundle.manifest.supportLevel === 'supported');
  const explicitPartIds = detectExplicitHardwarePartIds(contextualMessage, visualLibraryMentions);
  const supportGaps = unique([
    ...initialSupportGaps,
    ...buildExplicitBundlePartSupportGaps({
      selectedBundles,
      explicitPartIds,
      visualLibraryMentions
    })
  ]);
  const contextRoute = buildContextRouteV2({
    route: contextRouteV2,
    intentSignals,
    capabilityMatches,
    supportGaps
  });
  const retrievalPlan = buildRetrievalPlanV2({
    contextRoute,
    route: contextRouteV2,
    heavySourceIds: contextV2Index.heavySourceIds,
    index,
    selectedBundles
  });
  // Phase 5 (next): composition — not the route — is the candidate authority, so the enumerated
  // route's char ceiling can be mismatched (e.g. the OLED cases route to a 10k-budget route yet the
  // composition-driven prompt is ~12k). Relax the ceiling to the global route max under next. This
  // allows nothing the legacy 'full' routes don't already allow and does NOT change the actual
  // prompt size; the js-tiktoken token gate + Phase 3.2 prompt-slimming remain the efficiency controls.
  if (pipelineMode === 'next') {
    retrievalPlan.maxPromptChars = Math.max(retrievalPlan.maxPromptChars, 38000);
  }
  const shouldLoadRegistry = includesSource(retrievalPlan, 'registry:part-capabilities') || selectedBundlesAreBuildReady;
  const shouldLoadSimulationPrimitives = includesSource(retrievalPlan, 'simulation:primitives')
    && (selectedBundles.length === 0 || selectedBundlesAreBuildReady);
  const shouldLoadRenderFootprints = includesSource(retrievalPlan, 'rendering:render-footprints')
    && (selectedBundles.length === 0 || selectedBundlesAreBuildReady);
  const [registry, searchedParts, allSimulationPrimitives, allRenderFootprints] = await Promise.all([
    shouldLoadRegistry ? registrySource() : Promise.resolve([] as PartCapability[]),
    shouldLoadRegistry && selectedBundles.length === 0
      ? searchPartCapabilities(expandSearchQuery(contextualMessage))
      : Promise.resolve([] as PartCapability[]),
    shouldLoadSimulationPrimitives ? loadSimulationPrimitives() : Promise.resolve([] as SimulationPrimitive[]),
    shouldLoadRenderFootprints ? loadRenderFootprints() : Promise.resolve({} as Record<string, RenderFootprintEntry>)
  ]);
  const unresolvedHardwareMentions = unsupportedSignals.length > 0
    ? []
    : detectUnresolvedHardwareMentions(
      contextualMessage,
      buildKnownHardwareTerms(registry)
    );
  const unresolvedHardwareSupportGaps = unresolvedHardwareMentions.map((mention) =>
    `Unknown explicit hardware "${mention.phrase}" is not present in the verified H-eduware hardware registry. Ask for a supported substitute or verified hardware data before synthesis.`
  );
  const unresolvedHardwareAmbiguity = unresolvedHardwareMentions.map((mention) =>
    `Unknown explicit hardware requires clarification: ${mention.phrase}.`
  );
  const fallbackRouteSupportGaps = routeRequiresCompleteBundleOrComposition(contextRouteV2.routeId)
    && selectedBundles.length === 0
    ? ['General supported-hardware fallback cannot authorize validated synthesis without a complete v2 bundle or composition proof.']
    : [];
  const resolvedSupportGaps = unique([
    ...supportGaps,
    ...fallbackRouteSupportGaps,
    ...unresolvedHardwareSupportGaps
  ]);
  const resolvedIntentHints = unresolvedHardwareAmbiguity.length > 0
    ? {
      ...intentHints,
      ambiguity: unique([
        ...intentHints.ambiguity,
        ...unresolvedHardwareAmbiguity
      ])
    }
    : intentHints;
  const intentSpec = extractIntentSignals({
    message,
    locale,
    intentHints: resolvedIntentHints,
    capabilityMatches,
    unsupportedSignals,
    supportGaps: resolvedSupportGaps
  });
  const selectedBundlePartIds = selectedBundles.length > 0
    ? new Set(selectedBundles.flatMap((bundle) =>
      bundle.manifest.allowedParts.length > 0 ? bundle.manifest.allowedParts : bundle.manifest.requiredParts
    ))
    : null;
  // Phase 1 (flag-gated): the legacy filter restricts candidates to the selected bundle's parts,
  // which (a) drops an explicitly-named primary output when a wrong/compositional bundle wins (the
  // OLED bug) and (b) pulls in EVERY surface of a compositional bundle when only a surface matched.
  // In shadow|next, candidates = base parts + request-named (explicit) parts + the bundle's parts,
  // EXCEPT a compositional-context bundle contributes only what the student named (bounded to
  // request-named parts) — so a prototyping/wiring bundle never adds the surfaces they did not ask
  // for. legacy mode keeps the exact current filter.
  const baseCandidateIds = new Set(['arduino-uno', 'breadboard-half']);
  const selectedRouteIsCompositional = contextRouteV2.tier === 'compositional-context';
  const rawCandidateParts = selectCandidateParts(registry, searchedParts, resolvedIntentHints, unsupportedSignals, capabilityMatches, explicitPartIds)
    .filter((part) => {
      if (!selectedBundlePartIds) return true;
      if (pipelineMode === 'legacy') return selectedBundlePartIds.has(part.id);
      if (explicitPartIds.has(part.id) || baseCandidateIds.has(part.id)) return true;
      if (selectedRouteIsCompositional) return false;
      return selectedBundlePartIds.has(part.id);
    });
  const explicitBundlePartIds = explicitOptionalPartIdsForV2(selectedBundles, explicitPartIds);
  let candidateSourceMode: 'selected-bundle' | 'registry-search' | 'composition' = selectedBundles.length > 0
    ? 'selected-bundle'
    : 'registry-search';
  let candidateParts = selectedBundles.length > 0
    ? compactCandidatePartsForV2(rawCandidateParts, selectedBundles, explicitBundlePartIds)
    : rawCandidateParts;
  // Phase 5 (flag-gated, `next` only): make composition selection the candidate authority on the
  // live path — it covers the full corpus (37/37) by taking the top primary capability's parts
  // directly. `shadow` keeps the tier path and observes composition separately; `next` adopts it.
  // Replace (not merge) so a wrongly-included surface from the route path is dropped.
  if (pipelineMode === 'next') {
    const composed = await selectContextByComposition({ message: contextualMessage }, { registrySource });
    if (composed.candidateParts.length > 0) {
      candidateParts = composed.candidateParts;
      candidateSourceMode = 'composition';
    }
  }
  candidateParts = filterCandidatePartsForUnresolvedHardware(candidateParts, unresolvedHardwareMentions);
  const simulationPrimitives = selectedBundles.length > 0
    ? selectSimulationPrimitivesById(allSimulationPrimitives, selectedBundles.flatMap((bundle) => bundle.manifest.simulationPrimitives))
    : selectSimulationPrimitives(allSimulationPrimitives, capabilityMatches, candidateParts);
  const renderFootprints = selectedBundles.length > 0
    ? selectRenderFootprintsForV2(allRenderFootprints, selectedBundles, candidateParts, explicitBundlePartIds)
    : selectRenderFootprints(allRenderFootprints, capabilityMatches, candidateParts);
  const supportBundles = unsupportedSignals.length > 0
    ? []
    : await buildSupportBundleEvidence(capabilityMatches);
  const requiredContextIds = retrievalPlan.sourceIds;

  const contextTrace = buildContextTrace({
    capabilityMatches,
    candidateParts,
    simulationPrimitives,
    renderFootprints,
    requiredContextIds,
    unsupportedSignals,
    supportGaps: resolvedSupportGaps,
    visualLibraryMentions,
    indexVersion: index.version,
    contextRoute,
    retrievalPlan,
    index,
    selectedBundles,
    supportBundles,
    conversationContext
  });
  const contextCoverage = buildContextCoverage({
    contextTrace,
    capabilityMatches,
    candidateParts,
    renderFootprints,
    unsupportedSignals,
    supportGaps: resolvedSupportGaps,
    supportBundles,
    ambiguity: resolvedIntentHints.ambiguity,
    requiredSourceTypes: sourceTypesForPlan(retrievalPlan, index),
    retrievalWarnings: retrievalPlan.warnings
  });
  const promptBlock = renderPromptBlock({
    locale,
    message,
    intentSpec,
    intentHints: resolvedIntentHints,
    capabilityMatches,
    candidateParts,
    simulationPrimitives,
    renderFootprints,
    requiredContextIds,
    unsupportedSignals,
    supportGaps: resolvedSupportGaps,
    visualLibraryMentions,
    selectedBundles,
    supportBundles,
    contextRoute,
    retrievalPlan,
    contextTrace,
    contextCoverage,
    conversationContext
  });

  return ContextPacketSchema.parse({
    locale,
    studentMessage: message,
    intentSpec,
    intentHints: resolvedIntentHints,
    capabilityMatches,
    candidateParts,
    simulationPrimitives,
    renderFootprints,
    requiredContextIds,
    unsupportedSignals,
    supportGaps: resolvedSupportGaps,
    supportBundles,
    contextRoute,
    retrievalPlan,
    contextTrace,
    contextCoverage,
    metadata: buildContextPacketMetadata({
      pipelineMode,
      selectedBundles,
      candidateParts,
      candidateSourceMode,
      explicitPartIds,
      baseCandidateIds,
      unresolvedHardwareMentions,
      fallbackRouteSupportGaps,
      contextRoute,
      supportBundles
    }),
    promptBlock
  });
}

function buildContextPacketMetadata({
  pipelineMode,
  selectedBundles,
  candidateParts,
  candidateSourceMode,
  explicitPartIds,
  baseCandidateIds,
  unresolvedHardwareMentions,
  fallbackRouteSupportGaps,
  contextRoute,
  supportBundles
}: {
  pipelineMode: AgentPipelineMode;
  selectedBundles: ContextBundleV2[];
  candidateParts: PartCapability[];
  candidateSourceMode: 'selected-bundle' | 'registry-search' | 'composition';
  explicitPartIds: Set<string>;
  baseCandidateIds: Set<string>;
  unresolvedHardwareMentions: UnresolvedHardwareMention[];
  fallbackRouteSupportGaps: string[];
  contextRoute: ContextRoute;
  supportBundles: SupportBundleEvidence[];
}) {
  const selectedBundleIds = selectedBundles.map((bundle) => bundle.manifest.bundleId);

  return {
    pipelineMode,
    selectedBundleIds,
    candidateProvenance: candidateParts.map((part) => ({
      partId: part.id,
      source: candidateProvenanceSource({
        partId: part.id,
        candidateSourceMode,
        explicitPartIds,
        baseCandidateIds,
        selectedBundles
      }),
      bundleIds: selectedBundleIdsForPart(part.id, selectedBundles),
      explicit: explicitPartIds.has(part.id)
    })),
    unknownHardwareMentions: unresolvedHardwareMentions.map((mention) => ({
      phrase: mention.phrase,
      normalized: mention.token.toLowerCase(),
      reason: `Unknown ${mention.noun} is not present in the verified hardware registry.`
    })),
    fallbackRoute: fallbackRouteSupportGaps.length > 0
      ? {
        routeId: contextRoute.routeId,
        reason: fallbackRouteSupportGaps[0]
      }
      : null,
    supportBundleStatus: Object.fromEntries(
      supportBundles.map((bundle) => [
        bundle.capabilityId,
        {
          bundleId: bundle.bundleId,
          supportLevel: bundle.supportLevel,
          status: bundle.status,
          missingArtifacts: bundle.missingArtifacts
        }
      ])
    )
  };
}

function candidateProvenanceSource({
  partId,
  candidateSourceMode,
  explicitPartIds,
  baseCandidateIds,
  selectedBundles
}: {
  partId: string;
  candidateSourceMode: 'selected-bundle' | 'registry-search' | 'composition';
  explicitPartIds: Set<string>;
  baseCandidateIds: Set<string>;
  selectedBundles: ContextBundleV2[];
}): 'selected-bundle' | 'composition' | 'registry-search' | 'base' | 'explicit-request' {
  if (explicitPartIds.has(partId)) {
    return 'explicit-request';
  }
  if (baseCandidateIds.has(partId)) {
    return 'base';
  }
  if (candidateSourceMode === 'composition') {
    return 'composition';
  }
  if (selectedBundleIdsForPart(partId, selectedBundles).length > 0) {
    return 'selected-bundle';
  }
  return 'registry-search';
}

function selectedBundleIdsForPart(partId: string, selectedBundles: ContextBundleV2[]) {
  return selectedBundles
    .filter((bundle) => {
      const partIds = bundle.manifest.allowedParts.length > 0
        ? bundle.manifest.allowedParts
        : bundle.manifest.requiredParts;
      return partIds.includes(partId);
    })
    .map((bundle) => bundle.manifest.bundleId);
}

function buildContextualRoutingMessage(input: BuildContextPacketInput) {
  const context = input.conversationContext;
  const replacementTarget = extractExplicitReplacementTarget(input.message);
  if (replacementTarget) {
    return [
      `Current active request: ${replacementTarget}`,
      'Prior unsupported or cancelled goals are inactive and must not be used for capability matching.'
    ].join('\n');
  }

  if (!context) {
    return input.message;
  }

  const currentArtifact = context.currentArtifact;
  const confirmedProposal = isReferentialConfirmation(input.message)
    ? context.pendingSupportedAlternative?.goal ?? extractConfirmedAssistantProposal(context.recentTurns)
    : null;
  if (confirmedProposal) {
    return [
      input.message,
      `Confirmed assistant proposal: ${confirmedProposal}`,
      context.pendingSupportedAlternative?.capabilityIds?.length
        ? `Confirmed supported capability ids: ${context.pendingSupportedAlternative.capabilityIds.join(', ')}`
        : '',
      context.pendingSupportedAlternative?.partIds?.length
        ? `Confirmed supported part ids: ${context.pendingSupportedAlternative.partIds.join(', ')}`
        : '',
      context.lastSupportedGoal ? `Last supported goal: ${context.lastSupportedGoal}` : ''
    ].filter(Boolean).join('\n');
  }

  const lines = [
    input.message,
    context.lastSupportedGoal ? `Last supported goal: ${context.lastSupportedGoal}` : '',
    currentArtifact?.title ? `Current artifact: ${currentArtifact.title}` : '',
    currentArtifact?.circuitSpec?.intent?.primaryGoal ? `Current artifact goal: ${currentArtifact.circuitSpec.intent.primaryGoal}` : '',
    currentArtifact?.circuitSpec?.intent?.input ? `Current artifact input: ${currentArtifact.circuitSpec.intent.input}` : '',
    currentArtifact?.circuitSpec?.intent?.output ? `Current artifact output: ${currentArtifact.circuitSpec.intent.output}` : '',
    currentArtifact?.circuitSpec?.components?.length
      ? `Current artifact parts: ${currentArtifact.circuitSpec.components.map((component) => component.partId).join(', ')}`
      : '',
    context.awaitingBuildConfirmation ? 'The student may be confirming the current draft.' : '',
    context.recentTurns?.length
      ? `Recent conversation: ${context.recentTurns.map((turn) => `${turn.role}: ${turn.text}`).join(' | ')}`
      : ''
  ].filter(Boolean);

  return lines.join('\n');
}

function extractExplicitReplacementTarget(message: string) {
  const text = message.trim();
  if (!text || !hasCancellationIntent(text)) {
    return null;
  }

  const quotedTarget = text.match(/[“"']([^“”"']{3,160})[”"']/)?.[1]?.trim();
  if (quotedTarget) {
    return quotedTarget;
  }

  const englishTarget = text.match(/\b(?:use|switch to|change to|proceed with|start|build)\s+(.+)$/i)?.[1]?.trim();
  if (englishTarget) {
    return cleanReplacementTarget(englishTarget);
  }

  const koreanTarget = text.match(/(?:취소|제외|빼고|말고|없이|그만).*?(버튼.*?(?:회로|led|LED|켜|누르).*)/i)?.[1]?.trim();
  if (koreanTarget) {
    return cleanReplacementTarget(koreanTarget);
  }

  const lower = text.toLowerCase();
  if (/(button|pushbutton|press)/i.test(text) && /led|light/i.test(text)) {
    return 'button controlled LED circuit';
  }
  if (/버튼|누르/.test(text) && /led|LED|불|켜/.test(text)) {
    return '버튼을 누르면 LED가 켜지는 회로';
  }
  if (/(blink|blinking)/i.test(text) && /led|light/i.test(text)) {
    return 'LED blinking circuit';
  }
  if (/깜빡|깜박/.test(text) && /led|LED/.test(text)) {
    return 'LED 깜빡이 회로';
  }
  if (lower.includes('led')) {
    return 'LED circuit';
  }

  return null;
}

function hasCancellationIntent(message: string) {
  return /\b(cancel|exclude|remove|without|instead of|not the|stop using|drop)\b/i.test(message) ||
    /(취소|제외|빼고|말고|없이|그만|아니라|대신)/.test(message);
}

function cleanReplacementTarget(target: string) {
  return target
    .replace(/\b(?:instead|please|now|again)\b/gi, '')
    .replace(/[.?!。！？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function isReferentialConfirmation(message: string) {
  const text = message.trim().toLowerCase();
  if (!text) {
    return false;
  }

  return /^(그래|좋아|응|네|오케이|ok|okay|yes)\b/i.test(text) ||
    /(제안|그대로|그걸로|그 방향|너가|네가|말한|추천).*(진행|하자|해보자|할게|좋아|따를게)/i.test(text) ||
    /(진행|해보자|하자).*(제안|그대로|그걸로|그 방향)/i.test(text);
}

function extractConfirmedAssistantProposal(turns: Array<{ role: 'student' | 'assistant'; text: string }>) {
  const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant')?.text;
  if (!lastAssistant) {
    return null;
  }

  const sentences = lastAssistant
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const proposal = [...sentences].reverse().find((sentence) =>
    /(지원되는|대신|대안|진행할까요|진행하면|다음 회로|추천)/i.test(sentence) &&
    /(arduino|led|저항|버튼|button|buzzer|부저|servo|서보|oled|lcd|깜박|깜빡|on\/off|켜기|끄기)/i.test(sentence)
  ) ?? sentences[sentences.length - 1] ?? lastAssistant;

  return proposal
    .replace(/^.*?(제외하고|빼고|대신)\s*,?\s*/i, '')
    .replace(/^(지원되는\s+대안으로\s+진행하려면|지원되는\s+대안은)\s*/i, '')
    .replace(/\*\*/g, '')
    .slice(0, 500)
    .trim() || null;
}

function buildIntentSignals({
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

async function selectContextRouteV2(input: {
  capabilityMatches: CapabilityGraphEntry[];
  intentSignals: string[];
  ambiguity: boolean;
  unsafe: boolean;
  pipelineMode: AgentPipelineMode;
}): Promise<ContextV2Route> {
  const [index, routes] = await Promise.all([
    loadContextV2Index(),
    loadContextV2Routes()
  ]);
  const v2CapabilityIds = new Set(index.bundles.map((bundle) => bundle.capabilityId));

  // Unsafe requests always take the safety route regardless of capability match
  // (mirrors the former v1 unsupported-safety fallback).
  if (input.unsafe) {
    const safety = routes.routes.find((candidate) => candidate.when.unsafe);
    if (safety) {
      return safety;
    }
  }

  // Tier-aware ordering (Phase 1, flag-gated): a compositional-context route (a prototyping
  // surface, wiring, or passive that merely accompanies a build) must not out-rank the
  // primary-output route the request actually wants. In legacy mode, sort by priority alone (exact
  // current behavior). In shadow|next, rank primary-output routes ahead of compositional-context
  // routes, then by priority — so a compositional route only wins when no primary route matches.
  const tierRank = (route: ContextV2Route) => (route.tier === 'compositional-context' ? 1 : 0);
  const orderedRoutes = input.pipelineMode === 'legacy'
    ? [...routes.routes].sort((a, b) => a.priority - b.priority)
    : [...routes.routes].sort((a, b) => tierRank(a) - tierRank(b) || a.priority - b.priority);

  const matched = orderedRoutes
    .find((candidate) => {
      if (input.unsafe && !candidate.when.unsafe) return false;
      if (candidate.when.ambiguity && !input.ambiguity) return false;
      if (candidate.when.unsafe && !input.unsafe) return false;
      if (
        candidate.when.capabilityIds.length > 0 &&
        !capabilityIdsMatch(candidate.when.capabilityIds, input.capabilityMatches, candidate.when.capabilityMatchMode)
      ) {
        return false;
      }
      if (
        candidate.when.supportLevels.length > 0 &&
        !input.capabilityMatches.some((capability) => candidate.when.supportLevels.includes(capability.supportLevel))
      ) {
        return false;
      }
      if (
        candidate.when.modalities.length > 0 &&
        !candidate.when.modalities.every((modality) => input.intentSignals.includes(modality))
      ) {
        return false;
      }
      if (
        input.capabilityMatches.some((capability) =>
          !candidate.when.capabilityIds.includes(capability.id) &&
          !v2CapabilityIds.has(capability.id)
        )
      ) {
        return false;
      }
      return true;
    });

  // Total router: never returns null — fall back to the general supported-hardware
  // route so the single (v2) router always resolves a request.
  return matched
    ?? routes.routes.find((candidate) => candidate.routeId === 'supported-hardware-general')
    ?? routes.routes[0];
}

function capabilityIdsMatch(
  requiredCapabilityIds: string[],
  capabilityMatches: CapabilityGraphEntry[],
  matchMode: 'any' | 'all' = 'any'
) {
  if (requiredCapabilityIds.length === 0) {
    return true;
  }

  const matchedCapabilityIds = new Set(capabilityMatches.map((capability) => capability.id));
  if (matchMode === 'all') {
    return requiredCapabilityIds.every((capabilityId) => matchedCapabilityIds.has(capabilityId));
  }

  return requiredCapabilityIds.some((capabilityId) => matchedCapabilityIds.has(capabilityId));
}

function routeRequiresCompleteBundleOrComposition(routeId: string) {
  return routeId === 'supported-hardware-general';
}

function buildContextRouteV2({
  route,
  intentSignals,
  capabilityMatches,
  supportGaps
}: {
  route: ContextV2Route;
  intentSignals: string[];
  capabilityMatches: CapabilityGraphEntry[];
  supportGaps: string[];
}): ContextRoute {
  const capabilityIds = capabilityMatches.map((capability) => capability.id);
  const sourceIds = unique([
    ...route.bundleIds.map((bundleId) => `bundle:${bundleId}`),
    ...route.alwaysInclude
  ]);

  return ContextRouteSchema.parse({
    routeId: route.routeId,
    intentSignals,
    capabilityIds,
    sourceIds,
    confidence: route.policyOnly
      ? 0.45
      : supportGaps.length > 0
        ? 0.65
        : capabilityMatches.length > 0
          ? 0.88
          : 0.5,
    reason: route.reason
  });
}

function buildRetrievalPlanV2({
  contextRoute,
  route,
  heavySourceIds,
  index,
  selectedBundles
}: {
  contextRoute: ContextRoute;
  route: ContextV2Route;
  heavySourceIds: string[];
  index: ContextIndex;
  selectedBundles: ContextBundleV2[];
}): RetrievalPlan {
  const sourceIds: string[] = [];
  const warnings: string[] = [];

  for (const sourceId of contextRoute.sourceIds) {
    if (sourceId.startsWith('bundle:')) {
      sourceIds.push(sourceId);
      continue;
    }

    const resolved = resolveContextSourceId(sourceId, index);
    if (!resolved) {
      warnings.push(`Missing context source id referenced by route ${contextRoute.routeId}: ${sourceId}`);
      continue;
    }
    sourceIds.push(resolved.sourceId);
  }

  const selected = new Set(sourceIds);
  const omittedSourceIds = heavySourceIds
    .map((sourceId) => resolveContextSourceId(sourceId, index)?.sourceId ?? sourceId)
    .filter((sourceId) => !selected.has(sourceId));
  const budget = budgetForV2Route(route, selectedBundles);

  return RetrievalPlanSchema.parse({
    sourceIds: unique(sourceIds),
    omittedSourceIds: unique(omittedSourceIds),
    budget,
    maxPromptChars: route.maxPromptChars,
    warnings
  });
}

function budgetForV2Route(route: ContextV2Route, selectedBundles: ContextBundleV2[]): RetrievalPlan['budget'] {
  // An explicit budget on a (bundle-less) policy/fallback route wins, so migrated
  // routes keep their intended budget label instead of defaulting to 'minimal'.
  if (route.budget) {
    return route.budget;
  }
  if (route.policyOnly) {
    return 'minimal';
  }

  const bundleBudgets = selectedBundles.map((bundle) => bundle.manifest.promptBudget);
  if (bundleBudgets.includes('full')) return 'full';
  if (bundleBudgets.includes('data-only')) return 'data-only';
  if (bundleBudgets.includes('summary')) return 'summary';
  return 'minimal';
}

function includesSource(plan: RetrievalPlan, sourceId: string) {
  return plan.sourceIds.includes(sourceId);
}

function sourceTypesForPlan(plan: RetrievalPlan, index: ContextIndex): ContextTraceEntry['sourceType'][] {
  return unique(plan.sourceIds
    .map((sourceId) => sourceId.startsWith('bundle:')
      ? 'data'
      : resolveContextSourceId(sourceId, index)?.sourceType)
    .filter((sourceType): sourceType is ContextTraceEntry['sourceType'] => Boolean(sourceType)));
}

function expandSearchQuery(message: string) {
  const matchedTerms = ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => matchesHardwareKeyword(entry, message))
    .flatMap((entry) => [entry.partId, entry.output, entry.input, entry.protocol, ...entry.terms])
    .filter(Boolean);
  return unique([message, 'arduino', 'breadboard', ...matchedTerms]).join(' ');
}

function detectExplicitHardwarePartIds(
  message: string,
  visualLibraryMentions: VisualLibraryPartMention[]
) {
  const explicitPartIds = new Set(unique([
    ...ACTIVE_HARDWARE_KEYWORDS
      .filter((entry) => matchesHardwareKeyword(entry, message))
      .map((entry) => entry.partId),
    ...visualLibraryMentions
      .map((mention) => mention.agentPartId)
      .filter((partId): partId is string => Boolean(partId))
  ]));

  if (/\b(?:trimmer\s+potentiometer|trimmer\s+pot|trim\s+pot|trimmer)\b|반고정\s*가변저항|트리머\s*가변저항/i.test(message)) {
    explicitPartIds.add('trimmer-pot');
    explicitPartIds.delete('potentiometer-10k');
  }

  if (/\bbreadboard\s+(?:power\s+)?(?:supply|psu)\b|\bpower\s+module\b|브레드보드\s*전원|전원\s*모듈/i.test(message)) {
    explicitPartIds.add('breadboard-psu');
  }
  if (/\b9\s*v\s+battery\b|\b9v\s+(?:battery|clip)\b|9V\s*배터리|배터리\s*클립/i.test(message)) {
    explicitPartIds.add('9v-battery-clip');
  }
  if (/\baa\s+battery\s+holder\b|\b4x\s*aa\b|\b6v\s+battery\s+pack\b|AA\s*배터리\s*홀더|건전지\s*홀더/i.test(message)) {
    explicitPartIds.add('aa-battery-holder');
  }
  if (/\bbarrel\s+jack\b|\bdc\s+jack\b|\badapter\s+jack\b|DC\s*잭|전원\s*잭/i.test(message)) {
    explicitPartIds.add('barrel-jack');
  }
  if (/\b(?:full[-\s]*size\s+breadboard|full\s+breadboard|large\s+breadboard)\b|풀사이즈\s*브레드보드|대형\s*브레드보드/i.test(message)) {
    explicitPartIds.add('breadboard-full');
  }
  if (/\b(?:mini\s+breadboard|small\s+breadboard|compact\s+breadboard)\b|미니\s*브레드보드|소형\s*브레드보드/i.test(message)) {
    explicitPartIds.add('breadboard-mini');
  }
  if (/\b(?:perfboard|5x7\s+perfboard|solderable\s+prototyping\s+board)\b|만능기판|퍼프보드/i.test(message)) {
    explicitPartIds.add('perfboard-5x7');
  }
  if (/\b(?:blank\s+pcb|single[-\s]*sided\s+pcb|copper\s+clad\s+board)\b|빈\s*pcb|단면\s*pcb/i.test(message)) {
    explicitPartIds.add('pcb-blank-single');
  }
  if (/\b(?:proto\s+shield|prototype\s+shield|uno\s+prototype\s+shield|arduino\s+prototype\s+shield)\b|프로토\s*쉴드|아두이노\s*프로토\s*쉴드/i.test(message)) {
    explicitPartIds.add('proto-shield-uno');
  }
  if (/\b(?:male\s+header(?:\s+pins)?|40\s*pin\s+male\s+header|header\s+pins\s+male)\b|수\s*(?:헤더핀|핀헤더)/i.test(message)) {
    explicitPartIds.add('header-male-40pin');
  }
  if (/\b(?:female\s+header(?:\s+pins)?|40\s*pin\s+female\s+header|socket\s+header)\b|암\s*(?:헤더핀|핀헤더)/i.test(message)) {
    explicitPartIds.add('header-female-40pin');
  }
  if (/\b(?:4\s*pin\s+screw\s+terminal|4-pin\s+screw\s+terminal|four\s+pin\s+terminal\s+block|4\s*pin\s+terminal\s+block)\b|4핀\s*(?:스크류\s*터미널|터미널\s*블록)/i.test(message)) {
    explicitPartIds.add('screw-terminal-4pin');
  }
  if (/\b(?:2\s*pin\s+screw\s+terminal|2-pin\s+screw\s+terminal|2\s*pin\s+terminal)\b|2핀\s*(?:스크류\s*터미널|터미널)/i.test(message)) {
    explicitPartIds.add('screw-terminal-2pin');
  }
  if (/\b7805\b|\b5v\s+regulator\b|\bregulated\s+5v\b|7805\s*레귤레이터|전압\s*레귤레이터/i.test(message)) {
    explicitPartIds.add('7805-regulator');
  }
  if (/\b(?:lipo\s+battery|1s\s+lipo|3\.7v\s+lipo|lithium\s+polymer\s+battery)\b|LiPo\s*배터리|리튬폴리머\s*배터리/i.test(message)) {
    explicitPartIds.add('lipo-battery-1s');
  }
  if (/\b(?:ceramic\s+cap(?:acitor)?|decoupling\s+capacitor|bypass\s+capacitor)\b|세라믹\s*(?:콘덴서|캐패시터)/i.test(message)) {
    explicitPartIds.add('ceramic-cap');
  }
  if (/\b(?:electrolytic\s+cap(?:acitor)?|polarized\s+capacitor|filter\s+capacitor)\b|전해\s*(?:콘덴서|캐패시터)/i.test(message)) {
    explicitPartIds.add('electrolytic-cap');
  }
  if (/\b(?:1n4007|rectifier\s+diode|protection\s+diode)\b|정류\s*다이오드/i.test(message)) {
    explicitPartIds.add('diode-1n4007');
  } else if (/\bdiode\b|다이오드/i.test(message)) {
    explicitPartIds.add('diode-1n4007');
  }
  if (/\b(?:schottky\s+diode|1n5819|reverse\s+polarity\s+diode)\b|쇼트키\s*다이오드/i.test(message)) {
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
  if (/\b(?:16\s*mhz\s+crystal|16mhz\s+crystal|quartz\s+crystal|clock\s+crystal|crystal\s+oscillator)\b|(?:16MHz\s*)?크리스탈|클럭\s*크리스탈/i.test(message)) {
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
  if (/\b(?:usb\s+host\s+shield|usb-host\s+shield|max3421e|usb\s+host\s+module)\b|USB\s*호스트/i.test(message)) {
    explicitPartIds.add('usb-host-shield');
  }
  if (/\b(?:74hc595|shift\s+register|sipo|serial-in\s+parallel-out)\b|시프트\s*레지스터/i.test(message)) {
    explicitPartIds.add('74hc595-shift');
  }
  if (/\b(?:pcf8574|i2c\s+expander|gpio\s+expander|io\s+expander|i\/o\s+expander)\b|I2C\s*확장기/i.test(message)) {
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
  if (/\b(?:lm358|op\s*amp|op-amp|operational\s+amplifier)\b|오피앰프|연산\s*증폭기/i.test(message)) {
    explicitPartIds.add('lm358-opamp');
  }
  if (/\b(?:i2c\s+level\s+shifter|level\s+shifter|logic\s+level\s+converter|3\.3v\s+5v\s+logic)\b|레벨\s*시프터/i.test(message)) {
    explicitPartIds.add('i2c-level-shifter');
  }

  return explicitPartIds;
}

function inferIntentHints(message: string, capabilityMatches: CapabilityGraphEntry[] = []) {
  const outputModalities = unique([
    ...capabilityMatches.flatMap((capability) => capability.outputModalities),
    ...ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => entry.output && matchesHardwareKeyword(entry, message))
    .map((entry) => entry.output as string)
  ]);
  const inputModalities = unique([
    ...capabilityMatches.flatMap((capability) => capability.inputModalities),
    ...ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => entry.input && matchesHardwareKeyword(entry, message))
    .map((entry) => entry.input as string)
  ]);
  const protocols = unique([
    ...capabilityMatches.flatMap((capability) => capability.protocols),
    ...ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => matchesHardwareKeyword(entry, message) || message.toLowerCase().includes(entry.protocol))
    .map((entry) => entry.protocol)
  ]);
  const safetyConcerns = detectUnsupportedSignals(message);
  const ambiguity = capabilityMatches.length === 0 && outputModalities.length === 0 && inputModalities.length === 0 && safetyConcerns.length === 0
    ? ['No concrete input or output hardware was identified yet.']
    : [];
  if (needsSpecificTemperatureHumiditySensor(message) && !hasSupportedTemperatureHumiditySensor(capabilityMatches)) {
    ambiguity.push('Temperature/humidity readout needs a specific supported sensor such as DHT11.');
  }

  return {
    outputModalities,
    inputModalities,
    protocols,
    powerAssumptions: safetyConcerns.length > 0
      ? []
      : ['beginner-safe Arduino 5V low-voltage classroom circuit'],
    safetyConcerns,
    ambiguity
  };
}

function needsSpecificTemperatureHumiditySensor(message: string) {
  const asksForTemperatureHumidity = /temperature.*humidity|humidity.*temperature|temp(?:erature)?\s+humidity|온습도|온도.*습도|습도.*온도/i.test(message);
  if (!asksForTemperatureHumidity) {
    return false;
  }
  return !/dht11|dht22|bmp280|tmp36/i.test(message);
}

// A temp/humidity request is only ambiguous when no supported temp/humidity-sensor capability
// has been resolved. Once the capability graph matches one (e.g. "온습도센서" → dht11), the sensor
// is determined and the request should route to that capability instead of asking for clarification.
function hasSupportedTemperatureHumiditySensor(capabilityMatches: CapabilityGraphEntry[]) {
  return capabilityMatches.some(
    (capability) =>
      capability.supportLevel === 'supported' &&
      capability.inputModalities.includes('temperature-humidity-sensor')
  );
}

function extractIntentSignals({
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
  const controllerAssumptions = /arduino|uno/i.test(message) || capabilityMatches.some((capability) => capability.requiredParts.includes('arduino-uno'))
    ? ['arduino-compatible']
    : ['arduino-compatible', 'controller not explicitly specified'];
  const confidence = capabilityMatches.length > 0
    ? supportGaps.length > 0 ? 0.62 : 0.82
    : ambiguities.length > 0 ? 0.35 : 0.5;

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

function inferIntentBehaviors(
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
  const timing = inputModalities.includes('joystick') || inputModalities.includes('analog') || inputModalities.includes('analog-sensor') || inputModalities.includes('potentiometer') || inputModalities.includes('light-sensor')
    ? 'analog'
    : inputModalities.includes('temperature-humidity-sensor')
      ? 'steady-state'
    : inputModalities.includes('matrix-input') || inputModalities.includes('rotary-encoder') || inputModalities.includes('digital-input') || inputModalities.includes('digital-sensor')
      ? 'event-driven'
    : protocols.has('pwm')
      ? 'pwm'
      : inputModalities.includes('button')
        ? 'momentary'
        : 'steady-state';

  return [{
    trigger,
    action,
    timing
  }];
}

function inferLanguage(locale: 'ko' | 'en', message: string): IntentSpecV2['language'] {
  const hasHangul = /[\u3131-\uD79D]/.test(message);
  const hasLatin = /[a-z]/i.test(message);
  if (hasHangul && hasLatin) return 'mixed';
  if (hasHangul) return 'ko';
  if (hasLatin) return 'en';
  return locale;
}

function detectUnsupportedSignals(message: string) {
  const signals = ACTIVE_UNSAFE_PATTERNS
    .filter((entry) => entry.pattern.test(message))
    .map((entry) => entry.signal);
  if (signals.includes('high-voltage mains power')) {
    return signals.filter((signal) => signal !== 'mains protection component');
  }
  return signals;
}

function selectCandidateParts(
  registry: PartCapability[],
  searchedParts: PartCapability[],
  intentHints: ReturnType<typeof inferIntentHints>,
  unsupportedSignals: string[],
  capabilityMatches: CapabilityGraphEntry[],
  explicitPartIds: Set<string> = new Set()
) {
  const byId = new Map(registry.map((part) => [part.id, part]));
  const candidateIds = new Set<string>(['arduino-uno', 'breadboard-half']);

  for (const part of searchedParts) {
    candidateIds.add(part.id);
  }

  for (const entry of ACTIVE_HARDWARE_KEYWORDS) {
    const matchesInferredModality = intentHints.outputModalities.includes(entry.output ?? '')
      || intentHints.inputModalities.includes(entry.input ?? '');
    const isDisplayAlternative = entry.output === 'display' && entry.partId !== 'oled-i2c-096';
    if (explicitPartIds.has(entry.partId) || (matchesInferredModality && !isDisplayAlternative)) {
      candidateIds.add(entry.partId);
    }
  }

  for (const partId of explicitPartIds) {
    candidateIds.add(partId);
  }

  for (const capability of capabilityMatches) {
    for (const partId of [...capability.requiredParts, ...capability.optionalParts]) {
      candidateIds.add(partId);
    }
  }

  for (const id of [...candidateIds]) {
    const part = byId.get(id);
    for (const passive of part?.requiredPassives ?? []) {
      candidateIds.add(passive.partId);
    }
  }

  if (unsupportedSignals.length > 0) {
    return ['arduino-uno', 'breadboard-half']
      .map((id) => byId.get(id))
      .filter((part): part is PartCapability => Boolean(part));
  }

  return [...candidateIds]
    .map((id) => byId.get(id))
    .filter((part): part is PartCapability => Boolean(part));
}

function filterCandidatePartsForUnresolvedHardware(
  parts: PartCapability[],
  unresolvedHardwareMentions: UnresolvedHardwareMention[]
) {
  if (unresolvedHardwareMentions.length === 0) {
    return parts;
  }

  return parts.filter((part) =>
    !unresolvedHardwareMentions.some((mention) => unresolvedMentionMatchesPart(mention, part))
  );
}

function unresolvedMentionMatchesPart(mention: UnresolvedHardwareMention, part: PartCapability) {
  const searchable = [
    part.id,
    part.label,
    part.kind,
    part.family,
    ...part.aliases,
    ...part.capabilities
  ].join(' ').toLowerCase();

  if (mention.noun === 'sensor') {
    return part.kind === 'input' && /sensor|input|rfid|adc|encoder|keypad|switch|button/.test(searchable);
  }

  if (mention.noun === 'driver') {
    return /driver|mosfet|h-?bridge|motor-control|switched-load|step-dir/.test(searchable);
  }

  if (mention.noun === 'display') {
    return part.kind === 'output' && /display|oled|lcd|tft|segment|matrix|neopixel|led-array/.test(searchable);
  }

  if (mention.noun === 'shield') {
    return /shield/.test(searchable);
  }

  if (mention.noun === 'module') {
    return /module/.test(searchable);
  }

  if (mention.noun === 'board') {
    return /board|controller/.test(searchable);
  }

  return false;
}

function compactCandidatePartsForV2(
  parts: PartCapability[],
  selectedBundles: ContextBundleV2[],
  explicitBundlePartIds: Set<string>
) {
  if (explicitBundlePartIds.size === 0) {
    return parts;
  }

  const byId = new Map(parts.map((part) => [part.id, part]));
  const allowedIds = new Set(selectedBundles.flatMap((bundle) =>
    bundle.manifest.allowedParts.length > 0 ? bundle.manifest.allowedParts : bundle.manifest.requiredParts
  ));
  const keepIds = new Set(selectedBundles.flatMap((bundle) => bundle.manifest.requiredParts));

  for (const partId of explicitBundlePartIds) {
    if (allowedIds.has(partId)) {
      keepIds.add(partId);
    }
  }

  for (const bundle of selectedBundles) {
    const bundleRequiredIds = new Set(bundle.manifest.requiredParts);
    const bundleAllowedIds = new Set(
      bundle.manifest.allowedParts.length > 0 ? bundle.manifest.allowedParts : bundle.manifest.requiredParts
    );
    const explicitAlternatives = [...explicitBundlePartIds]
      .map((partId) => byId.get(partId))
      .filter((part): part is PartCapability =>
        part !== undefined
        && bundleAllowedIds.has(part.id)
        && !bundleRequiredIds.has(part.id)
        && (part.kind === 'output' || part.kind === 'input' || part.kind === 'power')
      );
    if (explicitAlternatives.length === 0) {
      continue;
    }

    for (const keptPartId of bundle.manifest.requiredParts) {
      const keptPart = byId.get(keptPartId);
      if (
        keptPart
        && !explicitBundlePartIds.has(keptPart.id)
        && explicitAlternatives.some((part) => canExplicitPartReplaceRequiredPart(part, keptPart))
      ) {
        keepIds.delete(keptPart.id);
      }
    }

    const requiredPassiveIds = new Set(explicitAlternatives.flatMap((part) =>
      part.requiredPassives.map((passive) => passive.partId)
    ));
    const requiredExternalPartIds = new Set(explicitAlternatives.flatMap((part) =>
      part.requiredExternalParts
    ));
    for (const partId of requiredExternalPartIds) {
      if (bundleAllowedIds.has(partId) && byId.has(partId)) {
        keepIds.add(partId);
      }
    }
    for (const keptPartId of bundle.manifest.requiredParts) {
      const keptPart = byId.get(keptPartId);
      if (
        keptPart?.kind === 'passive'
        && !explicitBundlePartIds.has(keptPart.id)
        && !requiredPassiveIds.has(keptPart.id)
      ) {
        keepIds.delete(keptPart.id);
      }
    }
  }

  for (const partId of [...keepIds]) {
    const part = byId.get(partId);
    for (const passive of part?.requiredPassives ?? []) {
      if (allowedIds.has(passive.partId) || byId.has(passive.partId)) {
        keepIds.add(passive.partId);
      }
    }
  }

  return parts.filter((part) => keepIds.has(part.id));
}

function canExplicitPartReplaceRequiredPart(explicitPart: PartCapability, requiredPart: PartCapability) {
  const explicitCategories = replacementCategories(explicitPart);
  const requiredCategories = replacementCategories(requiredPart);
  return explicitCategories.some((category) => requiredCategories.includes(category));
}

function replacementCategories(part: PartCapability) {
  const capabilities = new Set(part.capabilities);
  const categories: string[] = [];

  if (part.family?.startsWith('display') || capabilities.has('display-text')) {
    categories.push('display');
  }
  if (capabilities.has('sound-output')) {
    categories.push('sound-output');
  }
  if (
    part.kind === 'power'
    || part.family === 'power-source-or-connector'
    || capabilities.has('power-rail-source')
    || capabilities.has('low-voltage-power-source')
    || capabilities.has('low-voltage-power-connector')
    || capabilities.has('voltage-regulator')
  ) {
    categories.push('power-rail-source');
  }
  if (capabilities.has('analog-input') && capabilities.has('voltage-divider')) {
    categories.push('analog-divider-input');
  }
  if (
    capabilities.has('protocol-sensor')
    || capabilities.has('i2c-protocol-sensor')
    || capabilities.has('clocked-data-protocol-sensor')
    || capabilities.has('spi-protocol-sensor')
    || capabilities.has('uart-protocol-sensor')
    || capabilities.has('temperature-humidity-sensor')
  ) {
    categories.push('protocol-sensor');
  }
  if (
    part.family === 'light-output'
    || capabilities.has('visual-indicator')
    || capabilities.has('rgb-light-output')
    || capabilities.has('addressable-led-output')
  ) {
    categories.push('light-output');
  }
  if (
    part.family === 'servo-output'
    || (capabilities.has('motion-output') && capabilities.has('pwm-controlled-actuator'))
  ) {
    categories.push('servo-output');
  }

  return categories;
}

function selectSimulationPrimitives(
  primitives: SimulationPrimitive[],
  capabilityMatches: CapabilityGraphEntry[],
  candidateParts: PartCapability[]
) {
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const capabilityPrimitiveIds = unique(capabilityMatches.flatMap((capability) => capability.simulationPrimitives));
  const primitiveIds = capabilityPrimitiveIds.length > 0
    ? capabilityPrimitiveIds
    : unique(candidateParts
      .filter((part) => part.kind !== 'controller')
      .flatMap((part) => part.compatibleSimulationPrimitives));

  return primitiveIds
    .map((id) => byId.get(id))
    .filter((primitive): primitive is SimulationPrimitive => Boolean(primitive));
}

function selectSimulationPrimitivesById(primitives: SimulationPrimitive[], ids: string[]) {
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  return unique(ids)
    .map((id) => byId.get(id))
    .filter((primitive): primitive is SimulationPrimitive => Boolean(primitive));
}

function selectRenderFootprints(
  footprints: Record<string, RenderFootprintEntry>,
  capabilityMatches: CapabilityGraphEntry[],
  candidateParts: PartCapability[]
) {
  const footprintTypes = unique([
    ...capabilityMatches.flatMap((capability) => capability.renderFootprints),
    ...candidateParts.map((part) => part.renderFootprint.type)
  ]);

  return footprintTypes
    .map((type) => footprints[type])
    .filter((footprint): footprint is RenderFootprintEntry => Boolean(footprint));
}

function selectRenderFootprintsByType(
  footprints: Record<string, RenderFootprintEntry>,
  types: string[]
) {
  return unique(types)
    .map((type) => footprints[type])
    .filter((footprint): footprint is RenderFootprintEntry => Boolean(footprint));
}

function selectRenderFootprintsForV2(
  footprints: Record<string, RenderFootprintEntry>,
  selectedBundles: ContextBundleV2[],
  candidateParts: PartCapability[],
  explicitBundlePartIds: Set<string>
) {
  const bundleFootprintTypes = unique(selectedBundles.flatMap((bundle) => bundle.manifest.renderFootprints));
  if (explicitBundlePartIds.size === 0) {
    return selectRenderFootprintsByType(footprints, bundleFootprintTypes);
  }

  const candidateFootprintTypes = new Set(candidateParts.map((part) => part.renderFootprint.type));
  const selectedTypes = bundleFootprintTypes.filter((type) =>
    type === 'wire' || candidateFootprintTypes.has(type)
  );

  return selectRenderFootprintsByType(footprints, selectedTypes);
}

function explicitOptionalPartIdsForV2(
  selectedBundles: ContextBundleV2[],
  explicitPartIds: Set<string>
) {
  const allowedIds = new Set(selectedBundles.flatMap((bundle) =>
    bundle.manifest.allowedParts.length > 0 ? bundle.manifest.allowedParts : bundle.manifest.requiredParts
  ));

  return new Set([...explicitPartIds].filter((partId) =>
    allowedIds.has(partId)
  ));
}

function buildContextTrace({
  capabilityMatches,
  candidateParts,
  simulationPrimitives,
  renderFootprints,
  requiredContextIds,
  unsupportedSignals,
  supportGaps,
  visualLibraryMentions,
  indexVersion,
  contextRoute,
  retrievalPlan,
  index,
  selectedBundles,
  supportBundles,
  conversationContext
}: {
  capabilityMatches: CapabilityGraphEntry[];
  candidateParts: PartCapability[];
  simulationPrimitives: SimulationPrimitive[];
  renderFootprints: RenderFootprintEntry[];
  requiredContextIds: string[];
  unsupportedSignals: string[];
  supportGaps: string[];
  visualLibraryMentions: VisualLibraryPartMention[];
  indexVersion: string;
  contextRoute: ContextRoute;
  retrievalPlan: RetrievalPlan;
  index: ContextIndex;
  selectedBundles: ContextBundleV2[];
  supportBundles: SupportBundleEvidence[];
  conversationContext?: AgentConversationContext;
}): ContextTraceEntry[] {
  const trace: ContextTraceEntry[] = [
    {
      sourceId: 'memory:agent-operating-memory',
      sourceType: 'memory',
      reason: 'Loaded always-on agent operating memory before synthesis.',
      usedFields: ['safety constraints', 'validation-before-simulation'],
      summary: `context-index ${indexVersion}`
    }
  ];

  if (
    conversationContext?.currentArtifact
    || conversationContext?.lastSupportedGoal
    || conversationContext?.pendingSupportedAlternative
  ) {
    trace.push({
      sourceId: 'conversation:current-artifact',
      sourceType: 'memory',
      reason: 'Used the active draft/project artifact to interpret the student follow-up without discarding the raw message.',
      usedFields: [
        conversationContext.currentArtifact ? 'currentArtifact' : '',
        conversationContext.lastSupportedGoal ? 'lastSupportedGoal' : '',
        conversationContext.pendingSupportedAlternative ? 'pendingSupportedAlternative' : '',
        conversationContext.awaitingBuildConfirmation ? 'awaitingBuildConfirmation' : ''
      ].filter(Boolean),
      summary: [
        conversationContext.currentArtifact?.title,
        conversationContext.lastSupportedGoal,
        conversationContext.pendingSupportedAlternative?.goal
      ].filter(Boolean).join(' | ')
    });
  }

  for (const sourceId of retrievalPlan.sourceIds) {
    const entry = resolveContextSourceId(sourceId, index);
    if (!entry) {
      continue;
    }
    trace.push({
      sourceId: entry.sourceId,
      sourceType: entry.sourceType,
      reason: `Selected by context route ${contextRoute.routeId}: ${entry.description}`,
      usedFields: ['sourceId', 'level', 'provides', ...entry.provides],
      summary: `${entry.level} ${entry.budget}`
    });
  }

  for (const bundle of selectedBundles) {
    trace.push({
      sourceId: `bundle:${bundle.manifest.bundleId}`,
      sourceType: 'data',
      reason: `Selected v2 context bundle for ${bundle.manifest.capabilityId}.`,
      usedFields: ['summary', 'supportLevel', 'allowedParts', 'validationRules', 'simulationPrimitives', 'canonicalRefs'],
      summary: `${bundle.manifest.supportLevel} ${bundle.summary.slice(0, 160)}`
    });
  }

  for (const bundle of supportBundles) {
    trace.push({
      sourceId: `sources:support-bundle:${bundle.capabilityId}`,
      sourceType: 'data',
      reason: bundle.promptSummary,
      usedFields: ['bundleId', 'status', 'requiredArtifacts', 'missingArtifacts', 'sourceClaimIds', 'sourceTiers'],
      summary: bundle.status
    });
  }

  for (const capability of capabilityMatches) {
    trace.push({
      sourceId: `data:capability-graph:${capability.id}`,
      sourceType: 'data',
      reason: `Matched student request to ${capability.supportLevel} capability: ${capability.id}.`,
      usedFields: ['supportLevel', 'positivePhrases', 'requiredEvidence', 'negativeEvidence', 'minimumScore', 'requiredParts', 'protocols', 'simulationPrimitives', 'renderFootprints', 'validationRules'],
      summary: supportGaps.some((gap) => gap.includes(capability.id)) ? capability.unsupportedReason : undefined
    });
  }

  for (const mention of visualLibraryMentions) {
    trace.push({
      sourceId: `registry:visual-library:${mention.visualPartId}`,
      sourceType: 'registry',
      reason: mention.status === 'agent-ready'
        ? `Matched visual library part ${mention.visualPartId} to canonical agent part ${mention.agentPartId}.`
        : `Detected ${mention.status} library part ${mention.visualPartId}; supportTier=${mention.supportTier} is not eligible for circuit finalization until simulation-ready evidence is added.`,
      usedFields: ['visualPartId', 'visualPartName', 'visualCategory', 'status', 'supportTier', 'riskLevel', 'family', 'agentPartId', 'reason'],
      summary: mention.reason
    });
  }

  for (const primitive of simulationPrimitives) {
    trace.push({
      sourceId: `data:simulation-primitives:${primitive.id}`,
      sourceType: 'data',
      reason: `Loaded simulation primitive contract: ${primitive.id}.`,
      usedFields: ['requiredNetRoles', 'validationRules', 'currentPathRecipe', 'expectedStateRecipe', 'uiControls', 'animationCues', 'renderOverlays', 'limitations'],
      summary: primitive.explanationTemplate
    });
  }

  for (const footprint of renderFootprints) {
    trace.push({
      sourceId: `rendering:render-footprint:${footprint.type}`,
      sourceType: 'rendering',
      reason: `Loaded render footprint anchors and placement constraints: ${footprint.type}.`,
      usedFields: ['dimensions', 'pinAnchors', 'labelAnchor', 'placement', 'simulationOverlayAnchors']
    });
  }

  for (const part of candidateParts) {
    trace.push({
      sourceId: `registry:part-capabilities:${part.id}`,
      sourceType: 'registry',
      reason: `Matched candidate hardware capability: ${part.label}.`,
      usedFields: ['supportLevel', 'capabilities', 'aliases', 'pins', 'electrical', 'protocols', 'requiredPassives', 'renderFootprint', 'simulationModel', 'compatibleSimulationPrimitives']
    });
  }

  return dedupeTrace(trace);
}

function renderPromptBlock({
  locale,
  message,
  conversationContext,
  intentSpec,
  intentHints,
  capabilityMatches,
  candidateParts,
  simulationPrimitives,
  renderFootprints,
  requiredContextIds,
  unsupportedSignals,
  supportGaps,
  visualLibraryMentions,
  selectedBundles,
  supportBundles,
  contextRoute,
  retrievalPlan,
  contextTrace,
  contextCoverage
}: {
  locale: 'ko' | 'en';
  message: string;
  conversationContext?: AgentConversationContext;
  intentSpec: IntentSpecV2;
  intentHints: ReturnType<typeof inferIntentHints>;
  capabilityMatches: CapabilityGraphEntry[];
  candidateParts: PartCapability[];
  simulationPrimitives: SimulationPrimitive[];
  renderFootprints: RenderFootprintEntry[];
  requiredContextIds: string[];
  unsupportedSignals: string[];
  supportGaps: string[];
  visualLibraryMentions: VisualLibraryPartMention[];
  selectedBundles: ContextBundleV2[];
  supportBundles: SupportBundleEvidence[];
  contextRoute: ContextRoute;
  retrievalPlan: RetrievalPlan;
  contextTrace: ContextTraceEntry[];
  contextCoverage: ContextCoverageReport;
}) {
  const isV2Prompt = selectedBundles.length > 0 || contextRoute.routeId.startsWith('v2-');
  const isV2PolicyOnlyPrompt = isV2Prompt && selectedBundles.length === 0;
  const capabilities = capabilityMatches.map((capability) => isV2PolicyOnlyPrompt
    ? {
      id: capability.id,
      supportLevel: capability.supportLevel,
      unsupportedReason: capability.unsupportedReason
    }
    : {
      id: capability.id,
      supportLevel: capability.supportLevel,
      inputModalities: capability.inputModalities,
      outputModalities: capability.outputModalities,
      requiredParts: capability.requiredParts,
      protocols: capability.protocols,
      simulationPrimitives: capability.simulationPrimitives,
      renderFootprints: capability.renderFootprints,
      validationRules: capability.validationRules,
      unsupportedReason: capability.unsupportedReason
    });
  const parts = isV2Prompt
    ? candidateParts.map((part) => ({
      id: part.id,
      pins: part.pins.map((pin) => `${pin.name}:${pin.role}`),
      protocols: part.protocols,
      requiredPassives: part.requiredPassives.map((passive) => passive.partId)
    }))
    : candidateParts.map((part) => ({
      id: part.id,
      kind: part.kind,
      supportLevel: part.supportLevel,
      capabilities: part.capabilities,
      pins: part.pins.map((pin) => `${pin.name}:${pin.role}`),
      protocols: part.protocols,
      requiredPassives: part.requiredPassives.map((passive) => passive.partId),
      simulationModel: part.simulationModel.type,
      compatibleSimulationPrimitives: part.compatibleSimulationPrimitives,
      renderFootprint: part.renderFootprint.type
    }));
  const primitiveContracts = isV2Prompt
    ? compactPrimitiveContractsForV2(simulationPrimitives)
    : simulationPrimitives.map((primitive) => ({
      id: primitive.id,
      requiredNetRoles: primitive.requiredNetRoles,
      validationRules: primitive.validationRules,
      currentPathRecipe: primitive.currentPathRecipe,
      expectedStateRecipe: primitive.expectedStateRecipe,
      uiControls: primitive.uiControls.map((control) => ({
        id: control.id,
        type: control.type,
        affects: control.affects
      })),
      animationCues: primitive.animationCues,
      renderOverlays: primitive.renderOverlays,
      limitations: primitive.limitations
    }));
  const footprintAnchors = isV2Prompt
    ? compactFootprintsForV2(renderFootprints)
    : renderFootprints.map((footprint) => ({
      type: footprint.type,
      pinAnchors: Object.fromEntries(
        Object.entries(footprint.pinAnchors).map(([pin, anchor]) => [pin, {
          role: anchor.role,
          label: anchor.label
        }])
      ),
      placement: {
        allowedSurfaces: footprint.placement.allowedSurfaces,
        breadboardCompatible: footprint.placement.breadboardCompatible,
        defaultOrientation: footprint.placement.defaultOrientation
      },
      simulationOverlayAnchors: footprint.simulationOverlayAnchors
    }));
  const visualMentions = isV2Prompt
    ? visualLibraryMentions.map((mention) => ({
      visualPartId: mention.visualPartId,
      status: mention.status,
      supportTier: mention.supportTier,
      riskLevel: mention.riskLevel,
      family: mention.family,
      agentPartId: mention.agentPartId
    }))
    : visualLibraryMentions.map((mention) => ({
      visualPartId: mention.visualPartId,
      visualPartName: mention.visualPartName,
      visualCategory: mention.visualCategory,
      status: mention.status,
      supportTier: mention.supportTier,
      riskLevel: mention.riskLevel,
      family: mention.family,
      agentPartId: mention.agentPartId,
      reason: mention.reason
    }));
  const visualMentionSummary = isV2Prompt
    ? visualLibraryMentions.map((mention) =>
      `${mention.visualPartId}:${mention.status}/${mention.supportTier}/${mention.family}${mention.agentPartId ? `->${mention.agentPartId}` : ''}`
    ).join('; ') || 'none'
    : JSON.stringify(visualMentions, null, 2);
  const selectedBundleSummaries = selectedBundles.length > 0
    ? selectedBundles.map((bundle) => [
      `## ${bundle.manifest.bundleId}`,
      bundle.summary,
      `supportLevel=${bundle.manifest.supportLevel}`,
      `allowedParts=${bundle.manifest.allowedParts.join(', ') || 'none'}`,
      `validationRules=${bundle.manifest.validationRules.join(', ') || 'none'}`,
      `simulationPrimitives=${bundle.manifest.simulationPrimitives.join(', ') || 'none'}`
    ].join('\n')).join('\n\n')
    : 'none';
  const supportGapSummary = supportGaps.length > 0
    ? `Capability support gaps: ${(isV2Prompt ? supportGaps.map(compactSupportGapForV2) : supportGaps).join(' | ')}`
    : 'Capability support gaps: none';
  const supportBundleSummary = isV2Prompt
    ? supportBundles.map((bundle) =>
      bundle.status === 'complete'
        ? `${bundle.capabilityId}=complete`
        : `${bundle.capabilityId}=${bundle.status}(${bundle.supportLevel}; missing=${bundle.missingArtifacts.join(', ') || 'bundle'})`
    ).join('; ')
    : supportBundles.map((bundle) => ({
      capabilityId: bundle.capabilityId,
      bundleId: bundle.bundleId,
      supportLevel: bundle.supportLevel,
      status: bundle.status,
      requiredParts: bundle.requiredParts,
      missingArtifacts: bundle.missingArtifacts,
      sourceClaimIds: bundle.sourceClaimIds,
      sourceTiers: bundle.sourceTiers,
      promptSummary: bundle.promptSummary
    }));
  const capabilityBlock = isV2Prompt
    ? compactCapabilityMatchesPromptForV2(capabilityMatches)
    : JSON.stringify(capabilities, null, 2);
  const partBlock = isV2Prompt
    ? compactCandidatePartsPromptForV2(candidateParts)
    : JSON.stringify(parts, null, 2);
  const primitiveBlock = isV2Prompt
    ? compactPrimitivePromptForV2(simulationPrimitives)
    : JSON.stringify(primitiveContracts, null, 2);
  const footprintBlock = isV2Prompt
    ? compactFootprintPromptForV2(renderFootprints)
    : JSON.stringify(footprintAnchors, null, 2);
  const contextRouteBlock = isV2Prompt
    ? `${contextRoute.routeId}; capabilities=${contextRoute.capabilityIds.join(', ') || 'none'}; confidence=${contextRoute.confidence}; reason=${contextRoute.reason}`
    : JSON.stringify(contextRoute, null, 2);
  const retrievalPlanBlock = isV2Prompt
    ? `budget=${retrievalPlan.budget}; maxPromptChars=${retrievalPlan.maxPromptChars}; sources=${retrievalPlan.sourceIds.join(', ') || 'none'}`
    : JSON.stringify(retrievalPlan, null, 2);

  return [
    '## CONTEXT PACKET',
    `Locale: ${locale}`,
    `Student message: ${message}`,
    '',
    'Current artifact context:',
    renderConversationContextForPrompt(conversationContext),
    '',
    'Intent spec:',
    JSON.stringify(intentSpec, null, 2),
    '',
    'Intent hints:',
    JSON.stringify(intentHints, null, 2),
    '',
    'Context route:',
    contextRouteBlock,
    '',
    'Retrieval plan:',
    retrievalPlanBlock,
    '',
    'Selected context bundles:',
    selectedBundleSummaries,
    '',
    'Verified support data:',
    supportBundles.length > 0
      ? isV2Prompt
        ? supportBundleSummary
        : JSON.stringify(supportBundleSummary, null, 2)
      : 'none',
    '',
    unsupportedSignals.length > 0
      ? `Unsupported or unsafe signals detected before synthesis: ${unsupportedSignals.join(', ')}`
      : 'Unsupported or unsafe signals detected before synthesis: none',
    '',
    'Capability graph matches:',
    capabilityBlock,
    '',
    'Visual library hardware mentions:',
    visualMentionSummary,
    '',
    supportGapSummary,
    '',
    'Candidate canonical hardware capabilities:',
    partBlock,
    '',
    'Simulation primitive contracts:',
    primitiveBlock,
    '',
    'Render footprint anchors:',
    footprintBlock,
    '',
    `Required context documents: ${requiredContextIds.join(', ')}`,
    '',
    'Context trace evidence:',
    isV2Prompt
      ? contextTrace.map((entry) => `- ${entry.sourceId}`).join('\n')
      : contextTrace.map((entry) => `- ${entry.sourceId}: ${entry.reason}`).join('\n'),
    '',
    'Context coverage:',
    renderContextCoverageForPrompt(contextCoverage, isV2Prompt),
    '',
    isV2Prompt
      ? 'Synthesize only when candidate capabilities have complete verified support data; otherwise mark unsupportedItems.'
      : 'Guardrail: produce CircuitSpec only from candidate capabilities with complete verified support data and current context constraints. If verified support data is missing or incomplete, mark unsupportedItems or clarificationNeeds. Never upgrade a planned, unsupported, context-known-only, visual-only, or source-incomplete capability to supported.'
  ].join('\n');
}

function renderContextCoverageForPrompt(contextCoverage: ContextCoverageReport, compact = false) {
  const eligibilityReason = compact
    ? compactSupportGapForV2(contextCoverage.synthesisEligibility.reason)
    : contextCoverage.synthesisEligibility.reason;
  return [
    `status=${contextCoverage.status}`,
    `score=${contextCoverage.score}`,
    `sufficientFor=${contextCoverage.sufficientFor.join(', ') || 'none'}`,
    `synthesisEligibility=${contextCoverage.synthesisEligibility.status}: ${eligibilityReason}`,
    `missingSourceTypes=${contextCoverage.missingSourceTypes.join(', ') || 'none'}`,
    `warnings=${(compact ? contextCoverage.warnings.map(compactSupportGapForV2) : contextCoverage.warnings).join(' | ') || 'none'}`
  ].join('\n');
}

function compactSupportGapForV2(value: string) {
  const contextKnownMatch = value.match(/(context-known|pin-known|unsafe-blocked|catalog-only) hardware ([^(]+)\(([^)]+)\)/i);
  if (contextKnownMatch) {
    return `${contextKnownMatch[1]} hardware ${contextKnownMatch[2].trim()} (${contextKnownMatch[3]}) is not simulation-ready`;
  }

  const visualOnlyMatch = value.match(/visual-only hardware ([^(]+)\(([^)]+)\)/i);
  if (visualOnlyMatch) {
    return `visual-only hardware ${visualOnlyMatch[1].trim()} (${visualOnlyMatch[2]}) lacks canonical agent context`;
  }

  const plannedMatch = value.match(/([a-z0-9-]+ is planned)/i);
  if (plannedMatch) {
    return plannedMatch[1];
  }

  const missingBundleMatch = value.match(/([a-z0-9-]+ has no verified hardware support data)/i);
  if (missingBundleMatch) {
    return missingBundleMatch[1];
  }

  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function compactPrimitiveContractsForV2(primitives: SimulationPrimitive[]) {
  return primitives.map((primitive) => ({
    id: primitive.id,
    requiredNetRoles: primitive.requiredNetRoles,
    validationRules: primitive.validationRules,
    limitations: primitive.limitations
  }));
}

function compactFootprintsForV2(footprints: RenderFootprintEntry[]) {
  return footprints.map((footprint) => ({
    type: footprint.type,
    placement: {
      allowedSurfaces: footprint.placement.allowedSurfaces,
      breadboardCompatible: footprint.placement.breadboardCompatible,
      defaultOrientation: footprint.placement.defaultOrientation
    },
    pins: Object.keys(footprint.pinAnchors)
  }));
}

function compactCapabilityMatchesPromptForV2(capabilities: CapabilityGraphEntry[]) {
  if (capabilities.length === 0) {
    return 'none';
  }

  return capabilities.map((capability) => [
    `- ${capability.id}`,
    `support=${capability.supportLevel}`,
    `input=${capability.inputModalities.join(',') || 'none'}`,
    `output=${capability.outputModalities.join(',') || 'none'}`,
    `parts=${capability.requiredParts.join(',') || 'none'}`,
    `primitives=${capability.simulationPrimitives.join(',') || 'none'}`,
    capability.unsupportedReason ? `unsupported=${compactSupportGapForV2(capability.unsupportedReason)}` : ''
  ].filter(Boolean).join('; ')).join('\n');
}

function compactCandidatePartsPromptForV2(parts: PartCapability[]) {
  if (parts.length === 0) {
    return 'none';
  }

  return parts.map((part) => [
    `- ${part.id}`,
    `pins=${part.pins.map((pin) => `${pin.name}:${pin.role}`).join(',') || 'none'}`,
    `protocols=${part.protocols.join(',') || 'none'}`,
    `requires=${part.requiredPassives.map((passive) => passive.partId).join(',') || 'none'}`
  ].join('; ')).join('\n');
}

function compactPrimitivePromptForV2(primitives: SimulationPrimitive[]) {
  if (primitives.length === 0) {
    return 'none';
  }

  return primitives.map((primitive) => [
    `- ${primitive.id}`,
    `netRoles=${primitive.requiredNetRoles.join(',') || 'none'}`,
    `rules=${primitive.validationRules.join(',') || 'none'}`,
    `limits=${primitive.limitations.join(',') || 'none'}`
  ].join('; ')).join('\n');
}

function compactFootprintPromptForV2(footprints: RenderFootprintEntry[]) {
  if (footprints.length === 0) {
    return 'none';
  }

  return footprints.map((footprint) => [
    `- ${footprint.type}`,
    `surface=${footprint.placement.allowedSurfaces.join(',') || 'stage'}`,
    `breadboard=${footprint.placement.breadboardCompatible ? 'yes' : 'no'}`,
    `pins=${Object.keys(footprint.pinAnchors).join(',') || 'none'}`
  ].join('; ')).join('\n');
}

function renderConversationContextForPrompt(context?: AgentConversationContext) {
  if (!context) {
    return 'none';
  }

  const artifact = context.currentArtifact;
  return JSON.stringify({
    awaitingBuildConfirmation: context.awaitingBuildConfirmation,
    lastSupportedGoal: context.lastSupportedGoal ?? null,
    pendingSupportedAlternative: context.pendingSupportedAlternative ?? null,
    currentArtifact: artifact ? {
      source: artifact.source,
      title: artifact.title,
      intent: artifact.circuitSpec?.intent,
      validationStatus: artifact.validationReport?.status,
      simulationStatus: artifact.simulationPlan?.status,
      componentPartIds: artifact.circuitSpec?.components?.map((component) => component.partId) ?? []
    } : null,
    recentTurns: (context.recentTurns ?? []).slice(-4)
  }, null, 2);
}

function buildContextCoverage({
  contextTrace,
  capabilityMatches,
  candidateParts,
  renderFootprints,
  unsupportedSignals,
  supportGaps,
  supportBundles,
  ambiguity,
  requiredSourceTypes,
  retrievalWarnings
}: {
  contextTrace: ContextTraceEntry[];
  capabilityMatches: CapabilityGraphEntry[];
  candidateParts: PartCapability[];
  renderFootprints: RenderFootprintEntry[];
  unsupportedSignals: string[];
  supportGaps: string[];
  supportBundles: SupportBundleEvidence[];
  ambiguity: string[];
  requiredSourceTypes: ContextTraceEntry['sourceType'][];
  retrievalWarnings: string[];
}): ContextCoverageReport {
  const normalizedRequiredSourceTypes = unique(requiredSourceTypes.length > 0 ? requiredSourceTypes : [
    'memory',
    'policy',
    'reference',
    capabilityMatches.length > 0 ? 'data' : null,
    candidateParts.length > 0 ? 'registry' : null,
    renderFootprints.length > 0 && unsupportedSignals.length === 0 ? 'rendering' : null
  ].filter((value): value is ContextTraceEntry['sourceType'] => Boolean(value)));
  const presentSourceTypes = unique(contextTrace.map((entry) => entry.sourceType));
  const present = new Set(presentSourceTypes);
  const missingSourceTypes = normalizedRequiredSourceTypes.filter((sourceType) => !present.has(sourceType));
  const warnings = [
    ...retrievalWarnings.map((warning) => `Context retrieval warning: ${warning}`),
    ...missingSourceTypes.map((sourceType) => `Missing required context source type: ${sourceType}.`),
    ...supportGaps.map((gap) => `Context support gap: ${gap}`),
    ...supportBundles
      .filter((bundle) => bundle.status !== 'complete')
      .map((bundle) => `Verified support data gap: ${bundle.promptSummary}`),
    ...unsupportedSignals.map((signal) => `Unsupported or unsafe request signal: ${signal}.`),
    ...ambiguity.map((item) => `Ambiguous request context: ${item}`)
  ];
  const score = normalizedRequiredSourceTypes.length === 0
    ? 1
    : Number(((normalizedRequiredSourceTypes.length - missingSourceTypes.length) / normalizedRequiredSourceTypes.length).toFixed(3));
  const sufficientFor = classifyCoveragePurposes({
    missingSourceTypes,
    unsupportedSignals,
    supportGaps,
    supportBundles,
    ambiguity,
    capabilityMatches
  });
  const synthesisEligible = sufficientFor.includes('valid_circuit_synthesis');

  return {
    status: synthesisEligible ? 'sufficient' : 'insufficient',
    score,
    sufficientFor,
    synthesisEligibility: {
      status: synthesisEligible ? 'eligible' : 'ineligible',
      reason: synthesisEligible
        ? 'Canonical context coverage is sufficient for validated circuit synthesis.'
        : synthesisIneligibilityReason({ missingSourceTypes, unsupportedSignals, supportGaps, supportBundles, ambiguity })
    },
    requiredSourceTypes: normalizedRequiredSourceTypes,
    presentSourceTypes,
    missingSourceTypes,
    warnings
  };
}

function classifyCoveragePurposes({
  missingSourceTypes,
  unsupportedSignals,
  supportGaps,
  supportBundles,
  ambiguity,
  capabilityMatches
}: {
  missingSourceTypes: ContextTraceEntry['sourceType'][];
  unsupportedSignals: string[];
  supportGaps: string[];
  supportBundles: SupportBundleEvidence[];
  ambiguity: string[];
  capabilityMatches: CapabilityGraphEntry[];
}): ContextCoverageReport['sufficientFor'] {
  const purposes = new Set<ContextCoverageReport['sufficientFor'][number]>();
  const hasSupportGap = supportGaps.length > 0;
  const hasIncompleteSupportedBundle = bundleEvidenceBlocksSynthesis(supportBundles);
  const hasUnsupportedSignal = unsupportedSignals.length > 0;
  const hasUnsafeSignal = unsupportedSignals.some(signalRequiresUnsafeRefusal);
  const hasAmbiguity = ambiguity.length > 0;
  const hasMissingSources = missingSourceTypes.length > 0;
  const hasPartialCapability = capabilityMatches.some((capability) => capability.supportLevel === 'partial');
  const hasPlannedOrUnsupportedCapability = capabilityMatches.some((capability) =>
    capability.supportLevel === 'planned' || capability.supportLevel === 'unsupported'
  );

  if (!hasMissingSources && !hasSupportGap && !hasUnsupportedSignal && !hasAmbiguity && !hasIncompleteSupportedBundle) {
    purposes.add('valid_circuit_synthesis');
  }

  if (hasAmbiguity || hasSupportGap || hasMissingSources || hasIncompleteSupportedBundle) {
    purposes.add('clarification_response');
  }

  if (hasSupportGap || hasUnsupportedSignal || hasPlannedOrUnsupportedCapability || hasIncompleteSupportedBundle) {
    purposes.add('unsupported_response');
  }

  if (hasUnsafeSignal) {
    purposes.add('unsafe_refusal');
  }

  if (hasPartialCapability) {
    purposes.add('partial_visual_only');
  }

  return [...purposes];
}

function signalRequiresUnsafeRefusal(signal: string) {
  return /high-voltage|mains|thermal|hazardous|heater|wall power|mains protection|unsafe LiPo/i.test(signal);
}

function synthesisIneligibilityReason({
  missingSourceTypes,
  unsupportedSignals,
  supportGaps,
  supportBundles,
  ambiguity
}: {
  missingSourceTypes: ContextTraceEntry['sourceType'][];
  unsupportedSignals: string[];
  supportGaps: string[];
  supportBundles: SupportBundleEvidence[];
  ambiguity: string[];
}) {
  const unsafeSignal = unsupportedSignals.find(signalRequiresUnsafeRefusal);
  if (unsafeSignal) {
    return `Unsafe signal detected: ${unsafeSignal}.`;
  }
  if (unsupportedSignals.length > 0) {
    return `Unsupported request signal detected: ${unsupportedSignals[0]}.`;
  }
  if (supportGaps.length > 0) {
    return `Capability support gap blocks validated synthesis: ${supportGaps[0]}.`;
  }
  const blockedBundle = supportBundles.find((bundle) => bundle.supportLevel === 'supported' && bundle.status !== 'complete');
  if (blockedBundle) {
    return `Missing verified support data for synthesis: ${blockedBundle.capabilityId}.`;
  }
  if (missingSourceTypes.length > 0) {
    return `Missing verified context source type for synthesis: ${missingSourceTypes.join(', ')}.`;
  }
  if (ambiguity.length > 0) {
    return `Clarification is required before synthesis: ${ambiguity[0]}.`;
  }
  return 'Context coverage is not sufficient for valid circuit synthesis.';
}

function buildSupportGaps(capabilityMatches: CapabilityGraphEntry[]) {
  return capabilityMatches
    .filter((capability) => capability.supportLevel === 'planned' || capability.supportLevel === 'unsupported' || capability.supportLevel === 'partial')
    .map((capability) => {
      const reason = capability.unsupportedReason ? ` ${capability.unsupportedReason}` : '';
      return `${capability.id} is ${capability.supportLevel}.${reason}`;
    });
}

function buildVisualLibrarySupportGaps(visualLibraryMentions: VisualLibraryPartMention[]) {
  return visualLibraryMentions
    .filter((mention) => mention.status !== 'agent-ready')
    .map((mention) =>
      `${mention.supportTier} hardware ${mention.visualPartId} (${mention.visualPartName}) is visible in the parts library with ${mention.family} context, but lacks simulation-ready evidence for validated wiring, rendering, and current-flow simulation.`
    );
}

function buildExplicitBundlePartSupportGaps({
  selectedBundles,
  explicitPartIds,
  visualLibraryMentions
}: {
  selectedBundles: ContextBundleV2[];
  explicitPartIds: Set<string>;
  visualLibraryMentions: VisualLibraryPartMention[];
}) {
  if (selectedBundles.length === 0 || selectedBundles.some((bundle) => bundle.manifest.capabilityId === 'controller-board-substitution')) {
    return [];
  }

  const explicitControllerParts = visualLibraryMentions
    .filter((mention) =>
      mention.agentPartId
      && explicitPartIds.has(mention.agentPartId)
      && mention.family === 'controller-board'
      && mention.agentPartId !== 'arduino-uno'
    );

  const controllerGaps = explicitControllerParts
    .filter((mention) => selectedBundles.every((bundle) => {
      const allowedParts = bundle.manifest.allowedParts.length > 0
        ? bundle.manifest.allowedParts
        : bundle.manifest.requiredParts;
      return !allowedParts.includes(mention.agentPartId!);
    }))
    .map((mention) =>
      `${mention.agentPartId} (${mention.visualPartName}) is supported as controller-board pin-map and voltage-domain context, but the selected circuit bundle does not yet include validated controller substitution wiring for that board.`
    );

  const selectedPartIds = new Set(selectedBundles.flatMap((bundle) => {
    const allowedParts = bundle.manifest.allowedParts.length > 0
      ? bundle.manifest.allowedParts
      : bundle.manifest.requiredParts;
    return allowedParts;
  }));
  const selectedCapabilityIds = selectedBundles.map((bundle) => bundle.manifest.capabilityId).join(', ') || 'none';
  const controllerGapPartIds = new Set(controllerGaps.map((gap) => gap.match(/^([a-z0-9-]+)/i)?.[1]).filter(Boolean));
  const uncoveredExplicitPartGaps = [...explicitPartIds]
    .filter((partId) => !selectedPartIds.has(partId) && !controllerGapPartIds.has(partId))
    .map((partId) =>
      `${partId} was explicitly requested, but selected context bundle(s) ${selectedCapabilityIds} do not include validated combined wiring for that part.`
    );

  return [...controllerGaps, ...uncoveredExplicitPartGaps];
}

function contextSourceType(id: string): ContextTraceEntry['sourceType'] {
  if (id.endsWith('policy')) return 'policy';
  if (id.includes('safety') || id.includes('unsupported')) return 'policy';
  if (id.includes('validation')) return 'reference';
  if (id.includes('simulation')) return 'reference';
  if (id.includes('rendering')) return 'reference';
  if (id.includes('agent-operating')) return 'memory';
  return 'reference';
}

function contextReason(id: string, unsupportedSignals: string[]) {
  const reasons: Record<string, string> = {
    'agent-operating-memory': 'Applied always-loaded agent safety and orchestration memory.',
    'safety-policy': 'Applied low-voltage classroom safety constraints before circuit synthesis.',
    'board-topology': 'Grounded Arduino and breadboard topology assumptions.',
    'protocol-rules': 'Restricted wiring to supported protocol and pin-role constraints.',
    'validation-rules': 'Prepared deterministic validation failure modes and repair priorities.',
    'simulation-recipes': 'Prepared current-flow and behavior simulation recipes.',
    'rendering-footprints': 'Prepared supported render footprint constraints.',
    'simulation-truthfulness-policy': 'Prevented overclaiming beyond educational simulation support.',
    'unsupported-request-policy': 'Prepared explicit unsupported handling for request signals.',
    'electrical-limits': 'Applied voltage and current limits.'
  };
  if (id === 'safety-policy' && unsupportedSignals.length > 0) {
    return `Detected unsafe request signals: ${unsupportedSignals.join(', ')}.`;
  }
  return reasons[id] ?? `Loaded context rule ${id}.`;
}

function contextUsedFields(id: string) {
  const fields: Record<string, string[]> = {
    'safety-policy': ['unsafe keywords', 'low-voltage boundary'],
    'board-topology': ['breadboard rails', 'Arduino power pins', 'common ground'],
    'protocol-rules': ['GPIO', 'I2C', 'PWM'],
    'validation-rules': ['missing parts', 'pin errors', 'shorts', 'ground return'],
    'simulation-recipes': ['current paths', 'expected states', 'animation cues'],
    'rendering-footprints': ['footprint type', 'pin anchors', 'visual constraints'],
    'simulation-truthfulness-policy': ['supported approximations', 'limitations'],
    'unsupported-request-policy': ['unsupported items', 'safe alternatives'],
    'electrical-limits': ['voltage range', 'current range']
  };
  return fields[id] ?? ['summary'];
}

function hasAnyTerm(message: string, terms: string[]) {
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

function matchesHardwareKeyword(entry: typeof ACTIVE_HARDWARE_KEYWORDS[number], message: string) {
  if (!hasAnyTerm(message, entry.terms)) {
    return false;
  }
  if (
    entry.partId === 'led-5mm'
    && /\b(rgb|ws2812b?|neopixel|laser|strip|matrix|max7219|8x8|led\s+matrix)\b|공통\s*캐소드|레이저|스트립|매트릭스/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'piezo-buzzer'
    && /\b(active\s+buzzer|fixed\s+tone\s+buzzer|buzzer\s+module|sound\s+sensor)\b|액티브\s*부저|능동\s*부저|소리\s*센서/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'button-tactile'
    && /\b(limit\s+switch|dip\s+switch|keypad|matrix\s+keypad|membrane\s+keypad|relay|relay\s+module|switch\s+(?:a\s+)?(?:low[-\s]?voltage\s+)?(?:load|led\s+load|motor|lamp))\b|리미트\s*스위치|DIP\s*스위치|딥\s*스위치|키패드|매트릭스\s*키패드|멤브레인\s*키패드|릴레이/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'micro-servo'
    && /\b(mg996r|metal\s+gear\s+servo|high\s+torque\s+servo|large\s+servo)\b|MG996R\s*서보|고토크\s*서보/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'dc-motor-130'
    && /\b(servo|stepper|28byj|nema\s*17|nema17)\b|서보|스테퍼|스텝\s*모터/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'fsr-pressure'
    && /\b(bmp280|bme280|barometric|air\s+pressure|atmospheric\s+pressure)\b/i.test(message)
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
  if (entry.partId === 'lcd-16x2' && /\b(nokia\s*5110|pcd8544|tft|spi\s+tft|e-?paper|e-?ink|epaper)\b/i.test(message)) {
    return false;
  }
  if (entry.partId === 'lcd-20x4' && /\b16\s*x\s*2\b|16x2/i.test(message)) {
    return false;
  }
  if (
    entry.partId === '7seg-4digit-tm1637'
    && /\b(single|one|1)\s*-?\s*digit\b|bare\s+7\s*-?\s*segment|7seg-1digit|1자리/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === '7seg-1digit'
    && /\b(tm1637|4\s*-?\s*digit|4자리|four\s*-?\s*digit|max7219|matrix)\b/i.test(message)
  ) {
    return false;
  }
  if (
    entry.partId === 'oled-i2c-096'
    && /\b(1\.3|1\.3\s*inch|oled-13|large\s+oled|16\s*x\s*2|20\s*x\s*4|16x2|20x4|lcd|tm1637|max7219|7\s*segment|7-segment|seven\s+segment|neopixel|ws2812|led\s*matrix|8x8|spi|tft|nokia\s*5110|pcd8544|e-?paper|e-?ink|sck|cs)\b|1\.3\s*인치|큰\s*OLED|(?:7|세븐)\s*세그먼트/i.test(message)
  ) {
    return false;
  }
  if (entry.partId !== 'oled-i2c-096' || !/\bscreen\b/i.test(message)) {
    return true;
  }
  return hasAnyTerm(message, ['oled', 'display', 'text display', 'show text', 'display message']);
}

// Re-grounding: promote a student-selected capability to the top match so the packet grounds to it.
// Ignores unknown/unsupported ids (returns matches unchanged), so a stale selection never throws.
async function applyForcedCapabilityMatch(
  matches: CapabilityGraphEntry[],
  forceCapabilityId?: string
): Promise<CapabilityGraphEntry[]> {
  if (!forceCapabilityId) {
    return matches;
  }
  const graph = await loadCapabilityGraph();
  const forced = graph.find((entry) => entry.id === forceCapabilityId && entry.supportLevel === 'supported');
  if (!forced) {
    return matches;
  }
  return [forced, ...matches.filter((match) => match.id !== forced.id)];
}

function pruneCapabilityMatchesForExplicitHardware(matches: CapabilityGraphEntry[], message: string) {
  if (
    /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b|콘센트|가정용\s*전원|교류|220볼트|110볼트/i.test(message)
  ) {
    return matches.filter((match) => match.supportLevel === 'unsupported' || match.id === 'high-voltage-load-control');
  }

  if (
    /\b(dc\s*motor|motor|fan|pump|solenoid)\b.*\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b|\b(directly|direct|without\s+a?\s*(driver|mosfet|transistor|h-?bridge)|no\s+(driver|mosfet|transistor|h-?bridge))\b.*\b(dc\s*motor|motor|fan|pump|solenoid)\b/i.test(message)
  ) {
    return matches.filter((match) =>
      !['hbridge-motor-output', 'servo-motion-output'].includes(match.id)
    );
  }

  const ids = new Set(matches.map((match) => match.id));
  if (
    /\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b.*\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b|\b(?:calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power)\b.*\b(?:ads1115|mcp3008|adc|lm358|op-?amp|operational\s+amplifier)\b|(?:ADC|오피앰프|연산\s*증폭기).*?(?:정밀|보정|인증|정확한\s*전압|의료)|(?:정밀|보정|인증|정확한\s*전압|의료).*?(?:ADC|오피앰프|연산\s*증폭기)/i.test(message)
    || /\b(?:ne555|555\s+timer|timer\s+ic)\b.*\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b|\b(?:exact|calibrated|precise|precision)\b.*\b(?:frequency|hz|duty\s*cycle|waveform)\b.*\b(?:ne555|555\s+timer|timer\s+ic)\b|(?:NE555|555\s*타이머).*?(?:정확|정밀|보정).*?(?:주파수|듀티|파형)/i.test(message)
    || /\b(?:level\s+shifter|logic\s+level\s+converter)\b.*\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b|\b(?:power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b.*\b(?:level\s+shifter|logic\s+level\s+converter)\b|레벨\s*시프터.*?(?:전원\s*공급|레귤레이터|전류\s*증폭)/i.test(message)
  ) {
    return matches.filter((match) => match.supportLevel === 'unsupported');
  }
  if (
    ids.has('logic-interface-context')
    && /\b(?:74hc595|shift\s+register|pcf8574|i2c\s+expander|gpio\s+expander|ads1115|mcp3008|external\s+adc|spi\s+adc|i2c\s+adc|ne555|555\s+timer|lm358|op-?amp|operational\s+amplifier|level\s+shifter|logic\s+level\s+converter)\b|시프트\s*레지스터|I2C\s*확장기|ADC\s*모듈|타이머\s*IC|오피앰프|레벨\s*시프터/i.test(message)
  ) {
    return matches.filter((match) =>
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
    ids.has('low-voltage-power-rail')
    && /\b(power\s+rail|breadboard\s+psu|breadboard\s+power|power\s+module|5\s*v\s+rail|3\.3\s*v\s+rail|9\s*v\s+battery|aa\s+battery|lipo\s+battery|1s\s+lipo|barrel\s+jack|dc\s+jack|2\s*pin\s+screw\s+terminal|2-pin\s+screw\s+terminal|7805|regulator|regulated\s+5\s*v)\b|전원\s*레일|브레드보드\s*전원|전원\s*모듈|9V\s*배터리|AA\s*배터리|LiPo\s*배터리|DC\s*잭|2핀\s*스크류\s*터미널|7805\s*레귤레이터/i.test(message)
    && !/\b(h\s*-?\s*bridge|l298n|l293d|motor\s+driver|relay|stepper|28byj|nema\s*17|nema17|uln2003|a4988|drv8825)\b|H브리지|릴레이|스테퍼|스텝\s*모터/i.test(message)
  ) {
    return matches.filter((match) =>
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
    (ids.has('passive-protection-context') || ids.has('timing-passive-context'))
    && /\b(capacitor|cap|diode|zener|schottky|polyfuse|fuse|inductor|coil|crystal|quartz)\b|콘덴서|캐패시터|다이오드|제너|쇼트키|폴리퓨즈|퓨즈|인덕터|코일|크리스탈/i.test(message)
  ) {
    return matches.filter((match) =>
      ![
        'digital-light-output',
        'button-controlled-light-output',
        'sound-alert-output'
      ].includes(match.id)
    );
  }
  if (
    ids.has('matrix-input-display-readout')
    && /\b(dip\s+switch|keypad|matrix\s+keypad|membrane\s+keypad)\b|DIP\s*스위치|딥\s*스위치|키패드|매트릭스\s*키패드|멤브레인\s*키패드/i.test(message)
    && !/\b(led|light|lamp|neopixel|ws2812|rgb|glow|blink)\b|LED|불|빛|조명|깜빡/i.test(message)
  ) {
    return matches.filter((match) =>
      !['button-controlled-light-output', 'digital-light-output'].includes(match.id)
    );
  }
  if (
    ids.has('sound-alert-output')
    && /\b(buzzer|beep|tone|sound|piezo)\b|부저|삐|소리/i.test(message)
    && !/\b(led|light|lamp|neopixel|ws2812|rgb|glow|blink)\b|LED|불|빛|조명|깜빡/i.test(message)
  ) {
    return matches.filter((match) =>
      !['button-controlled-light-output', 'digital-light-output'].includes(match.id)
    );
  }
  if (
    (ids.has('prototyping-surface-context') || ids.has('connector-wiring-context'))
    && /\b(breadboard|perfboard|pcb|proto(?:type)?\s+shield|header|terminal\s+block|screw\s+terminal|connector)\b|브레드보드|만능기판|기판|프로토\s*쉴드|헤더핀|핀헤더|터미널|커넥터/i.test(message)
  ) {
    return matches.filter((match) =>
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
    ids.has('bare-seven-segment-display-output')
    && /\b(7seg-1digit|bare\s+(?:7|seven)\s*-?\s*segment|(single|one|1)\s*-?\s*digit\s+(?:7|seven)\s*-?\s*segment|per\s+segment\s+resistor|decimal\s+point)\b|1자리\s*(?:7|세븐)\s*세그먼트|한\s*자리\s*(?:7|세븐)\s*세그먼트/i.test(message)
  ) {
    return matches.filter((match) =>
      !['display-text-output', 'digital-light-output', 'led-array-display-output'].includes(match.id)
    );
  }
  if (
    ids.has('spi-display-output')
    && /\b(spi|tft|nokia\s*5110|pcd8544|e-?paper|e-?ink|epaper|sck|cs)\b/i.test(message)
  ) {
    return matches.filter((match) => match.id !== 'display-text-output');
  }
  if (
    [...ids].some((id) => [
      'dht22-temperature-humidity-display',
      'i2c-sensor-display-readout',
      'clocked-data-sensor-display-readout',
      'spi-sensor-display-readout',
      'uart-sensor-display-readout',
      'uart-communication-module-readout',
      'spi-communication-module-readout',
      'rs485-communication-module-readout'
    ].includes(id))
    && /\b(dht22|bmp280|mpu6050|mpu-6050|hmc5883l|hx711|load\s*cell|gps|neo-?6m|rc522|rfid|max30102|esp-?01|hc-?05|bluetooth|wifi|sim800l|gsm|lora|ra-?02|nrf24l01?|mcp2515|can\s+bus|rs-?485|max485|usb\s+host)\b|로드셀|무게\s*센서|GPS|RFID|맥박\s*센서|블루투스|와이파이|로라|무선\s*모듈|CAN\s*모듈|RS485|USB\s*호스트/i.test(message)
  ) {
    return matches.filter((match) =>
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
  if (
    ids.has('servo-motion-output')
    && /\bservo\b|서보/i.test(message)
  ) {
    return matches.filter((match) => match.id !== 'low-side-switched-load-output');
  }
  if (
    ids.has('low-side-switched-load-output')
    && /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b|콘센트|가정용\s*전원|교류|220볼트|110볼트/i.test(message)
  ) {
    return matches.filter((match) => match.id !== 'low-side-switched-load-output');
  }
  if (
    ids.has('hbridge-motor-output')
    && /\b(h\s*-?\s*bridge|l298n|l293d|forward\s+reverse|direction\s+control)\b|H브리지|정역회전/i.test(message)
  ) {
    return matches.filter((match) =>
      !['low-side-switched-load-output', 'servo-motion-output', 'stepper-motor-output'].includes(match.id)
    );
  }
  if (
    ids.has('relay-low-voltage-output')
    && /\b(relay|relay\s+module|relay\s+board)\b|릴레이/i.test(message)
  ) {
    return matches.filter((match) =>
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
    ids.has('stepper-motor-output')
    && /\b(stepper|28byj|nema\s*17|nema17|uln2003|a4988|drv8825)\b|스테퍼|스텝\s*모터/i.test(message)
  ) {
    return matches.filter((match) =>
      !['low-side-switched-load-output', 'servo-motion-output'].includes(match.id)
    );
  }
  return matches;
}

function dedupeTrace(trace: ContextTraceEntry[]) {
  const seen = new Set<string>();
  return trace.filter((entry) => {
    if (seen.has(entry.sourceId)) {
      return false;
    }
    seen.add(entry.sourceId);
    return true;
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}
