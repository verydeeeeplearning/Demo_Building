import './styles.css';
import {
  createDemoCircuit,
  createRequirementMarkdown
} from './circuitMetadata.js';
import { getAiRuntimeMode, sendAgentMessage } from './aiClient.js';
import { createStageScene } from './stageScene.js';
import { createLogoMark, createFaviconDataUri } from './heduwareLogo.js';
import { mountWelcomePopup, hasSeenWelcome } from './welcomePopup.js';
import { mountLibraryBrowser } from './libraryBrowser.js';
import { mountShareModal } from './shareModal.js';
import { readPublicShare } from './shareClient.js';
import { projectFromShareSnapshot } from './shareImport.js';
import { renderShareView } from './shareView.js';
import { getLocale, setLocale, t } from './i18n.js';
import { describeCircuitTarget } from './circuitInspector.js';
import { askCircuitTutor } from './circuitTutorClient.js';
import { agentErrorMessage as formatAgentErrorMessage } from './agentErrorMessages.js';
import { groundAgentResultArtifacts } from './agentArtifactGrounding.js';
import { classifyStudentTurn } from './conversationRouting.js';
import { renderWarningsMarkdown, renderWarningTitle } from './renderWarnings.js';
import {
  createInterview,
  startInterview,
  answerInterview,
  interviewProgress,
  isInterviewReady
} from './interviewEngine.js';
import { mountBuildProgress } from './buildProgress.js';

// How long the animated typing indicator shows before the assistant reply is
// revealed. Kept short so the interaction feels live without stalling tests.
const TYPING_REVEAL_MS = 650;

const app = document.querySelector('#app');

const state = {
  locale: getLocale(),
  activeTab: 'Files',
  projectLoaded: false,
  awaitingConfirmation: false,
  built: false,
  running: false,
  simulationPlaying: false,
  simulationStepIndex: 0,
  selectedCurrentPathId: null,
  selectedFileId: 'demo-requirements',
  aiRuntimeMode: { mode: 'agent-server-offline', ok: false, hasServerKey: false },
  agentSessionId: null,
  agentResult: null,
  shareView: null,
  interview: createInterview(getLocale()),
  thinking: false,
  inspector: {
    hoveredRawTarget: null,
    selectedRawTarget: null,
    chatMessages: [],
    tutorThinking: false,
    chatOpen: false
  }
};

state.project = createLocalizedProject(state.locale);

let stageController = null;
let welcomeController = null;
let libraryController = null;
let shareController = null;
let buildController = null;
let thinkingTimer = 0;

function createLocalizedProject(locale) {
  const circuit = createDemoCircuit(locale);
  return {
    circuit,
    files: [
      {
        id: 'demo-requirements',
        name: t('circuit.fileName', {}, locale),
        path: t('circuit.requirementPath', {}, locale),
        kind: 'Markdown',
        status: t('circuit.requirementStatus', {}, locale),
        markdown: createRequirementMarkdown(circuit, locale)
      }
    ]
  };
}

function activeCircuit() {
  return state.project.circuit;
}

function projectFiles() {
  return state.project.files;
}

function projectDisplayTitle() {
  if (!state.projectLoaded) {
    return t('topbar.newProject', {}, state.locale);
  }
  return activeCircuit()?.title || t('topbar.projectLoaded', {}, state.locale);
}

function activeDraftOrProjectCircuit() {
  if (state.agentResult && canBuildAgentResult(state.agentResult)) {
    return createProjectFromAgentResult(state.agentResult).circuit;
  }
  return state.projectLoaded ? activeCircuit() : null;
}

function currentPlanItems() {
  const circuit = activeDraftOrProjectCircuit();
  if (!circuit?.circuitSpec) {
    return t('aiPanel.planItems', {}, state.locale);
  }

  const parts = circuit.parts || [];
  const hasBreadboard = parts.some((part) => /breadboard/i.test(`${part.type} ${part.label}`));
  const hasArduino = parts.some((part) => /arduino/i.test(`${part.type} ${part.label}`));
  const focusParts = parts
    .filter((part) => !/breadboard|arduino/i.test(`${part.type} ${part.label}`))
    .map((part) => part.label)
    .slice(0, 2);

  if (state.locale === 'ko') {
    return [
      '요구사항 문서 작성',
      hasBreadboard ? '브레드보드 배치' : '작업 공간 준비',
      hasArduino ? 'Arduino Uno 배치' : '제어 보드 배치',
      focusParts.length ? `${focusParts.join(', ')} 배치` : '주요 부품 배치',
      '검증된 연결선 배치',
      '전류 흐름 확인'
    ];
  }

  return [
    'Write requirement document',
    hasBreadboard ? 'Place breadboard' : 'Prepare workspace',
    hasArduino ? 'Place Arduino Uno' : 'Place controller board',
    focusParts.length ? `Place ${focusParts.join(', ')}` : 'Place key parts',
    'Route validated wires',
    'Check current flow'
  ];
}

function buildStepsForCurrentCircuit() {
  const items = currentPlanItems();
  if (!activeDraftOrProjectCircuit()?.circuitSpec) {
    return undefined;
  }
  return items.map((label, index) => ({
    id: `agent-step-${index + 1}`,
    phase: index < 2 ? 'spec' : 'design',
    label,
    log: state.locale === 'ko'
      ? `${label} 중`
      : `${label}`
  }));
}

// A fully-decided interview matching the locked OLED demo, used when the demo
// is loaded directly or after the student confirms the build.
function demoInterviewState(locale = state.locale) {
  let interview = startInterview(createInterview(locale), t('interview.demoIdea', {}, locale), locale);
  interview = answerInterview(interview, 'yes', locale); // content: event name
  interview = answerInterview(interview, 'yes', locale); // controller: Arduino Uno
  interview = answerInterview(interview, 'yes', locale); // power: USB 5V
  return interview;
}

getAiRuntimeMode().then((runtimeMode) => {
  state.aiRuntimeMode = runtimeMode;
  refreshRuntimeModeLabel();
});

function render() {
  disposeStage();
  if (state.shareView) {
    app.innerHTML = renderShareView(state.shareView, state.shareView.snapshot?.locale || state.locale);
    bindShareViewEvents();
    return;
  }

  const circuit = activeCircuit();

  app.innerHTML = `
    <div class="announcement">${t('topbar.announcement', {}, state.locale)}</div>
    <div class="topbar">
      <div class="brand">
        ${createLogoMark({ size: 38 })}
        <div>
          <strong>H-eduware</strong>
          <span>${escapeHtml(projectDisplayTitle())}</span>
        </div>
      </div>
      <div class="tabs" role="tablist" aria-label="Project views">
        ${renderTab('Files')}
        ${renderTab('PCB')}
      </div>
      <div class="top-actions">
        ${renderLanguageToggle()}
        <button class="secondary-action" type="button" data-action="open-library" data-testid="open-library">${t('topbar.actions.library', {}, state.locale)}</button>
        <button class="secondary-action demo-action" type="button" data-action="load-demo">${t('topbar.actions.demo', {}, state.locale)}</button>
        <button class="secondary-action" type="button" data-action="share" data-testid="share-project" ${state.projectLoaded ? '' : 'disabled'}>${t('topbar.actions.share', {}, state.locale)}</button>
        <button class="primary-action" type="button" data-action="run" ${state.projectLoaded ? '' : 'disabled'}>${t('topbar.actions.run', {}, state.locale)}</button>
      </div>
    </div>
    <main class="workbench ${state.activeTab === 'PCB' ? 'is-pcb' : 'is-files'} ${state.projectLoaded ? 'has-project' : 'is-new'}">
      ${renderAiPanel()}
      <section class="center-stage" data-testid="center-stage">
        ${renderCenterStage()}
      </section>
      ${renderRightRail()}
    </main>
  `;

  bindEvents();

  if (state.projectLoaded && state.activeTab === 'PCB') {
    const host = app.querySelector('[data-stage-host]');
    stageController = createStageScene(host, circuit, {
      running: state.running,
      selectedTargetKey: rawTargetKey(state.inspector.selectedRawTarget),
      onHoverTarget: updateHoveredCircuitTarget,
      onSelectTarget: selectCircuitTarget
    });
  }
}

function renderLanguageToggle() {
  return `
    <div class="language-toggle" role="group" aria-label="${t('language.aria', {}, state.locale)}">
      <button class="language-option ${state.locale === 'ko' ? 'is-active' : ''}" type="button" data-locale="ko" aria-pressed="${state.locale === 'ko'}">${t('language.ko', {}, state.locale)}</button>
      <button class="language-option ${state.locale === 'en' ? 'is-active' : ''}" type="button" data-locale="en" aria-pressed="${state.locale === 'en'}">${t('language.en', {}, state.locale)}</button>
    </div>
  `;
}

