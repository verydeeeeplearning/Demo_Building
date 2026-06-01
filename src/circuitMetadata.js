import { getLocale, t } from './i18n.js';

export const DEMO_OLED_TEXT = 'RALPHTON BUSAN';

const PARTS = [
  {
    id: 'breadboard',
    type: 'breadboard',
    label: 'Half-size breadboard',
    designator: 'BB1',
    description: 'The reusable board that holds jumper wires without soldering.',
    pins: [
      { name: '+ rail', role: 'power-rail' },
      { name: '- rail', role: 'ground-rail' }
    ],
    position: { x: 0, y: 0, z: 0 }
  },
  {
    id: 'arduino-uno',
    type: 'arduino',
    label: 'Arduino Uno',
    designator: 'U1',
    description: 'The tiny computer that powers the OLED and sends the message.',
    pins: [
      { name: '5V', role: 'power', meaning: 'Supplies five volts to small modules.' },
      { name: 'GND', role: 'ground', meaning: 'Completes the electrical path back to the Arduino.' },
      { name: 'A4/SDA', role: 'i2c-data', meaning: 'Carries I2C data to the OLED.' },
      { name: 'A5/SCL', role: 'i2c-clock', meaning: 'Carries the I2C timing signal.' }
    ],
    position: { x: -1.8, y: 0.28, z: 0.1 }
  },
  {
    id: 'oled-display',
    type: 'oled',
    label: '0.96 inch I2C OLED',
    designator: 'DISP1',
    description: 'A small screen that can show the demo text.',
    pins: [
      { name: 'VCC', role: 'power', meaning: 'Receives power from Arduino 5V.' },
      { name: 'GND', role: 'ground', meaning: 'Connects to the common ground.' },
      { name: 'SDA', role: 'i2c-data', meaning: 'Receives display data.' },
      { name: 'SCL', role: 'i2c-clock', meaning: 'Receives the I2C clock.' }
    ],
    position: { x: 1.75, y: 0.35, z: -0.12 }
  },
  {
    id: 'photo-sensor',
    type: 'sensor',
    label: 'Light sensor',
    designator: 'S1',
    description: 'A library part included to show where sensors would appear next.',
    pins: [
      { name: 'VCC', role: 'power' },
      { name: 'GND', role: 'ground' },
      { name: 'SIG', role: 'signal' }
    ],
    libraryOnly: true,
    position: { x: 2.4, y: 0.3, z: 1.4 }
  },
  {
    id: 'dc-motor',
    type: 'motor',
    label: 'DC motor',
    designator: 'M1',
    description: 'A library part included to show that outputs can be more than screens.',
    pins: [
      { name: '+', role: 'power' },
      { name: '-', role: 'ground' }
    ],
    libraryOnly: true,
    position: { x: -2.4, y: 0.3, z: 1.4 }
  }
];

const CONNECTIONS = [
  {
    id: 'oled-power',
    from: { partId: 'arduino-uno', pin: '5V' },
    to: { partId: 'oled-display', pin: 'VCC' },
    signal: 'power',
    color: '#ff4d3d',
    cardAnchor: { left: '8%', top: '14%' },
    education: {
      label: '5V POWER',
      title: 'This wire carries power',
      what: 'This red jumper carries 5 volts from the Arduino to the OLED screen.',
      why: 'The screen needs a small, steady power supply before it can light any pixels.',
      missing: 'If this wire is missing, the OLED stays completely dark.'
    }
  },
  {
    id: 'oled-ground',
    from: { partId: 'arduino-uno', pin: 'GND' },
    to: { partId: 'oled-display', pin: 'GND' },
    signal: 'ground',
    color: '#20242a',
    cardAnchor: { left: '64%', top: '15%' },
    education: {
      label: 'GND',
      title: 'This wire closes the loop',
      what: 'This black jumper gives the OLED and Arduino the same ground reference.',
      why: 'Electricity needs a return path, and both boards must agree on what zero volts means.',
      missing: 'If ground is missing, the screen may flicker, freeze, or fail to turn on.'
    }
  },
  {
    id: 'oled-sda',
    from: { partId: 'arduino-uno', pin: 'A4/SDA' },
    to: { partId: 'oled-display', pin: 'SDA' },
    signal: 'i2c-data',
    color: '#2f7df6',
    cardAnchor: { left: '10%', top: '62%' },
    education: {
      label: 'I2C SDA',
      title: 'This wire carries the message',
      what: 'This blue jumper carries the display data from Arduino pin A4 to the OLED SDA pin.',
      why: 'SDA is the I2C data line, so it moves the letters that will appear on the screen.',
      missing: 'If this wire is missing, the Arduino cannot tell the OLED what to draw.'
    }
  },
  {
    id: 'oled-scl',
    from: { partId: 'arduino-uno', pin: 'A5/SCL' },
    to: { partId: 'oled-display', pin: 'SCL' },
    signal: 'i2c-clock',
    color: '#f6c44c',
    cardAnchor: { left: '64%', top: '62%' },
    education: {
      label: 'I2C SCL',
      title: 'This wire keeps time',
      what: 'This yellow jumper carries the clock pulse from Arduino pin A5 to the OLED SCL pin.',
      why: 'The clock tells both boards when to read each data bit, like a steady count-in.',
      missing: 'If this wire is missing, the data line has no timing and the screen cannot update.'
    }
  }
];

