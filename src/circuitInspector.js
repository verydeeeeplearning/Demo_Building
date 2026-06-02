import { t } from './i18n.js';

const QUESTION_PRESETS = {
  ko: {
    connection: [
      '이 선이 없으면 어떻게 돼?',
      '전류는 여기서 어떻게 흘러?',
      '이 연결을 어떻게 확인해?'
    ],
    part: [
      '이 부품은 무슨 역할이야?',
      '어떤 핀이 중요해?',
      '실행하면 이 부품은 어떻게 변해?'
    ],
    circuit: [
      '전류 흐름을 단계별로 설명해줘',
      '이 회로에서 가장 중요한 연결은 뭐야?',
      '초보자가 실수하기 쉬운 부분은 뭐야?'
    ]
  },
  en: {
    connection: [
      'What happens if this wire is missing?',
      'How does current flow here?',
      'How can I check this connection?'
    ],
    part: [
      'What does this part do?',
      'Which pins matter most?',
      'What changes when I press Run?'
    ],
    circuit: [
      'Explain the current flow step by step.',
      'Which connection matters most?',
      'What mistake would a beginner make here?'
    ]
  }
};

export function describeCircuitTarget(circuit, rawTarget, locale = 'ko') {
  const normalizedLocale = normalizeLocale(locale);
  if (!rawTarget) {
    return describeWholeCircuit(circuit, normalizedLocale);
  }

  if (rawTarget.type === 'connection' || rawTarget.kind === 'connection') {
    const connectionId = rawTarget.connectionId || rawTarget.id;
    const connection = circuit.connections.find((item) => item.id === connectionId);
    if (connection) {
      return describeConnection(circuit, connection, normalizedLocale);
    }
  }

  if (rawTarget.type === 'part' || rawTarget.kind === 'part') {
    const partId = rawTarget.partId || rawTarget.id;
    const part = circuit.parts.find((item) => item.id === partId);
    if (part) {
      return enrichTutorTarget(describePart(circuit, part, normalizedLocale), normalizedLocale);
    }
  }

  return describeWholeCircuit(circuit, normalizedLocale);
}

export function answerTutorQuestion({ circuit, target, question, locale = 'ko', running = false }) {
  const normalizedLocale = normalizeLocale(locale);
  const selected = withSimulationContext(
    enrichTutorTarget(target || describeWholeCircuit(circuit, normalizedLocale), normalizedLocale),
    circuit
  );
  const prompt = String(question || '').trim();
  const lower = prompt.toLowerCase();
  const wantsMissing = /없|없니|missing|remove|without|빠지|전선|연결.*안|wire|wiring/.test(lower);
  const wantsCurrent = /전류|current|flow|흐|경로/.test(lower);
  const wantsCheck = /확인|check|test|검사|검증/.test(lower);
  const wantsRun = /실행|run|simulate|시뮬/.test(lower);

  if ((wantsCurrent || wantsRun) && hasBlockedSimulation(selected)) {
    return {
      message: blockedSimulationAnswer(selected, normalizedLocale),
      grounding: groundingFor(selected),
      suggestedQuestions: selected.questions
    };
  }

  if (normalizedLocale === 'en') {
    return {
      message: buildEnglishAnswer(selected, { wantsMissing, wantsCurrent, wantsCheck, wantsRun, running }),
      grounding: groundingFor(selected),
      suggestedQuestions: selected.questions
    };
  }

  return {
    message: buildKoreanAnswer(selected, { wantsMissing, wantsCurrent, wantsCheck, wantsRun, running }),
    grounding: groundingFor(selected),
    suggestedQuestions: selected.questions
  };
}