function renderCenterStage() {
  if (!state.projectLoaded) {
    return renderNewProjectLanding();
  }

  return state.activeTab === 'Files' ? renderFilesTab() : renderPcbTab();
}

function renderTab(name) {
  const selected = state.activeTab === name;
  return `
    <button
      role="tab"
      type="button"
      class="tab ${selected ? 'is-active' : ''}"
      aria-selected="${selected}"
      data-tab="${name}"
    >${name === 'Files' ? t('topbar.tabs.files', {}, state.locale) : t('topbar.tabs.pcb', {}, state.locale)}</button>
  `;
}

function renderAiPanel() {
  const planItems = currentPlanItems();
  const interview = state.interview;
  const interviewActive = interview.status !== 'idle';
  // While "thinking", hide the trailing assistant reply and show a typing
  // indicator in its place, so the exchange reads as a live back-and-forth.
  const lastIsAssistant = interview.messages.at(-1)?.role === 'assistant';
  const visibleMessages = state.thinking && lastIsAssistant
    ? interview.messages.slice(0, -1)
    : interview.messages;

  return `
    <aside class="ai-panel" data-testid="ai-panel">
      <div class="panel-kicker">${t('aiPanel.kicker', {}, state.locale)}</div>
      <h1>${state.projectLoaded ? t('aiPanel.titleLoaded', {}, state.locale) : t('aiPanel.titleNew', {}, state.locale)}</h1>
      ${interviewActive ? renderInterviewProgress(interview) : ''}
      <div class="thread" aria-live="polite">
        ${visibleMessages.map(renderMessage).join('')}
        ${state.thinking ? renderTypingIndicator() : ''}
      </div>
      ${interviewActive ? renderDecisions(interview) : ''}
      ${interview.pendingId && !state.thinking ? `
        <div class="quick-replies" data-testid="quick-replies">
          <button class="reply-chip" type="button" data-action="answer" data-answer="yes">${t('aiPanel.yes', {}, state.locale)}</button>
          <button class="reply-chip" type="button" data-action="answer" data-answer="no">${t('aiPanel.no', {}, state.locale)}</button>
        </div>
      ` : ''}
      <div class="plan">
        <div class="panel-kicker">${t('aiPanel.planKicker', {}, state.locale)}</div>
        ${planItems.map((item, index) => `
          <div class="plan-row ${state.built ? 'is-done' : ''}">
            <span>${state.built ? t('aiPanel.stepDone', {}, state.locale) : String(index + 1).padStart(2, '0')}</span>
            <p>${item}</p>
          </div>
        `).join('')}
      </div>
      <div class="ai-runtime">
        <span>${t('aiPanel.runtimeLabel', {}, state.locale)}</span>
        <strong>${formatRuntimeModeForDisplay()}</strong>
      </div>
      ${renderRuntimeWarning()}
      <form class="idea-form" data-action="send-idea">
        <label for="idea-input">${interview.status === 'interviewing' ? t('aiPanel.replyLabel', {}, state.locale) : t('aiPanel.ideaLabel', {}, state.locale)}</label>
        <textarea id="idea-input" name="idea" rows="3" placeholder="${t('aiPanel.ideaPlaceholder', {}, state.locale)}"></textarea>
        <button class="light-action" type="submit">${t('aiPanel.sendIdea', {}, state.locale)}</button>
      </form>
      ${state.awaitingConfirmation ? `
        <button class="light-action confirm-action" type="button" data-action="confirm">${t('aiPanel.confirm', {}, state.locale)}</button>
      ` : ''}
    </aside>
  `;
}

function renderInterviewProgress(interview) {
  const progress = interviewProgress(interview);
  const ready = isInterviewReady(interview);
  return `
    <div
      class="interview-progress"
      data-testid="interview-progress"
      role="progressbar"
      aria-valuenow="${progress}"
      aria-valuemin="0"
      aria-valuemax="100"
        aria-label="${t('aiPanel.progressAria', {}, state.locale)}"
    >
      <div class="interview-progress-head">
        <span class="panel-kicker">${ready ? t('aiPanel.progressReady', {}, state.locale) : t('aiPanel.progressRefining', {}, state.locale)}</span>
        <strong data-testid="interview-progress-value">${progress}%</strong>
      </div>
      <div class="interview-progress-track">
        <div class="interview-progress-fill" style="width: ${progress}%"></div>
      </div>
    </div>
  `;
}

function formatRuntimeModeForDisplay() {
  const mode = state.aiRuntimeMode.mode;
  if (mode === 'deepagents-live') {
    const freshness = runtimeFreshnessStatus();
    const restartSuffix = freshness === 'stale'
      ? state.locale === 'ko' ? ' · 재시작 필요' : ' · restart needed'
      : freshness === 'unknown'
        ? state.locale === 'ko' ? ' · 재시작 확인 필요' : ' · restart check needed'
        : '';
    return `Deepagents Live${state.aiRuntimeMode.model ? ` · ${state.aiRuntimeMode.model}` : ''}${restartSuffix}`;
  }
  if (mode === 'deepagents-unconfigured') {
    return state.locale === 'ko' ? 'Deepagents 설정 필요' : 'Deepagents setup needed';
  }
  if (mode === 'agent-server-offline') {
    return state.locale === 'ko' ? 'Agent 서버 꺼짐' : 'Agent server offline';
  }
  return mode;
}

function runtimeFreshnessStatus() {
  if (state.aiRuntimeMode.mode !== 'deepagents-live' || !state.aiRuntimeMode.ok) {
    return 'fresh';
  }

  if (state.aiRuntimeMode.sourceStatus?.stale) {
    return 'stale';
  }

  if (!state.aiRuntimeMode.sourceStatus || !state.aiRuntimeMode.serverStartedAt) {
    return 'unknown';
  }

  return 'fresh';
}

function renderRuntimeWarning() {
  const freshness = runtimeFreshnessStatus();
  const sourceStatus = state.aiRuntimeMode.sourceStatus;
  if (freshness === 'fresh') {
    return '';
  }

  const count = sourceStatus?.staleSourceFiles?.length || 0;
  const message = freshness === 'stale'
    ? state.locale === 'ko'
      ? `Agent 서버가 최신 코드보다 오래 실행 중입니다. 서버를 재시작하면 최신 시뮬레이션 로직이 반영됩니다.${count ? ` 변경된 서버 파일 ${count}개가 감지됐습니다.` : ''}`
      : `The agent server is older than the current source. Restart it to apply the latest simulation logic.${count ? ` ${count} changed server file(s) detected.` : ''}`
    : state.locale === 'ko'
      ? 'Agent 서버가 이전 health 형식을 반환하고 있어 최신 코드가 반영됐는지 확인할 수 없습니다. 서버를 재시작한 뒤 다시 테스트하세요.'
      : 'The agent server is returning an older health format, so the app cannot verify that the latest code is running. Restart the server and test again.';

  return `
    <p class="runtime-warning" data-testid="runtime-stale-warning">
      ${message}
    </p>
  `;
}

function refreshRuntimeModeLabel() {
  const label = app.querySelector('.ai-runtime strong');
  if (!label) {
    render();
    return;
  }
  label.textContent = formatRuntimeModeForDisplay();
  const warning = app.querySelector('[data-testid="runtime-stale-warning"]');
  const freshness = runtimeFreshnessStatus();
  if ((freshness !== 'fresh' && !warning) || (freshness === 'fresh' && warning)) {
    render();
  }
}

