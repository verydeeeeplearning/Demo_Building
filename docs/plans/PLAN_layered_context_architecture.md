# Implementation Plan: Layered Context Architecture (v2 번들 + 부품 번들 통합, v1 제거)

**Status**: In Progress (Rev. 2 — 적대적 리뷰 반영)
**Started**: 2026-06-02
**Last Updated**: 2026-06-02

**CRITICAL INSTRUCTIONS**: 각 Phase 완료 후:
1. 완료 체크박스 체크
2. 품질 게이트 검증 명령 실행(`npm run check`, `npm run context:check`)
3. 모든 품질 게이트 항목 통과 확인
4. "Last Updated" 갱신 + Notes & Learnings 기록
5. 그 다음에만 다음 Phase 진행

> **Rev.2 변경 요약(3개 적대적 리뷰 반영)**: ① "L3=L2 memoized 캐시" 불변식 폐기 → **구조 코어 + 안전 오버레이 분리**. ② 부품 수 130(132 아님)·primitive 31종(5종 아님)으로 정정. ③ feature-flag(shadow 모드) 태스크 신설. ④ 골든 동치 클래스/단계적 게이트 명문화. ⑤ 숨은 차단 테스트·데이터 미준비·wp05/06 갭을 선행 의존으로 승격. ⑥ Phase 2 3분할. 상세 근거: `docs/plans/REVIEW_layered_context_architecture_2026-06-02.md`(리뷰 종합).

> 짝 문서: `as_is_analysis_report_2026-06-02.md`, `service_audit_and_improvement_plan_2026-06-02.md`, `rigorous_failure_and_v2_architecture_review_2026-06-02.md`.

---

## 1. Overview

### 1.1 Feature Description

현재 컨텍스트 레이어는 v1 라우팅과 v2 번들이 공존한다. **정확한 현 거동**(`contextPacket.ts:1348-1411` 실측):
- 매 요청 `loadContextRoutingMap()`(v1 라우팅맵)이 **항상** 로드된다(`:1351`).
- v2 라우트가 적중하면 v2 경로(`buildContextRouteV2`/`buildRetrievalPlanV2`), **미적중 시에만** v1 폴백(`selectContextRoute`/`buildRetrievalPlan`, `:1385-1410`).
- **단, v2 경로도 v1 routingMap에 결합**: `buildRetrievalPlanV2`가 `routingMap.heavySourceIds`를 인자로 사용(`:1931`).

즉 진짜 부채는 "매 요청 이중 실행"이 아니라 **(a) v2가 v1 routingMap에 결합 + (b) 미적중 신규조합이 `supported-hardware-general` 일반 폴백으로 열화(`:1810`)** 다. v2 번들은 "능력당 1:1 라우트 41개"의 닫힌 열거라, 사전 큐레이션되지 않은 부품 조합은 (b)로 빠진다 — "임의 부품 조합 지원" 목표와 구조적으로 충돌.

본 계획은 이를 **하나의 4계층 트리**로 통합한다(L0 부품번들 → L1 역할인덱스 → L2 토폴로지 조립엔진(생성) → L3 능력번들(큐레이션)). 두 경로(L3 적중 / L2 생성), **하나의 ContextPacket 계약**.

### 1.2 ⚠️ 핵심 설계 정정: "L3 = L2 캐시"가 아니라 "구조 코어 + 안전 오버레이"

**(Rev.1의 치명적 오류)** 번들을 "L2가 재생성할 수 있는 memoized 캐시"로 본 것은 틀렸다. 번들은 **두 이질적 산출물의 합**이다:

