# 적대적 리뷰 종합: PLAN_layered_context_architecture.md

**일자**: 2026-06-02
**리뷰어**: 3개 독립 서브에이전트(아키텍처 비판 / 코드 사실검증 / 실행·TDD·리스크) + 작성자 직접 측정 검증
**평결**: **REVISE** (REJECT 아님 — 전략 방향·데이터 역할화는 코드와 정합, Phase 0 실증됨)

> 본 문서는 리뷰 결과의 durable 기록이며, `PLAN_layered_context_architecture.md` Rev.2가 이를 반영했다.

---

## 0. 직접 측정으로 판가름난 사실 (리뷰어 간 충돌 해소)

| 쟁점 | 판정 | 증거(직접 측정) |
|------|------|----------------|
| RED 게이트 실재? | **실재** | `wc -c low-voltage-power-rail/BUNDLE.md` = **1515**, `test:unit` EXIT 1 재현 |
| primitive 개수 | **31종** (5종은 오류) | `primitives.json` 길이 31 |
| 부품 개수 | **130** (132 아님) | registry `order`=130, 집계=130 |
| capability-graph wp05/06 | **부재** | `capability-graph.sources/`에 wp05/wp06 없음(topology엔 존재) |

→ code-explorer의 "BUNDLE.md ~1010자, 위반 없음"은 **오측**. RED 게이트는 실재하며 Phase 0 유효.

---

## 1. CRITICAL (실행 차단 — 수정 없이는 막힘)

### C-1. "L3 = L2 memoized 캐시" 불변식은 거짓 (3명 수렴, 최우선)
- 번들 = **구조 코어(생성 가능)** + **안전 산문(생성 불가, 사람 큐레이션)** 의 합.
- 증거: `analog-sensor-display-readout/BUNDLE.md:11` "Do not claim calibrated/safety protection"; `hbridge-motor-output/BUNDLE.md:27-29` "Non-goals"; `circuitTools.ts:262-411` 부품별 하드코딩 경고(`SERVO/HBRIDGE/RESISTIVE/PROTOCOL_..._QUALITATIVE_ONLY`); 이 모두 `topology-templates`의 `requiredRoles/fromRole/toNet`에 없음.
- 골든 일치(Test 2.2)는 `summary`를 비교 제외 → 가장 위험한 안전 회귀를 구조적으로 못 잡음. 게다가 `summary`는 `contextPacket.ts`에서 프롬프트에 직접 주입(LLM이 읽는 안전 지침이 검증 밖).
- **위험**: "조합 모두 지원" → "조합 모두 안전 미검수 생성"으로 전락(교육 안전 핵심).
- **반영**: 번들을 `structural.json`(골든 대상) + `safety-overlay.md`(사람 큐레이션, build-ready 게이트)로 분리. 안전 오버레이 없는 신규 조합 = review-only.

### C-2. 롤백 전제인 feature-flag 인프라가 코드·계획에 부재
- 증거: `grep -rE "FLAG|FEATURE_|_MODE" server/context` = 0건. 분기는 `contextRouteV2 ? ... : ...`(라우팅 적중)이지 플래그 아님.
- 위험: 플래그 없이 L2 추가 시 v1폴백+v2번들+L2 = 삼중구조, "플래그 off 복귀" 롤백 허구.
- **반영**: `H_EDUWARE_CONTEXT_COMPOSE_MODE`(off/shadow/on) + shadow 모드(응답 미반영·diff 로깅) 태스크 신설(Phase 2b).

### C-3. 골든 합격 기준 미정의인데 전 Phase가 종속(단일 차단점)
- "39 집합 일치"만 있고 전수 100%인지/산문 포함인지/promptBlock 동치 판정 불명. 미달 시 "GREEN 불가"면 계획 영구 정지.
- **반영**: 동치 = 구조 필드 집합만(산문·promptBlock·evals 제외, 메타 검증 단언). 단계적 게이트(**≥30→39**, 사용자 결정 "중간"), 미달 번들은 L3 유지(정상 분기).

