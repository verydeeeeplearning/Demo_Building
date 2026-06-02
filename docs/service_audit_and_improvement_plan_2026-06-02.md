# H-eduware 서비스 종합 감사 보고서 & 개선 계획

**작성일**: 2026-06-02
**기준 문서**: `service-audit-checklist.md` (Senior Engineer Service Audit, 23개 영역)
**대상**: H-eduware (학생 자연어 → deepagents → 3D 시뮬레이션 → 하드웨어 직접 조작)
**감사 관점**: "부하가 걸리면 어디가 먼저 깨지는가 · 장애 시 blast radius · 6개월 뒤 유지보수 가능성"

---

## 0. 감사 전제 & 목표 시스템 정의

### 0.1 현재 시스템 성격

H-eduware는 **해커톤 출신 단일 사용자/데모 지향 웹앱**이다. 일반적인 프로덕션 SaaS 체크리스트(결제·주문·다중 테넌트·DB 정합성)와는 결이 다르므로, 본 감사는 체크리스트를 **실제 위험 기여도 기준으로 재해석**한다.

| 체크리스트 가정 | H-eduware 실제 |
|---|---|
| RDB/큐/캐시 인프라 | **없음**. 상태는 파일(`​.local/shared-projects`)과 인메모리 |
| 인증/인가/결제 | **없음**. 익명 단일 흐름 |
| 다중 인스턴스/오토스케일 | **없음**. 단일 Node 프로세스(`127.0.0.1:8787`) |
| 외부 의존성 | **OpenAI API (deepagents) — 유일하고 치명적인 SPOF** |
| 배포 파이프라인 | **없음**. CI/CD·Docker·배포 설정 전무 |

### 0.2 목표 시스템(사용자 확정)

```
학생 요청 → [deepagents 라이브] → 검증된 회로 + 시뮬레이션 → 3D 화면 하드웨어 직접 조작
```
- **데모 완전 제거** (오프라인 폴백/데모 회로/데모 인터뷰 삭제)
- **스코프**: 132개 부품의 **모든 조합 지원**(서브셋 게이트 아님) — v2 bundles + wp01~12 데이터가 기반
- **프런트**: 자체 store + 영역 렌더러(무프레임워크 유지)
- **컨텍스트**: v2 단일화 + legacy/v1 즉시 제거
- **테스트 결정성**: 기존 퀄리티 게이트(검증 파이프라인) 기반

> **핵심 모순**: 데모를 제거하면 유일한 오프라인 폴백이 사라져 **OpenAI 의존이 100%가 된다**. 즉 "OpenAI = 단일 장애점"이 제품의 본질이 된다. 본 감사의 P0 대부분이 이 한 문장에서 파생된다.

---

## 1. 한 페이지 요약 (Executive Summary)

| 영역 | 핵심 질문 | 현 상태 | 등급 |
|------|----------|---------|------|
| 제품 | 핵심 흐름이 안정적인가 | 데모 폴백에 의존, 라이브 경로는 단일 의존 | 🟠 |
| 아키텍처 | 장애가 전파되지 않는가 | OpenAI 장애 = 전체 마비, 격리 없음 | 🔴 |
| 코드 | 변경 쉽고 테스트 가능한가 | main.js 2,743줄 모놀리식, contextPacket 3,673줄 | 🟠 |
| API | 일관·안전·호환 | 버저닝 없음, rate limit 없음, body 크기 무제한 | 🔴 |
| 데이터 | 정합성·복구 | 공유 파일 무한 증가·TTL 없음·백업 없음 | 🟠 |
| 보안 | 인증·인가·민감정보 | 인증 없음(설계상), 키 redaction은 양호 | 🟡 |
| 테스트 | 핵심 자동 검증 | 단위/검증 게이트 충실, 데모 제거 시 e2e 재설계 필요 | 🟠 |
| 배포 | 안전 배포·롤백 | **CI/CD·배포 설정 전무, 롤백 불가** | 🔴 |
| 관측성 | 빠른 감지·원인 추적 | trace_id 로깅 있음, 메트릭/알림/대시보드 없음 | 🔴 |
| 성능 | 트래픽 견딤 | 단일 프로세스, 요청당 JSON 재파싱, 무한 body | 🟠 |
| 운영 | runbook·장애 대응 | 없음 | 🔴 |
| 비용 | 통제·낭비 | OpenAI 토큰 비용 무제한(예산/rate limit 없음) | 🔴 |

**P0(즉시) 5건 · P1(빠르게) 8건 · P2(계획적) 9건** — 상세는 §25 매트릭스.