| 구성 | 예시(증거) | L2 생성 가능? |
|------|-----------|---------------|
| **구조 코어** (structural) | requiredParts/requiredTopologies/validationRules ID 집합 (`manifest.json`) | ✅ 역할+토폴로지에서 결정적 생성 가능 |
| **안전 오버레이** (safety) | "Do not claim calibrated/safety protection" (`analog-sensor-display-readout/BUNDLE.md:11`), 부품별 경고(`circuitTools.ts:286,305,337,388`), `blockingConditions`의 조합-특정 함정(`fake-module-pins-on-two-pin-resistive-sensor`), `commonMistakes`(`sensor.json:90`), source-claim 신뢰등급 | ❌ 결선 그래프의 함수가 아님 — **사람 큐레이션** |

→ 따라서:
- **골든 일치는 구조 코어에만 적용**(안전 오버레이는 비교 대상 아님 — 정직한 한정).
- **안전 오버레이가 없는 신규 조합은 build-ready가 아니라 review-only**(검토용 장면). L2가 합법 결선을 생성해도, 그 조합의 안전 경계가 사람 검수로 확보되기 전엔 "조립 가능"으로 주장하지 않는다.
- 번들 = `structural`(L2 생성/캐시) + `safety-overlay`(사람 큐레이션, build-ready 게이트) **2파일로 분리**.

### 1.3 "v1 제거"의 정확한 정의 (경로 명시)

| 대상 | 실제 경로 | 조치 |
|------|-----------|------|
| ① 죽은 스냅샷 | `agent-context/legacy/v1/` | **삭제** (Phase 5) |
| ② v1 **활성** 라우팅 | `agent-context/routing/context-routing-map.json`(legacy 아님) + `loadContextRoutingMap`/`selectContextRoute`/`buildRetrievalPlan`/`buildContextRoute` | **삭제** → L2 생성으로 대체 (Phase 3) |
| ③ 루트 canonical | `registry/`,`data/`,`electrical/`,`simulation/`,`ontology/`,`rendering/` | **삭제 금지 → L0로 흡수** (Phase 1) |

> ②의 활성 파일은 `agent-context/routing/`에 있고, `legacy/v1/routing/...`은 별개 죽은 사본이다(혼동 금지). Phase 3 grep 가드는 **`server/` 스코프로 한정**해 Phase 5(legacy 삭제) 전 조기 실패를 방지.

### 1.4 Success Criteria (측정 가능하게 재정의)

- [ ] 단일 라우터: L3 적중 시 `provenance:'curated-bundle'`, 미적중 시 `'generated-composition'`. `server/`에 v1 라우팅 심볼 참조 **0**.
- [ ] **레지스트리에 정의된 전 부품(N=130, 확정 SSOT)**이 L0로 resolvable.
- [ ] 샘플 신규 조합 케이스 집합(≥20, 한국어 포함)에서 **`supported-hardware-general` 정적 폴백 0회** + 각 케이스가 ContextPacket 생성 또는 명시적 `blockingConditions` 반환.
- [ ] 두 경로가 동일 ContextPacket 계약(스냅샷 테스트로 shape 고정).
- [ ] **구조 코어 골든**: 39 번들 중 단계적 목표(**1차 ≥30 일치 → Phase 3 진입**, 잔여는 blockingConditions로 추적, 최종 39 전수). 동치 = **구조 필드 집합 일치**(part ID/topology/validationRules/primitives), 산문·promptBlock 제외.
- [ ] **안전 게이트**: 안전 오버레이 없는 신규 조합은 build-ready=false(review-only)로 강등됨을 테스트로 보장.
- [ ] `legacy/v1` 및 v1 활성 라우팅 제거 후 `npm run check` 그린(차단 테스트·index.json 동반 수정 포함).
- [ ] (선행) RED 게이트(`low-voltage-power-rail` 1515>1500자) 복구.

---

## 2. Architecture Decisions (Clean Architecture)

### 2.1 Layer Mapping