function renderDecisions(interview) {
  if (!interview.decisions.length) {
    return '';
  }
  return `
    <div class="interview-decisions" data-testid="interview-decisions">
      <div class="panel-kicker">${t('aiPanel.lockedDecisions', {}, state.locale)}</div>
      ${interview.decisions.map((decision) => `
        <div class="decision-chip" data-testid="decision-chip">
          <span>${escapeHtml(decision.label)}</span>
          <strong>${escapeHtml(decision.value)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMessage(message) {
  return `
    <article class="message ${escapeHtml(message.role)}">
      <span>${escapeHtml(t(`roles.${message.role}`, {}, state.locale))}</span>
      <p>${escapeHtml(message.text)}</p>
    </article>
  `;
}

function renderTypingIndicator() {
  return `
    <article class="message assistant is-typing" data-testid="ai-typing" aria-label="${t('aiPanel.typingAria', {}, state.locale)}">
      <span>${t('roles.assistant', {}, state.locale)}</span>
      <div class="typing-dots"><i></i><i></i><i></i></div>
    </article>
  `;
}

function renderNewProjectLanding() {
  return `
    <section class="new-project" data-testid="new-project-landing">
      <div class="new-project-inner">
        <div class="doc-status">${t('landing.status', {}, state.locale)}</div>
        <h2>${t('landing.title', {}, state.locale)}</h2>
        <p>${t('landing.body', {}, state.locale)}</p>
        <div class="landing-actions">
          <button class="primary-action" type="button" data-action="load-demo">${t('landing.loadDemo', {}, state.locale)}</button>
          <button class="button-outline" type="button" data-action="focus-idea">${t('landing.newProject', {}, state.locale)}</button>
        </div>
      </div>
    </section>
  `;
}

function renderFilesTab() {
  const selectedFile = getSelectedFile();
  const headings = getMarkdownHeadings(selectedFile.markdown);

  return `
    <article class="files-surface" data-testid="requirement-document">
      ${renderContextEvidencePanel()}
      <div class="markdown-shell">
        <div class="markdown-document" data-testid="requirement-markdown">
          ${renderMarkdown(selectedFile.markdown)}
        </div>
        <aside class="markdown-toc" data-testid="markdown-toc" aria-label="${t('files.tocAria', {}, state.locale)}">
          <div class="panel-kicker">${t('files.tocKicker', {}, state.locale)}</div>
          ${headings.filter((heading) => heading.level === 2).map((heading) => `
            <a href="#${heading.id}">${heading.text}</a>
          `).join('')}
        </aside>
      </div>
    </article>
  `;
}

function renderContextEvidencePanel() {
  const circuit = activeCircuit();
  const coverage = circuit.contextCoverage;
  if (!coverage) {
    return '';
  }

  const sourceTypes = [...new Set((circuit.contextTrace || []).map((entry) => entry.sourceType))]
    .filter(Boolean)
    .slice(0, 6);
  const warnings = coverage.warnings || [];
  const synthesisEligibility = formatSynthesisEligibility(coverage);
  const responseCoverage = formatCoveragePurposes(coverage);

  return `
    <section class="context-evidence-panel" data-testid="context-evidence-panel">
      <div>
        <span class="panel-kicker">${t('evidence.contextCoverage', {}, state.locale)}</span>
        <strong>${escapeHtml(coverage.status)}</strong>
      </div>
      <dl>
        <div>
          <dt>${t('evidence.score', {}, state.locale)}</dt>
          <dd>${Math.round((coverage.score || 0) * 100)}%</dd>
        </div>
        <div>
          <dt>${t('evidence.synthesisEligibility', {}, state.locale)}</dt>
          <dd data-testid="context-synthesis-eligibility">${escapeHtml(synthesisEligibility)}</dd>
        </div>
        <div>
          <dt>${t('evidence.responseCoverage', {}, state.locale)}</dt>
          <dd data-testid="context-response-coverage">${escapeHtml(responseCoverage)}</dd>
        </div>
        <div>
          <dt>${t('evidence.contextSources', {}, state.locale)}</dt>
          <dd>${escapeHtml(sourceTypes.join(', ') || t('evidence.notAvailable', {}, state.locale))}</dd>
        </div>
        <div>
          <dt>${t('evidence.warnings', {}, state.locale)}</dt>
          <dd>${escapeHtml(warnings.length ? warnings.slice(0, 2).join(' | ') : t('evidence.none', {}, state.locale))}</dd>
        </div>
      </dl>
    </section>
  `;
}

function formatSynthesisEligibility(coverage, locale = state.locale) {
  const rawStatus = coverage.synthesisEligibility?.status
    || ((coverage.sufficientFor || []).includes('valid_circuit_synthesis') ? 'eligible' : 'ineligible');
  const status = rawStatus === 'eligible' ? 'eligible' : 'ineligible';
  const label = t(`evidence.eligibility.${status}`, {}, locale);
  const reason = coverage.synthesisEligibility?.reason;
  return reason ? `${label}: ${reason}` : label;
}

function formatCoveragePurposes(coverage, locale = state.locale) {
  const purposes = coverage.sufficientFor || [];
  if (!purposes.length) {
    return t('evidence.none', {}, locale);
  }

  return purposes
    .map((purpose) => t(`evidence.purpose.${purpose}`, {}, locale))
    .join(', ');
}

function renderPcbTab() {
  const circuit = activeCircuit();
  const selectedTarget = currentInspectorTarget();
  const selectedFlowLabel = state.inspector.selectedRawTarget
    ? selectedTarget.label
    : t('simulationControls.noneSelected', {}, state.locale);
  return `
    <div class="pcb-surface">
      <div class="stage-host" data-stage-host></div>
      <div class="circuit-hover-tooltip is-hidden" data-testid="circuit-hover-tooltip">
        <span data-hover-kicker>${t('inspector.hoverKicker', {}, state.locale)}</span>
        <strong data-hover-title></strong>
        <p data-hover-summary></p>
      </div>
      ${renderPcbWarnings(circuit.renderWarnings || [])}
      <div class="stage-toolbar" aria-label="${t('pcb.toolbarAria', {}, state.locale)}">
        <button type="button" data-action="reset-view">${t('pcb.reset', {}, state.locale)}</button>
        <button type="button" data-action="toggle-simulation" data-testid="simulation-toggle">${state.simulationPlaying ? t('simulationControls.pause', {}, state.locale) : t('simulationControls.play', {}, state.locale)}</button>
        <button type="button" data-action="step-simulation" data-testid="simulation-step">${t('simulationControls.step', {}, state.locale)}</button>
        <span class="selected-target-chip" data-testid="selected-target-chip">
          ${t('simulationControls.selectedPath', {}, state.locale)}: <strong>${escapeHtml(selectedFlowLabel)}</strong>
        </span>
        <span>${t('pcb.output', {}, state.locale)}: <strong data-testid="oled-output">${state.running ? circuit.runText : t('pcb.ready', {}, state.locale)}</strong></span>
        <button type="button" data-action="fit-view">${t('pcb.fit', {}, state.locale)}</button>
      </div>
    </div>
  `;
}

function renderPcbWarnings(warnings) {
  if (!warnings.length) {
    return '';
  }

  return `
    <section class="render-warning-panel" data-testid="render-warning-panel">
      <strong>${escapeHtml(renderWarningTitle(state.locale))}</strong>
      ${warnings.map((warning) => `
        <p><span>${escapeHtml(warning.code)}</span> ${escapeHtml(warning.componentId || '')}: ${escapeHtml(warning.message)}</p>
      `).join('')}
    </section>
  `;
}

function renderRightRail() {
  if (state.activeTab === 'PCB' && state.projectLoaded) {
    return `
      <aside class="right-rail simulation-rail" data-testid="circuit-inspector">
        ${renderHardwarePanel()}
        ${renderCircuitChatDrawer()}
      </aside>
    `;
  }

  return renderFileExplorer();
}

function renderFileExplorer() {
  const files = projectFiles();
  return `
    <aside class="right-rail file-rail" data-testid="file-explorer">
      <div class="rail-header">
        <div class="panel-kicker">${t('files.explorerKicker', {}, state.locale)}</div>
        <h2>${t('files.explorerTitle', {}, state.locale)}</h2>
      </div>
      <div class="file-list">
        ${state.projectLoaded ? files.map((file) => `
          <button
            type="button"
            class="file-item ${state.selectedFileId === file.id ? 'is-selected' : ''}"
            data-file-id="${file.id}"
          >
            <span class="file-icon">MD</span>
            <span>
              <strong>${file.name}</strong>
              <small>${file.path}</small>
            </span>
          </button>
        `).join('') : `
          <div class="empty-file-list">
            <span class="file-icon">MD</span>
            <p>${t('files.empty', {}, state.locale)}</p>
          </div>
        `}
      </div>
    </aside>
  `;
}

function renderHardwarePanel() {
  const circuit = activeCircuit();
  const target = currentInspectorTarget();
  const selected = state.inspector.selectedRawTarget;

  return `
    <div class="hardware-panel" data-testid="hardware-panel">
      <div class="rail-header simulation-rail-header">
        <div>
          <div class="panel-kicker">${t('inspector.hardwareKicker', {}, state.locale)}</div>
          <h2>${t('inspector.hardwareTitle', {}, state.locale)}</h2>
        </div>
        <button
          class="button-outline rail-chat-toggle ${state.inspector.chatOpen ? 'is-active' : ''}"
          type="button"
          data-action="toggle-circuit-chat"
          data-testid="circuit-chat-toggle"
          aria-expanded="${state.inspector.chatOpen}"
          aria-controls="circuit-chat-panel"
        >${state.inspector.chatOpen ? t('inspector.chatToggleClose', {}, state.locale) : t('inspector.chatToggleOpen', {}, state.locale)}</button>
      </div>
      <section class="inspector-card" data-testid="inspector-selected">
        <div class="inspector-selected-label">${selected ? t('inspector.selectedContext', {}, state.locale) : t('inspector.emptyTitle', {}, state.locale)}</div>
        <span class="inspector-target-label">${target.label}</span>
        <h3>${target.title}</h3>
        <p>${target.detail || target.summary}</p>
        <dl>
          <div>
            <dt>${t('inspector.why', {}, state.locale)}</dt>
            <dd>${target.why}</dd>
          </div>
          <div>
            <dt>${t('inspector.missing', {}, state.locale)}</dt>
            <dd>${target.missing}</dd>
          </div>
        </dl>
        ${selected ? '' : renderInspectorTargetSelector(circuit)}
        <button class="button-outline inspector-chat-open" type="button" data-action="open-circuit-chat">${t('inspector.openChat', {}, state.locale)}</button>
      </section>
      <section class="hardware-connections" data-testid="connection-list">
        <div class="panel-kicker">${t('inspector.connectionsTitle', {}, state.locale)}</div>
        <div class="connection-list">
          ${circuit.connections.map((connection) => renderConnectionButton(connection, target)).join('')}
        </div>
      </section>
      <section class="inspector-parts" data-testid="part-library">
        <div class="panel-kicker">${t('inspector.partsTitle', {}, state.locale)}</div>
        <div class="inspector-part-list">
          ${circuit.parts.map((part) => `
            <button
              type="button"
              class="inspector-part ${target.id === `part:${part.id}` ? 'is-selected' : ''}"
              data-inspect-type="part"
              data-inspect-id="${part.id}"
              aria-label="${t('inspector.selectPart', { label: part.label }, state.locale)}"
            >
              <img
                class="part-thumb-render"
                data-testid="part-thumbnail"
                data-thumbnail-renderer="canvas-isometric"
                src="${createPartThumbnail(part)}"
                alt="${t('parts.thumbAlt', { label: part.label }, state.locale)}"
              />
              <span>
                <strong>${part.label}</strong>
                <small>${part.designator || part.type}</small>
              </span>
            </button>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderInspectorTargetSelector(circuit) {
  const connections = circuit.connections || [];
  if (!connections.length) {
    return '';
  }

  return `
    <section class="inspector-target-selector" data-testid="inspector-target-selector" aria-label="${t('inspector.targetSelectorTitle', {}, state.locale)}">
      <div class="panel-kicker">${t('inspector.targetSelectorTitle', {}, state.locale)}</div>
      <div class="inspector-target-list">
        ${connections.map((connection) => `
          <button
            type="button"
            class="target-select-button"
            data-action="select-target"
            data-target-id="connection:${escapeHtml(connection.id)}"
          >
            <span class="connection-signal" style="--wire-color: ${escapeHtml(connection.color || '#1863dc')}"></span>
            <span>${escapeHtml(connection.education.label)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderConnectionButton(connection, target) {
  const isSelected = target.type === 'connection' && target.connectionId === connection.id;
  return `
    <button
      type="button"
      class="connection-item ${isSelected ? 'is-selected' : ''}"
      data-testid="connection-item"
      data-inspect-type="connection"
      data-inspect-id="${connection.id}"
      aria-label="${t('inspector.selectConnection', { label: connection.education.label }, state.locale)}"
    >
      <span class="connection-signal" style="--wire-color: ${escapeHtml(connection.color || '#1863dc')}"></span>
      <span>
        <strong>${connection.education.label}</strong>
        <small>${connection.education.title}</small>
      </span>
    </button>
  `;
}

function renderCircuitChatDrawer() {
  if (!state.inspector.chatOpen) {
    return '';
  }

  const target = currentInspectorTarget();
  const targetLabel = chatTargetLabel(target);
  const messages = state.inspector.chatMessages;

  return `
    <section id="circuit-chat-panel" class="circuit-chat-drawer" data-testid="tutor-chat" role="dialog" aria-label="${t('inspector.chatTitle', {}, state.locale)}">
      <div class="chat-drawer-header">
        <div>
          <div class="panel-kicker">${t('inspector.chatKicker', {}, state.locale)}</div>
          <h2>${t('inspector.chatTitle', {}, state.locale)}</h2>
        </div>
        <button class="button-outline chat-close" type="button" data-action="close-circuit-chat">${t('inspector.closeChat', {}, state.locale)}</button>
      </div>
      <div class="chat-target-context">
        <span class="chat-context-label">${t('inspector.currentSelection', {}, state.locale)}</span>
        <span class="inspector-target-label">${targetLabel}</span>
        <p>${target.summary}</p>
      </div>
      <section class="inspector-suggestions" data-testid="inspector-suggestions">
        <div class="panel-kicker">${t('inspector.suggestions', {}, state.locale)}</div>
        ${target.questions.map((question) => `
          <button class="inspector-question" type="button" data-action="suggested-question" data-question="${escapeHtml(question)}">${question}</button>
        `).join('')}
      </section>
      <div class="tutor-thread" data-testid="tutor-thread">
        ${messages.length ? messages.map(renderTutorMessage).join('') : `<p class="tutor-empty">${t('inspector.emptyChat', {}, state.locale)}</p>`}
        ${state.inspector.tutorThinking ? `<p class="tutor-thinking" data-testid="tutor-thinking">${t('inspector.thinking', {}, state.locale)}</p>` : ''}
      </div>
      <form class="tutor-form" data-action="ask-tutor">
        <input name="question" type="text" placeholder="${t('inspector.chatPlaceholder', {}, state.locale)}" aria-label="${t('inspector.chatTitle', {}, state.locale)}" />
        <button class="primary-action" type="submit">${t('inspector.ask', {}, state.locale)}</button>
      </form>
    </section>
  `;
}

function chatTargetLabel(target) {
  return target.type === 'circuit' ? target.title : target.label;
}

function renderTutorMessage(message) {
  return `
    <article class="tutor-message ${message.role}" data-testid="tutor-message">
      <span>${message.role === 'student' ? t('inspector.student', {}, state.locale) : t('inspector.tutor', {}, state.locale)}</span>
      <p>${escapeHtml(message.text)}</p>
    </article>
  `;
}

function renderPartLibrary() {
  const circuit = activeCircuit();
  const selectedPart = circuit.parts.find((part) => part.id === 'oled-display');

  return `
    <aside class="right-rail part-rail" data-testid="part-library">
      <div class="rail-header">
        <div class="panel-kicker">${t('parts.railKicker', {}, state.locale)}</div>
        <h2>${t('parts.railTitle', {}, state.locale)}</h2>
      </div>
      <div class="library">
        ${circuit.parts.map((part) => `
          <article class="library-item">
            <img
              class="part-thumb-render"
              data-testid="part-thumbnail"
              data-thumbnail-renderer="canvas-isometric"
              src="${createPartThumbnail(part)}"
              alt="${t('parts.thumbAlt', { label: part.label }, state.locale)}"
            />
            <div>
              <strong>${part.label}</strong>
              <p>${part.description}</p>
            </div>
          </article>
        `).join('')}
      </div>
      <div class="properties">
        <div class="panel-kicker">${t('parts.selected', {}, state.locale)}</div>
        <h2>${selectedPart.label}</h2>
        ${selectedPart.pins.map((pin) => `
          <div class="property-row">
            <span>${formatPinName(pin.name)}</span>
            <p>${pin.meaning || pin.role}</p>
          </div>
        `).join('')}
      </div>
    </aside>
  `;
}

function bindEvents() {
  app.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.activeTab = tab.dataset.tab;
      render();
      focusPcbStageOnNarrowScreens();
    });
  });

  app.querySelectorAll('[data-action="load-demo"]').forEach((button) => {
    button.addEventListener('click', loadDemoProject);
  });

  app.querySelectorAll('[data-locale]').forEach((button) => {
    button.addEventListener('click', () => switchLocale(button.dataset.locale));
  });

  app.querySelector('[data-action="focus-idea"]')?.addEventListener('click', () => {
    app.querySelector('#idea-input')?.focus();
  });

  app.querySelectorAll('[data-file-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedFileId = button.dataset.fileId;
      render();
    });
  });

  bindInspectorEvents(app);

  const form = app.querySelector('[data-action="send-idea"]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = new FormData(form).get('idea')?.toString().trim();
    if (!input) {
      return;
    }

    submitAgentMessage(input);
  });

  app.querySelectorAll('[data-action="answer"]').forEach((button) => {
    button.addEventListener('click', () => submitInterviewAnswer(button.dataset.answer));
  });

  app.querySelector('[data-action="open-library"]')?.addEventListener('click', openLibraryBrowser);
  app.querySelector('[data-action="share"]')?.addEventListener('click', openShareModal);

  app.querySelector('[data-action="run"]').addEventListener('click', () => {
    if (!state.projectLoaded) {
      return;
    }

    state.built = true;
    state.awaitingConfirmation = false;
    state.running = true;
    state.simulationPlaying = true;
    state.activeTab = 'PCB';
    render();
    focusPcbStageOnNarrowScreens();
  });

  app.querySelector('[data-action="toggle-simulation"]')?.addEventListener('click', () => {
    if (!state.projectLoaded) {
      return;
    }

    state.simulationPlaying = !state.simulationPlaying;
    state.running = state.simulationPlaying;
    state.activeTab = 'PCB';
    render();
  });

  app.querySelector('[data-action="step-simulation"]')?.addEventListener('click', () => {
    stepCurrentFlow();
  });

  app.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
    confirmCurrentAgentResult();
  });
}