---

## 2. MAJOR (대규모 재작업/조기 실패)

| ID | 발견 | 증거 | 반영 |
|----|------|------|------|
| M-1 | 부품 "132"는 실제 130 | registry 합계 130 | 게이트를 "registry 전 부품(N)"으로 동적화(D-3) |
| M-2 | "primitive 5종 부족"은 허위(31종) | `primitives.json`=31 | 위험을 "부품×역할 매핑 커버리지"로 재정의 |
| M-3 | v1 라우팅 경로 모호(legacy vs 활성) | 활성=`agent-context/routing/...`, 죽은 사본=`legacy/v1/routing/...` | 활성 경로 명시 + grep 가드 `server/` 스코프 |
| M-4 | "매 요청 v1+v2 동시 실행"은 부정확 | `contextPacket.ts:1351` routingMap만 상시, v1빌더는 미적중 시만(`:1385`), v2도 heavySourceIds 결합(`:1931`) | §1.1 진단 정정 |
| M-5 | Phase 2가 거대(회로 생성 엔진 전체) | composeContext/partBundle 전부 신규 빌드 | 2a/2b/2c 3분할 |
| M-6 | 한국어 평가 게이트 부재 | generalizationEval ko 케이스 1 | Eval 한국어 수치 게이트 |

---

## 3. 누락(숨은 차단)·데이터 미준비

- **숨은 차단 테스트**: `contextLayerStructure.test.ts:95`(라우팅맵 존재 단언) → Phase 3에서 깨짐; `:119-131`(legacy 보존 단언) → Phase 5에서 깨짐; `agent-context/index.json` routing 섹션·`contextRouting.test.ts` 동반 수정 필요. **계획에 없었음 → Phase 3/5에 명시 추가.**
- **데이터 미준비**: `arduino-uno`/`led-5mm`/`resistor-220`/`piezo-buzzer` 구포맷 부품에 `sourceClaimIds` 누락 → L0 전수 resolvable 출발 FAIL. **D-1 선행 신설.**
- **wp05/06 capability 갭**: topology엔 있으나 capability-graph.sources엔 없음 → L1 누락. **D-2 선행(=service_audit Phase 3.3).**
- **데모 제거 동기화**: 데모 폴백 제거 전 L2(on) 준비 안 되면 신규 조합 무폴백 503. **데모 제거를 Phase 2c 이후로 동기화 명시.**

---

## 4. 대안 비교(아키텍처 리뷰)

| 옵션 | 장점 | 단점 | 채택 |
|------|------|------|------|
| A. L3=L2 캐시(Rev.1) | 단일 모델, 자동 증식 | 거짓 동치, 안전 회귀 미감지 | ✗ |
| B. 번들=eval fixture | 거짓 동치 제거 | 자동 증식 없음 | 부분 |
| **C. 구조코어+안전오버레이 분리** | 정직한 불변식, 안전 책임 명시 | 2파일 경계 비용 | **✓ 채택** |
| D. 번들 완전폐기 | 최대 단순 | circuitTools 안전게이트 전부 역할화(거대), 단기 안전 후퇴 | ✗(현 시점) |

채택: **C 기본 + 신규 조합 review-only 강등(B의 정신)**.

---

## 5. 상향 조건 (REVISE → ACCEPT)
C-1(플래그/shadow), C-2/C-3(골든 동치 클래스+단계 게이트), M-1(부품 수 SSOT), M-2(primitive 매핑 재정의), M-3(경로/스코프), D-1·D-2(데이터 선행) 반영 시 상향. → **Rev.2에서 6개 모두 반영 완료.**

---

## 6. 사용자 결정
- **부품 수**: **130 확정**(2026-06-02). 전 문서 130 기준으로 정정.
- **골든 단계 목표치**: **≥30/39 확정**(2026-06-02, "중간"). Phase 3 진입 = 39 중 ≥30 구조 골든 일치, 최종 39 전수.