function describeWholeCircuit(circuit, locale) {
  const parts = circuit.parts.filter((part) => !part.libraryOnly);
  const connectionLabels = circuit.connections.map((connection) => connection.education.label).join(', ');
  const profile = circuitBehaviorProfile(circuit, parts, locale);
  return {
    id: 'circuit:overview',
    type: 'circuit',
    label: circuit.title,
    title: locale === 'ko' ? '전체 회로' : 'Whole circuit',
    summary: locale === 'ko'
      ? `${parts.map((part) => part.label).join(', ')}가 ${connectionLabels}로 연결된 수업용 회로입니다.`
      : `A lesson circuit where ${parts.map((part) => part.label).join(', ')} are connected through ${connectionLabels}.`,
    detail: profile.detail,
    why: profile.why,
    missing: profile.missing,
    questions: QUESTION_PRESETS[locale].circuit
  };
}

function circuitBehaviorProfile(circuit, parts, locale) {
  const circuitText = `${circuit.title} ${circuit.runText} ${parts.map((part) => `${part.type} ${part.label}`).join(' ')}`.toLowerCase();
  const hasAnalogDimmer = /potentiometer|가변저항|knob|dimmer|brightness|pwm/.test(circuitText);
  const hasLightSensor = /photoresistor|ldr|light sensor|조도|dark|어두/.test(circuitText);
  const hasDistanceSensor = /ultrasonic|hc-sr04|distance sensor|거리 센서|초음파|distance:|cm/.test(circuitText);
  const hasTemperatureHumiditySensor = /dht11|temperature humidity|temperature and humidity|온습도|온도.*습도|humidity.*temperature/.test(circuitText);
  const hasLed = /(^|[^a-z])led([^a-z]|$)|light|blink|깜빡|엘이디/.test(circuitText);
  const hasDisplay = /oled|display|screen|화면|디스플레이/.test(circuitText);

  if (hasAnalogDimmer) {
    return locale === 'ko'
      ? {
          detail: '실행하면 가변저항의 아날로그 값이 Arduino A0로 들어가고, Arduino가 PWM 출력 비율을 바꿔 LED 밝기를 조절합니다.',
          why: '가변저항 전원/GND/OUT, A0 입력, PWM 출력, 직렬 저항, LED GND return이 모두 맞아야 밝기 조절 경로를 안전하게 검증할 수 있습니다.',
          missing: '가변저항 신호선이나 PWM-저항-LED-GND 경로 중 하나라도 빠지면 밝기 조절을 검증하거나 전류 흐름을 보여 줄 수 없습니다.'
        }
      : {
          detail: 'When Run is pressed, the potentiometer analog value reaches Arduino A0 and the Arduino changes the PWM duty cycle to adjust LED brightness.',
          why: 'The potentiometer power/GND/OUT pins, A0 input, PWM output, series resistor, and LED GND return must all match to validate safe brightness control.',
          missing: 'If the analog signal or PWM-resistor-LED-GND path is missing, the app cannot validate brightness control or show the current flow.'
        };
  }

  if (hasLightSensor) {
    return locale === 'ko'
      ? {
          detail: '실행하면 조도 센서의 아날로그 값이 Arduino A0로 들어가고, 어두움 기준을 넘으면 LED 출력 경로가 켜집니다.',
          why: '센서 전원/GND/AO, A0 입력, 임계값 동작, 직렬 저항, LED GND return이 모두 맞아야 안전한 센서 기반 출력이 됩니다.',
          missing: '센서 신호선이나 LED 전류 경로가 빠지면 어두울 때 켜지는 동작과 전류 흐름을 검증할 수 없습니다.'
        }
      : {
          detail: 'When Run is pressed, the light sensor analog value reaches Arduino A0; when it crosses the dark threshold, the LED output path turns on.',
          why: 'Sensor power/GND/AO, A0 input, threshold behavior, the series resistor, and LED GND return must all match for a safe sensor-triggered output.',
          missing: 'If the sensor signal or LED current path is missing, the dark-triggered behavior and current flow cannot be validated.'
        };
  }

  if (hasDistanceSensor) {
    return locale === 'ko'
      ? {
          detail: '실행하면 Arduino가 HC-SR04의 TRIG 핀에 짧은 펄스를 보내고, ECHO 펄스를 D2에서 읽어 거리값을 계산한 뒤 OLED에 표시합니다.',
          why: '센서 5V/GND, TRIG 출력, ECHO 입력, OLED 전원/GND/SDA/SCL이 모두 맞아야 거리 읽기와 표시 업데이트를 신뢰할 수 있습니다.',
          missing: 'TRIG, ECHO, 공통 GND, 또는 OLED I2C 연결 중 하나라도 빠지면 거리값을 읽거나 화면에 표시하는 시뮬레이션을 검증할 수 없습니다.'
        }
      : {
          detail: 'When Run is pressed, Arduino sends a short pulse to the HC-SR04 TRIG pin, reads the ECHO pulse on D2, calculates a distance value, and shows it on the OLED.',
          why: 'Sensor 5V/GND, trigger output, echo input, and OLED VCC/GND/SDA/SCL must all match before the distance readout can be trusted.',
          missing: 'If TRIG, ECHO, common GND, or the OLED I2C wiring is missing, the app cannot validate the distance reading or display update.'
        };
  }

  if (hasTemperatureHumiditySensor) {
    return locale === 'ko'
      ? {
          detail: '실행하면 Arduino가 DHT11의 DAT 단일 데이터선을 읽고, 온도와 습도 값을 OLED에 업데이트합니다.',
          why: 'DHT11 5V/GND/DAT, 공통 GND, OLED 전원/GND/SDA/SCL이 모두 맞아야 센서 읽기와 화면 표시를 신뢰할 수 있습니다.',
          missing: 'DAT, 공통 GND, 또는 OLED I2C 연결 중 하나라도 빠지면 온습도 값을 읽거나 화면에 표시하는 시뮬레이션을 검증할 수 없습니다.'
        }
      : {
          detail: 'When Run is pressed, Arduino reads the DHT11 DAT single-wire data line and updates temperature and humidity on the OLED.',
          why: 'DHT11 5V/GND/DAT, common ground, and OLED VCC/GND/SDA/SCL must all match before the readout can be trusted.',
          missing: 'If DAT, common ground, or the OLED I2C wiring is missing, the app cannot validate the temperature/humidity readout or display update.'
        };
  }

  if (hasLed && !hasDisplay) {
    return locale === 'ko'
      ? {
          detail: '실행하면 Arduino 출력 핀이 HIGH/LOW로 바뀌고, 전류가 저항과 LED를 지나 GND로 돌아가 LED가 깜빡입니다.',
          why: '출력 핀, 직렬 저항, LED 극성, GND return이 모두 맞아야 안전한 전류 경로가 됩니다.',
          missing: '전선 하나라도 빠지면 출력 핀에서 저항과 LED를 지나 GND로 돌아가는 닫힌 경로가 끊겨 LED가 켜지지 않거나 전류 흐름을 검증할 수 없습니다.'
        }
      : {
          detail: 'When Run is pressed, the Arduino output alternates HIGH and LOW so current passes through the resistor and LED, then returns to GND.',
          why: 'The output pin, series resistor, LED polarity, and GND return must all match to create a safe current path.',
          missing: 'If any required wire is missing, the closed path from output pin through resistor and LED back to GND is broken, so the LED may not turn on and current flow cannot be validated.'
        };
  }

  if (hasDisplay) {
    return locale === 'ko'
      ? {
          detail: `실행하면 표시 장치가 ${circuit.runText}를 보여 주고, 전원 경로와 신호 경로가 함께 동작합니다.`,
          why: '전원, GND, 데이터 신호가 모두 맞아야 표시 장치가 안정적으로 켜지고 내용을 받을 수 있습니다.',
          missing: '필수 연결 하나라도 빠지면 표시 장치가 꺼지거나 업데이트되지 않거나 불안정하게 동작할 수 있습니다.'
        }
      : {
          detail: `When Run is pressed, the display shows ${circuit.runText}; the power and signal paths work together.`,
          why: 'Power, ground, and data signals are all required for the display to turn on and receive content.',
          missing: 'If one required connection is missing, the display may stay off, fail to update, or behave unstably.'
        };
  }

  return locale === 'ko'
    ? {
        detail: '실행하면 검증된 연결과 시뮬레이션 계획에 따라 부품 상태와 전류 흐름을 확인합니다.',
        why: '전원, 신호, GND 경로가 회로 목적에 맞게 닫혀 있어야 동작을 믿고 설명할 수 있습니다.',
        missing: '필수 연결 하나라도 빠지면 닫힌 회로가 깨져 의도한 동작이나 전류 흐름을 검증할 수 없습니다.'
      }
    : {
        detail: 'When Run is pressed, the validated connections and simulation plan determine the part states and current flow.',
        why: 'Power, signal, and GND paths must be closed according to the circuit goal before the behavior can be trusted.',
        missing: 'If one required connection is missing, the closed circuit is broken and the intended behavior or current flow cannot be validated.'
      };
}