| Clean Arch | 컴포넌트 | 책임 |
|-----------|----------|------|
| **Domain** | `PartBundle`(L0), `Role`/`Capability`(L1), `TopologyTemplate`(L2), `BundleStructuralCore`/`SafetyOverlay`(L3), `ContextPacket` 값객체 + 조합 규칙(순수) | 외부 의존 0 |
| **Application** | `AssembleContextPacket`(번들/생성 경로), `ResolvePartBundle`, `ComposeTopology`, `EvaluateSafetyOverlay`, `PromoteCompositionToBundle` | 단일 계약 산출, build-ready 판정 |
| **Infrastructure** | L0/L2/L3 로더, 캐시, 집계 빌더, 라우터 어댑터, **compose-mode 플래그** | 파일 I/O, 캐싱 |

### 2.2 Key Decisions

| 결정 | 근거 | 트레이드오프 |
|------|------|-------------|
| 번들을 **구조 코어 + 안전 오버레이로 분리** | "L3=L2 캐시" 거짓 동치 제거(리뷰 C1) | 2파일 경계 관리, manifest 스키마 변경 |
| **골든은 구조 코어만**, 단계적 게이트 | 전수 100% 강제 시 영구 정지(리뷰 C2) | 산문 회귀는 사람 검수로 별도 통제 |
| 신규 조합 **review-only 기본값** | 안전 미검수 회로의 build-ready 주장 차단 | "조립 가능" 조합이 사람 검수만큼만 증가 |
| **shadow 모드 플래그**로 L2 병행 | 롤백 전제 인프라 부재(리뷰 C1) | 플래그/로깅 구축 비용 |
| L2 생성이 v1 일반 폴백 대체 | 신규 조합 열화 제거 | 생성 경로 검증 부담 → 동일 게이트 |
| 단일 라우터 | 이중 경로 복잡도 제거 | 라우팅 재작성 리스크 → 회귀 스위트 |
| 승격 루프(L2→L3) **사람 안전 승인 필수** | 자기참조 골든 순환 차단(리뷰) | 자동 증식이 아닌 "검수 보조" |

### 2.3 단일 ContextPacket 계약

```
ContextPacket {
  ... (기존 필드 동일) ...
  provenance: 'curated-bundle' | 'generated-composition',
  buildReadyScope: 'original' | 'review-only',   // 안전 오버레이 유무가 결정
  safetyOverlayPresent: boolean
}
```
shape는 두 경로 동일 → 하위 deepagents 합성/검증 게이트 무변경. (단, build-ready 판정은 `safetyOverlayPresent`를 반영.)

---

## 3. Dependencies & 선행 작업 (Rev.2 신설 — 리뷰로 드러난 미준비)

### 3.1 Required Before Phase 1 (검증 결과 — R-1/CI 완료, D-1/D-2는 가짜 차단으로 해소)
- [x] **R-1**: `low-voltage-power-rail/BUNDLE.md` ≤1500자 트림 → 게이트 복구(Phase 0 완료).
- [x] **CI 게이트**: `.github/workflows/ci.yml`로 `npm run check` PR 차단(Phase 0 완료).
- [x] **D-1 (해소 — 가짜 차단)**: 구포맷 부품 11개가 `sourceClaimIds` 필드는 없으나 **128/130이 `subjectId`로 source-claim 연결**됨. L0 resolver가 `subjectId ∪ sourceClaimIds` 합집합 조인 → 필드 없는 부품도 claim 복구. 스키마도 `sourceClaimIds` 기본 `[]`. 전수 resolvable, claim 0개는 `resistor-220`/`jumper-wire` 2개뿐(명시적 `missing-source-claims`).
- [x] **D-2 (해소 — 가짜 차단)**: `capability-graph.sources/`에 wp05/06 *파일*은 없으나 집계 `capability-graph.json`(42개)에 light-sound·motion-power capability 전부 존재(`sound-alert-output`/`servo-motion-output`/`hbridge-motor-output`/`stepper-motor-output` 등). 런타임 갭 없음 — 파일명 기준 오탐.
- [x] **D-3 부품 수 SSOT 확정**: **N=130 확정**(사용자 결정 2026-06-02). 게이트는 "registry 전 부품(N=130)" 기준. "132" 표현은 전 문서에서 130으로 정정.