---

## 2. 핵심 흐름 & Criticality (체크리스트 §1)

### 핵심 사용자 시나리오
- ✅ 핵심 플로우는 Spec/master_statement + AGENTS.md에 문서화됨(Describe→Interview→Confirm→Design→Explain→Run).
- ❌ 기능별 성공률(전환율)·이탈 지점 측정 **없음**.
- ❌ 장애 시 복구 우선순위 **정의 없음**.

### Criticality 분류 (H-eduware 재정의)

| 등급 | 기능 | 장애 영향 |
|------|------|----------|
| **Critical** | `POST /api/agent/message`(회로 합성) | 제품의 유일한 핵심. 죽으면 앱 무용 |
| **Critical** | OpenAI/deepagents 연결 | 위 기능의 전제. **SPOF** |
| High | `POST /api/agent/placement`(하드웨어 조작 해석) | 목표 UX의 절반 |
| High | 시뮬레이션 렌더(`stageScene`) | 결과 가시화 |
| Medium | `explain-target`(튜터) | mock 폴백 존재 → 격리됨 |
| Medium | 공유(`/api/share`) | 부가 기능 |

**발견(F-1, P1)**: 장애 시 우회(workaround)·복구 순서·핵심 기능 별도 모니터링이 **전무**. 데모 제거 후에는 Critical 2건이 곧 전부이므로, 이 둘에 모니터링·격리·degradation을 집중해야 한다.

---

## 3. 아키텍처 & 설계 (체크리스트 §2)

### 강점
- ✅ 계층 경계가 비교적 명확: `agent`(오케스트레이션) / `context`(데이터) / `share`(저장) / 프런트(`src`).
- ✅ 검증 게이트 다층(candidate-part, coverage, build-runnable)으로 잘못된 합성 차단.
- ✅ deepagents 출력은 Zod 스키마로 경계 검증.

### 🔴 단일 장애점(SPOF) & 장애 전파
- **OpenAI API가 절대적 SPOF.** `deepAgentRuntime.runAgent`는 라이브 모델 호출 외 경로가 없다(요구사항 분석 단계조차 mock 없음). 데모 제거 시 **graceful degradation이 0**.
- **격리/차단 구조 없음**: 서킷 브레이커·격벽·타임아웃(서버측)·재시도 백오프 전무. OpenAI가 느려지면 모든 요청이 90s까지 점유(클라이언트 타임아웃만 존재).
- `circuitTutor`만 `H_EDUWARE_TUTOR_MODE` 기반 mock 폴백을 가져 유일하게 격리됨 → **이 패턴을 핵심 경로에도 도입해야 함**.

### 상태/세션
- ✅ 에이전트 서버는 사실상 stateless(세션 state는 deepagents thread_id로 위임, 공유는 파일).
- ⚠️ 단, 컨텍스트 로더 인메모리 캐시(capabilityGraph만)는 프로세스 바운드 → 다중 인스턴스 시 불일치 없음(읽기 전용)이라 확장엔 무해.

### 의존성 구조
- ✅ 외부 의존성은 OpenAI 단일 → 체인 짧음, 순환 없음.
- ❌ 외부 호출에 **timeout/retry/circuit breaker 미적용**(서버측).

**발견(F-2, P0)**: OpenAI 장애·지연에 대한 **서버측 타임아웃·서킷브레이커·재시도(백오프+지터)** 부재. 데모 제거 후 단일 의존이 되므로 최우선.

**발견(F-3, P1)**: 핵심 합성 경로에 **degradation 경로 없음**. 최소한 "현재 회로 캐시 응답" 또는 "명시적 서비스 일시중단 메시지" 같은 fallback 필요.

---

## 4. 확장성 & 성능 (체크리스트 §3)

- 단일 프로세스·단일 포트. scale-out 미고려(현 단계 수용 가능).
- ⚠️ **요청당 비용**: 다수 컨텍스트 로더가 매 요청 JSON 재파싱(capabilityGraph 외 캐시 없음). `contextPacket.ts`(3,673줄)가 요청마다 intent 파싱→매칭→retrieval plan 수행.
- ⚠️ **무한 입력**: `server/index.ts:readJson`이 body를 **크기 제한 없이** 누적(`chunks.push`). 거대 payload로 메모리 고갈 가능(DoS 표면).
- ❌ p50/p95/p99 latency, TPS, 부하 테스트 **전무**. OpenAI 호출이 지배적이라 자체 latency보다 외부 지연이 꼬리를 만든다.

