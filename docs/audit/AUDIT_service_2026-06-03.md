# H-eduware 서비스 종합 감사 보고서 (Service Audit)

**감사일**: 2026-06-03
**대상**: `src/` 프론트엔드(바닐라 JS + Vite + three.js SPA), `server/` TypeScript 에이전트 런타임(LangChain/LangGraph 기반 회로 빌드·공유 서버)
**방법**: `service-audit-criteria.md`(§1 프론트엔드 개발자 / §2 디자이너 / §3 공동 경계, §4 0–3 루브릭, §7 Critical/Major/Minor) 기준의 8개 관점 멀티에이전트 감사. §5.6 우선순위화(심각도 × 영향범위 × 수정비용)와 부록 B 가중치(내부/교육용 웹앱: 사용성·IA·DX 高, 보안 中-高, SEO 低) 적용.

이 보고서는 H-eduware(학생용 Arduino+OLED 교육 데모 — 모호한 자연어 요청 → 3문항 인터뷰 → 회로 빌드 → 3D 시뮬레이션 실행 플로우)를 8개 관점에서 감사한 결과를 단일 개선 보고서로 종합한 것이다. 개발자 6개 영역, 디자이너 8개 영역, 공동 5개 경계를 0–3 루브릭으로 채점하고, 중복 발견사항을 통합·재순위화했다.

---

## 종합 점수

### 영역별 점수 (§4 루브릭, 0–3)

| 직군 | 영역 | 점수 | 비고 |
|---|---|---|---|
| 개발자 | 1.1 성능 | 1 | |
| 개발자 | 1.2 코드품질/아키텍처 | 2 | |
| 개발자 | 1.3 접근성(구현) | 2 | |
| 개발자 | 1.4 반응형/크로스환경 | 2 | |
| 개발자 | 1.5 보안 | 2 | ⚠ Stored-XSS 경로 존재(아래 별도 표기) |
| 개발자 | 1.6 견고성 | 2 | |
| 개발자 | 1.7 SEO/메타 | 1 | 가중치 低 |
| 개발자 | 1.8 유지보수/DX | 2 | |
| 디자이너 | 2.1 시각적 기반 | 1 | |
| 디자이너 | 2.2 일관성/디자인시스템 | 1 | |
| 디자이너 | 2.3 사용성 | 2 | |
| 디자이너 | 2.4 인터랙션/모션 | 2 | |
| 디자이너 | 2.5 정보구조 | 2 | |
| 디자이너 | 2.6 콘텐츠/카피 | 3 | |
| 디자이너 | 2.7 접근성(디자인) | 2 | |
| 디자이너 | 2.8 감성/신뢰/첫인상 | 3 | |
| 공동 | 3 접근성 경계 | 2 | |
| 공동 | 3 체감 성능 | 3 | |
| 공동 | 3 상태 설계 | 3 | |
| 공동 | 3 반응형 경계 | 2 | |
| 공동 | 3 디자인 토큰 동기화 | 1 | |

### 직군별 평균 → 종합

| 직군 | 영역 평균 | 등급 |
|---|---|---|
| 개발자 (§1, 8개 영역) | **1.75** | 미흡~양호 |
| 디자이너 (§2, 8개 영역) | **2.00** | 양호 |
| 공동 (§3, 5개 경계) | **2.20** | 양호 |
| **종합 (직군 평균)** | **≈ 1.98 / 3** | **양호 직전 (2점 경계)** |

> **§4 집계 규칙 — Critical 별도 표기**: 정식 Critical 등급 발견은 없으나, **1.5 보안 영역의 Stored-XSS 경로**(공개 공유 import 시 임의 스크립트 실행 가능)는 §7 정의상 "보안 차단"에 해당하여 **사실상 Critical급**으로 격상해 별도 추적한다. 해당 영역의 종합 점수(2점)와 무관하게 최우선 수정 항목으로 표기한다.

---

## 핵심 요약 (Executive Summary)