function describeConnection(circuit, connection, locale) {
  const fromPart = circuit.parts.find((part) => part.id === connection.from.partId);
  const toPart = circuit.parts.find((part) => part.id === connection.to.partId);
  const fromLabel = `${fromPart?.label ?? connection.from.partId} ${connection.from.pin}`;
  const toLabel = `${toPart?.label ?? connection.to.partId} ${connection.to.pin}`;

  return {
    id: `connection:${connection.id}`,
    type: 'connection',
    connectionId: connection.id,
    signal: connection.signal,
    label: connection.education.label,
    title: connection.education.title,
    summary: connection.education.what,
    detail: locale === 'ko'
      ? `${fromLabel}에서 ${toLabel}로 이어지는 ${signalLabel(connection.signal, locale)} 연결입니다.`
      : `This ${signalLabel(connection.signal, locale)} connection runs from ${fromLabel} to ${toLabel}.`,
    why: connection.education.why,
    missing: connection.education.missing,
    endpoints: [fromLabel, toLabel],
    questions: QUESTION_PRESETS[locale].connection
  };
}

function describePart(circuit, part, locale) {
  const connections = circuit.connections.filter((connection) => (
    connection.from.partId === part.id || connection.to.partId === part.id
  ));
  const pinSummary = part.pins
    .map((pin) => `${pin.name}${pin.meaning ? `: ${pin.meaning}` : ''}`)
    .join(locale === 'ko' ? ' / ' : '; ');

  return {
    id: `part:${part.id}`,
    type: 'part',
    partId: part.id,
    label: part.label,
    title: part.designator ? `${part.designator} · ${part.label}` : part.label,
    summary: part.description,
    detail: locale === 'ko'
      ? `이 부품은 ${connections.length}개의 연결에 참여합니다. 주요 핀은 ${pinSummary || '등록된 핀이 없습니다'}.`
      : `This part participates in ${connections.length} connection(s). Key pins: ${pinSummary || 'no registered pins'}.`,
    why: locale === 'ko'
      ? part.id === 'arduino-uno'
        ? 'Arduino는 회로의 제어 보드라서 전원과 통신 신호를 제공합니다.'
        : part.id === 'oled-display'
          ? 'OLED는 학생이 실행 결과를 직접 확인하는 출력 장치입니다.'
          : '이 부품은 회로의 학습 맥락을 구성합니다.'
      : part.id === 'arduino-uno'
        ? 'The Arduino is the controller; it provides power and communication signals.'
        : part.id === 'oled-display'
          ? 'The OLED is the output device where the student sees the result.'
          : 'This part supports the lesson context.',
    missing: locale === 'ko'
      ? '이 부품이 빠지면 관련 연결과 시뮬레이션 동작도 함께 성립하지 않습니다.'
      : 'If this part is missing, the related connections and simulated behavior no longer hold.',
    questions: QUESTION_PRESETS[locale].part
  };
}