**발견(F-4, P1)**: body 크기 상한·요청 타임아웃 부재. **F-5(P2)**: 컨텍스트 로더 캐시 일원화(부팅 시 1회 로드 → 동결)로 요청당 파싱 제거.

---

## 5. 신뢰성 & 가용성 (체크리스트 §4)

- ❌ timeout(서버측)·retry 백오프·서킷브레이커·격벽 전무(§3과 동일 뿌리).
- ❌ SLA/SLO/SLI, error budget 미정의.
- ❌ 멱등성: `POST /api/agent/message`에 idempotency key 없음 → 중복 클릭 시 OpenAI 중복 과금(프런트는 `state.thinking` 가드가 있으나 서버 보증 아님).
- **백업/복구**: 공유 파일(`.local/shared-projects`)은 백업·TTL·복구 절차 없음. RPO/RTO 미정의(단, 데이터 가치가 낮아 영향 제한적).

**발견(F-6, P1)**: `/api/agent/message`에 **idempotency key**(클라이언트 생성 토큰) 도입 → 중복 제출 시 동일 trace 재사용·재과금 방지.

---

## 6. 보안 (체크리스트 §5) — 부분 강점

### 양호
- ✅ **시크릿 비커밋**: `.gitignore`가 `.local/`, `.env`, `.env.*` 제외. git 추적 파일에 키 없음(검증 완료).
- ✅ **공유 스냅샷 redaction**: `sk-proj-…`, `OPENAI_API_KEY=…`, `.local/agent.env` 패턴을 프런트(`shareSnapshot.js`)에서 제거.
- ✅ **Path traversal 방어**: `shareStore.sharePath`가 정규식(`^[a-f0-9]{32}$`)+경로 prefix 이중검증.
- ✅ **XSS**: 프런트가 `escapeHtml`을 광범위 사용(렌더 문자열 보간 시).

### 위험
- ⚠️ **입력 크기/검증**: agent message body 크기 무제한(§4). Zod 스키마 검증은 있으나 길이 상한 점검 필요.
- ⚠️ **에러 정보 노출**: `errorResponse.ts:44-51`의 최종 fallback이 `error.message`를 그대로 400 응답에 노출 + `index.ts`가 원본 에러를 로깅/throw. 내부 경로·구현 노출 소지.
- ⚠️ **CORS**: `127.0.0.1:4173/5173` 화이트리스트(데모 적정). 단 배포 시 도메인 정책 재설계 필요.
- ❌ **rate limit 없음** → 익명 무제한 호출 = OpenAI 비용 폭주 + DoS(§18).
- ❌ **SCA/SAST/의존성 취약점 스캔 없음**(`npm audit`도 CI 없음).
- (N/A) 인증·인가·비밀번호 해싱·MFA·IDOR·RBAC — 현재 사용자/리소스 모델이 없어 비해당. **단, 향후 사용자/저장 기능 추가 시 즉시 P0 후보.**

**발견(F-7, P0)**: 익명 엔드포인트에 **rate limit + body 크기 상한** 미적용(비용·DoS·남용). **F-8(P1)**: 에러 응답 표준화로 내부 메시지 노출 차단.

---

## 7. 개인정보 & 컴플라이언스 (체크리스트 §6)

- ✅ 현재 개인정보 수집 **없음**(익명, 계정 없음). 최소 수집 원칙 자연 충족.
- ⚠️ 학생이 입력한 자연어 프롬프트가 **OpenAI로 전송**됨 → 향후 미성년 사용자 대상이면 데이터 처리 고지·OpenAI 데이터 정책 검토 필요.
- ⚠️ 로깅(`agent-events.jsonl`)에 학생 메시지 preview가 남을 수 있음(`requestLogSummary`) → 보관 기간·민감도 정책 필요.

**발견(F-9, P2)**: 학생 프롬프트의 외부 전송·로그 보관에 대한 데이터 처리 정책 문서화(특히 교육 대상이 미성년인 경우).

---

## 8. 관측성 (체크리스트 §7) — 🔴 약점

- ✅ **구조화 로깅**: `agentLogger`가 JSONL + `traceId`로 요청 상관관계 추적. 이벤트(received/built/analysis/synthesis/validation/sent/failed) 충실.
- ✅ LangSmith 추적 훅(`langSmithTraceCli`) 존재.
- ❌ **메트릭 전무**: request count/latency/error rate, OpenAI latency/failure rate, 토큰 사용량 대시보드 없음.
- ❌ **알림 전무**: 장애·비용·에러율 알림 없음.
- ❌ 로그 기본 레벨 `silent` → 운영 시 사실상 관측 불가.