- **전체 건강도: "양호 직전(≈2.0)" — 데모로서 견고하나 프로덕션·디자인 충실도에서 체계적 결함.** 핵심 플로우는 짧고 피드백이 풍부하며(인터뷰 진행바, typing indicator, build progress), 상태 설계·체감 성능 경계는 모범적(3점)이다.
- **단 하나의 실질적 보안 구멍이 최우선.** 공유(import)된 회로의 `renderPlan`/connection 라벨이 서버 스키마에서 `z.unknown()`으로 무검증인 채 `app.innerHTML`로 비이스케이프 렌더되어 **Stored-XSS**가 성립한다. 6개 렌더 지점 이스케이프 + 스키마 강화로 닫힌다.
- **성능(1.1=1)이 개발자 측 최약점.** 코드 스플리팅 0건의 단일 825 kB(gzip 220 kB) 번들 + three.js 즉시 로드 + 유휴 상태에서도 매 프레임 렌더하는 rAF 루프. 3D 스테이지 지연 로딩 + on-demand 렌더로 큰 비용을 크리티컬 패스에서 제거 가능.
- **디자인 시스템 토큰 동기화가 시각 영역의 체계적 실패점(2.1·2.2·공동토큰 모두 1점).** 필수 3개 서체(Space Grotesk/Inter/Space Mono) 미로딩 → 전부 시스템 폰트로 붕괴, 미정의 변수(`--cream`/`--muted`/`--c-slate`) → 색·대비 깨짐, flux.ai 잔재 teal, 토큰 값/이름 스펙 불일치.
- **접근성은 디자인 의도는 좋으나 구현이 한 발 뒤짐 [종합].** 시맨틱 HTML·ARIA·포커스 링은 양호하나 **4개 모달 전부 포커스 트랩 부재**, share/build 모달 Escape 누락, stone 배경 12px 보조 텍스트 4.29:1(AA 미달)이 여러 관점에서 반복 지적됨.
- **강점은 진짜다.** TypeScript strict 통과·`any` 사실상 0건, 60 unit + 3 e2e 테스트, CI 전 게이트 강제, 시크릿 처리(gitignore + hasServerKey boolean), 학생 친화 카피(금지어 준수)·정직한 신뢰 신호는 동급 데모 대비 우수.

---

## 우선순위 개선사항

> §5.6(심각도 × 영향범위 × 수정비용)로 정렬. 여러 관점에서 중복 보고된 항목(접근성 모달/토큰/render churn 등)은 통합하고 가장 강한 증거를 보존했으며, 직군 교차 항목은 **[종합]**으로 표기.