function enrichTutorTarget(target, locale) {
  if (target?.type !== 'part') {
    return target;
  }

  const profile = profilePartForTutorTarget(target, locale);
  if (!profile) {
    return target;
  }

  return {
    ...target,
    summary: profile.summary || target.summary,
    detail: profile.detail || target.detail,
    why: profile.why || target.why,
    missing: profile.missing || target.missing
  };
}

function withSimulationContext(target, circuit) {
  const simulationContext = simulationExplanationContext(circuit);
  if (!simulationContext.status) {
    return target;
  }

  return {
    ...target,
    simulationContext
  };
}

function simulationExplanationContext(circuit) {
  const plan = circuit?.simulationPlan;
  if (!plan) {
    return {};
  }

  return {
    status: plan.status,
    warning: (plan.warnings || []).find((warning) =>
      /SIMULATION_BLOCKED_BY_RENDER_DRC|BREADBOARD_.*CONFLICT/.test(warning)
    ) || (plan.warnings || [])[0] || ''
  };
}

function hasBlockedSimulation(target) {
  return Boolean(target?.simulationContext?.status && target.simulationContext.status !== 'valid');
}

function blockedSimulationAnswer(target, locale) {
  const reason = target.simulationContext.warning
    ? locale === 'ko'
      ? ` 이유: ${target.simulationContext.warning}`
      : ` Reason: ${target.simulationContext.warning}`
    : '';

  if (locale === 'ko') {
    return `${target.label}은 현재 시뮬레이션 상태가 ${target.simulationContext.status}라서 Run 전류 애니메이션을 보여줄 수 없습니다.${reason}`;
  }

  return `Run cannot animate current for ${target.label} because the simulation is ${target.simulationContext.status}.${reason}`;
}

