# H-eduware 다관점 종합 분석 보고서 (Multi-Agent Synthesis)

> **작성일:** 2026-06-03
> **대상:** `C:\Users\aquap\Desktop\H-eduware_origin\SourceCode`
> **방법론:** 4개 전문 에이전트를 **병렬**로 띄워 독립 분석한 뒤, 교차검증·합성
> **선행 문서:** `REPOSITORY_ANALYSIS.md`(기능 모듈 단위 1차 분석) — 본 문서는 그 위에 4개 전문 관점을 더한 2차 심층 분석이다.

---

## 0. 분석 방법론

서로 간섭하지 않는 4개의 전문 에이전트가 동일 코드베이스를 **각기 다른 렌즈**로 동시 분석했다. 각자 독립적으로 결론을 내렸기 때문에, **여러 에이전트가 동일 지점을 독립 발견한 항목**은 신뢰도가 매우 높다(§3).

| 에이전트 | 관점 | 산출 토큰 | 핵심 도구 사용 |
|----------|------|-----------|----------------|
| security-reviewer | 보안 (OWASP/시크릿/공급망/XSS) | ~102k | `npm audit`, 정적 grep |
| architect | 아키텍처 (경계/상태/포트/확장성) | ~104k | 의존성 추적, 코드 정독 |
| code-reviewer | 코드 품질 (버그/로직결함/엣지케이스) | ~113k | 전 모듈 정독, 테스트 갭 분석 |
| designer | UX/디자인 시스템 (토큰/a11y/반응형) | ~77k | CSS·스펙 대조 |

---

## 1. 종합 스코어카드

| 차원 | 점수 | 한 줄 평가 |
|------|------|-----------|
| **보안** | **8.5 / 10** | 공격 표면이 의도적으로 작음. Critical/High 0건. 잔여 항목은 모두 defense-in-depth |
| **아키텍처** | **B+ (중상)** | "암묵적이지만 실재하는 클린 코어". 원칙 90% 충족, 형식(디렉터리)은 현 범위에 과설계 |
| **코드 품질** | **양호 (데모 범위 한정)** | 잠복 결함 위주. High 3건은 확장/회귀 시 즉시 표면화 |
| 디자인 — 비주얼 | 7.5 / 10 | 하드코딩 hex 3개, flat-surface 위반 그라데이션 1건 |
| 디자인 — 타이포 | 7 / 10 | `clamp()` 스케일 곡선 불일치 |
| 디자인 — 색 | 7 / 10 | 스펙 토큰 9개 미선언, `--c-muted`/`--c-hairline` 값 편차 |
| 디자인 — 레이아웃/반응형 | 6.5 / 10 | 모바일 tabbed-stack 미구현, 3D 스테이지 모바일 과잉 높이 |
| 디자인 — 모션 | 7 / 10 | 탭 전환 효과·버튼 hover 불균일 |
| **디자인 — 접근성** | **6 / 10** | 포커스 트랩 미구현, tabpanel 연결 없음 (최저 점수 영역) |

**총평:** 코드/보안/아키텍처는 해커톤 평균을 크게 상회(상위 10%). 가장 약한 고리는 **접근성**과 **모바일 반응형**이며, 두 영역이 "회로를 처음 보는 학생에게 legible하게"라는 제품 핵심 목표와 직결된다.

---

## 2. 가장 중요한 한 가지: "AI"는 실제 LLM이 아니다 (재확인)

선행 문서 §6.5에서 확인했고, architect·security 에이전트가 독립적으로 재확인했다:

- `src/` 전체에 `fetch`/`openai`/`/v1/`/`Bearer`/`.completions` **0건**.
- `aiClient.js`는 포트 자리만 있는 **스텁** — 키 존재 여부로 UI 라벨만 바꾸고 어떤 요청도 보내지 않음(architect: "추상화의 자리는 있으나 추상화는 없다").
- 좌측 "AI 인터뷰"는 100% `interviewEngine.js`의 결정론적 상태 머신.
- 스펙(§149)은 라이브 OpenAI 호출을 계획했으나 하네스 규약(기본=캐시/결정론)이 이를 대체 → 라이브 호출 미구현.

