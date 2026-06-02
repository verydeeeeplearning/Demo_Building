export const en = {
  topbar: {
    announcement: 'H-eduware demo build',
    projectLoaded: 'Arduino OLED lesson',
    newProject: 'New project',
    tabs: { files: 'Files', pcb: 'PCB' },
    actions: { library: 'Library', demo: 'Demo', share: 'Share', run: 'Run' }
  },
  language: {
    aria: 'Language',
    ko: 'KOR',
    en: 'ENG'
  },
  roles: {
    student: 'student',
    assistant: 'assistant'
  },
  aiPanel: {
    kicker: 'AI interview',
    titleLoaded: 'From idea to circuit',
    titleNew: 'New project',
    progressReady: 'Build ready',
    progressRefining: 'Refining design',
    progressAria: 'Design specification progress',
    lockedDecisions: 'Locked decisions',
    yes: 'Yes',
    no: 'No',
    planKicker: 'Design plan',
    planItems: [
      'Clarify requirements',
      'Identify required parts',
      'Plan circuit connections',
      'Validate safety and current paths',
      'Prepare simulation'
    ],
    stepDone: 'Done',
    runtimeLabel: 'AI mode',
    runtimeLocalKey: 'Local demo key ready',
    runtimeCached: 'Cached demo',
    replyLabel: 'Reply to the assistant',
    ideaLabel: 'Describe circuit idea',
    ideaPlaceholder: 'Example: blink an LED from Arduino Uno D8',
    sendIdea: 'Send idea',
    confirm: 'Confirm and build',
    typingAria: 'Assistant is typing'
  },
  landing: {
    status: 'No project loaded',
    title: 'Start with a blank learning circuit.',
    body: 'The workspace opens empty so the student sees when a project is created. A prepared example circuit is available from the Demo control.',
    loadDemo: 'Load demo project',
    newProject: 'New project'
  },
  files: {
    tocKicker: 'On this page',
    tocAria: 'Markdown table of contents',
    explorerKicker: 'File explorer',
    explorerTitle: 'Project files',
    empty: 'No markdown files yet.'
  },
  evidence: {
    contextCoverage: 'Context coverage',
    contextSources: 'Grounding sources',
    sourceBundle: 'Verified support data',
    bundleReady: 'ready',
    bundleGap: 'support gap',
    synthesisEligibility: 'Circuit synthesis',
    responseCoverage: 'Response coverage',
    purpose: {
      valid_circuit_synthesis: 'valid circuit synthesis',
      clarification_response: 'clarification response',
      unsupported_response: 'unsupported response',
      unsafe_refusal: 'unsafe refusal',
      partial_visual_only: 'visual-only preview'
    },
    eligibility: {
      eligible: 'eligible',
      ineligible: 'not eligible'
    },
    unsupportedReason: 'Why this is unsupported',
    simulationBasis: 'Simulation basis',
    validationWarnings: 'Validation warnings',
    status: 'Status',
    score: 'Score',
    warnings: 'Warnings',
    none: 'None',
    notAvailable: 'No agent evidence yet'
  },
  pcb: {
    toolbarAria: '3D stage controls',
    reset: 'Reset view',
    fit: 'Fit view',
    output: 'Simulation output',
    ready: 'READY'
  },
  simulationControls: {
    play: 'Show current',
    pause: 'Pause',
    step: 'Step through',
    selectedPath: 'Selected flow',
    noneSelected: 'None selected'
  },
  solverGate: {
    diagnosticTitle: '3D diagnostic simulation',
    diagnosticBody: 'The scene is visible, while build-ready and current-flow claims remain unverified.',
    safeEquivalentTitle: 'Safe equivalent simulation',
    safeEquivalentBody: 'The original unsafe request is not built; only the verified low-voltage equivalent is shown.',
    placeholderTitle: 'Placeholder part simulation',
    placeholderBody: 'Some hardware is shown with generalized geometry, so exact physical dimensions remain limited.'
  },
  parts: {
    railKicker: 'Part library',
    railTitle: '3D parts',
    selected: 'Selected part',
    thumbAlt: '{label} 3D thumbnail',
    ground: 'Ground'
  },
  inspector: {
    kicker: 'Circuit inspector',
    title: 'Selected circuit explanation',
    hardwareKicker: 'Circuit explanation',
    hardwareTitle: 'Hardware',
    hoverKicker: 'Currently hovered',
    emptyTitle: 'Hover the circuit or select a part',
    emptyBody: 'Select a wire, part, or output to see its role and simulation meaning here.',
    why: 'Why it matters',
    missing: 'If it is missing',
    selectedContext: 'Selected',
    connectionsTitle: 'Connections',
    targetSelectorTitle: 'Select a connection',
    suggestions: 'Suggested questions',
    chatKicker: 'Question',
    chatTitle: 'Ask about this circuit',
    chatPlaceholder: 'Example: What happens if this wire is missing?',
    chatToggleOpen: 'Ask',
    chatToggleClose: 'Close',
    currentSelection: 'Current selection',
    emptyChat: 'Ask a question. Answers use the selected part or connection.',
    openChat: 'Ask about this part',
    closeChat: 'Close',
    ask: 'Ask',
    thinking: 'Checking circuit evidence',
    tutor: 'tutor',
    student: 'me',
    partsTitle: 'Circuit parts',
    selectPart: 'Select {label}',
    selectConnection: 'Select {label} connection',
    noMessages: 'Ask a question about the selected target.'
  },
  build: {
    aria: 'Build progress',
    title: 'Building your circuit',
    starting: 'Starting',
    pause: 'Pause',
    resume: 'Resume',
    skip: 'Skip animation',
    open: 'Open project',
    ready: 'Circuit ready.',
    phases: {
      spec: 'Writing the spec',
      design: 'Designing the circuit'
    },
    steps: [
      { id: 'read-idea', phase: 'spec', label: 'Reading your idea', log: 'Parsing the request into a clear goal' },
      { id: 'draft-spec', phase: 'spec', label: 'Drafting the requirement spec', log: 'Writing demo-oled.md' },
      { id: 'list-parts', phase: 'spec', label: 'Listing the parts', log: 'Arduino Uno, I2C OLED, breadboard, jumper wires' },
      { id: 'write-connections', phase: 'spec', label: 'Writing the connections', log: 'Documenting 5V, GND, SDA, SCL' },
      { id: 'place-breadboard', phase: 'design', label: 'Placing the breadboard', log: 'Dropping the breadboard onto the stage' },
      { id: 'add-arduino', phase: 'design', label: 'Adding the Arduino Uno', log: 'Mounting the controller' },
      { id: 'add-oled', phase: 'design', label: 'Adding the I2C OLED', log: 'Mounting the display' },
      { id: 'wire-power', phase: 'design', label: 'Wiring power and ground', log: 'Running the red and black jumpers' },
      { id: 'wire-data', phase: 'design', label: 'Wiring data and clock', log: 'Running the SDA and SCL jumpers' }
    ]
  },
  welcome: {
    close: 'Close welcome',
    kicker: 'Welcome',
    title: 'Describe an idea. Watch it become a circuit.',
    body: 'H-eduware turns plain words like <em>"show some text on a little screen"</em> into a 3D breadboard you can see, understand wire by wire, and run.',
    points: [
      'Tell the assistant what you want to build.',
      'Answer a few short questions to lock the design.',
      'Explore the 3D parts and press Run to see it work.'
    ],
    start: 'Start exploring',
    demo: 'Load the demo'
  },
  library: {
    aria: 'Part library browser',
    close: 'Close part library',
    kicker: 'Part library',
    title: '{count} 3D components',
    searchPlaceholder: 'Search parts (sensor, motor, OLED ...)',
    searchAria: 'Search parts',
    all: 'All',
    count: 'Showing {visible} of {total} parts',
    pins: '{count} {count, plural, one {pin} other {pins}}',
    noPins: 'no pins',
    categories: {
      boards: 'Microcontroller Boards',
      displays: 'Displays',
      sensors: 'Sensors',
      actuators: 'Actuators',
      ics: 'ICs & Drivers',
      passives: 'Passive Components',
      inputs: 'Input Devices',
      'power-comms': 'Power & Communication',
      prototyping: 'Prototyping'
    }
  },
  share: {
    aria: 'Share circuit',
    close: 'Close sharing',
    kicker: 'Share',
    emptyTitle: 'No circuit to share yet',
    emptyBody: 'Build or load a circuit first. Then you can share a clean project summary.',
    emptyHint: 'Use the Demo button or describe a circuit idea to create something shareable.',
    readyBody: 'Share a safe summary of this circuit. Public links are planned, so this MVP gives you a clean copyable artifact first.',
    summaryLabel: 'Share summary',
    copySummary: 'Copy summary',
    createLink: 'Create public link',
    creatingLink: 'Creating public link...',
    linkCreated: 'Public link is ready.',
    linkFailed: 'Could not create a public link. The summary and JSON export still work.',
    linkLabel: 'Public link',
    copyLink: 'Copy link',
    linkCopied: 'Link copied.',
    downloadCard: 'Save image',
    cardReady: 'Image export prepared.',
    downloadJson: 'Download JSON',
    jsonReady: 'JSON export prepared.',
    publicLinkSoon: 'Public link coming soon',
    copied: 'Summary copied.',
    copyFallback: 'Select the summary and copy it manually.'
  },
  publicShare: {
    loadingTitle: 'Loading shared circuit',
    loadingBody: 'Checking the saved project summary and validation state.',
    errorTitle: 'Shared circuit unavailable',
    errorBody: 'This link may be expired or the circuit could not be found.',
    sharedProject: 'Shared Circuit',
    import: 'Start from this circuit',
    createOwn: 'Create my own circuit',
    details: 'Shared circuit details',
    validation: 'Validation',
    validBody: 'This circuit was validated before sharing.',
    draftBody: 'This circuit is a draft or needs more verification.',
    simulation: 'How it works',
    simulationAvailable: 'Simulation available',
    diagnosticAvailable: '3D diagnostic available',
    diagnosticBody: 'A 3D diagnostic scene is available, but Run and current-flow simulation need review.',
    simulationUnavailable: 'No simulation',
    parts: 'Parts',
    context: 'Evidence',
    notAvailable: 'No evidence listed'
  },
  interview: {
    initial: 'Start a new project or load a prepared example circuit.',
    demoIdea: 'show the event name on a small OLED screen',
    labels: {
      goal: 'Project goal',
      output: 'Output device',
      content: 'Display content',
      controller: 'Controller',
      power: 'Power'
    },
    questions: {
      content: 'Do you want the screen to show the event name?',
      controller: 'Should an Arduino Uno run this? It is the friendliest board to start with.',
      power: 'Will USB power be enough for the demo?'
    },
    values: {
      eventName: 'Event name (RALPHTON BUSAN)',
      customMessage: 'A short custom message',
      arduinoUno: 'Arduino Uno',
      arduinoNano: 'Arduino Nano',
      usb5v: 'USB 5V',
      external5v: 'External 5V supply',
      oledScreen: 'OLED screen',
      ledIndicator: 'LED indicator',
      dcMotor: 'DC motor',
      buzzer: 'Buzzer'
    },
    goal: 'Turn {subject} into a working {output} circuit',
    ready: 'The design is clear. Press Confirm and build to place the parts in 3D.'
  },
  circuit: {
    title: 'Arduino OLED name display',
    fileName: 'demo-oled.md',
    requirementPath: 'requirements/demo-oled.md',
    requirementTitle: 'Project Requirement: Arduino OLED name display',
    requirementStatus: 'Confirmed demo requirement',
    statusLabel: 'Status',
    sections: {
      goal: 'Goal',
      parts: 'Parts Needed',
      behavior: 'What It Should Do',
      connections: 'Connections',
      assumptions: 'Assumptions'
    },
    goal: 'Build a breadboard circuit that uses an Arduino and a small I2C OLED screen to show {runText}.',
    behavior: 'When the student presses Run, the OLED lights up and displays {runText}.',
    partsNeeded: [
      'Arduino Uno or compatible board',
      '0.96 inch I2C OLED display',
      'Half-size breadboard',
      'Four jumper wires: 5V, GND, SDA, and SCL'
    ],
    assumptions: [
      'The OLED module uses the common four-pin I2C layout: VCC, GND, SDA, and SCL.',
      'The Arduino provides 5V power and uses A4 for SDA and A5 for SCL.',
      'This is a scripted teaching demo, not a general-purpose circuit simulator.'
    ],
    transcriptConfirm: 'Yes, build that.',
    transcriptFinal: 'Great. I will build an Arduino and I2C OLED circuit that shows {runText}.'
  }
};
