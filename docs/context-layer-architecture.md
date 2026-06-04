# H-eduware Context Layer Architecture

이 문서는 H-eduware의 Context Layer가 어떤 아키텍처를 가지고 있고, 각 layer가 어떤 내용을 담는지 정리한다. 메인 Chat UI의 사용자 쿼리는 이 계층을 통과해 `ContextPacket`이 되고, 그 packet이 Deep Agent prompt, scoped tools, validation gate, 최종 시뮬레이션 권한의 기준이 된다.

시각화:

- [`context-layer-architecture.svg`](context-layer-architecture.svg): L0-L4 구조와 packet 생성 흐름
- [`context-layer-data-example.svg`](context-layer-data-example.svg): 실제 OLED 요청이 어떤 데이터로 표현되는지

## 핵심 정의

Context Layer는 단순한 프롬프트 자료 모음이 아니다. 현재 구현에서는 다음 역할을 동시에 가진다.

- Route authority: 사용자 요청을 v2 route와 capability bundle로 매핑한다.
- Candidate authority: agent가 사용할 수 있는 부품 집합을 정한다.
- Evidence authority: 지원 bundle, source claim, validation/render/simulation 근거를 묶는다.
- Tool boundary: agent tool이 읽고 검색하고 compile할 수 있는 범위를 제한한다.
- Synthesis gate: build-ready synthesis가 가능한지 `contextCoverage.synthesisEligibility`로 판정한다.
- Final guardrail: server finalization 단계에서 candidate/context gate를 다시 적용한다.

현재 v2 상태:

- v2 routes: 43개
- v2 bundles: 39개
- hardware support bundles: 39개
- heavy source ids: `registry:part-capabilities`, `simulation:primitives`, `rendering:render-footprints`
- shared canonical data: `parts`, `capabilityGraph`, `footprints`, `simulationPrimitives`, `topologyTemplates`, `pinAliases`, `breadboardGrid`

## Layer 구조

| Layer | 이름 | 담는 내용 | Runtime 역할 |
| --- | --- | --- | --- |
| L0 | Foundation | always-loaded operating memory/routing, v2 shared canonical data 주소 | 모든 요청의 기본 규칙과 canonical source-of-truth를 제공한다. 전체 heavy data를 항상 prompt에 넣는다는 뜻은 아니다. |
| L1 | Policy | safety, clarification, unsupported request, simulation truthfulness policy | unsafe/unsupported/ambiguous 요청이 build-ready claim으로 승격되지 않도록 막는다. |
| L2 | Capability Bundle Summary | 선택된 capability의 `BUNDLE.md` 요약 | Deep Agent가 주로 읽는 prompt surface다. 전체 catalog가 아니라 선택된 bundle 중심으로 추론하게 한다. |
| L3 | Manifest + Evidence Refs | `manifest.json`, allowed/required parts, topologies, validation rules, primitive ids, footprint ids, source claim ids | tool과 validator가 어떤 부품/규칙/근거를 사용할 수 있는지 결정한다. |
| L4 | Heavy Tool Data | full part registry, render footprints, simulation primitive recipes, detailed topology/render/simulation data | prompt에 직접 넣지 않고 bounded deterministic tools가 필요할 때만 읽는다. |

## L0 Foundation

L0는 두 성격을 가진다.

첫째, always-on operating context다. `agent-context/index.json`의 memory/routing 계열과 `memory:agent-operating-memory` 같은 항목이 여기에 해당한다. agent runtime은 이 규칙을 통해 “검증 전 시뮬레이션 claim 금지”, “context gate 우선” 같은 기본 운용 원칙을 유지한다.

둘째, v2 shared canonical data의 주소 체계다. `agent-context/v2/index.json`의 `shared`는 다음 canonical 파일들을 가리킨다.

- `parts`: canonical part capability registry
- `capabilityGraph`: capability matching graph
- `footprints`: render footprint data
- `simulationPrimitives`: simulation primitive contracts
- `topologyTemplates`: electrical topology templates
- `pinAliases`: pin alias ontology
- `breadboardGrid`: breadboard coordinate/grid data

중요한 점은 L0가 “전부 prompt에 넣는 layer”가 아니라는 것이다. shared data는 source-of-truth이며, 실제 prompt 또는 tool 접근 여부는 route, bundle, retrieval plan, tool scope로 제한된다.

## L1 Policy

L1은 요청의 안전성과 제품 범위를 결정한다.

주요 정책:

- safety policy
- clarification policy
- unsupported request policy
- simulation truthfulness policy

Runtime에서는 `detectUnsupportedSignals()`, route selection, `contextCoverage`, preflight draft, solver gate와 연결된다. 예를 들어 고전압/화재/위험 부하 요청은 `unsupported-safety` route나 safe-equivalent path로 흐르고, build-ready wiring으로 바로 변환되지 않는다.

## L2 Capability Bundle Summary