이것은 결함이 아니라 **의도된 설계 결정**이며, 모든 후속 분석의 전제다.

---

## 3. 교차검증된 핵심 발견 (복수 에이전트 독립 발견 — 최고 신뢰도)

여러 관점에서 동시에 잡힌 항목은 "진짜 중요한 구조적 신호"다.

### 🔴 CC-1. `main.js`의 다중 책임 — 순수 로직이 테스트 불가 영역으로 새고 있음
**발견:** architect(B1), code-reviewer(종합평가), 선행문서(§7.3)
- `main.js`(753 LOC)에 합성 루트 + 전역 상태 + 전이 + 뷰 렌더 + **마크다운 파서**(L541-617) + **Canvas2D 썸네일 드로잉**(L619-713)이 평면적으로 혼합.
- architect의 정밀 진단: "비대함"이 아니라 **6개의 서로 다른 추상화 레벨이 한 파일에 섞인 것**이 본질. 마크다운/썸네일은 상태·DI와 무관한 순수 함수인데 오케스트레이터에 묻혀 ① 단위 테스트 불가 ② 재사용 불가.
- **합의된 처방:** `src/markdown/`, `src/thumbnails/`, `src/state/appReducer.js`로 추출 → `main.js`를 ~150 LOC 합성 루트로 환원. 노력 낮음~중간, 영향 높음.

### 🔴 CC-2. 부품 데이터 모델의 이중화 — 확장 시 1순위 파손점
**발견:** architect(B3, 최우선 균열), code-reviewer(M-5)
- 부품이 **호환 불가능한 두 스키마**로 두 곳에 존재:
  - `circuitMetadata.js`: `type`(5종) 기반, 데모 회로 5개
  - `partLibraryData.js`: `model.kind`(12종) 기반, 라이브러리 132개
- 렌더 경로도 분기: PCB 레일은 `main.js`의 **Canvas2D**(`createPartThumbnail`), 라이브러리 모달은 `partRenderer.js`의 **three.js**. 동일 "부품 썸네일" 개념에 완전히 다른 두 경로.
- architect의 결정적 관찰: `stageScene.js`는 `circuit`을 인자로 받으면서 **부품 배치를 전부 하드코딩**(`addArduino` 좌표, `addWires.endpoints` 8핀 좌표). `circuit.parts[].position` 필드가 **정의되어 있으나 읽히지 않는다**. 즉 데이터-주도가 아니라 코드-주도.
- **영향:** "다중 회로"로 확장하는 순간 세 곳(circuitMetadata / stageScene / createPartThumbnail)을 손으로 동기화해야 함.

### 🟠 CC-3. 자체 마크다운 렌더러의 escape 우회 잠재성
**발견:** security(M-1), code-reviewer(M-1, M-2)
- `renderInlineMarkdown`(main.js:601)은 "escape 후 정규식으로 마크업 재삽입" 패턴. 현재 정적 입력이라 **악용 불가**지만, 향후 모델 생성 마크다운·링크(`[text](url)`) 지원 추가 시 `href`에 `javascript:`/`data:` 주입 가능한 sink로 변질되기 쉬움.
- code-reviewer 추가 발견: ① 이탤릭 정규식 `/^_..._$/`이 줄 전체일 때만 동작 → 문장 중간 `_강조_`·`snake_case` 깨짐(M-1) ② 헤더는 `renderInlineMarkdown` 미적용 → `## Goal **(v2)**`가 리터럴 노출 ③ **TOC 링크 텍스트는 escape 누락**(`<a>${heading.text}</a>`, main.js:278) — 본문은 escape하면서 TOC는 비대칭(M-2).
- **처방:** 마크다운 계열을 별도 모듈로 분리·export 후 엣지케이스 단위 테스트 추가. 링크 도입 시 URL 스킴 화이트리스트(`http/https/mailto`) 강제.