### 3.2 External Dependencies
- 신규 패키지 **없음**(무프레임워크 유지).

---

## 4. Test Strategy

| 유형 | 목표 | 목적 |
|------|------|------|
| Unit (Domain) | ≥90% | L0 완결성, L2 조립 규칙, 안전 오버레이 판정 |
| Unit (Application) | ≥80% | 두 경로 동일 계약, 단일 라우터, build-ready 강등 |
| **구조 골든** | 단계적(≥30→39) | L2 구조코어 == L3 구조코어(**산문 제외**) |
| **안전 회귀** | 부품별/조합별 | 안전 오버레이 없는 조합 = review-only 단언 |
| Integration | 핵심 | ContextPacket → 합성 → 검증 게이트 무변경 |
| Eval | 조합+**한국어 ≥N, 통과율 ≥X%** | 일반화(수치 게이트) |

**동치 클래스 명문화**: 골든 비교는 `{candidateParts ID 집합, requiredTopologies, validationRules, simulationPrimitives ID 집합}` 만. `summary`/`promptBlock`/`evals.jsonl`/안전 산문은 **제외**(별도 사람 검수). 모킹: 결정적 파일 데이터.

---

## 5. Implementation Phases

### Phase 0: 게이트 복구 & CI (선행, P0) — *실증됨*
**Goal**: 수용 게이트 그린 + 회귀 차단. **Est: 1–2h**
**Status**: ✅ Complete (2026-06-02) — BUNDLE.md 1515→1477B, test:unit EXIT0, ci.yml 신설, architect APPROVE

- RED 0.1: `low-voltage-power-rail` compact 위반 재현(현재 FAIL, 1515>1500, `contextLayer.test.ts:31`)
- GREEN 0.2: `BUNDLE.md` ≤1500자 트림(의미 보존) · 0.3: GitHub Actions(`npm run check`+`npm audit`)
- REFACTOR 0.4: compact 한도 상수화 + 빌드 시 검사 연계
- **Gate**: `npm run test:unit` EXIT 0, CI 차단 동작, `npm run check` 그린

### Phase 1: L0 부품 번들 토대 (③ 흡수)
**Goal**: 전 부품(N=130)을 완결 canonical 단일 주소로. **Est: 3–4h**
**Status**: ✅ Complete (2026-06-02) — 순수 추가(기존 코드 미변경), 게이트 그린

- [x] RED 1.1: `resolvePartBundle(partId)`가 {pins+role, electrical, footprint(인라인), simulationPrimitive, sourceClaims}를 반환 — `tests/unit/partBundle.test.ts`(4 테스트)
- [x] RED 1.2: L0 Zod 스키마(`PartBundleSchema`) 검증 · 1.3: **registry 전 부품 130 resolvable**(claim 0개 2개는 명시적 `missing-source-claims`)
- [x] GREEN 1.4: `server/context/partBundle.ts` resolver(footprint/sim은 부품 레코드 인라인 재사용 `getPartRegistry`, sourceClaims는 `subjectId ∪ sourceClaimIds` 조인 `loadSourceClaims`) · 1.5: `PartBundle` 값객체+스키마 · 1.6: 결손 부품 blockingConditions(`missing-source-claims`/`missing-simulation-primitive`)
- [x] REFACTOR 1.7: L0 번들 캐시(`resolveAllPartBundles` 1회 로드 동결 + id 맵)
- **Gate**: ✅ test:unit JS 110/110 + TS 323/323, typecheck EXIT0. (참고: L0 resolver는 Application/Infra 계층 — 순수 Domain 분리는 L2 도입 시 정리)

### Phase 2a: L2 토폴로지 조립 — 순수 도메인 (M-5 분할)
**Goal**: 역할 충족 부품 선택 + `fromRole/toNet` 결선 생성(순수). **Est: 3–4h**
**Status**: ✅ Core Complete (2026-06-02) — 범용 순수 엔진 + 1차 역할배치, 게이트 그린