| 우선순위 | 심각도 | 영역 | 현상 | 증거 (file:line) | 권장조치 |
|---|---|---|---|---|---|
| **P0** | **Critical급** (보안) | 1.5 보안 | **Stored-XSS**: import된 공유 회로의 `part.label`/`designator`/`connection.education.label·title`이 무이스케이프로 `app.innerHTML`에 삽입. 소스 필드는 서버 스키마 `z.unknown()`로 무검증 → 공격자 제어 가능. i18n `t()` 보간도 비이스케이프(2차 주입점). | `src/main.js:987,994,997,998,1043,1047,1048`; 소스: `server/share/shareSchemas.ts:74,81`(z.unknown()); 흐름: `src/shareImport.js:81-98,120-137`; `src/i18n.js:55-57` | 6개 렌더 지점에 `escapeHtml` 적용(이미 `shareView.js`가 쓰는 패턴). `renderPlan`/`solverGateResult`를 길이·enum 제한 객체 스키마로 교체. `t()`로 미신뢰 데이터 전달 금지 또는 보간 시 이스케이프. |
| **P1** | Major | 1.1 성능 | 단일 825 kB(gzip 220 kB) 번들, 코드 스플리팅 0건, three.js를 첫 페인트에 즉시 로드(chat-first 플로우엔 불필요). `src/` 내 `import()` 동적 임포트 0건. | vite build `dist/assets/index-*.js 825.10 kB`; `src/main.js:7`; `src/stageScene.js:1`, `src/partRenderer.js:17`(`import * as THREE`) | build-progress 'open' 시점에 three.js 스테이지/partRenderer를 `import()`로 지연 로딩. `partLibraryData.js`(69 kB)도 분리 검토. |
| **P2** | Major | 1.1 성능 | rAF 렌더 루프가 유휴(비실행) 상태에서도 매 프레임 `renderer.render()` 호출. 채팅 중 정적 회로에서도 GPU/컴포지터 상시 점유(배터리 소모). | `src/stageScene.js:256-272`(무조건 rAF + 매 프레임 render), 게이트 `:259-267`는 dot 가시성만 토글 | on-demand 렌더로 전환: running·드래그/회전 보간 중·상호작용 직후 몇 프레임만 rAF, 그 외 유휴. resize/상태변화 시 1회 렌더. |
| **P3** | Major | 접근성 **[종합]** (1.3 / 2.8 / 공동 3) | **4개 모달 전부 Tab 포커스 트랩 부재** + Escape 처리 불일치(welcome·library는 Escape 있음, **share·build 모달은 keydown/Escape 핸들러 자체 없음**). `aria-modal=true` 선언만 하고 키보드 사용자가 배경으로 탈출. A4·A7·A8 3개 관점 중복 지적. | `src/welcomePopup.js:73-89`(Escape만, 트랩 X); `src/libraryBrowser.js:159-170`; `src/shareModal.js`(Escape 0건, 복원만 `:72`); `src/buildProgress.js:39`(핸들러 없음) | 공유 focus-trap + Escape-to-close 헬퍼 1개를 4개 오버레이에 적용. 닫힐 때 트리거로 포커스 복원(이미 일부 구현됨). |
| **P4** | Major | 시각/디자인 **[종합]** (2.1 / 공동 토큰) | **필수 3개 서체 미로딩**: Space Grotesk/Inter/Space Mono에 대한 `<link>`·`@font-face` 전무 → 전부 system-ui로 폴백. 스펙 §8이 금지한 display+body 분리 붕괴. 음수 자간(carved 트래킹)도 부재. | `index.html:1-12`(폰트 링크 없음); `src/styles.css:32,234,218`(폰트 스택만 선언) | `index.html`에 preconnect + Google Fonts(또는 self-host `@font-face` + `font-display:swap`). display 헤딩 `letter-spacing` -0.02~-0.03em 적용. |
| **P5** | Major | 디자인 토큰 **[종합]** (2.2 / 2.7 / 공동 토큰) | **미정의 CSS 변수 `--cream`/`--muted`/`--c-slate`**가 참조되나 `:root` 미선언 → 상속색으로 폴백되어 context-evidence 패널·런타임 경고·lib-meta 라벨의 색·대비 깨짐(다크 표면 위 다크 잉크 등). 3개 관점 중복. | `src/styles.css:401,418,425,1132,1657`; `:root`=`src/styles.css:1-16`(미선언) | `--c-slate(#75758a)` 추가, `--cream→--c-canvas`, `--muted→--c-muted` 교정. stylelint `custom-property-no-missing`로 CI 차단. |
| **P6** | Major | 2.7 접근성(디자인) **[종합]** | **stone 배경 12px 보조 텍스트 대비 4.29:1**(WCAG AA 본문 4.5:1 미달). 라이브러리 카드 설명·file/connection 보조 라벨·카운트 다수. (스펙 #93939f는 더 밝아 악화 → 구현값 기준 재산정 필요.) | `src/styles.css:13`(--c-muted #6f6f68), `:765-769`, `:735-739`, `:973-978`(stone=`:747,:709`) | stone 위 12px 텍스트 색을 #5f5f59 이하로(4.5:1↑) 또는 폰트 키워 대형 텍스트 3:1 기준 전환. |
| **P7** | Major | 2.2 일관성 | **flux.ai 잔재 teal 강조색**(스펙이 명시적으로 supersede 선언)이 `.visual-arrangement-chip` 활성 상태에 하드코딩(§2 토큰표에 없음). | `src/styles.css:665,668,669`; cf. `Spec/H-eduware_design_system.md:26` | coral/soft-coral(교육 활성) 또는 `--c-blue`(보조 강조) 팔레트 토큰으로 재색상, cyan 리터럴 제거. |
| **P8** | Major | 1.2 아키텍처 | **God module `circuitTools.ts` 9,213 LOC / 298 함수** — 스펙검증·netlist·렌더플랜·시뮬플랜·요구문서·breadboard 감사를 한 파일에 혼재. SRP 위반, 변경 위험. | `server/agent/circuitTools.ts:1`; 익스포트 `:137,:160,:674,:725,:886,:1433,:7685,:7758,:7873` | 관심사별 모듈 분리(validation/netlist/renderPlan/simulationPlan/requirementDoc/breadboardAudit) + thin barrel로 18개 공개 API 유지. blast radius 낮음. |
| **P9** | Minor | 1.2 / 1.1 성능 **[종합]** | **frontend render() 전체 재구성**: `app.innerHTML` 전체 + `disposeStage()`+`createStageScene()`를 매 상태변화(29개 호출처, 채팅/인터뷰마다)에 실행 → 회로 불변에도 three.js 씬 파괴·재생성. | `src/main.js:190,200,235,2667`; 29개 render() 호출처 | 회로 identity/시각 revision 변경 시에만 스테이지 dispose/recreate(last-rendered key 비교), innerHTML 재구성을 변경 패널로 스코프 제한. |
| **P10** | Minor | 1.2 contextPacket | 2번째 과대 모듈 `contextPacket.ts` 3,626 LOC — intent추출·라우팅·선택·프롬프트 렌더가 한 파일. | `server/context/contextPacket.ts:1355,2664,2919,2957-3033,3055,3129` | 프롬프트 프레젠테이션(`renderPromptBlock`+`compact*ForV2`)을 `contextPromptRenderer.ts`로, intent 추출을 별도 모듈로 추출. |
| **P11** | Minor | 1.5 보안 | **CSP/보안 헤더 전무** — CORS·content-type만 설정. CSP/X-Content-Type-Options/X-Frame-Options/Referrer-Policy 없음(P0 XSS 완화책이 됐을 것). | `server/index.ts:110-118`; `index.html`(CSP meta 없음) | `sendJson`에 baseline CSP + `X-Content-Type-Options:nosniff` + `X-Frame-Options:DENY`, SPA에 CSP meta. (loopback 데모라 가중치 低.) |
| **P12** | Minor | 1.6 견고성 | **전역 error/unhandledrejection 핸들러·클라이언트 모니터링 부재** — wrapped async 밖 throw는 무피드백 실패. Sentry/RUM/console.error 없음 → 프로덕션 실패 비가시. | `src/main.js`(핸들러 0건); 서버 로깅만 `server/index.ts:44-60` | top-level `window.addEventListener('error'/'unhandledrejection')`로 토스트 + 로깅 훅. 최소 에러리포팅 엔드포인트/Sentry. |
| **P13** | Minor | 1.6 / 성능 | **클라이언트 retry/backoff 없음** + 서버 ChatOpenAI에 명시적 timeout/maxRetries 없음(라이브러리 기본+90s abort만 천장). 또한 매 메시지마다 health pre-flight 직렬 왕복. | `src/aiClient.js:43,81-110`; `src/shareClient.js:30-60`; `server/agent/deepAgentRuntime.ts:549-553` | idempotent GET에 bounded retry-with-backoff, ChatOpenAI에 timeout/maxRetries 설정, health 결과 캐시. |
| **P14** | Minor | 1.4 / 공동 반응형 **[종합]** | **터치 타깃 44px 미달**(stage-toolbar 버튼 3×7px, 언어 토글, welcome-close 34px) + **코드 브레이크포인트(520/780/1100)가 스펙(425/640/768/1024/1440)과 불일치**. | `src/styles.css` stage-toolbar; `:1870,1890-1937,1939,2017`; `src/main.js:1279`; `Spec/H-eduware_design_system.md:265-274` | 핵심 터치 타깃 ≥44px. CSS 브레이크포인트를 스펙에 정렬하거나 스펙 §9를 실제 3개로 업데이트해 단일 어휘 확립. |
| **P15** | Minor | 1.7 SEO | meta description·OG/Twitter·canonical·robots.txt·sitemap·JSON-LD 전무, Files 탭 h1 2개 동시 렌더. (내부 데모라 가중치 低.) | (정적 분석) `index.html`; Files 탭 이중 h1 | 정적 기본 메타(description/OG) 1세트 + Files 탭 h1 단일화. |
| **P16** | Minor | 2.1 / 2.2 시각 | display 음수 자간 부재, focus 링이 coral(스펙 Focus Blue #4c6ee6 위반, coral은 교육 강조 전용), :root 토큰 13개로 스펙 19개 대비 불완전·값 drift(hairline·muted·soft-coral 이름). | `src/styles.css:49-54,1-16,232-238`; `Spec/H-eduware_design_system.md:60-104` | `--c-focus(#4c6ee6)` 추가해 focus-visible에 사용, :root를 스펙 토큰표에서 생성. |
| **P17** | Minor | 1.2 / 1.8 DX **[종합]** | ESLint/Prettier 부재(no-floating-promises 등 미강제), `langsmith` 의존성 미선언(transitive 우연 해결), 루트 README 없음. | `package.json:6-31`; `server/agent/langSmithTraceCli.ts:1-2`(depcheck missing); 루트 README 부재 | @typescript-eslint flat config + Prettier 추가, `langsmith` devDeps 명시, 루트 README(범위·2-프로세스 dev·`npm run check`) 작성. |
| **P18** | Minor | 1.5 보안 | npm audit moderate 3건(uuid bounds-check, @langchain/langgraph 경유 transitive). high/critical 0건, 실사용 노출 낮음. | `npm audit`: moderate 3, uuid ← @langchain/langgraph | `npm audit fix`/langgraph 버전 업, npm audit를 CI/Dependabot에 연동. |
| **P19** | Minor | 2.6 / 2.8 카피·신뢰 **[종합]** | welcome 모달 포커스 트랩 부재(P3과 동류), 좁은 레일 한국어 제목 음절 줄바꿈('물어보\n기'), evidence/solverGate 일부 라벨이 시스템 톤('진단/검증/근거'). | `src/welcomePopup.js:33-92`; `src/locales/ko.js:173,62-87,112-118`; `src/styles.css:997-1001` | (트랩은 P3에서 일괄) 좁은 제목에 `word-break:keep-all`, evidence 라벨을 행동/결과 중심으로 풀어쓰기. |

---

## 관점별 상세

### A1 — Frontend Performance & Resilience (§1.1, §1.6) · developer
- **점수**: 1.1 성능 **1**, 1.6 견고성 **2**
- 견고성은 데모 기준 견실: 모든 async 경로(AI 채팅·튜터·build·share)에 loading/error/empty + 친절·재시도 카피, 전 fetch AbortController 타임아웃. 갭은 사용자향이 아닌 운영(모니터링·전역 핸들러·retry) 측면.
- 성능이 약점: 단일 825 kB 번들·코드 스플리팅 0·three.js 즉시 로드(P1), 유휴 시 매 프레임 렌더(P2), prefers-reduced-motion 무시(WebGL), health pre-flight 직렬 왕복(P13).

### A2 — Code Quality / Architecture & DX (§1.2, §1.8) · developer
- **점수**: 1.2 **2**, 1.8 **2**
- 강점: tsconfig strict 통과·`any` 사실상 0(22k LOC), 60 unit+3 e2e, CI 전 게이트, depcheck clean·TODO 0, 시크릿 처리 정상, 에이전트 런타임 DI 포트 경계.
- 약점: god module 2개(circuitTools 9,213 LOC P8 / contextPacket 3,626 LOC P10), ESLint/Prettier 부재(P17), langsmith 미선언(P17), 루트 README 없음(P17), render() churn(P9).

### A3 — Security (§1.5) · developer
- **점수**: 1.5 **2** (⚠ Stored-XSS로 영역 별도 표기)
- 강점: shareView 전 필드 이스케이프, shareSnapshot 시크릿 redaction, 서버 Zod 검증, path-traversal-safe 공유 스토어(32-hex 서버 생성 ID), 127.0.0.1 바인딩, 클라이언트 키 미노출.
- 약점: inspector renderPlan 라벨 Stored-XSS(P0), CSP/보안 헤더 전무(P11), npm audit moderate 3건(P18).

### A4 — a11y / Responsive / SEO (vanilla JS) · developer
- **점수**: 1.3 접근성 **2**, 1.4 반응형 **2**, 1.7 SEO **1**
- 강점: div-soup 0, 적절한 role(tablist/progressbar/dialog), 모달 open 포커스 이동·share 복원·드로어 토글 복원·커스텀 타깃 Enter/Space.
- 약점: 모달 포커스 트랩 전무 + share Escape 누락(P3), stage-toolbar 터치 타깃·desktop-first(P14), SEO 메타 전무·Files 이중 h1(P15).

### A5 — Visual Foundation & Design System (§2.1, §2.2) · designer
- **점수**: 2.1 **1**, 2.2 **1**
- 강점: 3-region shell·pill CTA·coral 강조·8/16/22px radii·dark AI 패널·inline-SVG 로고는 스펙 충실.
- 약점: 필수 3서체 미로딩(P4), flux teal 잔재(P7), :root 토큰 불완전·미정의 변수(P5/P16), display 음수 자간 부재·focus 링 coral(P16), 오프그리드 spacing.

### A6 — Usability / IA / Interaction & Motion (§2.3–2.5) · designer
- **점수**: 2.3 사용성 **2**, 2.4 인터랙션/모션 **2**, 2.5 정보구조 **2**
- 강점: 짧고 피드백 풍부한 핵심 플로우(3문항 인터뷰·quick-reply·진행바·typing·build modal), 목적 있는 microinteraction, prefers-reduced-motion 대체로 존중.
- 약점: 에러 예방 얇음(파괴적 build/Run 확인 없음, disabled 사유 미설명, undo/cancel 불가), :hover/:focus 커버리지 불일치, context-evidence 미정의 토큰(P5).

### A7 — 콘텐츠/카피 · 디자인 접근성 · 감성/신뢰 (§2.6–2.8) · designer
- **점수**: 2.6 카피 **3**, 2.7 접근성(디자인) **2**, 2.8 감성/신뢰 **3**
- 강점: ko.js 카피 가이드·금지어 준수(인스펙터/컨텍스트/렌더 미노출), 에러·빈·성공 메시지 원인+다음행동, 정직한 안전 신뢰 신호, 환영 팝업 3단계 가치 전달.
- 약점: stone 12px 보조 텍스트 4.29:1(P6), 미정의 색 토큰(P5), welcome 포커스 트랩 부재·한국어 줄바꿈·시스템 톤 라벨(P19).

### A8 — 두 직군 공동 경계 (§3) · joint
- **점수**: 접근성 **2**, 체감성능 **3**, 상태설계 **3**, 반응형 **2**, 토큰동기화 **1**
- 모범: typing skeleton이 `Promise.all([sendAgentMessage, wait])`로 실제 지연 반영(`main.js:1428`), 모든 디자인 상태에 코드 경로 존재(orphan 0).
- 약점: 토큰 동기화가 핵심 실패점(미정의 변수·값 drift·focus 링 coral, P5/P16), 모달 접근성 구현 지연(P3), 코드↔스펙 브레이크포인트 불일치(P14), index.html `lang="ko"` 하드코딩(런타임 보정됨).

---

## 빠른 실행 항목 (Quick Wins)

저비용·고효과 순. 대부분 수 시간 내 처리 가능.

1. **[P0] XSS 이스케이프 6곳** — `main.js`의 6개 렌더 지점에 기존 `escapeHtml` 적용. 보안 영역의 단일 최대 리스크를 즉시 닫음.
2. **[P5] 미정의 CSS 변수 3개 교정** — `--cream→--c-canvas`, `--muted→--c-muted`, `--c-slate` 정의 추가. 색·대비 깨짐 즉시 해소.
3. **[P4] 폰트 3종 `<link>` 추가** — `index.html` preconnect + Google Fonts 1줄. 디자인 보이스 전체가 살아남.
4. **[P7] flux teal 리터럴 제거** — `.visual-arrangement-chip` 3줄을 팔레트 토큰으로 교체.
5. **[P2] on-demand 렌더** — rAF를 running/상호작용 중에만 스케줄. 유휴 GPU 점유·배터리 소모 제거.
6. **[P6] stone 위 12px 텍스트 색 한 단계 다운** — `--c-muted`를 #5f5f59 이하로 또는 폰트 확대로 AA 통과.
7. **[P17] 루트 README + `langsmith` devDeps 선언** — 온보딩 마찰·의존성 정직성 해소.
8. **[P11] sendJson에 보안 헤더 3종** — CSP/nosniff/X-Frame-Options. P0의 방어심층.

> 큰 효과지만 비용 높은 항목(별도 일정 권장): **P1 three.js 지연 로딩**, **P3 공유 focus-trap 헬퍼**, **P8 circuitTools 모듈 분리**.

---

## 부록: N/A 처리 항목

대상 스택(바닐라 JS + Vite + three.js CSR SPA, React/Next 없음)·서비스 성격(내부/교육 데모, loopback) 때문에 적용 불가하거나 가중치를 낮춘 항목.

- **Core Web Vitals (Lighthouse/CrUX)** — 배포 URL·RUM 없음. 번들/렌더루프 증거로 정적 평가 대체.
- **이미지·폰트 최적화 / next/image / font-display** — 웹폰트·`<img>` 에셋 미사용(폰트는 P4로 별도 다룸).
- **렌더링 전략 SSR/SSG/ISR / Hydration / 'use client' / RSC 경계** — 바닐라 SPA. 번들/코드스플리팅·render-loop로 매핑.
- **불필요한 re-render (memo/useMemo)** — React 없음. 수동 render() churn(P9)으로 평가.
- **NEXT_PUBLIC_ env 오용** — Next 아님. VITE_ 시크릿 노출 점검 결과 없음(키는 서버 전용).
- **dangerouslySetInnerHTML** — React 전용. 바닐라 등가 innerHTML/insertAdjacentHTML로 평가(P0 XSS 발견).
- **Progressive enhancement (JS 비활성)** — 핵심 기능이 3D 시뮬이라 구조적 N/A. 최소 `<noscript>` 안내만 권장.
- **동적 meta/OG 생성** — 순수 CSR, SSR/SSG 없음. 정적 기본 메타만 적용 가능(P15).
- **Dark mode (OS 라이트/다크)** — 단일 white-canvas 디자인 언어, 스펙에 다크모드 요구 없음.
- **Skeleton 로딩 디자인** — async 리스트 페치 없음. typing indicator·진행바·build modal이 적절한 대체.
- **Breadcrumb** — 플랫 2-탭(Files/PCB) IA, 불필요(aria-selected로 처리).
- **터치 타깃(디자인 측 일부)** — 대부분 버튼 패딩 충분, desktop-first 내부 데모라 일부 미달은 P14로 통합·Critical 미기재.
- **Cross-browser 실기기 매트릭스 / Lighthouse·axe 자동 스캔** — 본 감사는 정적 cross-reference. live a11y 스캔은 후속 권장.
- **React/Next 카피·a11y 관용구(next/image alt 등)** — 바닐라 스택, 텍스트 대안은 i18n 키(thumbAlt 등)로 처리.