function bindShareViewEvents() {
  app.querySelector('[data-action="share-import"]')?.addEventListener('click', importSharedSnapshot);
  app.querySelector('[data-action="share-create-own"]')?.addEventListener('click', startNewProjectFromShareView);
}

function focusPcbStageOnNarrowScreens() {
  if (state.activeTab !== 'PCB' || !state.projectLoaded) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (!window.matchMedia('(max-width: 780px)').matches) {
      return;
    }

    app.querySelector('[data-testid="center-stage"]')?.scrollIntoView({
      block: 'start',
      behavior: 'auto'
    });
  });
}

function bindInspectorEvents(root) {
  root.querySelectorAll('[data-inspect-type]').forEach((element) => {
    const rawTarget = inspectTargetFromElement(element);
    element.addEventListener('mouseenter', () => updateHoveredCircuitTarget(rawTarget));
    element.addEventListener('click', () => selectCircuitTarget(rawTarget));
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectCircuitTarget(rawTarget);
      }
    });
  });

  root.querySelectorAll('[data-action="select-target"]').forEach((button) => {
    button.addEventListener('click', () => {
      const rawTarget = rawTargetFromId(button.dataset.targetId);
      if (rawTarget) {
        selectCircuitTarget(rawTarget);
      }
    });
  });

  root.querySelectorAll('[data-action="suggested-question"]').forEach((button) => {
    button.addEventListener('click', () => {
      submitTutorQuestion(button.dataset.question);
    });
  });

  root.querySelector('[data-action="toggle-circuit-chat"]')?.addEventListener('click', () => {
    const opening = !state.inspector.chatOpen;
    state.inspector.chatOpen = opening;
    refreshInspectorRail();
    if (opening) {
      focusTutorInput();
    } else {
      focusCircuitChatToggle();
    }
  });

  root.querySelector('[data-action="open-circuit-chat"]')?.addEventListener('click', () => {
    state.inspector.chatOpen = true;
    refreshInspectorRail();
    focusTutorInput();
  });

  root.querySelector('[data-action="close-circuit-chat"]')?.addEventListener('click', () => {
    state.inspector.chatOpen = false;
    refreshInspectorRail();
    focusCircuitChatToggle();
  });

  root.querySelector('[data-action="ask-tutor"]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = new FormData(event.currentTarget).get('question')?.toString().trim();
    if (!question) {
      return;
    }
    event.currentTarget.reset();
    submitTutorQuestion(question);
  });
}

