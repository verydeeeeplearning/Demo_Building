# 엄밀 실패 분석 & v2 아키텍처 재평가

**작성일**: 2026-06-02
**방법론**: 추측 배제. 모든 결론은 (a) 실제 실행 결과 또는 (b) `파일:라인` 코드 증거로 뒷받침한다.
**대상 질문**:
1. "실제로 **어디서 fail** 하는가" — 재현 가능한 실패만 보고
2. "현재 v2가 **최선의 아키텍처**인가" — 목표(132부품 모든 조합 지원) 대비 평가

> 짝 문서: `as_is_analysis_report_2026-06-02.md`(구조), `service_audit_and_improvement_plan_2026-06-02.md`(운영 감사).

---

## 검증 실행 환경

| 항목 | 결과 |
|------|------|
| `node_modules` | 설치됨 |
| `npm run typecheck` (`tsc --noEmit`) | **EXIT 0** (정적 타입 통과) |
| `npm run test:unit` (JS+TS) | **EXIT 1** ❌ — JS 110/110 통과, TS 318/319 통과, **1 FAIL** |

→ 정적 컴파일은 깨끗하다. **실패는 컴파일이 아니라 (1) 데이터 정합성, (2) 런타임 아키텍처에 있다.**

---

# Part A. 엄밀 실패 분석 (재현된 것만)

## A-1. 🔴 수용 게이트가 지금 RED다 (P0, 재현 완료)

### 증거
```
$ npm run test:unit
...
not ok 198 - context v2 bundle files are resolvable and compact
  location: tests/unit/contextLayer.test.ts:1:689
  error: 'low-voltage-power-rail summary stays compact'
  code: 'ERR_ASSERTION'   expected: true   actual: false
EXIT:1
```
```
$ wc -c agent-context/v2/bundles/low-voltage-power-rail/BUNDLE.md
1515
```
테스트 단언 (`tests/unit/contextLayer.test.ts:30-31`):
```js
assert.ok(bundle.summary.length > 0,    `${id} summary exists`);
assert.ok(bundle.summary.length <= 1500, `${id} summary stays compact`);
```

### 정확한 원인
`low-voltage-power-rail` 번들의 `BUNDLE.md` 요약이 **1515자 = 한도(1500)를 15자 초과**. 비교: `display-text-output` 657자, `digital-light-output` 1058자 → 이 번들만 비대.

### 의미 (왜 P0인가)
- `AGENTS.md`는 `npm run check`(= `test:unit` → `typecheck` → `build` → `test:e2e`)를 **goal-mode 수용 게이트**로 명시한다. 그 **첫 단계가 지금 실패**하므로 **현재 빌드는 수용 불가 상태**다.
- 메모리/핸드오프(S221, 5069 "Full Test Suite ... Passes")는 "전체 테스트 통과"라고 기록했으나 **현재는 거짓**. 즉 번들 요약이 커밋 사이에 15자 늘어난 **조용한 회귀(silent regression)** 가 게이트를 무시하고 들어왔다.
- 역설: v2의 존재 이유가 "프롬프트 비대 방지(compact)"인데, **v2 자신의 번들이 그 규칙을 위반**했고 그걸 잡는 테스트가 켜져 있는데도 레드인 채 방치됐다.

### 개선점
1. (즉시) `low-voltage-power-rail/BUNDLE.md`를 ≤1500자로 트림 → 게이트 복구.
2. (구조) 이 회귀가 **어떻게 게이트를 통과해 커밋됐는가** = §A-4(CI 부재). 로컬 `npm run check`를 강제하는 CI가 없으면 동일 회귀가 반복된다.

---

## A-2. 🔴 런타임 이중 라우팅 — v1·v2를 매 요청마다 둘 다 부담 (P1)

### 증거 (`server/context/contextPacket.ts:1348-1411`)
```ts
const [index, rawCapabilityMatches, routingMap, ...] = await Promise.all([
  loadContextIndex(),
  matchCapabilities(contextualMessage),
  loadContextRoutingMap(),            // ← v1 라우팅맵 로드 (1351)
  ...
]);
const contextRouteV2 = await selectContextRouteV2({...});   // ← v2 라우팅 로드 (1367)
const contextRoute = contextRouteV2
  ? buildContextRouteV2({...})        // v2 경로
  : selectContextRoute({ routingMap, ...});  // v1 폴백 (1394)
const retrievalPlan = contextRouteV2
  ? buildRetrievalPlanV2({ ..., routingMap, ... })  // ← v2 경로도 v1 routingMap 사용 (1404)
  : buildRetrievalPlan({ routingMap, ... });
```
- v1 폴백 라우트: `contextPacket.ts:1810` → `routingMap.routes.find(r => r.routeId === 'supported-hardware-general')`. 해당 라우트는 `agent-context/routing/context-routing-map.json:535`에 실재.