const PART_COPY = {
  en: {
    breadboard: {
      label: 'Half-size breadboard',
      description: 'The reusable board that holds jumper wires without soldering.'
    },
    'arduino-uno': {
      label: 'Arduino Uno',
      description: 'The tiny computer that powers the OLED and sends the message.',
      pins: {
        '5V': 'Supplies five volts to small modules.',
        GND: 'Completes the electrical path back to the Arduino.',
        'A4/SDA': 'Carries I2C data to the OLED.',
        'A5/SCL': 'Carries the I2C timing signal.'
      }
    },
    'oled-display': {
      label: '0.96 inch I2C OLED',
      description: 'A small screen that can show the demo text.',
      pins: {
        VCC: 'Receives power from Arduino 5V.',
        GND: 'Connects to the common ground.',
        SDA: 'Receives display data.',
        SCL: 'Receives the I2C clock.'
      }
    },
    'photo-sensor': {
      label: 'Light sensor',
      description: 'A library part included to show where sensors would appear next.'
    },
    'dc-motor': {
      label: 'DC motor',
      description: 'A library part included to show that outputs can be more than screens.'
    }
  },
  ko: {
    breadboard: {
      label: '하프 사이즈 브레드보드',
      description: '납땜 없이 점퍼선을 꽂아 회로를 연습하는 판입니다.'
    },
    'arduino-uno': {
      label: 'Arduino Uno',
      description: 'OLED에 전원을 공급하고 표시할 문구를 보내는 작은 컴퓨터입니다.',
      pins: {
        '5V': '작은 모듈에 5V 전원을 보냅니다.',
        GND: '전류가 Arduino로 돌아오는 길을 만듭니다.',
        'A4/SDA': 'OLED로 I2C 데이터를 보냅니다.',
        'A5/SCL': 'I2C 통신의 타이밍 신호를 보냅니다.'
      }
    },
    'oled-display': {
      label: '0.96 inch I2C OLED',
      description: '데모 문구를 표시할 수 있는 작은 화면입니다.',
      pins: {
        VCC: 'Arduino 5V에서 전원을 받습니다.',
        GND: '공통 GND에 연결됩니다.',
        SDA: '화면에 표시할 데이터를 받습니다.',
        SCL: 'I2C 클록 신호를 받습니다.'
      }
    },
    'photo-sensor': {
      label: '빛 센서',
      description: '다음 단계에서 센서가 어디에 놓일지 보여 주기 위한 라이브러리 부품입니다.'
    },
    'dc-motor': {
      label: 'DC 모터',
      description: '화면 이외의 출력 부품도 사용할 수 있음을 보여 주는 라이브러리 부품입니다.'
    }
  }
};

const CONNECTION_COPY = {
  en: {
    'oled-power': {
      title: 'This wire carries power',
      what: 'This red jumper carries 5 volts from the Arduino to the OLED screen.',
      why: 'The screen needs a small, steady power supply before it can light any pixels.',
      missing: 'If this wire is missing, the OLED stays completely dark.'
    },
    'oled-ground': {
      title: 'This wire closes the loop',
      what: 'This black jumper gives the OLED and Arduino the same ground reference.',
      why: 'Electricity needs a return path, and both boards must agree on what zero volts means.',
      missing: 'If ground is missing, the screen may flicker, freeze, or fail to turn on.'
    },
    'oled-sda': {
      title: 'This wire carries the message',
      what: 'This blue jumper carries the display data from Arduino pin A4 to the OLED SDA pin.',
      why: 'SDA is the I2C data line, so it moves the letters that will appear on the screen.',
      missing: 'If this wire is missing, the Arduino cannot tell the OLED what to draw.'
    },
    'oled-scl': {
      title: 'This wire keeps time',
      what: 'This yellow jumper carries the clock pulse from Arduino pin A5 to the OLED SCL pin.',
      why: 'The clock tells both boards when to read each data bit, like a steady count-in.',
      missing: 'If this wire is missing, the data line has no timing and the screen cannot update.'
    }
  },
  ko: {
    'oled-power': {
      title: '전원을 보내는 선',
      what: '이 빨간 점퍼선은 Arduino의 5V 전원을 OLED 화면으로 보냅니다.',
      why: '화면이 켜지고 픽셀을 밝히려면 작고 안정적인 전원이 먼저 필요합니다.',
      missing: '이 선이 빠지면 OLED는 완전히 켜지지 않습니다.'
    },
    'oled-ground': {
      title: '전류가 돌아오는 길',
      what: '이 검은 점퍼선은 OLED와 Arduino가 같은 GND 기준을 쓰게 합니다.',
      why: '전류에는 돌아오는 길이 필요하고, 두 보드는 0V 기준을 함께 써야 합니다.',
      missing: 'GND가 빠지면 화면이 깜박이거나 멈추거나 켜지지 않을 수 있습니다.'
    },
    'oled-sda': {
      title: '화면 데이터를 보내는 선',
      what: '이 파란 점퍼선은 Arduino A4 핀의 표시 데이터를 OLED SDA 핀으로 보냅니다.',
      why: 'SDA는 I2C 데이터 선이라 화면에 나타날 글자를 전달합니다.',
      missing: '이 선이 빠지면 Arduino가 OLED에 무엇을 그릴지 알려 줄 수 없습니다.'
    },
    'oled-scl': {
      title: '통신 박자를 맞추는 선',
      what: '이 노란 점퍼선은 Arduino A5 핀의 클록 신호를 OLED SCL 핀으로 보냅니다.',
      why: '클록은 두 보드가 언제 데이터를 읽어야 하는지 맞춰 주는 박자입니다.',
      missing: '이 선이 빠지면 데이터 선에 타이밍이 없어 화면을 갱신할 수 없습니다.'
    }
  }
};