**발견(F-10, P0)**: Golden Signals(지연·트래픽·에러·포화) + **OpenAI 호출 latency/실패율/토큰 비용** 메트릭과 임계 알림 부재. 데모 제거 후 단일 의존이라 "OpenAI가 느려지는 순간"을 먼저 알아야 함.

---

## 9. 데이터 관리 & 정합성 (체크리스트 §8)

- (대부분 N/A — RDB 없음)
- 공유 저장: 파일당 1 스냅샷, 멱등(랜덤 id), 동시성 충돌 없음(고유 파일).
- ⚠️ **무한 증가**: 공유 파일 TTL/정리 없음 → 디스크 누수.
- ⚠️ **컨텍스트 집계 정합성**: `*.sources/ → buildContextAggregate.mjs` 빌드 게이트가 ID중복·순서만 검사. **스키마 검증은 런타임 테스트로 분리** → 잘못된 부품 정의가 빌드 시 통과 가능.

**발견(F-11, P1)**: 공유 파일 TTL/정리 배치. **F-12(P1)**: 컨텍스트 집계 빌드에 Zod 스키마 검증 통합(132부품 확장 시 정합성 핵심).

---

## 10. API (체크리스트 §9)

- ✅ 표준화 에러 응답 일부(`errorResponse`: 502/503/413 + errorCode/retryable).
- ❌ **버저닝 없음**(`/api/agent/message`). breaking change 절차 없음.
- ❌ rate limit·idempotency 없음(§5,§6).
- ❌ OpenAPI 등 명세 없음(스키마는 Zod 코드에만 존재).
- ⚠️ 응답 시간 SLA/SLO 미정의.

**발견(F-13, P2)**: API 버저닝(`/api/v1/…`) + Zod→OpenAPI 명세 생성으로 계약 가시화.

---

## 11. 코드 품질 & 유지보수성 (체크리스트 §10) — 🟠

### 거대 단위
| 파일 | 줄수 | 문제 |
|------|------|------|
| `server/context/contextPacket.ts` | 3,673 | 단일 책임 초과(intent·매칭·retrieval·coverage·prompt) |
| `src/main.js` | 2,743 | 상태+렌더+이벤트+3D제어 혼재, 전체 DOM 재생성 |
| `src/stageScene.js` | 2,026 | 씬 초기화·이벤트·애니메이션 혼재 |
| `server/agent/deepAgentRuntime.ts` | 1,632 | 오케스트레이션+안전대체+정규화 혼재 |
| `server/agent/schemas.ts` | 1,116 | 거대 superRefine(solver gate ~100줄) |

### 전역 상태 / 사이드이펙트
- 🔴 `src/main.js`의 단일 `state` 객체 + 매 변경 시 `app.innerHTML` 재할당 → 포커스/스크롤 손실, 리스너 재바인딩.
- ⚠️ build-ready/review 판정 헬퍼가 `main.js`·`shareSnapshot.js`·`shareImport.js`에 **중복**.

### 에러 처리
- ✅ 커스텀 에러 타입(`AgentConfigurationError`/`AgentPromptBudgetError`/`AgentStructuredOutputError`) → 분류 양호.
- ⚠️ 최종 fallback이 원문 노출(§6).

### 정적 분석
- ❌ **린터 없음**(eslint/prettier 미설정). `tsc --noEmit`만 존재. 컨벤션 일관성은 사람 의존.

**발견(F-14, P2)**: 거대 파일 분해(특히 `main.js`→store+영역렌더러, `contextPacket`→단계별 모듈). **F-15(P2)**: ESLint+Prettier 도입.

---

## 12. 테스트 (체크리스트 §11)

- ✅ 단위/검증 테스트 충실(42파일/17,036줄): 스키마·검증 게이트·라우팅·컨텍스트·공유·i18n.
- ✅ mock 기본 / 라이브 opt-in(`RUN_LIVE_E2E`, `H_EDUWARE_AGENT_MODE=live`) — AGENTS.md 보안 계약 준수.
- ✅ e2e가 캔버스 픽셀 검사로 빈 3D 무대 차단.
- ⚠️ **데모 제거 시 `demo.spec.js` 오프라인 경로가 붕괴** → 핵심 e2e 재설계 필요(사용자 결정: 기존 퀄리티 게이트 기반).
- ❌ flaky 대비 재시도 없음, 한국어 안전 거부 시나리오 부족, 부하/통합(외부 API 장애 mock) 부족.

