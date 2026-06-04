const PART_PATTERNS = [
  { part: 'led', pattern: /\bled\b|led-|\uC5D8\s*\uC774\s*\uB514/i },
  { part: 'oled', pattern: /\boled\b|display|screen|\uB514\uC2A4\uD50C\uB808\uC774|\uD654\uBA74/i },
  { part: 'arduino', pattern: /arduino|uno|\uC544\uB450\uC774\uB178/i },
  { part: 'resistor', pattern: /resistor|ohm|\uC800\uD56D/i },
  { part: 'breadboard', pattern: /breadboard|\uBE0C\uB808\uB4DC\uBCF4\uB4DC/i }
];

const VOLTAGE_SAFETY_PATTERN = /higher voltage|high voltage|voltage|volt|5v|3\.3v|current|amp|serve|serving|drive|burn|damage|\uC804\uC555|\uBCFC\uD2F0\uC9C0|\uB192|\uC804\uB958|\uC804\uB958\s*\uC81C\uD55C|\uD0DC\uC6CC|\uC190\uC0C1|\uC800\uD56D/i;

export function classifyTutorQuestionIntent(question, context = {}) {
  const text = String(question || '');
  const mentionedPart = mentionedPartIn(text);
  const targetPart = mentionedPartIn([
    context.target?.partId,
    context.target?.id,
    context.target?.type,
    context.target?.label,
    context.target?.title,
    context.target?.summary
  ].filter(Boolean).join(' '));
  const isVoltageSafetyQuestion = mentionedPart === 'led' && VOLTAGE_SAFETY_PATTERN.test(text);
  const confidence = isVoltageSafetyQuestion ? 'high' : mentionedPart ? 'medium' : 'none';

  return {
    mentionedPart,
    targetPart,
    isVoltageSafetyQuestion,
    shouldRetarget: Boolean(mentionedPart && mentionedPart !== targetPart && confidence === 'high'),
    confidence
  };
}

export function isLedVoltageSafetyIntent(intent) {
  return intent?.mentionedPart === 'led' && intent.isVoltageSafetyQuestion === true;
}

export function ledVoltageSafetyAnswer(locale) {
  if (locale === 'ko') {
    return 'LED는 더 높은 전압을 직접 받아도 되는 부품이 아니라 전류에 민감한 부품입니다. 반드시 직렬 저항(current-limiting resistor)으로 전류를 제한하세요. Arduino 5V/3.3V GPIO로 고전압 부하를 직접 drive하지 말고, 더 높은 전압 부하는 transistor/MOSFET driver와 공통 GND를 사용해야 합니다.';
  }
  return 'An LED should not be treated as a part that can safely take arbitrary higher voltage directly. It is current-sensitive, so keep a current-limiting resistor in series. Arduino 5V/3.3V GPIO should not drive a high-voltage load directly; use an appropriate transistor/MOSFET driver and shared ground for higher-voltage loads.';
}

function mentionedPartIn(text) {
  const normalized = String(text || '');
  return PART_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.part ?? null;
}