- [x] RED 2a.1: `composeTopology(template, slotAssignments)` 합법 결선/미충족 blockingConditions — `tests/unit/composeTopology.test.ts`(5 테스트)
- [x] GREEN 2a.3: 순수 도메인 `server/context/composeTopology.ts`(파일 I/O 0): `composeTopology`(범용 와이어링 — **55 토폴로지 전부 구조 처리**) + `topologySlotRoles`(connections에서 슬롯 파생) + `partFillsSlotRole`(L1 술어, 1차 배치) + `resolveSlotAssignments`. 미해결은 명시적 `unresolved-slot-role`/`unresolved-pin-role`.
- [~] 2a.4 역할 taxonomy 정합: **1차 배치만**(controller/analog-sensor/i2c-module/dc-load/series-current-limit/power·ground-rail/switch 등). 정직한 커버리지: 55 토폴로지 중 **3개 end-to-end 완전조립**, 52개는 명시적 미커버 슬롯(`protocol-sensor`/`communication-module`/`pwm-actuator`/`low-side-driver`/`stepper-driver`…). **확장(3→골든 ≥30)은 Phase 2c 측정 목표.**
- [ ] 2a.2 안전대체 훅(고전압/메인) → Phase 2c 안전 오버레이와 통합(이연)
- **Gate**: ✅ 순수(외부의존 0) — test:unit JS 110/110 + TS 328/328(+5), typecheck EXIT0, 무회귀

### Phase 2b: 생성 경로 + shadow 모드 (C-1)
**Goal**: L2로 ContextPacket 생성, **응답 미반영 shadow로 병행**. **Est: 3–4h**
**Status**: ✅ Complete (2026-06-02) — 생성 경로 + 플래그 + 가드된 shadow 관찰자, 게이트 그린(build 포함)

- [x] RED 2b.1: `assembleGeneratedComposition`(생성 경로)가 구조 코어 산출, `provenance:'generated-composition'`, **안전 오버레이 없으면 항상 `buildReadyScope:'review-only'`**(완전조립이어도) — `generatedComposition.test.ts`(5)
- [x] RED 2b.2: shadow 관찰자가 candidateParts만 읽고 로깅만 → **응답 불변(by construction)**. `getComposeMode` off 기본·case-insensitive 단언
- [x] GREEN 2b.3: `composeMode.ts`(off/shadow/on) + `deepAgentRuntime.runLiveAgent`에 **가드 주입**(default-off·try/catch·패킷 미변경, 로그 이벤트 `context.compose.shadow`) · 2b.4: 프롬프트 예산은 역할/토폴로지/부품 ID 묶음(netlist+validationRules+primitiveHints)
- **Gate**: ✅ test:unit JS 110/110 + TS 333/333(+5), typecheck, **build ✓**, EXIT0. shadow는 env-gated이라 e2e/기존 경로 무영향.

### Phase 2c: 구조 골든 + 안전 오버레이 (C-2, 리뷰 핵심)
**Goal**: L2 구조코어 == L3 구조코어(단계적), 안전 오버레이 분리. **Est: 3–4h**
**Status**: ✅ Core Complete (2026-06-02) — **34/39 골든 일치(목표 ≥30 초과)**, 게이트 그린