L2는 v2 bundle-first architecture의 핵심 prompt surface다.

각 capability bundle은 보통 다음 두 파일로 구성된다.

- `BUNDLE.md`: agent가 읽는 짧은 요약
- `manifest.json`: tool과 validator가 읽는 엄격한 계약

예시:

- `agent-context/v2/bundles/display-text-output/BUNDLE.md`
- `agent-context/v2/bundles/display-text-output/manifest.json`

사용자가 “Arduino Uno + I2C OLED에 Hello 표시”를 요청하면 context layer는 `v2-display-text-output` route와 `display-text-output` bundle을 선택하고, agent prompt에는 이 bundle summary와 compact id 중심의 `promptBlock`이 들어간다.

## L3 Manifest + Evidence Refs

L3는 “이 bundle이 실제로 무엇을 허용하는가”를 담는다.

`manifest.json`의 주요 필드:

- `requiredParts`: 반드시 필요한 부품
- `allowedParts`: 사용할 수 있는 부품 후보
- `requiredTopologies`: 허용 topology
- `validationRules`: 적용할 검증 규칙
- `simulationPrimitives`: 사용 가능한 simulation primitive id
- `renderFootprints`: 사용 가능한 visual footprint id
- `canonicalRefs`: parts, footprints, simulation, topology, sources 참조
- `blockingConditions`: 빠진 근거가 있을 때 합성을 막는 조건

Support bundle evidence도 이 단계와 연결된다. capability가 `supported`여도 source claim이나 required artifact가 complete가 아니면 `valid_circuit_synthesis` 권한을 얻지 못한다.

## L4 Heavy Tool Data

L4는 무겁고 세부적인 데이터다. prompt에 전부 넣지 않고, scoped deterministic tools가 필요할 때만 접근한다.

대표 heavy source:

- `registry:part-capabilities`
- `simulation:primitives`
- `rendering:render-footprints`

도구 접근 규칙:

- `read_context_doc`: `retrievalPlan.sourceIds`에 있는 source만 읽는다.
- `search_part_capabilities`: `candidateParts` 안에서만 검색한다.
- `load_support_bundle_evidence`: 현재 route의 support bundle만 반환한다.
- validation/render/simulation compile tools: candidate/context gate를 적용한 뒤 artifact를 만든다.

이 구조 때문에 agent는 전체 부품 catalog를 자유롭게 훑으며 임의 조합을 만드는 것이 아니라, ContextPacket이 허용한 좁은 범위 안에서만 회로 초안을 만들 수 있다.

## Runtime Packet 생성 절차

`server/context/contextPacket.ts`의 `buildContextPacket()`이 runtime의 중심이다.

절차:

1. 사용자 message, locale, conversationContext를 받는다.
2. `matchCapabilities()`로 capability 후보를 찾는다.
3. `inferIntentHints()`와 `detectUnsupportedSignals()`로 intent/safety signal을 만든다.
4. `selectContextRouteV2()`로 v2 route를 선택한다.
5. route의 `bundleIds`로 v2 bundle을 로드한다.
6. `buildRetrievalPlanV2()`로 source scope와 prompt budget을 정한다.
7. 필요한 canonical registry, primitives, footprints만 lazy load한다.
8. unknown explicit hardware와 visual library support gap을 support gap으로 합친다.
9. candidateParts를 선택한다. `next` pipeline에서는 L2 topology composition이 candidate authority가 될 수 있다.
10. supportBundles, contextTrace, contextCoverage를 만든다.
11. `promptBlock`과 metadata를 포함한 `ContextPacket`을 반환한다.

## ContextPacket 산출물

`ContextPacket`의 핵심 필드:

- `contextRoute`: 선택된 route id, capability ids, source ids
- `retrievalPlan`: agent/tools가 접근 가능한 source ids와 prompt budget
- `candidateParts`: build candidate로 허용된 canonical parts
- `supportBundles`: capability별 support evidence 상태
- `contextTrace`: 어떤 source가 왜 선택됐는지에 대한 trace
- `contextCoverage`: synthesis eligibility와 warnings
- `promptBlock`: agent prompt에 들어가는 compact context block
- `metadata`: selected bundles, candidate provenance, unknown hardware mentions, fallback route, support bundle status

## 실제 데이터 표현 예시

Query:

```text
Display Hello on an I2C OLED with an Arduino Uno.
```

이 요청은 `buildContextPacket()`에서 다음과 같은 packet 형태로 정리된다. 아래는 `pipelineMode: next` probe의 전체 객체가 아니라 Deep Agent와 gate가 실제로 소비하는 핵심 필드만 축약한 예시다.