function refreshInspectorRail() {
  const rail = app.querySelector('[data-testid="circuit-inspector"]');
  if (!rail || state.activeTab !== 'PCB' || !state.projectLoaded) {
    render();
    return;
  }

  rail.innerHTML = `
    ${renderHardwarePanel()}
    ${renderCircuitChatDrawer()}
  `;
  bindInspectorEvents(rail);
}

function submitInterviewAnswer(answer) {
  state.interview = answerInterview(state.interview, answer, state.locale);
  state.awaitingConfirmation = true;
  beginThinking();
}

async function submitAgentMessage(message) {
  if (state.thinking) {
    return;
  }

  const turnRoute = classifyStudentTurn(message, {
    hasBuildableDraft: Boolean(state.awaitingConfirmation && canBuildAgentResult(state.agentResult)),
    hasCurrentArtifact: Boolean(state.agentResult || state.projectLoaded)
  });

  if (turnRoute.route === 'confirm-current-draft') {
    state.interview = {
      ...state.interview,
      status: 'ready',
      messages: nextAgentThreadMessages(message).concat({
        role: 'assistant',
        text: state.locale === 'ko'
          ? '좋아요. 방금 검증한 회로 초안으로 구성해 볼게요.'
          : 'Okay. I will build the validated circuit draft.'
      })
    };
    confirmCurrentAgentResult();
    return;
  }

  if (turnRoute.route === 'current-artifact-question') {
    await answerCurrentArtifactQuestion(message);
    return;
  }

  const conversationContext = turnRoute.route === 'revise-current-draft'
    ? buildConversationContext()
    : undefined;

  state.interview = {
    ...createInterview(state.locale),
    status: 'interviewing',
    idea: message,
    pendingId: null,
    decisions: [],
    messages: nextAgentThreadMessages(message)
  };
  state.awaitingConfirmation = false;
  state.agentResult = null;
  state.built = false;
  state.running = false;
  state.projectLoaded = false;
  state.activeTab = 'Files';
  resetInspectorState();
  state.thinking = true;
  render();

  try {
    const [result] = await Promise.all([
      sendAgentMessage({
        sessionId: state.agentSessionId,
        message,
        locale: state.locale,
        conversationContext
      }),
      wait(TYPING_REVEAL_MS)
    ]);

    const groundedResult = groundAgentResultArtifacts(result);
    state.agentSessionId = groundedResult.sessionId;
    state.agentResult = groundedResult;
    state.interview = {
      ...state.interview,
      status: canBuildAgentResult(groundedResult) ? 'ready' : 'interviewing',
      decisions: agentEventsToDecisions(groundedResult.agentEvents || []),
      messages: state.interview.messages.concat(
        (groundedResult.assistantMessages?.length ? groundedResult.assistantMessages : [fallbackAgentMessage(groundedResult)])
          .map((text) => ({ role: 'assistant', text }))
      )
    };
    state.awaitingConfirmation = canBuildAgentResult(groundedResult);
  } catch (error) {
    const messageText = formatAgentErrorMessage(error, state.locale, { studentMessage: message });
    state.interview = {
      ...state.interview,
      status: 'interviewing',
      decisions: [],
      messages: state.interview.messages.concat({ role: 'assistant', text: messageText })
    };
    state.awaitingConfirmation = false;
    state.aiRuntimeMode = await getAiRuntimeMode();
  } finally {
    state.thinking = false;
    render();
  }
}

async function answerCurrentArtifactQuestion(message) {
  const circuit = activeArtifactCircuit();
  const target = describeCircuitTarget(circuit, null, state.locale);
  state.interview = {
    ...state.interview,
    status: state.awaitingConfirmation || state.agentResult ? 'ready' : state.interview.status,
    messages: nextAgentThreadMessages(message)
  };
  state.thinking = true;
  render();

  try {
    const [response] = await Promise.all([
      askCircuitTutor({
        circuit,
        target,
        question: message,
        locale: state.locale,
        running: state.running
      }),
      wait(TYPING_REVEAL_MS)
    ]);

    state.interview = {
      ...state.interview,
      messages: state.interview.messages.concat({
        role: 'assistant',
        text: response.message
      })
    };
  } catch (error) {
    state.interview = {
      ...state.interview,
      messages: state.interview.messages.concat({
        role: 'assistant',
        text: formatAgentErrorMessage(error, state.locale, { studentMessage: message })
      })
    };
  } finally {
    state.thinking = false;
    render();
  }
}

function nextAgentThreadMessages(message) {
  const priorMessages = state.interview.status === 'idle' ? [] : state.interview.messages;
  return priorMessages.concat({ role: 'student', text: message });
}

function canBuildAgentResult(result) {
  return result?.validationReport?.status === 'valid'
    && result?.simulationPlan?.status === 'valid'
    && (result?.renderPlan?.parts?.length || 0) > 0;
}

function confirmCurrentAgentResult() {
  if (state.agentResult && canBuildAgentResult(state.agentResult)) {
    state.project = createProjectFromAgentResult(state.agentResult);
    state.selectedFileId = state.project.files[0]?.id || 'deepagent-requirements';
  } else {
    state.interview = demoInterviewState(state.locale);
    state.project = createLocalizedProject(state.locale);
    state.selectedFileId = 'demo-requirements';
  }
  state.awaitingConfirmation = false;
  cancelThinking();
  render();
  startBuildSequence();
}