### 의미
- **모든 요청이 v1 라우팅맵과 v2 인덱스/라우트를 둘 다 로드**한다. v2가 이겨도(`buildRetrievalPlanV2`) **v1 routingMap을 인자로 받아 쓴다(1404)** → v1은 폴백이 아니라 **상시 의존**.
- 코드 경로가 이중(`selectContextRouteV2`/`selectContextRoute`, `buildContextRouteV2`/`buildContextRoute`, `buildRetrievalPlanV2`/`buildRetrievalPlan`)이라 **모든 라우팅 로직을 두 벌 유지**해야 한다. → §22 거대 파일(`contextPacket.ts` 3,673줄)의 직접 원인.
- "v2 단일화 + legacy 즉시 제거" 결정은 **이 이중 결합을 먼저 끊지 않으면 불가능**하다(아래 Part B에서 상세).

---

## A-3. 🟠 "132부품 조합" 요청이 실제로 실패/열화하는 지점 (P1)

### 증거 (v2 라우팅 구조)
- `agent-context/v2/routes.json`: `routeId` **41개**. 그중 39개가 `when.capabilityIds: ["<단일-capability>"]` → `bundleIds: ["<동일-id>"]` 형태의 **능력당 1:1 라우트**(예: `v2-addressable-led-display-output`, `v2-bare-seven-segment-display-output`).
- 매칭 실패 시: `selectContextRouteV2`가 `null` 반환 → `selectContextRoute`(v1) → `supported-hardware-general` 일반 라우트로 폴백(`contextPacket.ts:1810`).

### 실패 시나리오 (재현 논리)
학생이 **번들로 사전 큐레이션되지 않은 조합**(예: "조이스틱으로 서보 각도를 조절하고 OLED에 각도를 표시")을 요청하면:
1. 단일 capability 매칭에 실패(이 조합에 대응하는 bundle 없음).
2. v2 라우트 미스 → v1 `supported-hardware-general` 폴백.
3. 폴백 경로는 번들의 `requiredTopologies`/`canonicalRefs`/`blockingConditions` 같은 **정밀 합성 근거가 없는 일반 컨텍스트** → 합성 품질 저하, 또는 `build-runnable` 게이트에서 차단 → 학생에겐 "검토용 장면" 또는 실패.

### 이것이 핵심 모순이다
- 사용자 목표 = **132부품의 임의 조합 지원**.
- 현재 v2 = **39개 미리 정해진 조합(번들)만 정밀 지원**, 나머지는 v1 일반 폴백.
- `docs/context_layer_sufficiency_audit.md`의 자체 결론("structurally correct but not sufficient for broad student-query generalization")이 **코드 구조로 그대로 확인**된다. 즉 이 갭은 데이터 부족이 아니라 **아키텍처 형태의 문제**다(Part B).

---

## A-4. 🔴 회귀가 게이트를 통과하는 통로 — CI 부재 (P0)

### 증거
- `.github/workflows` 없음, Dockerfile/배포 설정 없음(직접 확인).
- `npm run check`는 **로컬 수동 실행**에만 의존.

### 의미
A-1의 15자 회귀가 들어온 경로가 바로 이것이다. **로컬에서 `check`를 돌리지 않고 커밋하면 아무도 못 막는다.** 데모 제거·132조합 확장처럼 변경이 커질수록 이런 silent regression 빈도는 올라간다.

---

## A-5. 런타임 단일 의존 실패면 (코드 증거 기반, 데모 제거 후 P0)

| 실패면 | 증거 | 트리거 | 현 거동 |
|--------|------|--------|---------|
| OpenAI 미설정 | `deepAgentRuntime.requireLiveConfig` — 첫 요청에서야 throw | env 누락 배포 | 부팅 성공 → 첫 사용자 503 (fail-fast 위반) |
| OpenAI 지연/장애 | 서버측 timeout/retry/circuit breaker 부재 | OpenAI 느려짐 | 클라 90s까지 점유, 격리 없음 |
| 무한 body | `index.ts:readJson`이 크기 제한 없이 `chunks.push` | 거대 payload | 메모리 압박(DoS 표면) |
| 무제한 호출 | rate limit 없음 | 익명 반복 호출 | OpenAI 토큰 비용 폭주 |
| 중복 제출 | idempotency key 없음 | 더블클릭/재시도 | OpenAI 중복 과금 |

→ 데모(오프라인 폴백)를 제거하는 순간 이 표의 모든 행이 "유일 경로의 실패"가 된다. 상세 개선은 운영 감사 문서 §22 Phase 0 참고.

---

# Part B. v2가 최선의 아키텍처인가? — 결론: **현재 목표에는 아니다**