function profilePartForTutorTarget(target, locale) {
  const text = `${target.partId || ''} ${target.label || ''} ${target.title || ''} ${target.summary || ''}`.toLowerCase();
  const isResistor = /resistor|ohm|저항/.test(text);
  const isLed = /\bled\b|led-/.test(text);
  const isArduino = /arduino|uno/.test(text);
  const isBreadboard = /breadboard/.test(text);
  const isDht11 = /dht11|temperature humidity|온습도/.test(text);
  const isOled = /oled|display|screen/.test(text);

  if (locale === 'ko') {
    if (isResistor) {
      return {
        summary: 'LED에 흐르는 전류를 제한하는 직렬 저항입니다.',
        detail: '이 저항은 Arduino 출력 핀과 LED 사이에 직렬로 들어가 LED가 감당할 수 있는 수준으로 전류를 낮춥니다.',
        why: '저항이 없으면 LED에 과전류가 흐를 수 있고, 회로가 valid로 검증되어도 안전한 교육용 회로라고 보기 어렵습니다.',
        missing: '저항이 빠지면 LED가 너무 밝게 켜지거나 손상될 수 있으므로, 전류 흐름 시뮬레이션도 안전한 경로로 표시하면 안 됩니다.'
      };
    }
    if (isLed) {
      return {
        summary: 'Arduino 출력 상태를 빛으로 보여 주는 출력 부품입니다.',
        detail: 'LED 애노드(A)는 저항 쪽, 캐소드(K)는 GND 쪽으로 연결되어야 D8이 HIGH일 때만 전류가 흐릅니다.',
        why: 'LED는 학생이 회로 동작을 즉시 확인하는 출력 장치입니다. 극성과 직렬 저항이 맞아야 깜빡임을 안전하게 볼 수 있습니다.',
        missing: 'LED가 빠지거나 극성이 반대로 연결되면 빛이 나지 않고, 현재 시뮬레이션의 출력 동작도 성립하지 않습니다.'
      };
    }
    if (isArduino) {
      return {
        summary: '회로를 제어하는 Arduino Uno 보드입니다.',
        detail: 'Arduino는 D8 같은 디지털 출력 핀을 HIGH/LOW로 바꾸고, GND 기준점을 제공해 닫힌 전류 경로를 만듭니다.',
        why: '컨트롤러가 있어야 학생이 원하는 동작을 코드와 핀 상태로 만들 수 있습니다.',
        missing: 'Arduino가 빠지면 LED를 깜빡이게 할 출력 신호와 공통 GND 기준이 사라집니다.'
      };
    }
    if (isBreadboard) {
      return {
        summary: '부품과 전선을 납땜 없이 꽂아 회로를 구성하는 실습 보드입니다.',
        detail: '브레드보드는 LED, 저항, 점퍼 와이어를 눈으로 확인하며 배치할 수 있게 해 줍니다.',
        why: '초보자가 연결을 바꿔 보며 회로 구조를 이해하기에 적합합니다.',
        missing: '브레드보드가 없어도 일부 부품은 직접 연결할 수 있지만, 실습 배치와 시각화의 기준점이 약해집니다.'
      };
    }
    if (isDht11) {
      return {
        summary: '온도와 습도를 디지털 데이터선으로 전달하는 센서입니다.',
        detail: 'DHT11은 VCC와 GND로 전원을 받고 DAT 한 가닥으로 Arduino D2 같은 디지털 핀에 온습도 데이터를 보냅니다.',
        why: '학생이 주변 환경 값을 화면에서 확인할 수 있게 해 주는 입력 장치입니다. DAT와 공통 GND가 맞아야 OLED 표시도 믿을 수 있습니다.',
        missing: 'DHT11이 빠지거나 DAT가 연결되지 않으면 표시할 온도/습도 값이 없어 온습도 시뮬레이션이 성립하지 않습니다.'
      };
    }
    if (isOled) {
      return {
        summary: '실행 결과를 문자나 그래픽으로 보여 주는 표시 장치입니다.',
        detail: 'OLED는 전원, GND, I2C 데이터/클록 신호가 모두 맞아야 화면을 갱신할 수 있습니다.',
        why: '학생이 프로그램 결과를 직접 확인하는 출력 장치입니다.',
        missing: 'OLED가 빠지면 화면 출력 결과를 확인할 수 없습니다.'
      };
    }
  }

  if (isResistor) {
    return {
      summary: 'A series resistor that limits current through the LED.',
      why: 'Without the resistor, the LED can draw unsafe current and the simulation should not be treated as a safe circuit.',
      missing: 'If the resistor is missing, the LED can be damaged and the current-flow path is no longer safe to animate as valid.'
    };
  }
  if (isLed) {
    return {
      summary: 'The output part that turns the Arduino signal into visible light.',
      why: 'The LED lets the student see the output state directly, but polarity and current limiting must be correct.',
      missing: 'If the LED is missing or reversed, the visible output behavior no longer works.'
    };
  }
  if (isArduino) {
    return {
      summary: 'The Arduino Uno controller board.',
      why: 'The controller provides the digital output signal and the shared ground reference.',
      missing: 'If the Arduino is missing, the circuit has no controlled output pin or shared ground reference.'
    };
  }
  if (isBreadboard) {
    return {
      summary: 'A solderless practice board for arranging parts and jumper wires.',
      why: 'It gives beginners a visible, editable layout for the circuit.',
      missing: 'If the breadboard is missing, the lesson loses its clear wiring layout.'
    };
  }
  if (isDht11) {
    return {
      summary: 'A digital sensor that provides temperature and humidity readings.',
      why: 'It turns the environment into a data signal the Arduino can show on the OLED.',
      missing: 'If the DHT11 or its DAT wire is missing, there is no validated temperature/humidity value to display.'
    };
  }
  if (isOled) {
    return {
      summary: 'The display module that shows text or graphics.',
      why: 'It is the output device where the student sees the program result.',
      missing: 'If the OLED is missing, the screen output cannot be verified.'
    };
  }

  return null;
}