function agentEventsToDecisions(events) {
  return events.slice(0, 6).map((event) => ({
    id: event.name,
    label: studentFacingEventLabel(event.name, state.locale),
    value: studentFacingEventSummary(event.summary || event.status, state.locale),
    status: event.status === 'error' ? 'warning' : 'locked'
  }));
}

function studentFacingEventLabel(name, locale) {
  const key = String(name || '').toLowerCase();
  const labels = {
    ko: [
      [/context[-_ ]?support[-_ ]?gap|support[-_ ]?gap/, '지원 준비 확인'],
      [/safety/, '안전 확인'],
      [/unsupported|support/, '지원 범위 확인'],
      [/intent/, '요구사항 확인'],
      [/validator|validation|constraint/, '회로 검토'],
      [/simulation/, '시뮬레이션 확인'],
      [/render|visual/, '화면 준비'],
      [/context|retriever|trace/, '참고 자료 확인'],
      [/coordinator|deepagents|agent/, '요청 정리']
    ],
    en: [
      [/context[-_ ]?support[-_ ]?gap|support[-_ ]?gap/, 'Support readiness check'],
      [/safety/, 'Safety check'],
      [/unsupported|support/, 'Support check'],
      [/intent/, 'Requirement check'],
      [/validator|validation|constraint/, 'Circuit review'],
      [/simulation/, 'Simulation check'],
      [/render|visual/, 'View preparation'],
      [/context|retriever|trace/, 'Reference check'],
      [/coordinator|deepagents|agent/, 'Request review']
    ]
  };

  const match = labels[locale === 'ko' ? 'ko' : 'en'].find(([pattern]) => pattern.test(key));
  if (match) {
    return match[1];
  }

  return key
    .replaceAll('-', ' ')
    .replace(/\b(deepagents?|agent|coordinator|subagent|tool)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || (locale === 'ko' ? '확인' : 'Check');
}

function studentFacingEventSummary(summary, locale) {
  const raw = String(summary || '').trim();
  if (!raw) {
    return locale === 'ko' ? '확인했습니다.' : 'Checked.';
  }

  if (/context[-_ ]?support[-_ ]?gap|canonical context|valid synthesis|planned capability|part[-_ ]?capability|render[-_ ]?footprint|simulation[-_ ]?primitive|context coverage|support gap/i.test(raw)) {
    return locale === 'ko'
      ? '아직 검증 자료가 부족해 회로를 만들기 전에 지원 범위를 확인했습니다.'
      : 'Checked that this request needs more verified context before circuit synthesis.';
  }

  if (/structured circuit draft|deepagents|coordinator|subagent|tool call|trace|stack/i.test(raw)) {
    return locale === 'ko'
      ? '요청을 검토하고 회로로 만들 수 있는지 확인했습니다.'
      : 'Reviewed whether the request can become a circuit.';
  }

  return raw
    .replace(/\bDeepagents?\b/g, locale === 'ko' ? 'AI' : 'AI')
    .replace(/\b(coordinator|subagent|tool call|trace)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackAgentMessage(result) {
  if (result?.clarification) {
    return result.clarification;
  }
  return state.locale === 'ko'
    ? 'Deepagents가 회로 초안을 만들었지만 표시할 답변이 비어 있습니다.'
    : 'Deepagents created a circuit draft, but the response text was empty.';
}

function agentErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL|configured|configuration/i.test(raw)) {
    return state.locale === 'ko'
      ? '실제 Deepagents 서버 설정이 필요합니다. 서버 프로세스에 OPENAI_API_KEY와 H_EDUWARE_AGENT_MODEL을 설정한 뒤 다시 보내 주세요.'
      : 'The live Deepagents server is not configured. Set OPENAI_API_KEY and H_EDUWARE_AGENT_MODEL on the server process, then send again.';
  }
  if (/Failed to fetch|offline|timed out|timeout/i.test(raw)) {
    return state.locale === 'ko'
      ? 'Deepagents 서버에 연결할 수 없습니다. npm run agent:dev가 실행 중인지 확인해 주세요.'
      : 'I cannot reach the Deepagents server. Check that npm run agent:dev is running.';
  }
  return state.locale === 'ko'
    ? `Deepagents 실행 중 오류가 발생했습니다: ${raw}`
    : `Deepagents failed: ${raw}`;
}

function createProjectFromAgentResult(result) {
  const renderWarnings = result.renderPlan?.warnings || [];
  const circuit = {
    title: result.renderPlan.title,
    runText: result.simulationPlan.runText || result.renderPlan.runText,
    parts: result.renderPlan.parts,
    connections: result.renderPlan.connections,
    floatingCards: result.renderPlan.floatingCards || [],
    validationReport: result.validationReport,
    simulationPlan: result.simulationPlan,
    renderWarnings,
    circuitSpec: result.circuitSpec,
    contextTrace: result.contextTrace || [],
    contextCoverage: result.contextCoverage || null
  };
  const id = result.circuitSpec?.id || 'deepagent-circuit';

  return {
    circuit,
    files: [
      {
        id: 'deepagent-requirements',
        name: state.locale === 'ko' ? '회로 요구사항.md' : 'Deepagents requirements.md',
        path: `requirements/${id}.md`,
        kind: 'Markdown',
        status: result.validationReport.status,
        markdown: result.requirementMarkdown
      },
      {
        id: 'deepagent-context-trace',
        name: state.locale === 'ko' ? '참고 자료.md' : 'Context trace.md',
        path: `agent/${id}-context-trace.md`,
        kind: 'Markdown',
        status: result.contextCoverage?.status || 'grounded',
        markdown: contextTraceToMarkdown(result.contextTrace || [], state.locale, result.contextCoverage)
      }
    ].concat(renderWarnings.length ? [{
      id: 'deepagent-render-warnings',
      name: state.locale === 'ko' ? '시각화 경고.md' : 'Render warnings.md',
      path: `agent/${id}-render-warnings.md`,
      kind: 'Markdown',
      status: 'warning',
      markdown: renderWarningsMarkdown(renderWarnings, state.locale)
    }] : [])
  };
}

function activeArtifactCircuit() {
  if (state.agentResult && canBuildAgentResult(state.agentResult)) {
    return createProjectFromAgentResult(state.agentResult).circuit;
  }
  return activeCircuit();
}

function buildConversationContext() {
  const currentArtifact = state.projectLoaded
    ? artifactSnapshotFromProject(state.project, 'built-project')
    : state.agentResult
      ? artifactSnapshotFromAgentResult(state.agentResult, 'draft')
      : undefined;

  return {
    recentTurns: state.interview.messages.slice(-12).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'student',
      text: message.text
    })),
    currentArtifact,
    lastSupportedGoal: state.agentResult?.circuitSpec?.intent?.primaryGoal
      || state.project?.circuit?.circuitSpec?.intent?.primaryGoal
      || state.interview.idea
      || undefined,
    awaitingBuildConfirmation: Boolean(state.awaitingConfirmation && state.agentResult)
  };
}

function artifactSnapshotFromAgentResult(result, source) {
  return {
    source,
    title: result.renderPlan?.title || result.circuitSpec?.title || 'Current circuit draft',
    requirementMarkdown: result.requirementMarkdown,
    circuitSpec: result.circuitSpec,
    validationReport: result.validationReport,
    renderPlan: result.renderPlan,
    simulationPlan: result.simulationPlan
  };
}

function artifactSnapshotFromProject(project, source) {
  const circuit = project?.circuit;
  const requirementFile = project?.files?.find((file) => file.kind === 'Markdown' && /requirement|요구|회로/i.test(`${file.id} ${file.name} ${file.path}`))
    || project?.files?.find((file) => file.kind === 'Markdown');

  if (!circuit) {
    return undefined;
  }

  return {
    source,
    title: circuit.title || 'Current circuit',
    requirementMarkdown: requirementFile?.markdown,
    circuitSpec: circuit.circuitSpec,
    validationReport: circuit.validationReport,
    renderPlan: circuit.circuitSpec && circuit.simulationPlan ? {
      title: circuit.title || 'Current circuit',
      runText: circuit.runText || circuit.simulationPlan.runText || 'READY',
      parts: circuit.parts,
      connections: circuit.connections || [],
      floatingCards: circuit.floatingCards || [],
      warnings: circuit.renderWarnings || []
    } : undefined,
    simulationPlan: circuit.simulationPlan
  };
}