## B-1. v2가 실제로 무엇인지 (증거)

`agent-context/v2`의 구조를 코드/데이터로 보면:

| 구성 | 실체 |
|------|------|
| `index.json` | 39개 bundle 목록 + `shared`(루트 v1 canonical 경로 7개) |
| `bundles/<cap>/manifest.json` | 능력 1개의 `requiredParts`/`allowedParts`(하드코딩 목록), `requiredTopologies`, `validationRules`, `simulationPrimitives`, `renderFootprints`, `canonicalRefs(shared:…)`, `blockingConditions` |
| `routes.json` | 능력당 1:1 라우트 41개 (`when.capabilityIds:[하나]` → `bundleIds:[하나]`) |
| `shared` | **v2가 데이터를 소유하지 않음** — `../registry/part-capabilities.json` 등 루트(v1)를 참조 |

→ **v2 = "미리 큐레이션된 known-good 레시피의 닫힌 카탈로그 + 그 위의 1:1 라우팅 + 프롬프트 예산 통제."** 이것은 *bounded·auditable·budget-safe* 한 **수직 슬라이스 집합**이다.

## B-2. 설계 의도 vs 현재 목표의 불일치

| 축 | v2가 잘하는 것 | 132조합 목표가 요구하는 것 |
|----|----------------|----------------------------|
| 커버리지 | 39개 *알려진* 능력을 정밀하게 | *임의* 조합을 일반적으로 |
| 확장 비용 | 새 능력 = 새 번들 1개(수작업 큐레이션) | 부품 추가 = 조합 N×M 폭증 |
| 라우팅 | capability→bundle **1:1 조회** | role/intent **조합 추론** |
| 데이터 | 번들에 사전 고정(allowedParts 하드코딩) | 부품/역할/토폴로지에서 **조립 생성** |
| 신규 조합 | 번들 없으면 **v1 일반 폴백으로 열화** | 신규 조합도 1급으로 지원 |

**핵심**: 번들-우선(bundle-first)은 **열거(enumeration)** 모델이고, "132부품 모든 조합"은 **생성(generation)** 문제다. 39개를 아무리 늘려도 조합 공간(수천~수만)을 열거로 덮을 수 없다. v2는 **구조적으로 목표와 어긋난다.**

## B-3. 이중 아키텍처 세금 (지금 지불 중)

A-2에서 본 대로 v2는 v1을 **대체하지 못하고 위에 얹혀 있다**:
- 매 요청 v1 routingMap + v2 index/routes 동시 로드.
- 라우팅·플랜 빌드 코드가 v1/v2 두 벌.
- v2 `shared`가 루트 canonical에 의존 → **"legacy 즉시 제거" 결정은 현 구조에선 모순**(루트를 지우면 v2가 깨짐). README도 "Deleting v1 files is not part of the initial v2 rollout"이라 명시.
- 결과: 두 시스템의 합집합만큼 복잡도·실패면이 늘고(예: A-1 같은 번들 회귀 + v1 라우팅 회귀 둘 다 가능), 누구도 단일 모델을 못 본다(버스 팩터↑).

## B-4. 더 적합한 아키텍처: 역할-조합 엔진 (role/capability composition)

번들 카탈로그 대신, **부품의 역할(role)에서 컨텍스트를 조립**하는 생성형 모델을 권한다.

```
요청 → intent(입력역할? 출력역할? 버스? 전원?) 추출
     → 부품 레지스트리에서 역할별 후보(132개에 role/capability 태그)
     → topology-templates(역할 조합 규칙: input×output, sensor×display, bus=I2C/SPI/UART…)로
        합법 결선 생성
     → 부품-레벨 canonical(pins/electrical/footprint/source-claim) + 역할-레벨 primitive 조립
     → 검증 게이트(common-ground, current-limit, pin-role-match…)는 그대로 재사용
```

이 모델의 성질:
- **부품은 데이터, 조합은 규칙.** 번들을 손으로 만들 필요 없음 → 132개에 태그만 정확하면 임의 조합이 1급.
- v2의 좋은 자산은 **그대로 재활용**: `validationRules`, `simulationPrimitives`, `topology-templates`, `source-claims`, `blockingConditions`, 프롬프트 예산 규칙. (버릴 것은 "번들=레시피 1:1"와 "1:1 라우트"뿐.)
- 프롬프트 예산 통제(v2의 강점)는 "선택된 *역할/토폴로지/부품 ID* 묶음"을 budget로 조립하는 방식으로 유지.

> wp01~12(아날로그·디지털·매트릭스·디스플레이·light-sound·motion-power·power-passive·controller·prototyping·protocol·comm·logic) 분류는 이 역할-조합 모델의 **role taxonomy 기반으로 그대로 승격**할 수 있다. 즉 wp는 "번들 12묶음"이 아니라 "역할 카테고리 12종"으로 읽어야 가치가 산다.