**발견(F-16, P0 for 데모 제거)**: 데모 제거와 동시에 **퀄리티 게이트 기반 e2e 재설계** — 오프라인 스텁 대신, 검증 파이프라인(validate→netlist→render→sim→build-runnable)의 결정적 출력으로 핵심 흐름을 보호.

---

## 13. CI/CD & 배포 (체크리스트 §12) — 🔴 전무

- ❌ `.github/workflows` 없음 → PR 자동 테스트·lint·typecheck·보안스캔 전무.
- ❌ Dockerfile·배포 설정(fly/vercel/render)·staging/prod 분리 없음.
- ❌ 롤백 전략 없음 → "문제 시 빠르게 되돌리기" 불가.
- ✅ `npm run check`(test→typecheck→build→e2e)가 **로컬 수동 게이트**로 존재 → CI로 승격만 하면 됨.

**발견(F-17, P0)**: `npm run check`를 **GitHub Actions로 승격**(PR 차단 게이트) + `npm audit`/의존성 스캔 추가. 배포 대상이 정해지면 컨테이너화·롤백 전략 수립.

---

## 14. 인프라 (체크리스트 §13)

- (대부분 N/A — 로컬 단일 프로세스)
- ❌ graceful shutdown 없음(`server.listen`만; SIGTERM 핸들러 부재) → 배포 중 요청 유실 가능.
- ❌ readiness/liveness 구분 없음(`/api/agent/health`는 소스 freshness 위주, 의존성(OpenAI) 도달성 미반영).

**발견(F-18, P1)**: health를 **liveness/readiness 분리** + OpenAI 도달성 반영. graceful shutdown 추가.

---

## 15. 외부 연동 (체크리스트 §16)

- OpenAI(deepagents)가 유일 외부 의존. SLA 인지·timeout·fallback·재처리 큐 **전무**(§3,§5 동일 뿌리).
- ✅ vendor lock-in 관점: LangChain 추상화로 모델 교체 여지는 있음(`H_EDUWARE_AGENT_MODEL`).

**발견(F-2 재확인, P0)**: 외부 API timeout/retry/circuit breaker — 데모 제거 후 최우선.

---

## 16. 설정 & 시크릿 (체크리스트 §17)

- ✅ config-코드 분리: 환경변수(`OPENAI_API_KEY`, `H_EDUWARE_AGENT_MODEL`, 로깅·reasoning effort 등) + `.local/agent.env` 로더.
- 🔴 **fail-fast 위반**: 필수 env가 **시작 시 미검증**. `requireLiveConfig()`가 첫 요청에서야 던짐 → 잘못된 배포가 "동작하는 척" 하다가 첫 사용자에게 503.
- ⚠️ env 누락 시 health는 `deepagents-unconfigured`를 반환하나, 시작 로그에 명시적 경고 없음.

**발견(F-19, P0)**: 서버 부팅 시 필수 env 검증(fail-fast) + 명확한 시작 로그.

---

## 17. 비용 (체크리스트 §18) — 🔴

- 🔴 **OpenAI 토큰 비용 무제한**: rate limit·요청 예산·일일 상한 없음. 익명 공개 시 비용 폭주 직결.
- ⚠️ reasoning effort 기본 `low`지만 gpt-5 계열은 비용 큼. draft repair loop(max 2)로 요청당 최대 2회 합성 → 비용 2배 가능.
- ❌ 비용 추이 모니터링·급증 알림 없음.

**발견(F-20, P0)**: 요청 rate limit + 일일/세션 토큰 예산 + 비용 메트릭. (F-7,F-10과 묶음)

---

## 18. 장애 대응 / 문서화 / 팀 (체크리스트 §19,§20,§21)

- ❌ runbook·on-call·incident 등급·postmortem 절차 없음.
- ❌ **README 없음** → 신규 개발자가 "문서만 보고 실행" 불가(AGENTS.md가 부분 대체).
- ✅ 풍부한 계획/감사/핸드오프 문서(docs/)는 존재하나 **SSOT 분산**(Spec/docs/루트 3층)·일부 stale.
- ⚠️ **버스 팩터**: 컨텍스트 레이어(wp01~12, bundles, source-claims) + deepagents 오케스트레이션이 고도로 특화 → 지식 단일점 위험.

**발견(F-21, P1)**: README(로컬 셋업·실행·아키텍처 1장) + 최소 runbook(OpenAI 장애·env 누락·서버 재시작). **F-22(P2)**: 문서 SSOT 통합.

---

## 19. 관리자 도구 & 감사 추적 (체크리스트 §23)