- [x] RED 2c.1: **구조 골든** — `composeContextGolden.test.ts`(3). 역할 커버리지 확장(3/55→**38/39 해소, 34/39 VR 정확일치**). 동치 = validationRules 집합 + 토폴로지 해소가능성. **메타 검증**: 산문/promptBudget 변경이 구조코어에 영향 없음 단언. **추적 예외**(회귀 가드): UNRESOLVED=`logic-interface-context`, VR_DIFF=`dht22…`/`digital-light-output`/`low-voltage-power-rail`/`spi-communication-module-readout`.
- [x] RED 2c.2: 안전 오버레이 없는 생성 조합 = `buildReadyScope:'review-only'`(골든 safety 테스트 + 2b 불변식)
- [x] 2c.3 결정: `allowedParts`는 큐레이션 입력으로 취급(골든 **비교 대상 아님** — 비교는 도출 가능한 validationRules). 부품은 후보 입력으로만 사용.
- [ ] 2c.4 (이연 → Phase 4 승격): 번들 물리적 `structural.json`/`safety-overlay.md` 파일 분리. 안전 *개념*은 이미 강제(생성=review-only)이므로 게이트엔 불필요. 승격 루프(Phase 4)에서 파일 분리 수행.
- **Gate**: ✅ 골든 ≥30(=34), 안전 강등 단언, 잔여 추적. test:unit JS 110/110 + TS 336/336(+3), typecheck, build ✓, EXIT0.

### Phase 3: 단일 라우터 & v1 활성 라우팅 제거 (②) — *Phase 2c 증명 후*
**Goal**: 이중 경로 → 단일. 미적중은 L2(정적 폴백 제거). **Est: 3–4h (위험 단계, 별도 브랜치)**
**Status**: ✅ Complete (2026-06-02) — 단일 v2 라우터, v1 라우팅 완전 제거, 동작 보존 증명. commits `fd4f2f7`(특성화)·`8c98b6e`(3a)·`db743ff`(3b)

- [x] **3-pre 특성화(behavior lock)**: `routingCharacterization.test.ts`(3) — 9 케이스의 routeId/budget/maxPromptChars + 안전 unsafe 경로의 정확한 sourceIds 잠금. commit `fd4f2f7`. v1 제거가 동작 보존인지 증명하는 안전망.
- [x] **3-조사**: v1 고유 route 3개 식별 — `unsupported-safety`(when unsafe, **안전 critical**), `planned-capability-gap`(planned/partial), `supported-hardware-general`(supported catch-all). v2엔 unsafe/general/planned route 부재. v1 route의 grouped `load`→v2 flat `alwaysInclude` 변환 매핑 확보. `buildRetrievalPlanV2`의 유일 v1 의존 = `routingMap.heavySourceIds`(:1931).
- [x] **발견된 위험 해소**: eval 코퍼스 집계로 v1 fallback 중 **`unsupported-safety`만 실제 발동**(planned/general은 죽은 코드 — planned cap 0개, 모든 supported cap이 v2 route 보유)을 확인. unsupported-safety budget=minimal이라 budgetForV2Route와 일치 → budget-label 위험 무효. 그래도 `budget` 필드를 v2 route 스키마에 추가하고 budgetForV2Route가 존중하도록 수정(general=full 충실).
- [x] GREEN 3.4(3a): buildContextPacket 단일 v2 경로 재작성, selectContextRouteV2 total화(unsafe 단락→safety, 미적중→general). 3.5/3.6/3.7(3b): v1 코드/스키마/타입/로더/캐시 제거 + `context-routing-map.json` 삭제 + `index.json` routing 엔트리 제거 + `contextRouting.test.ts` v2로 재작성 + `contextLayerStructure.test.ts`·`contextV2Architecture.test.ts` 동반 수정 + heavySourceIds를 `v2/index.json`으로 이전.
- [ ] REFACTOR 3.8: `contextPacket.ts` 모듈 분해 — 별도 작업으로 이연(선택).
- **Gate**: ✅ `server/` v1 참조 **0**, 특성화 불변(동작 보존 증명), test:unit JS 110/110 + TS 339/339, typecheck, build, EXIT0.

### Phase 4: L3 재정초 & 승격 루프
**Goal**: 번들이 L0 참조(복제 제거), 구조/안전 분리 정착, 승격 절차. **Est: 3–4h**
**Status**: ✅ Core Complete (2026-06-02) — 승격 루프 + 사이클 차단 + L3↔L0 무결성, 게이트 그린