function buildKoreanAnswer(target, flags) {
  if (flags.wantsMissing) {
    if (target.type === 'circuit') {
      return `검증된 회로 기준으로 보면, 전선은 선택 사항이 아닙니다. ${target.missing}`;
    }
    return `검증된 회로 기준으로 보면, ${target.label}이 빠질 때의 핵심 문제는 이것입니다: ${target.missing}`;
  }
  if (flags.wantsCurrent) {
    return target.type === 'connection'
      ? `${target.label}은 ${target.signal ? signalLabel(target.signal, 'ko') : '회로'} 경로입니다. ${target.detail} 전류 설명은 검증된 연결 정보에 근거하며, 전원은 5V에서 부품으로 이동하고 GND로 돌아오는 폐회로가 되어야 합니다.`
      : `${target.label}을 기준으로 보면 전류는 전원에서 필요한 부품을 지나 GND로 돌아와야 합니다. ${target.detail}`;
  }
  if (flags.wantsCheck) {
    return `${target.label}을 확인할 때는 먼저 핀 이름을 맞추고, 그다음 같은 신호끼리 연결됐는지 봅니다. ${target.detail}`;
  }
  if (flags.wantsRun) {
    return flags.running
      ? `현재 실행 상태에서는 ${target.label}이 실제 시뮬레이션 결과와 연결되어 있습니다. ${target.summary}`
      : `아직 실행 전이라면 ${target.label}의 역할을 먼저 확인하고, 실행을 누른 뒤 전류 애니메이션과 동작 결과를 같이 비교해 보세요. ${target.detail}`;
  }
  return `${target.label}에 대해 설명하면, ${target.summary} ${target.why}`;
}