```json
{
  "contextRoute": {
    "routeId": "v2-display-text-output",
    "capabilityIds": ["display-text-output"],
    "sourceIds": [
      "bundle:display-text-output",
      "policy:safety",
      "policy:truthfulness"
    ]
  },
  "retrievalPlan": {
    "sourceIds": [
      "bundle:display-text-output",
      "policy:safety-policy",
      "policy:simulation-truthfulness-policy"
    ],
    "maxPromptChars": 38000
  },
  "candidateParts": [
    { "id": "arduino-uno", "supportLevel": "supported" },
    { "id": "breadboard-half", "supportLevel": "supported" },
    { "id": "oled-i2c-096", "supportLevel": "supported" },
    { "id": "jumper-wire", "supportLevel": "supported" }
  ],
  "supportBundles": [
    {
      "capabilityId": "display-text-output",
      "status": "complete",
      "supportLevel": "supported"
    }
  ],
  "contextCoverage": {
    "status": "sufficient",
    "sufficientFor": ["valid_circuit_synthesis"],
    "synthesisEligibility": {
      "status": "eligible",
      "reason": "Canonical context coverage is sufficient for validated circuit synthesis."
    },
    "warnings": []
  },
  "metadata": {
    "selectedBundleIds": ["display-text-output"],
    "supportBundleStatus": {
      "display-text-output": {
        "bundleId": "display-text-output-starter",
        "supportLevel": "supported",
        "status": "complete",
        "missingArtifacts": []
      }
    }
  },
  "promptBlock": "## CONTEXT PACKET ..."
}
```

이 packet은 자연어 설명이 아니라 runtime 계약이다.

- `contextRoute`는 어떤 route와 source가 선택됐는지 나타낸다.
- `retrievalPlan.sourceIds`는 `read_context_doc`와 `load_context_index`가 보여줄 수 있는 문서 범위를 정한다.
- `candidateParts`는 `search_part_capabilities`, `validate_circuit_spec`, `build_netlist`, `compile_render_plan`, `compile_simulation_plan`의 허용 부품 범위다.
- `supportBundles`는 선택 capability가 source-backed complete 상태인지 증명한다.
- `contextCoverage.synthesisEligibility`는 Deep Agent가 build-ready 회로 초안을 내도 되는지에 대한 pre-agent 판정이다.
- `promptBlock`은 위 내용을 agent prompt에 넣기 위한 compact text representation이다.

## 역할별 소비자

Context Layer의 산출물은 한 번 만들고 끝나는 값이 아니라, 이후 단계에서 계속 권한 기준으로 재사용된다.

| 소비자 | 읽는 필드 | 역할 |
| --- | --- | --- |
| Deep Agent prompt | `promptBlock`, candidate registry summary | agent가 선택된 bundle과 부품 범위 안에서만 회로를 추론하게 한다. |
| Scoped tools | `candidateParts`, `retrievalPlan.sourceIds`, `supportBundles`, `contextCoverage` | 문서 읽기, 부품 검색, netlist/render/simulation compile 범위를 제한한다. |
| Requirement routing | `contextCoverage`, request scope, intent hints | synthesize, clarify, unsupported/gap, chat 응답 중 어느 경로인지 판단하는 근거가 된다. |
| Finalization gate | `candidateParts`, `contextCoverage` | LLM이 낸 `CircuitSpec`을 다시 검증하고, 허용되지 않은 부품이나 insufficient context를 차단한다. |
| UI build/run gate | `servingStatus`, `buildRunnableReport`, `solverGateResult`, `contextCoverage` | Files/PCB/Run UI에서 build, run, current-flow claim을 켤 수 있는지 제한한다. |

## Gate 모델

Context Layer는 네 군데 gate와 연결된다.

1. Pre-agent context gate
   - `contextCoverage.synthesisEligibility.status`
   - `valid_circuit_synthesis`가 없으면 build-ready synthesis가 불가하다.

2. Tool scope gate
   - `createHeduwareAgentTools()`는 `contextCoverage`, `candidateParts`, `allowedContextSourceIds`, `supportBundles`가 없으면 실패한다.
   - 빈 candidate set은 “전체 허용”이 아니라 “buildable parts 없음”이다.

3. Finalization gate
   - LLM draft는 `applyCandidatePartGate()`, `applyIntentFulfillmentGate()`, `applyContextCoverageGate()`를 다시 통과한다.

4. UI gate
   - `servingStatus`, `solverGateResult`, `buildRunnableReport`가 build/run/current-flow UI를 최종 제한한다.

## 대표 예시

Query:

```text
Display Hello on an I2C OLED with an Arduino Uno.
```

Observed deterministic `buildContextPacket()` result:

```text
route: v2-display-text-output
bundle: display-text-output
candidateParts: arduino-uno, breadboard-half, oled-i2c-096, jumper-wire
synthesisEligibility: eligible
sufficientFor: valid_circuit_synthesis
supportBundle(display-text-output): complete / supported
```

이 결과가 이후 Deep Agent prompt, scoped tools, server finalization, UI simulation rendering의 기준이 된다.