function contextTraceToMarkdown(contextTrace, locale, contextCoverage) {
  const title = locale === 'ko' ? '참고 자료 확인' : 'Context Layer Grounding';
  const intro = locale === 'ko'
    ? '회로를 만들기 전에 서버가 확인한 참고 자료입니다.'
    : 'Context evidence forced into the Deepagents workflow before circuit synthesis.';
  const missingSourcesLabel = locale === 'ko' ? '부족한 자료 유형' : 'Missing source types';
  const coverageFallback = locale === 'ko' ? '- 참고 자료 확인 결과가 없습니다.' : '- No context coverage report was returned.';
  const sourcesFallback = locale === 'ko' ? '- 참고 자료 기록이 없습니다.' : '- No context trace was returned.';
  const reasonLabel = locale === 'ko' ? '이유' : 'Reason';
  const fieldsLabel = locale === 'ko' ? '사용한 항목' : 'Used fields';
  const coverageRows = contextCoverage
    ? [
      `- ${t('evidence.status', {}, locale)}: ${contextCoverage.status}`,
      `- ${t('evidence.score', {}, locale)}: ${Math.round(contextCoverage.score * 100)}%`,
      `- ${t('evidence.synthesisEligibility', {}, locale)}: ${formatSynthesisEligibility(contextCoverage, locale)}`,
      `- ${t('evidence.responseCoverage', {}, locale)}: ${formatCoveragePurposes(contextCoverage, locale)}`,
      `- ${t('evidence.contextSources', {}, locale)}: ${(contextCoverage.presentSourceTypes || []).join(', ') || t('evidence.none', {}, locale)}`,
      `- ${missingSourcesLabel}: ${(contextCoverage.missingSourceTypes || []).join(', ') || t('evidence.none', {}, locale)}`,
      `- ${t('evidence.warnings', {}, locale)}: ${(contextCoverage.warnings || []).join(' | ') || t('evidence.none', {}, locale)}`
    ].join('\n')
    : coverageFallback;
  const rows = contextTrace.length
    ? contextTrace.map((entry) => [
      `- **${entry.sourceId}**`,
      `  - ${reasonLabel}: ${entry.reason}`,
      `  - ${fieldsLabel}: ${(entry.usedFields || []).join(', ') || 'summary'}`
    ].join('\n')).join('\n')
    : sourcesFallback;

  return `# ${title}

${intro}

## ${locale === 'ko' ? '확인 결과' : 'Coverage'}

${coverageRows}

## ${locale === 'ko' ? '자료' : 'Sources'}

${rows}
`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inspectTargetFromElement(element) {
  return {
    type: element.dataset.inspectType,
    connectionId: element.dataset.inspectType === 'connection' ? element.dataset.inspectId : undefined,
    partId: element.dataset.inspectType === 'part' ? element.dataset.inspectId : undefined
  };
}

function currentInspectorTarget() {
  const rawTarget = state.inspector.selectedRawTarget || state.inspector.hoveredRawTarget;
  return describeCircuitTarget(activeCircuit(), rawTarget, state.locale);
}

function updateHoveredCircuitTarget(rawTarget) {
  state.inspector.hoveredRawTarget = rawTarget;
  const target = describeCircuitTarget(activeCircuit(), rawTarget, state.locale);
  paintHoverTarget(target, Boolean(rawTarget));
}

function selectCircuitTarget(rawTarget) {
  const previousKey = rawTargetKey(state.inspector.selectedRawTarget);
  const nextKey = rawTargetKey(rawTarget);
  state.inspector.selectedRawTarget = rawTarget;
  state.inspector.hoveredRawTarget = rawTarget;
  state.selectedCurrentPathId = rawTarget?.connectionId ?? null;
  if (previousKey !== nextKey) {
    state.inspector.chatMessages = [];
  }
  refreshInspectorRail();
  syncSelectedTargetPresentation();
}

function stepCurrentFlow() {
  const connections = activeCircuit().connections || [];
  if (!state.projectLoaded || connections.length === 0) {
    return;
  }

  const index = state.simulationStepIndex % connections.length;
  const connection = connections[index];
  state.simulationStepIndex = (index + 1) % connections.length;
  state.selectedCurrentPathId = connection.id;
  state.inspector.selectedRawTarget = {
    type: 'connection',
    connectionId: connection.id
  };
  state.inspector.hoveredRawTarget = state.inspector.selectedRawTarget;
  state.inspector.chatMessages = [];
  state.simulationPlaying = true;
  state.running = true;
  state.activeTab = 'PCB';
  render();
}

async function submitTutorQuestion(question) {
  const target = currentInspectorTarget();
  state.inspector.selectedRawTarget ||= rawTargetFromTarget(target);
  state.inspector.chatOpen = true;
  state.inspector.chatMessages = state.inspector.chatMessages.concat({
    role: 'student',
    text: question
  });
  state.inspector.tutorThinking = true;
  refreshInspectorRail();

  const response = await askCircuitTutor({
    circuit: activeCircuit(),
    target,
    question,
    locale: state.locale,
    running: state.running
  });

  state.inspector.chatMessages = state.inspector.chatMessages.concat({
    role: 'assistant',
    text: response.message
  });
  state.inspector.tutorThinking = false;
  refreshInspectorRail();
}

function focusTutorInput() {
  if (!state.inspector.chatOpen) {
    return;
  }
  requestAnimationFrame(() => {
    app.querySelector('[data-action="ask-tutor"] input')?.focus();
  });
}

function focusCircuitChatToggle() {
  requestAnimationFrame(() => {
    app.querySelector('[data-testid="circuit-chat-toggle"]')?.focus();
  });
}

function rawTargetFromTarget(target) {
  if (target.type === 'connection') {
    return { type: 'connection', connectionId: target.connectionId };
  }
  if (target.type === 'part') {
    return { type: 'part', partId: target.partId };
  }
  return null;
}

function rawTargetFromId(targetId) {
  const [type, id] = String(targetId || '').split(':');
  if (!type || !id) {
    return null;
  }
  if (type === 'connection') {
    return { type: 'connection', connectionId: id };
  }
  if (type === 'part') {
    return { type: 'part', partId: id };
  }
  return null;
}

function rawTargetKey(rawTarget) {
  if (!rawTarget) {
    return '';
  }
  return [
    rawTarget.type || rawTarget.kind || '',
    rawTarget.connectionId || rawTarget.partId || rawTarget.id || ''
  ].join(':');
}

function syncSelectedTargetPresentation() {
  const target = currentInspectorTarget();
  const chipLabel = app.querySelector('[data-testid="selected-target-chip"] strong');
  if (chipLabel) {
    chipLabel.textContent = state.inspector.selectedRawTarget
      ? target.label
      : t('simulationControls.noneSelected', {}, state.locale);
  }

  const canvas = app.querySelector('[data-testid="stage-canvas"]');
  if (canvas) {
    canvas.dataset.selectedTarget = rawTargetKey(state.inspector.selectedRawTarget);
  }
}

function paintHoverTarget(target, visible) {
  const tooltip = app.querySelector('[data-testid="circuit-hover-tooltip"]');
  tooltip?.classList.toggle('is-hidden', !visible);
  if (tooltip) {
    tooltip.querySelector('[data-hover-title]').textContent = target.label;
    tooltip.querySelector('[data-hover-summary]').textContent = target.summary;
  }
}

function switchLocale(locale) {
  const nextLocale = setLocale(locale);
  if (nextLocale === state.locale) {
    return;
  }

  state.locale = nextLocale;
  document.documentElement.lang = nextLocale;
  state.project = state.agentResult && state.projectLoaded
    ? createProjectFromAgentResult(state.agentResult)
    : createLocalizedProject(nextLocale);
  state.inspector.chatMessages = [];
  state.inspector.tutorThinking = false;
  state.inspector.chatOpen = false;

  if (state.interview.status === 'idle') {
    state.interview = createInterview(nextLocale);
  } else if (!state.agentResult && (state.projectLoaded || state.interview.status === 'ready')) {
    state.interview = demoInterviewState(nextLocale);
  }

  render();
}

// Shows the typing indicator, then reveals the assistant's latest reply.
function beginThinking() {
  state.thinking = true;
  render();
  clearTimeout(thinkingTimer);
  thinkingTimer = setTimeout(() => {
    state.thinking = false;
    render();
  }, TYPING_REVEAL_MS);
}

// Cancels any in-flight typing reveal so transitions that bypass beginThinking
// (confirm, demo load, opening a modal) never leave a stale typing indicator.
function cancelThinking() {
  state.thinking = false;
  clearTimeout(thinkingTimer);
}

function startBuildSequence() {
  if (buildController) {
    return;
  }
  buildController = mountBuildProgress(document.body, {
    locale: state.locale,
    steps: buildStepsForCurrentCircuit(),
    onComplete() {
      buildController = null;
      finalizeBuild();
    }
  });
}

function finalizeBuild() {
  state.projectLoaded = true;
  state.built = true;
  state.running = false;
  state.activeTab = 'Files';
  state.selectedFileId = state.project.files[0]?.id || 'demo-requirements';
  render();
}

function openLibraryBrowser() {
  if (libraryController) {
    return;
  }
  cancelThinking();
  libraryController = mountLibraryBrowser(document.body, {
    locale: state.locale,
    onClose() {
      libraryController = null;
    }
  });
}

function openShareModal() {
  if (shareController || !state.projectLoaded) {
    return;
  }

  cancelThinking();
  const requirementFile = projectFiles().find((file) => file.kind === 'Markdown' && /requirement|요구|demo|deepagent/i.test(`${file.id} ${file.name} ${file.path}`))
    || projectFiles().find((file) => file.kind === 'Markdown');
  shareController = mountShareModal(document.body, {
    locale: state.locale,
    projectLoaded: state.projectLoaded,
    title: projectDisplayTitle(),
    markdown: requirementFile?.markdown,
    project: state.project,
    source: state.agentResult ? 'agent' : 'demo',
    onClose() {
      shareController = null;
    }
  });
}

function loadDemoProject() {
  cancelThinking();
  state.agentResult = null;
  state.shareView = null;
  state.projectLoaded = true;
  state.awaitingConfirmation = false;
  state.built = true;
  state.running = false;
  state.activeTab = 'Files';
  state.selectedFileId = 'demo-requirements';
  state.interview = demoInterviewState(state.locale);
  resetInspectorState();
  render();
}

function importSharedSnapshot() {
  const snapshot = state.shareView?.snapshot;
  if (!snapshot) {
    return;
  }

  cancelThinking();
  state.agentResult = null;
  state.agentSessionId = null;
  state.project = projectFromShareSnapshot(snapshot, state.locale);
  state.projectLoaded = true;
  state.awaitingConfirmation = false;
  state.built = true;
  state.running = false;
  state.activeTab = 'PCB';
  state.selectedFileId = 'shared-requirements';
  state.interview = createInterview(state.locale);
  state.shareView = null;
  resetInspectorState();
  replaceUrlWithoutShare();
  render();
}

function startNewProjectFromShareView() {
  cancelThinking();
  state.agentResult = null;
  state.agentSessionId = null;
  state.project = createLocalizedProject(state.locale);
  state.projectLoaded = false;
  state.awaitingConfirmation = false;
  state.built = false;
  state.running = false;
  state.activeTab = 'Files';
  state.selectedFileId = 'demo-requirements';
  state.interview = createInterview(state.locale);
  state.shareView = null;
  resetInspectorState();
  replaceUrlWithoutShare();
  render();
}

function resetInspectorState() {
  state.inspector.hoveredRawTarget = null;
  state.inspector.selectedRawTarget = null;
  state.inspector.chatMessages = [];
  state.inspector.tutorThinking = false;
  state.inspector.chatOpen = false;
  state.simulationPlaying = false;
  state.simulationStepIndex = 0;
  state.selectedCurrentPathId = null;
}

function getSelectedFile() {
  const files = projectFiles();
  return files.find((file) => file.id === state.selectedFileId) || files[0];
}

function getMarkdownHeadings(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      level: match[1].length,
      text: match[2],
      id: slugify(match[2])
    }));
}