- (N/A) 관리자 페이지·권한 변경·대량 작업 없음.
- ✅ trace_id 기반 행동 추적은 로깅으로 일부 가능.

---

## 20. 시니어 핵심 질문 답변 (체크리스트 부록 C)

| 질문 | 현재 답 |
|------|---------|
| 어디가 깨지면 가장 큰 피해? | **OpenAI 연결** — 데모 제거 후 전체 마비 |
| 사용자보다 먼저 장애를 아는가? | ❌ 메트릭/알림 없음 |
| 10분 안에 원인 좁히는가? | △ trace 로그 있으나 대시보드 없음 |
| 배포 실패 시 빠른 롤백? | ❌ CI/CD·롤백 전무 |
| 데이터 틀어지면 복구? | △ 공유 파일 백업 없음(영향 낮음) |
| 10배 트래픽 시 먼저 터지는 곳? | OpenAI rate limit + 무제한 body |
| 외부 죽으면 같이 죽는가? | 🔴 **그렇다**(격리 없음) |
| 신규 개발자가 안전히 수정? | △ README 없음, 모놀리식, 린터 없음 |
| 보안 사고 시 노출? | 입력 프롬프트·trace 로그(키는 redaction됨) |
| 버스 팩터? | 🔴 컨텍스트 레이어·deepagents 특화 지식 |

---

# 제2부. 개선 계획 (Improvement Plan)

> 데모 제거 + 4대 이슈 + 감사 발견을 **하나의 로드맵**으로 통합한다. 사용자 확정 결정(자체 store, v2 단일화, 132부품 조합, 퀄리티 게이트 기반)을 전제로 한다.

## 21. 개선 원칙

1. **데모 제거가 곧 단일 의존 노출**이므로, 제거 전에 "OpenAI 장애 격리"를 먼저 깐다(P0).
2. **퀄리티 게이트가 새 안전망**: 데모 오프라인 폴백 대신, 결정적 검증 파이프라인 출력이 e2e를 지탱한다.
3. **132부품 조합 = 데이터 정합성 게임**: 코드보다 v2 bundles/wp 데이터의 스키마·커버리지가 품질을 좌우한다.
4. **무프레임워크 유지**: 자체 store + 영역 렌더러로 main.js 부채를 해소(의존성 0).

## 22. 단계별 로드맵

### Phase 0 — 안전망 선설치 (데모 제거의 전제, P0)
데모를 걷기 *전에* 단일 의존을 견딜 수 있게 만든다.

- [ ] **0.1 OpenAI 호출 격리**: `deepAgentRuntime`에 서버측 timeout + 재시도(지수 백오프+지터, 최대 N) + 간이 서킷브레이커(연속 실패 시 빠른 503).
- [ ] **0.2 fail-fast env 검증**: 부팅 시 `OPENAI_API_KEY`·`H_EDUWARE_AGENT_MODEL` 확인, 누락 시 명확한 종료/경고 로그.
- [ ] **0.3 rate limit + body 상한**: `/api/agent/*`에 IP/세션 기반 rate limit, `readJson` 크기 상한, 요청 타임아웃.
- [ ] **0.4 토큰 예산 + 비용 메트릭**: 요청당/일일 토큰 상한, OpenAI latency·실패율·토큰 수 카운터.
- [ ] **0.5 핵심 흐름 degradation**: 합성 실패 시 명시적 "일시중단" 응답(`retryable`) — 데모 회로로 위장하지 않는다.
- **게이트**: `npm run check` 통과 + 0.1~0.4 단위 테스트.

### Phase 1 — 데모 완전 제거 (스코프 정렬, 🟡#4)
- [ ] **1.1 데모 데이터 제거**: `createDemoCircuit`/`createRequirementMarkdown`의 데모 회로, `demoInterviewState`, `loadDemoProject`, landing/topbar의 `load-demo`, `source: 'demo'` 분기(`canRunLoadedProject:1567`).
- [ ] **1.2 빈 시작 상태 재설계**: 앱은 데모가 아닌 "요청 입력 대기" 상태로 부팅(`state.project = createLocalizedProject` 제거). 빈/로딩/에러 상태 명시(체크리스트 §15).
- [ ] **1.3 폴백 분기 교체**: `confirmCurrentAgentResult`의 데모 폴백(`1811-1815`) 제거 → 에이전트 결과 없으면 명확한 재시도 안내.
- [ ] **1.4 오프라인 인터뷰 엔진 처리**: `interviewEngine`는 "데모 보존용"이 목적이었으므로, 역할 재정의(순수 클라 진행 UI로 유지하되 데모 잠금 흐름 제거) 또는 제거.
- [ ] **1.5 데모 e2e 재설계**: `demo.spec.js` 오프라인 스텁(8799) → 퀄리티 게이트 기반 결정적 e2e(검증 파이프라인 출력 고정)로 교체.
- [ ] **1.6 i18n/문서 정리**: `locales`·Spec·AGENTS.md의 "OLED 데모 하나" 경계 문구를 "132부품 조합 일반화"로 갱신.
- **게이트**: 데모 문자열 0 grep + 새 e2e 통과 + `npm run check`.