function buildEnglishAnswer(target, flags) {
  if (flags.wantsMissing) {
    if (target.type === 'circuit') {
      return `Grounded in the validated circuit: wires are not optional. ${target.missing}`;
    }
    return `Grounded in the validated circuit: if ${target.label} is missing, the main issue is: ${target.missing}`;
  }
  if (flags.wantsCurrent) {
    return target.type === 'connection'
      ? `${target.label} is a ${target.signal ? signalLabel(target.signal, 'en') : 'circuit'} path. ${target.detail} Current must form a closed path from supply, through the load, and back to ground.`
      : `For ${target.label}, current must leave the supply, pass through the active load, and return to ground. ${target.detail}`;
  }
  if (flags.wantsCheck) {
    return `To check ${target.label}, match the pin names first, then confirm that only the same intended signal is connected. ${target.detail}`;
  }
  if (flags.wantsRun) {
    return flags.running
      ? `${target.label} is tied to the current simulation state. ${target.summary}`
      : `Before pressing Run, inspect ${target.label}; after Run, compare the current animation with the simulation output. ${target.detail}`;
  }
  return `${target.label}: ${target.summary} ${target.why}`;
}

function signalLabel(signal, locale) {
  const labels = {
    ko: {
      power: '전원',
      ground: 'GND',
      'i2c-data': 'I2C 데이터',
      'i2c-clock': 'I2C 클록',
      gpio: '디지털 신호',
      pwm: 'PWM 신호'
    },
    en: {
      power: 'power',
      ground: 'ground',
      'i2c-data': 'I2C data',
      'i2c-clock': 'I2C clock',
      gpio: 'digital signal',
      pwm: 'PWM signal'
    }
  };
  return labels[locale][signal] || signal;
}

function groundingFor(target) {
  return [
    target.id,
    target.type,
    target.signal,
    ...(target.endpoints || []),
    target.simulationContext?.status ? `simulation:${target.simulationContext.status}` : '',
    target.simulationContext?.warning
      ? `simulation-warning:${target.simulationContext.warning.split(':')[0].trim()}`
      : ''
  ].filter(Boolean);
}

function normalizeLocale(locale) {
  return locale === 'en' ? 'en' : 'ko';
}