function renderMarkdown(markdown) {
  const lines = markdown.split('\n');
  let html = '';
  let listOpen = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('# ')) {
      html += closeList();
      html += `<h1 id="${slugify(line.slice(2))}">${escapeHtml(line.slice(2))}</h1>`;
      continue;
    }

    if (line.startsWith('## ')) {
      html += closeList();
      html += `<h2 id="${slugify(line.slice(3))}">${escapeHtml(line.slice(3))}</h2>`;
      continue;
    }

    if (line.startsWith('- ')) {
      if (!listOpen) {
        html += '<ul>';
        listOpen = true;
      }
      html += `<li>${renderInlineMarkdown(line.slice(2))}</li>`;
      continue;
    }

    html += closeList();
    html += `<p>${renderInlineMarkdown(line)}</p>`;
  }

  html += closeList();
  return html;

  function closeList() {
    if (!listOpen) {
      return '';
    }
    listOpen = false;
    return '</ul>';
  }
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/^_([^_]+)_$/, '<em>$1</em>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function createPartThumbnail(part) {
  const canvas = document.createElement('canvas');
  canvas.width = 168;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  const palette = {
    breadboard: ['#ffffff', '#dedbd4', '#6f6f68'],
    arduino: ['#0a765d', '#0f9777', '#17171c'],
    oled: ['#103950', '#75d7ff', '#06111f'],
    sensor: ['#2f7df6', '#7ea7ff', '#17171c'],
    motor: ['#bfc5c8', '#f2f2f2', '#656b70']
  }[part.type] || ['#eeece7', '#ffffff', '#17171c'];

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f8f7f4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(context);

  if (part.type === 'motor') {
    drawMotorThumbnail(context, palette);
  } else {
    drawBoardThumbnail(context, palette, part.type);
  }

  return canvas.toDataURL('image/png');
}

function drawGrid(context) {
  context.strokeStyle = '#e5e2dc';
  context.lineWidth = 1;
  for (let x = -20; x < 190; x += 16) {
    context.beginPath();
    context.moveTo(x, 88);
    context.lineTo(x + 56, 22);
    context.stroke();
  }
}

function drawBoardThumbnail(context, palette, type) {
  const points = [[38, 72], [94, 42], [136, 62], [80, 92]];
  drawIsoBox(context, points, palette[0], palette[1]);

  if (type === 'breadboard') {
    context.fillStyle = '#4f4b47';
    for (let x = 56; x < 108; x += 10) {
      context.beginPath();
      context.arc(x, 66 + ((x / 10) % 2) * 5, 1.7, 0, Math.PI * 2);
      context.fill();
    }
    return;
  }

  context.fillStyle = palette[2];
  context.fillRect(72, 60, 28, 12);
  context.fillStyle = palette[1];
  context.fillRect(108, 58, 18, 10);
}

function drawMotorThumbnail(context, palette) {
  context.fillStyle = palette[0];
  context.beginPath();
  context.ellipse(84, 64, 38, 22, -0.36, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette[1];
  context.beginPath();
  context.ellipse(102, 56, 24, 15, -0.36, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette[2];
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(36, 73);
  context.lineTo(24, 80);
  context.stroke();
}

function drawIsoBox(context, topPoints, topColor, sideColor) {
  const bottomPoints = topPoints.map(([x, y]) => [x, y + 13]);
  context.fillStyle = sideColor;
  context.beginPath();
  context.moveTo(topPoints[0][0], topPoints[0][1]);
  context.lineTo(topPoints[3][0], topPoints[3][1]);
  context.lineTo(bottomPoints[3][0], bottomPoints[3][1]);
  context.lineTo(bottomPoints[0][0], bottomPoints[0][1]);
  context.closePath();
  context.fill();

  context.fillStyle = topColor;
  context.beginPath();
  topPoints.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.fill();
}

function disposeStage() {
  if (stageController) {
    stageController.dispose();
    stageController = null;
  }
}

function formatPinName(pinName) {
  return pinName === 'GND' ? t('parts.ground', {}, state.locale) : pinName;
}

function maybeShowWelcome() {
  if (hasSeenWelcome() || welcomeController) {
    return;
  }
  welcomeController = mountWelcomePopup(document.body, {
    locale: state.locale,
    onDismiss(reason) {
      welcomeController = null;
      if (reason === 'demo') {
        loadDemoProject();
      }
    }
  });
}

function installFavicon() {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = createFaviconDataUri();
}

async function loadInitialShareView() {
  const shareId = new URLSearchParams(window.location.search).get('share');
  if (!shareId) {
    render();
    maybeShowWelcome();
    return;
  }

  state.shareView = { status: 'loading', shareId };
  render();

  try {
    const snapshot = await readPublicShare(shareId);
    state.shareView = { status: 'ready', shareId, snapshot };
    if (snapshot.locale === 'ko' || snapshot.locale === 'en') {
      state.locale = setLocale(snapshot.locale);
      document.documentElement.lang = state.locale;
    }
  } catch (error) {
    state.shareView = {
      status: 'error',
      shareId,
      error: state.locale === 'ko'
        ? '공유된 회로를 찾지 못했습니다.'
        : 'The shared circuit could not be loaded.'
    };
  }

  render();
}

function replaceUrlWithoutShare() {
  if (window.location.search.includes('share=')) {
    window.history.replaceState({}, '', window.location.pathname || '/');
  }
}

installFavicon();
document.documentElement.lang = state.locale;
loadInitialShareView();