### 🟠 CC-4. 모달 포커스 트랩 미구현
**발견:** security(L-3), designer(접근성 §3)
- welcome / library / buildProgress 세 모달 모두 `aria-modal="true"`를 선언하나 **실제 포커스 트랩 없음** → Tab으로 모달 밖 DOM 접근 가능.
- security 관점: 클릭재킹/오조작 표면을 약간 넓힘(위험 낮음).
- designer 관점: 키보드/스크린리더 사용자가 인터뷰 플로우를 못 따라감(접근성 6/10의 주원인). libraryBrowser는 초기 `search.focus()`조차 없음.
- **처방:** 세 모달에 포커스 트랩(첫 요소→Tab 순환→Shift+Tab 역순환) 구현. 접근성+보안 동시 해결.

### 🟡 CC-5. escape 함수 중복·커버리지 드리프트
**발견:** security(L-1, I-3), code-reviewer(L-5), architect(모달 패턴 일관성)
- `escapeHtml`(main.js)과 `escapeAttr`(libraryBrowser.js)가 **중복 구현**, 둘 다 `'`·백틱 미escape("속성은 항상 큰따옴표" 암묵 가정에 의존).
- `renderFloatingCard`(main.js:303)는 `education.*`를 escape 없이 삽입 — `renderMessage`/`renderDecisions`는 escape함(비일관).
- E2E 네트워크 가드도 두 spec 파일에 복붙 → 한쪽 수정 시 드리프트.
- **처방:** escape 유틸·E2E 가드를 단일 소스로 통합.

---

## 4. 관점별 심층 요약

### 4.1 보안 (8.5/10) — *위험 수준: LOW*

**구조적 강점**
- 백엔드·DB·인증·외부 네트워크 호출이 **전혀 없음** → OWASP A01/A02/A07/A09/A10이 구조적으로 N/A.
- `npm audit` **0 vulnerabilities**, lockfile **SHA-512 integrity** 고정(공급망 무결성 양호).
- 실제 XSS 페이로드(`<img src=x onerror>`) 회귀 테스트 보유(features.spec.js:161).
- 데모 전용 로컬 키는 `.gitignore`(`/.local/`)로 커밋 차단, 기본값은 키 없음.

**잔여 항목(모두 현재 악용 불가, defense-in-depth)**
| 등급 | 항목 | 위치 |
|------|------|------|
| Medium | 마크다운 인라인 렌더러 escape 우회 잠재성(→CC-3) | main.js:601 |
| Low | escape 함수의 `'`·백틱 미처리(→CC-5) | main.js:607, libraryBrowser.js:158 |
| Low | 동적 import 로컬 키 — 클라이언트 키 노출 안티패턴(데모 한정) | aiClient.js:13 |
| Low | 모달 포커스 트랩 부재(→CC-4) | 3개 모달 |

> **OWASP 평가:** A03(XSS)이 유일한 실질 표면이나 양호. A06(공급망) 양호. CSP 헤더는 미설정(정적 데모라 낮은 우선순위).

### 4.2 아키텍처 (B+) — *암묵적 클린 코어*

**구조적 강점(코드 정독으로 확인)**
- `interviewEngine.js`는 모든 전이가 `{...state}`를 반환하는 **진짜 불변 리듀서**. 클린 아키텍처 "엔티티+유스케이스" 핵심 충족.
- three.js 리소스 관리의 **두 상반된 전략이 모두 정확**: stageScene는 공유 머티리얼 스킵 dispose, partRenderer는 단일 공유 렌더러+즉시 cleanup. "마이크로 레벨 A급".
- graceful degradation이 **의식적 패턴**(모든 외부 리소스 경계에서 폴백).
- 모달 컨트롤러 패턴 일관성(`(host, callbacks) → {dispose}`).