export function createDemoCircuit(locale = getLocale()) {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  return {
    title: t('circuit.title', {}, normalizedLocale),
    runText: DEMO_OLED_TEXT,
    parts: PARTS.map((part) => localizePart(part, normalizedLocale)),
    connections: CONNECTIONS.map((connection) => ({
      ...connection,
      from: { ...connection.from },
      to: { ...connection.to },
      cardAnchor: { ...connection.cardAnchor },
      education: {
        ...connection.education,
        ...CONNECTION_COPY[normalizedLocale][connection.id]
      }
    }))
  };
}

export function createRequirementDocument(circuit = createDemoCircuit(), locale = getLocale()) {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  return {
    title: t('circuit.requirementTitle', {}, normalizedLocale),
    status: t('circuit.requirementStatus', {}, normalizedLocale),
    goal: t('circuit.goal', { runText: circuit.runText }, normalizedLocale),
    partsNeeded: t('circuit.partsNeeded', {}, normalizedLocale),
    behavior: t('circuit.behavior', { runText: circuit.runText }, normalizedLocale),
    assumptions: t('circuit.assumptions', {}, normalizedLocale),
    connections: circuit.connections.map((connection) => ({
      label: connection.education.label,
      summary: normalizedLocale === 'ko'
        ? `${connection.from.pin}을 ${connection.to.pin}에 연결합니다: ${connection.education.why}`
        : `${connection.from.pin} connects to ${connection.to.pin}: ${connection.education.why}`
    }))
  };
}

export function createRequirementMarkdown(circuit = createDemoCircuit(), locale = getLocale()) {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  const document = createRequirementDocument(circuit, normalizedLocale);
  const parts = document.partsNeeded.map((part) => `- ${part}`).join('\n');
  const assumptions = document.assumptions.map((assumption) => `- ${assumption}`).join('\n');
  const connections = document.connections
    .map((connection) => `- **${connection.label}**: ${connection.summary}`)
    .join('\n');
  const sections = t('circuit.sections', {}, normalizedLocale);

  return `# ${document.title}

_${t('circuit.statusLabel', {}, normalizedLocale)}: ${document.status}_

## ${sections.goal}

${document.goal}

## ${sections.parts}

${parts}

## ${sections.behavior}

${document.behavior}

## ${sections.connections}

${connections}

## ${sections.assumptions}

${assumptions}
`;
}

export function createDemoTranscript(studentPrompt, locale = getLocale()) {
  const normalizedLocale = locale === 'en' ? 'en' : 'ko';
  return [
    {
      role: 'student',
      text: studentPrompt
    },
    {
      role: 'assistant',
      text: t('interview.questions.content', {}, normalizedLocale)
    },
    {
      role: 'student',
      text: t('circuit.transcriptConfirm', {}, normalizedLocale)
    },
    {
      role: 'assistant',
      text: t('circuit.transcriptFinal', { runText: DEMO_OLED_TEXT }, normalizedLocale),
      action: 'build-demo-circuit'
    }
  ];
}

export function isLegalConnection(circuit, from, to) {
  return circuit.connections.some((connection) => {
    return (
      sameEndpoint(connection.from, from) &&
      sameEndpoint(connection.to, to)
    ) || (
      sameEndpoint(connection.from, to) &&
      sameEndpoint(connection.to, from)
    );
  });
}

function sameEndpoint(left, right) {
  return left.partId === right.partId && left.pin === right.pin;
}

function localizePart(part, locale) {
  const copy = PART_COPY[locale][part.id] || {};
  return {
    ...part,
    label: copy.label || part.label,
    description: copy.description || part.description,
    pins: part.pins.map((pin) => ({
      ...pin,
      meaning: copy.pins?.[pin.name] || pin.meaning
    })),
    position: { ...part.position }
  };
}