### Phase 2 — 프런트 store + 영역 렌더러 (🔴#1)
- [ ] **2.1 상태 store 도입**: 의존성 0의 `createStore(initial)` — `getState/setState/subscribe`. 상태를 도메인별 슬라이스(ui/stage/simulation/interview/agent)로 분리.
- [ ] **2.2 영역 렌더러 분리**: `renderAiPanel`/`renderFiles`/`renderPcb`/`renderInspector`를 모듈로 추출, 각자 자기 DOM 노드만 갱신.
- [ ] **2.3 증분 갱신**: 전체 `app.innerHTML` 재생성 제거 → 영역별 타깃 갱신(포커스/스크롤 보존). store 구독으로 변경 영역만 리렌더.
- [ ] **2.4 이벤트 위임**: 루트 1개 리스너로 위임(매 렌더 재바인딩 제거).
- [ ] **2.5 중복 헬퍼 통합**: build-ready/review 판정 로직을 단일 모듈로(`main`/`shareSnapshot`/`shareImport` 공유).
- **게이트**: 기존 e2e/단위 통과 + 렌더 횟수/포커스 보존 회귀 테스트.

### Phase 3 — 컨텍스트 v2 단일화 + legacy 제거 (🟠#3)
- [ ] **3.1 v2 승격**: `agent-context/v2`(bundles + routes + schemas)를 유일 소스로. 루트의 중복 registry/data를 v2 빌드 산출로 일원화.
- [ ] **3.2 legacy/v1 삭제**: `agent-context/legacy/` 제거 + 참조 정리.
- [ ] **3.3 wp01~12 커버리지 완성**: render-footprints/topology는 wp01~12 전체 존재하나 capability-graph는 wp05/06 누락(아날로그·디지털·매트릭스·디스플레이·power-passive·controller·prototyping·protocol·comm·logic만 존재) → **wp05(light-sound)/wp06(motion-power) capability 소스 추가**로 12 WP 정합.
- [ ] **3.4 빌드 스키마 검증**: `buildContextAggregate.mjs`에 Zod 스키마 검사 추가(ID/순서 외 구조 검증).
- **게이트**: `npm run context:check` + 신규 스키마 검증 + 컨텍스트 단위 테스트.

### Phase 4 — 132부품 조합 일반화 (스코프 본체)
- [ ] **4.1 조합 매트릭스 정의**: wp 카테고리 간 합법 조합 규칙(예: 센서×디스플레이, 입력×출력)을 topology-templates로 일반화. 특정 케이스 하드코딩 금지.
- [ ] **4.2 안전 게이트 유지**: "모든 조합 지원"이되 안전정책(고전압·메인전원)은 안전대체로 유도(현 `buildSafeLowVoltageLedEquivalentSpec` 일반화).
- [ ] **4.3 시뮬레이션 프리미티브 확장**: 현 5종 → PWM·아날로그 읽기·통신 프로토콜 등 wp 커버리지에 맞춰 확장(미확장 시 132조합의 시뮬이 빈약).
- [ ] **4.4 일반화 평가 확장**: `generalizationEval` + `context-sufficiency` 평가셋에 조합 케이스·한국어 샘플 보강.
- **게이트**: `eval:generalization` 통과율 목표 설정 + 조합 회귀 스위트.

### Phase 5 — 운영 성숙도 (P0/P1 잔여)
- [ ] **5.1 CI 승격**: GitHub Actions로 `npm run check` + `npm audit` PR 차단 게이트(F-17).
- [ ] **5.2 관측성**: Golden Signals + OpenAI 메트릭 + 임계 알림(F-10), 로그 레벨 운영값.
- [ ] **5.3 에러 응답 표준화**: 원문 노출 제거, errorCode 체계화(F-8).
- [ ] **5.4 공유 TTL/정리 + health liveness/readiness 분리 + graceful shutdown**(F-11,F-18).
- [ ] **5.5 README + 최소 runbook**(F-21).
- [ ] **5.6 ESLint/Prettier**(F-15).