**핵심 약점**
- CC-1(main.js 추상화 혼합), CC-2(부품 데이터 이중화 + stageScene 하드코딩).
- **상태 전이가 이벤트 핸들러에 인라인**(main.js:420-535) → 핵심 유스케이스인데 DOM과 분리 불가, 테스트 불가. interviewEngine은 순수하게 만들고 그 위 오케스트레이션은 테스트 불가 영역에 둔 **비대칭**이 최대 약점.
- **진짜 버그(선행문서 누락):** PCB 탭에서 인터뷰 진행 시, thinking 토글(650ms ×2 render)마다 3D 씬이 불필요하게 `dispose()`→재생성 → GPU 재업로드 + 카메라 회전 상태 손실.

**클린 아키텍처 ROI 판정**
- ✅ **할 것:** 마크다운/썸네일 추출, 전이 리듀서화(interviewEngine과 동형이라 학습비용 0).
- ❌ **하지 말 것:** `domain/application/infrastructure` 풀 디렉터리 골격 — DB·HTTP·영속성이 없어 빈 추상화 = 명백한 과설계. `CreateCircuitUseCase`/`CircuitRepository`는 컴파일타임 상수 1개에 리포지토리를 씌우는 ceremony.

**확장 시 파손 순서:** ① stageScene 하드코딩 → ② 부품 스키마 이중화 → ③ main.js 전이 인라인 → ④ interviewEngine.FLOW 하드코딩(단 인자화하면 깨끗) → ⑤ 실제 LLM(의외로 가장 나중, 엔진이 이미 준비됨).

### 4.3 코드 품질 (양호, 데모 한정) — *판정: COMMENT*

**High (확장/회귀 시 즉시 실패)**
- **H-1** `createLogoMark`가 `data-testid="brand-logo"`를 항상 하드코딩 → 첫 방문 시 토프바+welcome lockup으로 **testid 2개 중복**. 현재 E2E는 welcome을 먼저 닫아 우연히 통과(타이밍 의존). 파라미터화 필요.
- **H-2** `thinkingTimer`(650ms)가 탭 전환·파일 선택·Run 핸들러에서 `cancelThinking()` 없이 살아남아 **모달/현재화면 위로 예기치 않은 재렌더** → 포커스/스크롤/드래그 상태 리셋.
- **H-3** 빌드 팝업 중 배경 `#app` 버튼이 여전히 클릭 가능할 수 있음(CSS `pointer-events` 의존) → `finalizeBuild()`와 상태 전이 충돌 가능. `inert` 속성 권장.

**Medium 주요**
- M-1/M-2 마크다운 파서 엣지케이스(→CC-3).
- M-3 초기 로드 시 `render()`(동기) + `getAiRuntimeMode().then(render)`(비동기)로 **2회 render** → 초기 빠른 입력 소실·포커스 흔들림 여지.
- M-4 `stageScene.resize()`가 레이아웃 안정화 전 호출되면 첫 프레임 비정상 종횡비.

**Low 주요**
- L-1 `aiClient` catch가 구문 오류까지 무차별 삼킴(silent failure) → `console.warn`(키 제외) 권장.
- L-4 `libraryOnly` 플래그가 **어디서도 필터링에 안 쓰임**(데드 플래그) — 센서/모터가 데모 회로에 잡음으로 포함.
- L-3 `answerInterview`의 `"no idea"`가 No로 오분류(자유텍스트 충돌).

**테스트 커버리지 공백(중요)**
- stageScene/partRenderer/buildProgress(mount)/welcomePopup/libraryBrowser/main.js에 **단위 테스트 0건**. dispose 정확성·타이머 정리·리스너 해제를 검증하는 테스트가 없어 H-1~H-3, 누수 회귀가 잡히지 않음.
- 모달 동시 오픈·빠른 상태 전이 E2E 부재. 마크다운 파서는 export조차 안 돼 테스트 불가(→분리 필요).

### 4.4 UX / 디자인 시스템 — *접근성이 최약점*

**강점**
- "AI 슬롭"의 전형(보라 그라데이션·제네릭 카드·무의미 글로우)이 **없음**. Cohere 파생 디자인 언어가 코드 전반에 충실히 구현.
- CSS 토큰화 성실(`:root` 14변수), `prefers-reduced-motion`을 모든 애니메이션에 적용(스펙 미명시 부분까지 챙김).
- 절제된 마이크로인터랙션(타이핑 인디케이터, 메시지/칩 진입, 진행바).