- [x] RED 4.1(재정초/무결성): 번들 manifest는 부품을 **ID 참조**(전체 레코드 복제 아님). **L3→L0 참조 무결성 테스트**: 모든 번들의 requiredParts∪allowedParts가 `resolvePartBundle`로 L0 해소(dangling 0). — `bundlePromotion.test.ts`
- [x] RED 4.2(사이클 차단 — 리뷰 핵심): `promoteCompositionToBundle`이 L2 구조코어를 동결하되, **사람 안전 승인(`approval.safetyOverlayReviewed`) 없이는 'supported'(oracle 자격) 불가**. 미승인→'partial', 미완성→'planned'. 생성물이 스스로 골든 oracle로 승격하는 자기참조 순환을 차단.
- [x] GREEN: `server/context/bundlePromotion.ts`(순수) — `PromotedBundleStructural`(requiredParts=배정 슬롯, allowedParts=후보, validationRules/topology/primitives=L2 코어, provenance, promotion{approvedBy/At/safetyOverlayReviewed}). 4 테스트(구조 도출 / 사이클 차단 / 미완성→planned / L3↔L0 무결성).
- [ ] 이연(고churn·저가치): 39 manifest 물리적 `structural.json`/`safety-overlay.md` 파일 분리(2c.4) + `capabilityPromotionReport` 자동 연계 + BUNDLE.md 초안 자동화. 안전 *개념*은 강제됨(생성=review-only, 승격=사람승인 필수)이라 게이트엔 불필요.
- **Gate**: ✅ 승격 왕복(구조 도출 + 사이클 차단 단언) + L3↔L0 무결성, test:unit JS 110/110 + TS 343/343(+4), typecheck, build, EXIT0.

### Phase 5: legacy 제거 & 정리 (①)
**Goal**: 죽은 v1 스냅샷 제거, 문서/스코프 정합. **Est: 2–3h**
**Status**: Pending

- RED 5.1: `agent-context/legacy/` 참조 0(전 리포지토리) · 5.2: 인덱스/스키마가 legacy 미참조
- GREEN 5.3: `agent-context/legacy/v1/` 삭제 + **`contextLayerStructure.test.ts:119-131`(legacy 보존 단언) 수정/삭제** · 5.4: v2 README 갱신 · 5.5: AGENTS.md/Spec "OLED 데모 하나" → "부품 조합 일반화"
- REFACTOR 5.6: 컨텍스트 SSOT 정리
- **Gate**: legacy 참조 0, `npm run check`+`npm run context:check` 그린

---

## 6. Risk Assessment

| Risk | P | I | Mitigation |
|------|---|---|------------|
| **안전 미검수 신규 조합이 build-ready로 노출** | High | High | 안전 오버레이 없으면 review-only 강등(2c.2). 교육 안전 최우선 |
| L2 구조코어가 번들 정밀도 미달 | Med | High | 단계적 골든(≥20→39), 미달 번들은 L3 유지(롤백 아닌 정상 분기) |
| 골든 자기참조 순환(L2→L3→L2 검증) | Med | High | 승격 시 사람 안전 승인 타임스탬프 후에만 oracle 자격(4.2) |
| ③ canonical 흡수 중 데이터 손실 | Low | High | Phase 1 전수 resolvable 게이트, 삭제는 Phase 5만 |
| 데이터 미준비(구포맷·wp05/06) | High | Med | D-1/D-2 선행(§3.1), 미보강 시 Phase 1 차단 |
| 부품 수 130/132 불일치 | High | Low | D-3 SSOT 동적 표현, 즉시 노출·저비용 수정 |
| primitive 매핑 커버리지(개수 아님) | Med | Med | 31종 중 부품별 매핑 누락 가시화(개수 부족 아님) |
| Phase 3 라우팅 재작성 회귀 | Med | High | grep 가드(server/ 스코프)+동반 테스트, 별도 브랜치 |
| 한국어 신규조합 회귀 | High | Med | Eval 한국어 수치 게이트(§4) |

---

## 7. Rollback Strategy

