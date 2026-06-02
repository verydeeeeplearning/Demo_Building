export const ko = {
  topbar: {
    announcement: 'H-eduware 데모 빌드',
    projectLoaded: 'Arduino OLED 수업 회로',
    newProject: '새 프로젝트',
    tabs: { files: '문서', pcb: '회로' },
    actions: { library: '부품', demo: '데모', share: '공유', run: '실행' }
  },
  language: {
    aria: '언어 선택',
    ko: 'KOR',
    en: 'ENG'
  },
  roles: {
    student: '학생',
    assistant: 'AI'
  },
  aiPanel: {
    kicker: 'AI 설계 상담',
    titleLoaded: '아이디어를 회로로',
    titleNew: '새 프로젝트',
    progressReady: '제작 준비 완료',
    progressRefining: '설계 조건 정리 중',
    progressAria: '설계 조건 정리 진행률',
    lockedDecisions: '확정된 조건',
    yes: '네',
    no: '아니요',
    planKicker: '설계 계획',
    planItems: [
      '요구사항 정리',
      '필요한 부품 확인',
      '회로 연결 계획',
      '안전과 전류 경로 검증',
      '시뮬레이션 준비'
    ],
    stepDone: '완료',
    runtimeLabel: 'AI 모드',
    runtimeLocalKey: '로컬 데모 키 준비됨',
    runtimeCached: '캐시된 데모',
    replyLabel: 'AI에게 답장하기',
    ideaLabel: '만들고 싶은 회로를 적어 주세요',
    ideaPlaceholder: '예: Arduino Uno D8로 LED를 깜빡이고 싶어요',
    sendIdea: '보내기',
    confirm: '확인하고 회로 만들기',
    typingAria: 'AI가 답변을 작성 중'
  },
  landing: {
    status: '아직 열린 프로젝트가 없습니다',
    title: '빈 학습 회로에서 시작해 보세요.',
    body: '작업 공간은 비어 있는 상태로 시작합니다. 준비된 예제 회로는 데모 버튼으로 불러올 수 있습니다.',
    loadDemo: '데모 프로젝트 불러오기',
    newProject: '새 프로젝트'
  },
  files: {
    tocKicker: '문서 목차',
    tocAria: '마크다운 문서 목차',
    explorerKicker: '프로젝트 문서',
    explorerTitle: '문서',
    empty: '아직 마크다운 파일이 없습니다.'
  },
  evidence: {
    synthesisEligibility: '회로 합성 가능 여부',
    responseCoverage: '응답 근거',
    purpose: {
      valid_circuit_synthesis: '검증 가능한 회로 합성',
      clarification_response: '추가 질문',
      unsupported_response: '지원 불가 안내',
      unsafe_refusal: '안전상 거절',
      partial_visual_only: '시각 자료만 제공'
    },
    eligibility: {
      eligible: '가능',
      ineligible: '불가'
    },
    contextCoverage: '참고 자료 확인',
    contextSources: '참고한 자료',
    sourceBundle: '검증 자료',
    bundleReady: '준비됨',
    bundleGap: '근거 부족',
    unsupportedReason: '지원할 수 없는 이유',
    simulationBasis: '동작 확인 기준',
    validationWarnings: '확인이 필요한 점',
    status: '상태',
    score: '점수',
    warnings: '경고',
    none: '없음',
    notAvailable: '아직 참고 자료 없음'
  },
  pcb: {
    toolbarAria: '3D 회로 보기 조작',
    reset: '보기 초기화',
    fit: '화면 맞춤',
    output: '동작 결과',
    ready: '준비됨'
  },
  simulationControls: {
    play: '전류 보기',
    pause: '일시정지',
    step: '단계 보기',
    selectedPath: '선택한 흐름',
    noneSelected: '선택 없음'
  },
  solverGate: {
    diagnosticTitle: '3D 진단 시뮬레이션',
    diagnosticBody: '장면은 표시하지만, 조립 가능 여부와 전류 흐름은 아직 검증 완료로 표시하지 않습니다.',
    safeEquivalentTitle: '안전한 대체 시뮬레이션',
    safeEquivalentBody: '원래 위험한 요청은 만들지 않고, 검증된 저전압 대체 회로만 표시합니다.',
    placeholderTitle: '대체 부품 시뮬레이션',
    placeholderBody: '일부 부품은 일반화된 형태로 표시되며, 실제 부품 치수 검증은 제한됩니다.',
    adjustment: {
      diagnostic_simulation: {
        label: '검토용 3D 진단',
        title: '검토용 3D 진단 시뮬레이션',
        body: '하드웨어 장면은 계속 보이고, 자동 검토가 끝날 때까지 조립과 전류 흐름 조작은 검토 상태로 둡니다.'
      },
      placeholder_part_simulation: {
        label: '자리 맞춤 중',
        title: '자리 맞춤 장면',
        body: '정확한 외형 확인이 더 필요한 부품은 안전한 일반 형태로 자동 표시합니다.'
      },
      safe_equivalent_simulation: {
        label: '안전 대체 회로',
        title: '안전 대체 회로',
        body: '원래 요청 대신 안전한 저전압 대체 회로를 보여주며, 표시된 대체 회로에 대해서만 설명합니다.'
      },
      state_only: {
        label: '상태 확인',
        title: '상태 확인 3D 진단 시뮬레이션',
        body: '전류 애니메이션은 켜지 않고, 보드와 핀, 배치, 출력 상태를 살펴볼 수 있게 보여줍니다.'
      }
    },
    claimScope: {
      original: '요청한 회로 기준으로 조립 가능 여부를 검토합니다.',
      displayed_equivalent: '표시된 안전 대체 회로 기준으로만 조립 가능 여부를 검토합니다.',
      none: '이 검토 장면에는 조립 가능 완료 표시를 붙이지 않습니다.'
    },
    controls: {
      runOff: '자동 검토가 끝날 때까지 실행은 꺼져 있습니다.',
      currentOff: '확인된 경로가 준비될 때까지 전류 흐름 애니메이션은 꺼져 있습니다.'
    }
  },
  parts: {
    railKicker: '부품함',
    railTitle: '3D 부품',
    selected: '선택된 부품',
    thumbAlt: '{label} 3D 미리보기',
    ground: 'GND'
  },
  inspector: {
    kicker: '회로 설명',
    title: '선택한 부분',
    hardwareKicker: '회로 설명',
    hardwareTitle: '부품과 연결',
    hoverKicker: '마우스를 올린 부분',
    emptyTitle: '회로 위에 마우스를 올리거나 부품을 선택해 보세요',
    emptyBody: '선, 부품, 출력 화면을 선택하면 역할과 시뮬레이션 의미를 여기서 바로 설명합니다.',
    why: '왜 필요한가',
    missing: '빠지면 어떻게 되나',
    selectedContext: '선택됨',
    connectionsTitle: '연결선',
    targetSelectorTitle: '연결 선택',
    suggestions: '추천 질문',
    chatKicker: '질문',
    chatTitle: '회로에 대해 물어보기',
    chatPlaceholder: '예: 이 선이 없으면 어떻게 돼?',
    chatToggleOpen: '회로 질문',
    chatToggleClose: '질문 닫기',
    currentSelection: '현재 선택',
    emptyChat: '궁금한 점을 물어보세요. 선택한 부품이나 연결선에 맞춰 설명합니다.',
    openChat: '이 부분 물어보기',
    closeChat: '닫기',
    ask: '물어보기',
    thinking: '회로 정보를 확인하는 중',
    tutor: '튜터',
    student: '나',
    partsTitle: '부품함',
    selectPart: '{label} 선택',
    selectConnection: '{label} 연결 선택',
    noMessages: '선택한 항목에 대해 궁금한 점을 물어보세요.'
  },
  build: {
    aria: '회로 구성 진행 상황',
    title: '회로를 구성하는 중',
    starting: '시작하는 중',
    pause: '일시정지',
    resume: '다시 시작',
    skip: '애니메이션 건너뛰기',
    open: '프로젝트 열기',
    ready: '회로가 준비됐습니다.',
    phases: {
      spec: '요구사항 문서 작성 중',
      design: '회로 배치 중'
    },
    steps: [
      { id: 'read-idea', phase: 'spec', label: '아이디어 읽기', log: '학생의 요청을 명확한 목표로 정리하는 중' },
      { id: 'draft-spec', phase: 'spec', label: '요구사항 문서 작성', log: 'demo-oled.md를 작성하는 중' },
      { id: 'list-parts', phase: 'spec', label: '필요한 부품 정리', log: 'Arduino Uno, I2C OLED, 브레드보드, 점퍼선을 정리하는 중' },
      { id: 'write-connections', phase: 'spec', label: '연결 방법 작성', log: '5V, GND, SDA, SCL 연결을 문서화하는 중' },
      { id: 'place-breadboard', phase: 'design', label: '브레드보드 배치', log: '브레드보드를 3D 무대에 놓는 중' },
      { id: 'add-arduino', phase: 'design', label: 'Arduino Uno 추가', log: '제어 보드를 올리는 중' },
      { id: 'add-oled', phase: 'design', label: 'I2C OLED 추가', log: '디스플레이 모듈을 올리는 중' },
      { id: 'wire-power', phase: 'design', label: '전원과 GND 연결', log: '빨간색과 검은색 점퍼선을 연결하는 중' },
      { id: 'wire-data', phase: 'design', label: '데이터와 클록 연결', log: 'SDA와 SCL 점퍼선을 연결하는 중' }
    ]
  },
  welcome: {
    close: '환영 창 닫기',
    kicker: '환영합니다',
    title: '아이디어를 적으면 회로가 만들어집니다.',
    body: 'H-eduware는 <em>"LED를 깜빡이고 싶어요"</em> 같은 말에서 시작해, 선 하나하나 이해할 수 있는 3D 브레드보드 회로로 바꿔 줍니다.',
    points: [
      '만들고 싶은 것을 AI에게 말합니다.',
      '짧은 질문에 답하면서 설계 조건을 확정합니다.',
      '3D 부품을 살펴보고 실행을 눌러 동작을 확인합니다.'
    ],
    start: '시작하기',
    demo: '데모 불러오기'
  },
  library: {
    aria: '부품 라이브러리',
    close: '부품 라이브러리 닫기',
    kicker: '부품 라이브러리',
    title: '3D 부품 {count}개',
    searchPlaceholder: '부품 검색 (센서, 모터, OLED ...)',
    searchAria: '부품 검색',
    all: '전체',
    count: '전체 {total}개 중 {visible}개 표시',
    pins: '핀 {count}개',
    noPins: '핀 없음',
    categories: {
      boards: '마이크로컨트롤러 보드',
      displays: '디스플레이',
      sensors: '센서',
      actuators: '액추에이터',
      ics: 'IC 및 드라이버',
      passives: '수동 부품',
      inputs: '입력 장치',
      'power-comms': '전원 및 통신',
      prototyping: '프로토타이핑'
    }
  },
  share: {
    aria: '회로 공유',
    close: '공유 창 닫기',
    kicker: '공유',
    emptyTitle: '아직 공유할 회로가 없습니다',
    emptyBody: '먼저 회로를 만들거나 예제를 불러오세요. 그다음 정리된 회로 요약을 공유할 수 있습니다.',
    emptyHint: '데모를 불러오거나 만들고 싶은 회로를 적어 공유할 결과물을 만들어 보세요.',
    readyBody: '이 회로를 다른 사람에게 보여 줄 수 있도록 안전한 요약으로 정리했습니다. 공개 링크 기능은 준비 중이며, 지금은 복사 가능한 요약을 제공합니다.',
    summaryLabel: '공유용 요약',
    copySummary: '요약 복사',
    createLink: '공개 링크 만들기',
    creatingLink: '공개 링크를 만드는 중입니다...',
    linkCreated: '공개 링크가 준비되었습니다.',
    linkFailed: '공개 링크를 만들지 못했습니다. 요약 복사와 JSON 내보내기는 계속 사용할 수 있습니다.',
    linkLabel: '공개 링크',
    copyLink: '링크 복사',
    linkCopied: '링크를 복사했습니다.',
    downloadCard: '이미지 저장',
    cardReady: '공유 이미지를 준비했습니다.',
    downloadJson: 'JSON 내려받기',
    jsonReady: 'JSON 파일을 준비했습니다.',
    publicLinkSoon: '공개 링크 준비 중',
    copied: '요약을 복사했습니다.',
    copyFallback: '요약을 선택한 뒤 직접 복사해 주세요.'
  },
  publicShare: {
    loadingTitle: '공유된 회로를 불러오는 중입니다',
    loadingBody: '저장된 회로 요약과 검증 정보를 확인하고 있습니다.',
    errorTitle: '공유 회로를 열 수 없습니다',
    errorBody: '링크가 만료되었거나 회로를 찾을 수 없습니다.',
    sharedProject: '공유 회로',
    import: '이 회로에서 시작',
    createOwn: '새 회로 만들기',
    details: '공유 회로 상세',
    validation: '검증 상태',
    validBody: '공유되기 전에 검증된 회로입니다.',
    draftBody: '이 회로는 초안이거나 추가 검증이 필요합니다.',
    simulation: '동작 설명',
    simulationAvailable: '시뮬레이션 가능',
    diagnosticAvailable: '3D 진단 가능',
    diagnosticBody: '3D 진단 장면은 볼 수 있지만, 실행과 전류 흐름 시뮬레이션은 검토가 필요합니다.',
    adjustment: {
      diagnostic_simulation: {
        label: '검토용 3D 진단 가능',
        body: '안전한 3D 진단 장면은 볼 수 있고, 자동 검토 중에는 실행과 전류 흐름 조작을 꺼 둡니다.'
      },
      placeholder_part_simulation: {
        label: '자리 맞춤 장면 가능',
        body: '정확한 부품 외형을 검토하는 동안 안전한 일반 형태로 장면을 보여줍니다.'
      },
      safe_equivalent_simulation: {
        label: '안전 대체 회로 가능',
        body: '원래 요청 대신 안전한 대체 회로를 보여줍니다.'
      },
      state_only: {
        label: '상태 확인 장면 가능',
        body: '정적인 상태와 배치 장면을 살펴볼 수 있습니다.'
      }
    },
    simulationUnavailable: '시뮬레이션 없음',
    parts: '부품',
    context: '근거',
    notAvailable: '표시할 근거가 없습니다'
  },
  interview: {
    initial: '새 프로젝트를 시작하거나 준비된 예제 회로를 불러오세요.',
    demoIdea: '작은 OLED 화면에 행사 이름을 보여 주고 싶어요',
    labels: {
      goal: '프로젝트 목표',
      output: '출력 장치',
      content: '표시할 내용',
      controller: '제어 보드',
      power: '전원'
    },
    questions: {
      content: '화면에는 행사 이름을 표시하면 될까요?',
      controller: '제어 보드는 처음 배우기 쉬운 Arduino Uno로 할까요?',
      power: 'USB 5V 전원으로 충분할까요?'
    },
    values: {
      eventName: '행사 이름(RALPHTON BUSAN)',
      customMessage: '짧은 사용자 지정 문구',
      arduinoUno: 'Arduino Uno',
      arduinoNano: 'Arduino Nano',
      usb5v: 'USB 5V',
      external5v: '외부 5V 전원',
      oledScreen: 'OLED 화면',
      ledIndicator: 'LED 표시등',
      dcMotor: 'DC 모터',
      buzzer: '부저'
    },
    goal: '{subject} 요청을 작동하는 {output} 회로로 바꾸기',
    ready: '설계에 필요한 정보가 정리됐어요. 확인하고 회로를 만들어 볼게요.'
  },
  circuit: {
    title: 'Arduino OLED 이름 표시',
    fileName: 'demo-oled.md',
    requirementPath: 'requirements/demo-oled.md',
    requirementTitle: '회로 요구사항: Arduino OLED 이름 표시',
    requirementStatus: '확정된 데모 요구사항',
    statusLabel: '상태',
    sections: {
      goal: '목표',
      parts: '필요한 부품',
      behavior: '실행하면 보이는 동작',
      connections: '연결 방법',
      assumptions: '가정한 내용'
    },
    goal: 'Arduino와 작은 I2C OLED 화면을 사용해 {runText}를 표시하는 브레드보드 회로를 만듭니다.',
    behavior: '학생이 실행을 누르면 OLED가 켜지고 {runText}가 표시됩니다.',
    partsNeeded: [
      'Arduino Uno 또는 호환 보드',
      '0.96 inch I2C OLED 디스플레이',
      '하프 사이즈 브레드보드',
      '점퍼선 4개: 5V, GND, SDA, SCL'
    ],
    assumptions: [
      'OLED 모듈은 VCC, GND, SDA, SCL을 사용하는 일반적인 4핀 I2C 배열이라고 가정합니다.',
      'Arduino는 5V 전원을 제공하고 A4를 SDA, A5를 SCL로 사용합니다.',
      '이 기능은 수업용 데모이며 범용 회로 시뮬레이터는 아닙니다.'
    ],
    transcriptConfirm: '네, 그렇게 만들어 주세요.',
    transcriptFinal: '좋아요. {runText}를 표시하는 Arduino와 I2C OLED 회로를 만들게요.'
  }
};