## B-5. 권고 (어떻게 갈 것인가)

번들을 **버리지 말고 강등**한다 — *생성 엔진의 회귀 테스트/골든 케이스*로 재배치.

1. **B-5.1 역할 태깅**: 132개 부품에 role/capability/bus/전원 태그를 `part-capabilities`에 정규화(이미 `capabilities`, `compatibleSimulationPrimitives` 필드 존재 → 확장).
2. **B-5.2 조합 규칙화**: `topology-templates`를 역할 조합 규칙으로 일반화(특정 부품 하드코딩 제거). 안전(고전압)은 안전대체로.
3. **B-5.3 라우팅 단일화**: 1:1 번들 라우트 41개 → **역할/모달리티 기반 소수 라우트**로 축소. `selectContextRoute`/`selectContextRouteV2` 이중 경로 → 단일 경로.
4. **B-5.4 번들 강등**: 39개 번들 → 생성 엔진이 같은 입력에 동일/우월한 컨텍스트를 만드는지 검증하는 **골든 회귀 스위트**(evals.jsonl 재활용).
5. **B-5.5 그 다음에 legacy 제거**: 생성 엔진이 루트 canonical을 단일 소스로 직접 소비하게 되면, v1 라우팅맵·중복 경로·legacy/v1 스냅샷을 안전하게 삭제.

### "v2 단일화 + legacy 즉시 제거" 결정에 대한 수정 제언
현 v2는 v1 canonical에 의존(`shared`)하고 v1 라우팅과 공존하므로 **"즉시 제거"는 깨짐을 유발**한다. 순서를 다음으로 권고:
> (1) 역할-조합 엔진으로 라우팅·합성 단일화 → (2) 번들을 회귀 스위트로 강등 → (3) v1 라우팅/legacy 제거.
즉 **"즉시"가 아니라 "엔진 교체 후 제거"**. 이렇게 하면 "132조합"과 "단일 소스"를 동시에 달성한다.

---

# Part C. 우선순위 (이 문서 한정)

| ID | 발견 | 등급 | 액션 |
|----|------|------|------|
| R-1 | 수용 게이트 RED(`low-voltage-power-rail` 1515>1500자) | **P0** | BUNDLE.md 15자+α 트림 → 게이트 복구 |
| R-2 | CI 부재로 회귀가 게이트 통과 | **P0** | `npm run check`를 GitHub Actions PR 게이트로 |
| R-3 | v1·v2 이중 라우팅 상시 부담 | P1 | 역할-조합 엔진으로 라우팅 단일화(B-5.3) |
| R-4 | 번들-우선이 132조합과 구조적 불일치 | P1 | 생성형 역할-조합 엔진 도입(B-4) |
| R-5 | 신규 조합이 v1 일반 폴백으로 열화 | P1 | B-4 도입 시 자연 해소 + 조합 evals 보강 |
| R-6 | "legacy 즉시 제거"는 현 구조서 깨짐 | P1 | 엔진 교체 후 제거로 순서 수정(B-5.5) |
| R-7 | OpenAI 단일 의존 실패면(A-5) | P0(데모 제거 후) | 운영 감사 §22 Phase 0 |

---

## 결론 (두 질문에 대한 답)

**Q1. 실제로 어디서 fail하는가?**
- 지금 당장: **수용 게이트가 RED**다(`low-voltage-power-rail` 번들 요약 1515>1500자, `test:unit` EXIT 1). CI가 없어 이 15자 회귀가 그대로 들어왔다.
- 구조적으로: **번들로 미리 큐레이션되지 않은 부품 조합**이 들어오면 v2 라우팅이 미스나고 **v1 일반 폴백으로 열화**한다 — 이것이 "132조합" 목표가 실제로 깨지는 지점이다.
- 데모 제거 후: OpenAI가 유일 경로가 되며 timeout/rate/idempotency/fail-fast 부재가 실위험으로 전환된다.

**Q2. 현재 v2가 최선의 아키텍처인가?**
- **아니다.** v2 번들-우선은 *알려진 39개 레시피*에는 정밀·안전·예산통제 면에서 우수하지만, "임의 조합 지원"이라는 목표에는 **열거 vs 생성**의 근본 불일치가 있다. 게다가 v1을 대체하지 못한 채 **이중 비용**을 물고 있다.
- 권고: v2의 데이터 자산(검증규칙·primitive·topology·source-claim·예산규칙)은 살리고, **"번들=레시피 1:1"과 "1:1 라우트"를 역할-조합 생성 엔진으로 대체**한 뒤, 번들은 골든 회귀로 강등하고, 그 다음에 legacy를 제거한다.
