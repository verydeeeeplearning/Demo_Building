export function agentErrorMessage(error, locale = 'ko', context = {}) {
  const raw = rawErrorMessage(error);
  const code = error?.payload?.errorCode || error?.errorCode;
  const isKorean = locale !== 'en';
  const studentMessage = context.studentMessage || '';

  if (isUnsafeStudentRequest(studentMessage)) {
    return isKorean
      ? '이 요청은 감전이나 화재 위험이 있는 고전압 회로라서 배선도나 시뮬레이션으로 만들 수 없습니다. 대신 Arduino 5V, GND, 220Ω 저항, LED를 사용하는 안전한 저전압 회로로 바꿔서 진행할 수 있습니다.'
      : 'That request involves unsafe high voltage, so I cannot turn it into wiring or a simulation. I can help reframe it as a safe low-voltage Arduino 5V LED circuit with a resistor.';
  }

  if (code === 'AGENT_STRUCTURED_OUTPUT_MISSING' || /structured circuit draft|did not return a structured/i.test(raw)) {
    return isKorean
      ? '회로 초안을 구조화해서 확인하지 못했어요. 현재 요청을 기준으로 다시 정리해 보낼게요. 조금 더 구체적으로 회로의 동작이나 빠진 연결을 알려 주세요.'
      : 'I could not verify the circuit plan. Please try again with the circuit behavior or missing connection you want me to check.';
  }

  if (/OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL|configured|configuration|not configured/i.test(raw)) {
    return isKorean
      ? '실제 에이전트 서버 설정이 필요합니다. 서버 환경변수를 확인한 뒤 다시 요청해 주세요.'
      : 'The live agent server needs configuration. Check the server environment variables, then try again.';
  }

  if (/Failed to fetch|offline|timed out|timeout|network/i.test(raw)) {
    return isKorean
      ? '에이전트 서버에 연결하지 못했어요. 서버가 실행 중인지 확인한 뒤 다시 요청해 주세요.'
      : 'I cannot reach the agent server. Check that the server is running, then try again.';
  }

  return isKorean
    ? '에이전트 실행 중 문제가 발생했어요. 현재 회로 조건을 다시 확인한 뒤 요청해 주세요.'
    : 'The agent hit a recoverable error. Please review the circuit request and try again.';
}

function rawErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || '');
}

function isUnsafeStudentRequest(message) {
  return /220\s?v|110\s?v|mains|outlet|wall power|콘센트|가정용 전기|고전압|직접 연결|화재|감전/i.test(String(message || ''));
}