**교육 UX 핵심 결함**
1. **플로팅 카드가 3D 좌표에 앵커되지 않음** — 4개 카드가 절대좌표(`spot-0~3`) 고정. 스펙(§7)은 "투영된 3D 좌표 앵커"를 요구. 학생이 "이 카드가 어느 선 설명인지" 직관 파악 어려움. → leader line(연결선) 또는 좌표 앵커 필요.
2. **모바일에서 카드 본문 텍스트 숨김**(`.floating-card p { display:none }`, styles.css:1270) → 교육 도구의 **핵심 콘텐츠를 잘라냄**.
3. 메시지 role이 "assistant"/"student" 영문 대문자 노출, 결정 칩 label이 `GOAL`/`OUTPUT` 내부 키워드 노출.

**디자인 시스템 갭(designer 보고 — 스펙 대조 기준)**
- `--c-muted`(#93939f→#6f6f68), `--c-hairline`(#d9d9dd→#dedbd4) 값 편차.
- `--c-slate`, `--c-focus`(#4c6ee6), `--c-focus-input`, `--c-error`, `--c-wash-green/blue` 등 **9개 토큰 미선언**(일부는 미선언 상태로 참조 → 폴백 없음).
- focus ring이 스펙(Focus Blue)이 아닌 coral 사용. `.new-project` 그라데이션이 "flat surface" 정책 위반.

> ⚠️ 위 토큰 값들은 designer 에이전트가 `Spec/H-eduware_design_system.md`와 대조해 보고한 것으로, 적용 전 스펙 원문 재확인을 권장(본 합성 문서가 스펙 값을 직접 검증하지는 않음).

**접근성(6/10)**
- 포커스 트랩 미구현(→CC-4), tab↔tabpanel `aria-controls` 연결 없음, libraryBrowser 초기 포커스 없음, `.build-step` 비활성 텍스트 대비 ~3.2:1(WCAG AA 4.5:1 미달), library-filter `aria-pressed` 누락.

**반응형(6.5/10)**
- 스펙(§9)의 모바일 "tabbed stack" 미구현(단순 수직 스택). Pixel 5에서 `min-height:680px` 스테이지가 뷰포트 초과.

---

## 5. 통합 우선순위 액션 플랜

4개 관점의 처방을 노력·영향·범위로 통합했다.

### Tier 0 — 지금 (데모 안 깨고, 테스트 가능성·품질 즉시 향상)
| # | 액션 | 출처 | 노력 | 영향 |
|---|------|------|------|------|
| 0-1 | `renderMarkdown`/`slugify`/`escapeHtml` → `src/markdown/` 추출 + 단위 테스트 | arch CC-1, code M-1/M-2 | 낮음 | 높음 |
| 0-2 | `createPartThumbnail` → `src/thumbnails/` 추출 | arch CC-1 | 낮음 | 중간 |
| 0-3 | 상태 전이 → `src/state/appReducer.js` 순수 리듀서(interviewEngine 동형) | arch B2, code | 중간 | 높음 |
| 0-4 | `cancelThinking()`/모달 가드를 `render()` 진입부로 일원화 | code H-2/H-3 | 낮음 | 높음 |
| 0-5 | `createLogoMark`에 `testId` 파라미터화 | code H-1 | 낮음 | 중간 |
| 0-6 | escape 유틸·E2E 네트워크 가드 단일화 + `'`·백틱 처리 | sec L-1, code CC-5 | 낮음 | 중간 |

### Tier 1 — 곧 (접근성·UX 핵심, 제품 목표 직결)
| # | 액션 | 출처 | 노력 |
|---|------|------|------|
| 1-1 | 3개 모달 포커스 트랩 + libraryBrowser 초기 포커스 | sec CC-4, design | 반나절 |
| 1-2 | 플로팅 카드 ↔ 와이어 leader line(또는 3D 좌표 앵커) | design 교육UX | 반나절 |
| 1-3 | 모바일에서 카드 본문 숨김 제거(수평 스크롤 재배치) | design 반응형 | 중간 |
| 1-4 | 디자인 토큰 스펙 동기화(미선언 9개 + 값 편차 2개) | design | 30분~2h |
| 1-5 | tab↔tabpanel `aria-controls` 연결, `aria-pressed`, role 한국어화 | design a11y | 중간 |
| 1-6 | PCB 탭 불필요 stage 재생성 제거 | arch B2, code M | 중간 |

### Tier 2 — 확장 결정 시에만 (다중 회로 / 실제 LLM)
| # | 액션 | 출처 | 비고 |
|---|------|------|------|
| 2-1 | `stageScene` 데이터-주도화(`position` 사용) + 부품 스키마 통합 | arch CC-2 | 다중 회로 1순위 파손점 |
| 2-2 | `aiClient` → `AiInterviewPort` 인터페이스 + CachedAdapter/LiveAdapter | arch E | LiveAdapter는 **서버 프록시 필수**(클라 키 노출) |
| 2-3 | `interviewEngine.FLOW`·`BUILD_STEPS` 회로-주도화 | arch B4 | |
| 2-4 | 마크다운 링크 지원 시 URL 스킴 화이트리스트 | sec CC-3 | |

### 명시적 비권장 (현 범위 과설계)
- ❌ 클린 아키텍처 풀 디렉터리 골격(`domain/application/infrastructure/`) — DB·HTTP·영속성 부재로 빈 추상화.

---

## 6. 결론

H-eduware는 4개 독립 관점이 일관되게 **"범위에 잘 맞춰진, 평균을 크게 상회하는 단일 목적 데모"**로 평가한 프로젝트다. 보안(8.5)·아키텍처(B+)·코드 품질이 모두 해커톤 상위권이며, 특히 ① 순수 함수형 도메인 코어 ② 두 가지 상반된 three.js 리소스 전략의 정확한 구사 ③ 일관된 graceful degradation ④ 실제 XSS·네트워크 회귀 테스트는 절대 기준으로도 우수하다.

네 관점이 **독립적으로 같은 곳을 가리킨 두 가지 구조적 신호**가 가장 중요하다:
1. **`main.js`로 순수 로직이 새고 있다**(CC-1) — 잘 만든 순수 도메인 위에서 정작 오케스트레이션·파서·드로잉이 테스트 불가 영역에 묻혔다.
2. **부품 데이터가 이중화되어 있고 3D 씬이 데이터-주도가 아니다**(CC-2) — `position` 필드가 정의됐으나 미사용. 확장 시 가장 먼저 깨진다.

가장 약한 고리는 **접근성(6/10)과 모바일 반응형(6.5/10)**으로, 둘 다 "회로를 처음 보는 학생에게 legible하게"라는 제품 핵심과 직결된다. 특히 플로팅 카드가 와이어에 시각적으로 연결되지 않고 모바일에서 본문이 잘리는 것은 교육 가치의 직접 손실이다.

권장 경로는 명확하다. **Tier 0(반나절 분량의 "공짜 점심" 6건)**으로 테스트 가능성과 품질을 즉시 끌어올리고, **Tier 1**으로 접근성·교육 UX를 프로덕션 수준(9점대)으로 올린다. Tier 2(데이터-주도화·LLM 포트화)는 "다중 회로/실제 LLM" 결정이 실제로 내려질 때 착수하며, 클린 아키텍처 디렉터리 강제는 현 범위에서 명시적으로 보류한다.

---

### 부록: 에이전트별 원본 점수
| 관점 | 점수/등급 | 판정 |
|------|-----------|------|
| 보안 | 8.5/10 | Critical 0, High 0, Medium 1, Low 3 |
| 아키텍처 | B+ (해커톤 상위 10%) | 원칙 90% 충족, 형식은 과설계 |
| 코드 품질 | 양호(데모 한정) | COMMENT — High 3건 확장 전 선결 권장 |
| UX/디자인 | 6~7.5/10 (차원별) | 접근성·반응형이 최약점 |