- **Phase 1**: 신규 파일 제거(L0는 병행 추가, 런타임 무변경).
- **Phase 2a/2b/2c**: `H_EDUWARE_CONTEXT_COMPOSE_MODE=off`로 즉시 복귀(2b에서 구축). shadow는 응답 불변이라 무위험.
- **Phase 3**: 가장 위험 — 별도 브랜치, 단일 커밋 revert. **2c 구조 골든 ≥20 증명 전 진입 금지.**
- **Phase 4/5**: git revert.

원칙: compose-mode 플래그로 **off(기존)→shadow(병행·로깅)→on(전환)** 3단계. v1 활성 라우팅 삭제(Phase 3)는 shadow에서 골든·diff 증명 후에만. (삼중구조 회피: L2는 항상 플래그 뒤, on 전까지 응답 미반영.)

---

## 8. Progress Tracking
- Phase 0: ✅100% · 1: ✅100% · 2a: ✅ · 2b: ✅100% · 2c: ✅core · 3: ✅100% · 4: ✅core(승격루프+사이클차단+L3↔L0무결성) · 5: 0%
- **Overall: ~85%** (잔여: Phase 5 legacy 삭제 + 선택적 물리 파일 분리/모듈 분해 이연분) · **추정 총량: ~25–32h (Large+)**. D-1/D-2는 가짜 차단으로 해소(작업 불요).

---

## 9. Notes & Learnings (Rev.2 — 측정값 정정)

- **부품 수 = 130 확정**(사용자 결정). registry `order`/집계 모두 130. 게이트·Success Criteria 모두 130 기준.
- **simulation primitive = 31종**(5종 아님 — 내 as_is 보고서 오류였음). 병목은 개수가 아니라 **부품×역할 매핑 커버리지**.
- **RED 게이트 실재 확인**: `low-voltage-power-rail/BUNDLE.md = 1515 bytes` 직접 측정, `test:unit` EXIT 1 재현.
- **capability-graph.sources에 wp05/wp06 부재** 확인(topology엔 존재) → L1 갭(D-2).
- **이중 라우팅 정정**: 매 요청 동시 실행이 아니라 routingMap 상시 로드 + v2의 heavySourceIds 결합(`:1931`) + 미적중 v1 폴백.
- **핵심 교훈(리뷰)**: 번들은 구조(생성 가능)+안전 산문(생성 불가)의 합. "L3=L2 캐시"는 범주 오류. 안전 오버레이는 별도 자산으로 보존하고 build-ready를 게이팅해야 "130조합 지원"이 "130조합 안전 미검수 생성"으로 전락하지 않는다.
- (증거) 부품 역할 태깅·토폴로지 역할 기반(`fromRole/toNet`)은 실재 → L2 생성의 데이터 토대는 유효.
- (증거) 안전 큐레이션 위치: `BUNDLE.md` 산문 + `circuitTools.ts:262-411` 부품별 하드코딩 경고 + manifest `blockingConditions` + `sensor.json:90 commonMistakes`.
- [구현 중 추가 학습 기록]

---

## 10. 범위 경계 & 동기화

- **포함**: 컨텍스트 L0~L3 통합, v1 ①+② 제거/③ 흡수, 단일 라우터, 구조/안전 분리, 승격 루프, 게이트/CI.
- **선행 의존**: D-1(구포맷 부품), D-2(wp05/06 capability) — service_audit Phase 3.3과 동일.
- **데모 제거와 동기화(미해결 → 명시 필요)**: 데모 오프라인 폴백 제거 전 L2(최소 shadow→on)가 준비돼야 신규 조합 무폴백 503 윈도우를 피한다. 데모 제거(service_audit Phase 1)는 **본 계획 Phase 2c(on 전환 가능) 이후**로 동기화.
- **별도 계획**: OpenAI 단일의존 안전망 + 프런트 store → `service_audit_and_improvement_plan_2026-06-02.md` §22.