---

## 23. 의존 관계 (실행 순서 근거)

```
Phase 0 (안전망) ──▶ Phase 1 (데모 제거)   ← 0 없이 1 하면 단일 의존이 무방비로 노출
        │
        ├──▶ Phase 2 (프런트)   ← 데모 제거로 빈 상태/흐름 바뀌므로 1 이후
        │
        └──▶ Phase 3 (컨텍스트) ──▶ Phase 4 (132조합)  ← 3의 v2 단일화가 4의 전제
Phase 5 (운영)  ← 전 구간 병행 가능하나 CI(5.1)는 조기 도입 권장
```

---

## 24. 데모 제거 영향 파일 체크리스트 (grep 근거)

| 파일 | 데모 결합 지점 | 조치 |
|------|----------------|------|
| `src/main.js` | `createLocalizedProject`(67,77), `demoInterviewState`(177,1812,2322), `loadDemoProject`(2403), `load-demo`(217,472,1158), `source==='demo'`(1567), 폴백(1811-1815) | 제거/교체 |
| `src/circuitMetadata.js` | `createDemoCircuit` 등 데모 회로(10건) | 데모 회로 제거, 부품 메타만 유지 |
| `src/interviewEngine.js` | 데모 잠금 흐름(2건) | 역할 재정의 |
| `src/circuitTutorClient.js` | demo 참조(1) | 정리 |
| `src/locales/{ko,en}.js` | demo 카피(7/15건) | 일반화 문구로 교체 |
| `src/share{Snapshot,Card,Import,View}.js` | `source:'demo'` 처리(7건) | agent-only로 단순화 |
| `src/welcomePopup.js` | demo 안내(2건) | 갱신 |
| `tests/e2e/demo.spec.js` | 오프라인 데모 경로 전체 | 퀄리티 게이트 e2e로 재작성 |
| `AGENTS.md`, `Spec/*` | "OLED 데모 하나" 경계 | 132조합 스코프로 갱신 |

---

## 25. 우선순위 매트릭스 (체크리스트 부록 D)

### P0 — 즉시 (데모 제거의 전제 / 서비스 치명)
| ID | 항목 | 근거 |
|----|------|------|
| F-2 | OpenAI 호출 timeout/retry/circuit breaker | 데모 제거 후 단일 의존 |
| F-7 | rate limit + body 크기 상한 | DoS·비용·남용 |
| F-10 | OpenAI 메트릭 + 알림(관측성) | 사용자보다 먼저 인지 |
| F-17 | CI 게이트(npm run check + audit) | 롤백/회귀 방어 시작점 |
| F-19 | 부팅 시 env fail-fast 검증 | 잘못된 배포 조기 차단 |
| F-20 | 토큰 예산 + 비용 통제 | 비용 폭주 |
| F-16 | 퀄리티 게이트 기반 e2e 재설계 | 데모 제거와 동시 |

### P1 — 빠르게
F-1(복구 우선순위·핵심 모니터링) · F-3(degradation) · F-6(idempotency) · F-8(에러 표준화) · F-11(공유 TTL) · F-12(컨텍스트 스키마 검증) · F-18(health 분리·graceful shutdown) · F-21(README+runbook)

### P2 — 계획적으로
F-4/F-5(성능·캐시 일원화) · F-9(데이터 정책) · F-13(API 버저닝·명세) · F-14(거대 파일 분해) · F-15(린터) · F-22(문서 SSOT)

---

## 26. 결론

H-eduware는 **검증 게이트·스키마·시크릿 위생 같은 "안쪽 품질"은 해커톤치고 견고**하나, **"바깥쪽 운영 품질"(외부 의존 격리·관측성·비용통제·CI/롤백)이 사실상 0**이다. 평소엔 문제없지만 **데모를 제거하는 순간 OpenAI가 유일 SPOF가 되어 모든 운영 부채가 동시에 실위험으로 전환**된다.

따라서 권고 순서는 명확하다:
1. **Phase 0(안전망)을 먼저** 깐 뒤 **Phase 1(데모 제거)**.
2. 이후 프런트(2)·컨텍스트(3)·132조합(4)을 데이터 정합성 중심으로 진행.
3. CI(5.1)는 가능한 한 조기 도입.

> 본 감사·계획은 `as_is_analysis_report_2026-06-02.md`(구조 분석)와 짝을 이룬다. 실행 시 각 Phase를 CLAUDE.md의 TDD 계획 프로토콜(`docs/plans/PLAN_*.md`)로 분해할 것.
