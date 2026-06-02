# Full Visual Part Simulation Coverage Plan

작성일: 2026-06-01

## 목적

이 문서는 H-eduware의 visual part library 전체를 agent가 신뢰성 있게 다룰 수 있도록 만드는 전체 작업 계획이다.

최종 목표는 "학생이 언급할 수 있는 132개 visual part가 모두 context layer에서 설명 가능하고, 지원 가능한 안전 저전압 회로 조합은 deterministic validator와 simulation engine으로 검증/렌더/실행 가능하며, 위험하거나 범위 밖인 조합은 명확한 이유로 차단되는 상태"다.

중요한 전제:

- 모든 임의 조합을 사전에 나열하지 않는다.
- 모든 부품을 role, pin, protocol, electrical, render, simulation contract로 정규화한다.
- 조합은 topology template이 담당한다.
- LLM은 요구사항 분석과 draft 생성을 담당하고, 최종 가능 여부는 deterministic validator가 판정한다.
- 체크박스는 master가 검증 명령과 브라우저 확인을 통과시킨 뒤에만 지운다.

## 현재 스냅샷

현재 audit 기준:

- 전체 visual parts: 132
- explicit target states: 132/132
- simulation-ready visual parts: 131
- target achieved visual parts: 132
- legacy visual-only compatibility count: 1
- target-state 기준 남은 visual parts: 0
- 남은 항목 중 pin-known: 0
- current unsafe-blocked visual parts: 1
- 남은 unsafe-blocked target: 0
- coverage report artifact: `docs/visual_part_simulation_coverage_report.md`

현재 simulation-ready 범위:

- [x] WP-01부터 WP-12까지의 target parts는 모두 simulation-ready 또는 unsafe-blocked로 닫혔다.
- [x] WP-11 communication modules는 local command/status/bus activity simulation으로 지원하며, 실제 cloud/network/RF/CAN/USB host 동작은 overclaim으로 차단한다.
- [x] WP-12 `74hc595-shift`, `pcf8574-expander`, `ne555-timer`, `ads1115-adc`, `mcp3008-adc`, `lm358-opamp`, `i2c-level-shifter` 7개가 qualitative interface simulation-ready로 승격됐다.

## 계획 문서 기준

이 문서를 전체 132개 visual part simulation coverage의 master plan으로 사용한다.

보조 문서의 역할:

- `docs/visual_part_simulation_coverage_report.md`: generated coverage report. 수치는 source contract를 고친 뒤 `npm run audit:visual-coverage -- --write`로 재생성한다.
- `docs/구현_계획문서.md`: end-to-end architecture 설명 문서. 현재 일부 수치와 예시는 stale할 수 있으므로, 구현 진행 기준은 이 master plan과 generated coverage report를 우선한다.
- `docs/context-source-bundle-backlog.md`: source bundle hardening backlog. 현재 promoted 상태와 어긋나는 항목이 있으므로, 구현 전 정리 대상이다.
- `docs/subagent-proposals/`: subagent가 중앙 JSON/TS 파일을 직접 건드리기 전에 proposal을 남기는 작업 공간이다.

최근 정리한 문서/계약 drift와 남은 주의점:

- `docs/구현_계획문서.md`의 agent-ready/canonical/non-simulation-ready 수치는 2026-06-02 WP-12 logic/interface closeout 기준으로 갱신했다.
- `context-source-bundle-backlog.md`에서 potentiometer, ultrasonic, DHT11, button, buzzer, servo는 promoted bundle로 재분류했다.
- `2n2222-npn`은 generated coverage에서는 WP-06으로 분류되지만, 기존 plan 일부에는 WP-12에도 나타난다. 최종 소유권은 WP-06 `controller-transistor-low-side-load`로 둔다.
- `screw-terminal-4pin`은 prototyping/connector surface 쪽 WP-09로 다룬다. 전원 커넥터 정책은 WP-07과 연결되지만 중앙 package ownership은 WP-09다.
- `visualOnlyPartIds`는 legacy compatibility metric이다. 최종 목표에는 유용하지만, 지금의 remaining count와 1:1로 같지 않다. 예를 들어 `varistor-mov`는 visual-only compatibility에는 남을 수 있어도 target-state 기준으로는 `unsafe-blocked` 완료 상태다.
- 일부 테스트 fixture는 과거 unsupported 예시를 유지할 수 있다. part가 simulation-ready로 승격되면 해당 fixture는 "recovery" 또는 "old gap regression" 용도로 재정의해야 한다.

남은 항목:

- [x] 마지막 7개 visual part를 simulation-ready 또는 deterministic safety-blocked로 승격
- [x] 전체 부품에 canonical PartCapability 부여
- [x] 전체 부품에 visual-library-crosswalk 매핑 부여
- [x] 안전한 부품군에 render footprint와 pin anchor 부여
- [x] 안전한 부품군에 topology membership 부여
- [x] 안전한 부품군에 validator rule과 current/signal simulation contract 부여
- [x] 위험 또는 고전류 부품군에 deterministic power-warning/safety-blocked policy 부여
- [ ] 전체 지원/차단 상태의 live browser smoke를 최신 서버로 재확인

## 완료 정의

전체 완료는 다음 조건을 모두 만족해야 한다.

- `auditVisualLibraryExpansion()`에서 `totalVisualParts = 132`.
- generated report에서 `Remaining target parts = 0`.
- 모든 visual part가 `agent-ready` 또는 `unsafe-blocked` 상태다.
- 안전 저전압 부품은 `supportTier = simulation-ready`.
- 안전 차단 부품은 `supportTier = unsafe-blocked`이고, 학생 친화적인 refusal/eval/browser evidence가 있다.
- `npm run audit:capabilities`가 supported capability의 누락 artifact를 0으로 보고한다.
- `npm run audit:context:v2`가 모든 supported bundle의 canonical refs 누락을 0으로 보고한다.
- `npm run audit:sources`가 source claim과 browser evidence 누락을 0으로 보고한다.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`가 통과한다.
- 대표 live/browser flows에서 build confirmation, render canvas, run simulation, current path overlay가 확인된다.

## 왜 조합 전수 검증이 아닌가

132개 부품의 조합 수는 너무 크다.

- 2개 조합: 8,646
- 3개 조합: 374,660
- 4개 조합: 12,082,785
- 5개 조합: 309,319,296
- 6개 조합: 6,547,258,432

따라서 전체 커버리지는 "조합 목록"이 아니라 "부품 contract + topology engine + validator"로 달성한다.

## 전체 커버리지 증명 모델

전체 조합을 전수 검증하지 않는 대신, coverage는 아래 검증 축이 모두 닫혔는지로 증명한다.

1. Inventory coverage
   - `src/partLibraryData.js`의 visual part id 132개가 모두 audit에 등장한다.
   - id 중복, category 누락, target state 누락이 없어야 한다.

2. Representation coverage
   - 모든 visual part는 `visual-library-crosswalk.json`에서 canonical agent part, restricted part, 또는 deterministic blocked part로 연결된다.
   - 최종 상태에서 `visualOnlyPartIds.length = 0`이어야 한다.

3. Contract coverage
   - simulation-ready 또는 restricted part는 `PartCapability`, pin alias, voltage/current/risk, render footprint, simulation model, compatible topology가 있어야 한다.
   - source claim 없이 support tier를 올리지 않는다.

4. Topology-slot coverage
   - topology마다 role slot을 정의한다: controller, input, output, display, driver, power source, passive, connector.
   - 각 slot은 허용 part family와 금지 part family를 가진다.
   - validator는 slot 간 net/pin/protocol/electrical constraint를 검증한다.

5. Substitution coverage
   - 같은 topology에 속한 모든 부품 조합을 전수 테스트하지 않는다.
   - 대신 topology별 positive fixture 1개, validation rule별 negative fixture, slot family별 대표 substitution fixture, 위험 family별 blocked fixture를 둔다.
   - 다중 slot이 동시에 변하는 topology는 pairwise 또는 대표 조합 matrix로 E2E를 줄인다.

6. Risk coverage
   - `low-voltage`: 정상 simulation-ready 대상.
   - `power-warning`: simulation은 가능하되 외부전원/전류/극성 경고와 gate가 필요하다.
   - `high-current`: GPIO 직접 구동을 차단하고 driver/external supply topology를 요구한다.
   - `mains-unsafe`: breadboard/student simulation에서는 deterministic unsafe-blocked로 둔다.

7. Runnable coverage
   - frontend는 자체 기준을 재구현하지 않고 server `buildRunnableReport.runnable` boolean에 위임해야 한다.
   - visible scene availability는 `solverGateResult.visibleSimulation`에 위임한다. `buildRunnableReport.runnable === false`여도 diagnostic/placeholder/safe-equivalent scene은 보일 수 있다.
   - simulation-ready family는 current path만으로 판정하지 않고, family별 runnable evidence를 정의한다.
   - 예: current path, digital state, analog slider, display readout, PWM activity, servo angle, bus activity, blocked/fault overlay.

## Context Packet Budget 원칙

context layer는 굳이 깊은 계층형 prompt로 나누지 않는다. 기본 구조는 flat canonical index와 capability bundle registry를 유지하고, request analysis 결과에 맞는 bundle만 확장한다.

- 항상 넣는 정보는 작게 유지한다: part ids, aliases, family, support tier, route ids, blocker summary.
- 상세 정보는 선택 확장한다: pin map, topology template, source claim, render footprint, simulation primitive, validation rule.
- 요청 분석 agent가 후보 capability를 1차로 좁히고, context packet builder가 해당 bundle만 넣는다.
- 일반 대화나 추천 질문에는 build/run bundle을 넣지 않는다.
- 학생이 명시한 부품 family가 있으면 generic sibling bundle을 pruning한다. 예: SPI display 요청에는 generic OLED display bundle을 같이 넣지 않는다.
- 속도는 flat index가 담당하고, 신뢰성은 선택된 상세 bundle과 deterministic validator가 담당한다.

## 표준 부품 승격 체크리스트

각 부품 또는 부품군은 아래 항목을 통과해야 한다.

- [ ] Source claims: pin map, voltage/current, protocol, critical safety fact
- [ ] Hardware support bundle: capability, required artifacts, browser evidence ids
- [ ] PartCapability: canonical id, aliases, pins, electrical, protocols, render footprint, simulation model
- [ ] Visual crosswalk: visual id -> canonical agent part id
- [ ] Render footprint: exact pin anchors matching canonical pin names
- [ ] Topology membership: compatibleTopologies and required role template
- [ ] Validator: power, ground, signal, bus, current-limit, polarity, safety checks
- [ ] Simulation: current path, signal activity, bus activity, expected states, controls
- [ ] v2 bundle: manifest, BUNDLE.md, evals.jsonl, route, index entry
- [ ] Global eval: supported prompt and negative/unsupported counterexample
- [ ] Unit tests: context routing, v2 bundle, source claims, validator, render, simulation paths
- [ ] E2E/browser fixture: visible user flow evidence
- [ ] Audit commands pass

## Promotion Gate Contract

simulation-ready 승격은 legacy support bundle과 v2 bundle이 모두 같은 사실을 가리킬 때만 허용한다.

Required agreement:

- `agent-context/sources/hardware-support-bundles.json`
  - `supportLevel = supported`
  - required artifact classes가 모두 선언되어 있다.
  - `sourceClaimIds`가 실제 `source-claims.json` 항목으로 존재한다.
  - `canonicalFiles`가 실제 파일과 실제 entry를 가리킨다.
  - `browserEvidenceIds`가 eval 또는 E2E evidence와 연결된다.
- `agent-context/v2/bundles/<capability>/manifest.json`
  - `requiredParts`, `allowedParts`, `requiredTopologies`, `validationRules`, `simulationPrimitives`, `renderFootprints`가 실제 canonical entry와 연결된다.
  - `canonicalRefs.sources`가 legacy support bundle과 충돌하지 않는다.
  - supported bundle은 `blockingConditions`를 비워두지 않는다.
- `agent-context/v2/routes.json`
  - student phrase가 올바른 bundle로 route된다.
  - generic route가 더 구체적인 route를 삼키지 않는다.
  - combined capability는 필요하면 multi-bundle route를 사용한다.
- tests
  - supported prompt는 build/run까지 간다.
  - clarification-only/meta unsupported counterexample은 no-scene이어야 한다.
  - hardware-shaped unsupported counterexample은 diagnostic context scene을 만들 수 있지만 verified current simulation, Run, share/build-ready claim은 열지 않는다.
  - unsafe counterexample은 no-scene policy response 또는 safe-equivalent scene이어야 하며 original unsafe request를 build-ready로 만들지 않는다.
  - source/canonical ref 누락은 audit에서 실패한다.

Current hardening gaps:

- support bundle evidence는 현재 일부 artifact를 선언만 보고 통과시킬 수 있다. 실제 canonical entry 존재 검증으로 강화해야 한다.
- v2 manifest와 legacy support bundle의 source refs가 일부 capability에서 서로 다르다.
- `button-controlled-light-output`, `sound-alert-output`, `servo-motion-output`은 legacy-supported지만 v2 route/manifest 이관이 필요하다.
- `analog-led-dimmer`, `light-sensor-triggered-output`은 blocking condition을 보강해야 한다.

## Master/Subagent 작업 방식

Master 역할:

- 작업 패키지를 분배한다.
- 동시에 같은 central JSON 파일을 수정하는 worker를 만들지 않는다.
- worker 결과를 받은 뒤 test/audit/browser verification만 master가 수행한다.
- 검증 통과 전에는 이 문서의 체크박스를 완료로 바꾸지 않는다.
- worker가 구현한 기능이 전체 목표를 좁히는 방향이면 반려한다.

Worker 역할:

- 할당된 package id와 part id만 수정한다.
- 기존 사용자 변경을 revert하지 않는다.
- 변경한 파일 목록과 실행한 테스트를 보고한다.
- source claim 없는 part promotion을 하지 않는다.
- validator 없이 render/simulation만 추가하지 않는다.
- render footprint pin anchor와 current path endpoint 이름을 반드시 일치시킨다.

중앙 파일 충돌 방지 규칙:

- 같은 wave 안에서 한 명만 `agent-context/registry/part-capabilities.json`을 수정한다.
- 같은 wave 안에서 한 명만 `agent-context/data/capability-graph.json`을 수정한다.
- 같은 wave 안에서 한 명만 `agent-context/data/render-footprints.json`을 수정한다.
- 같은 wave 안에서 한 명만 `server/agent/circuitTools.ts`를 수정한다.
- 병렬화가 필요하면 worker는 먼저 package-local proposal 문서를 만들고, master가 central file integration을 직렬로 수행한다.

Worker 완료 보고 형식:

```text
Package:
Parts:
Topologies:
Files changed:
Source claims added:
Validator rules added:
Current path ids:
Tests run:
Known gaps:
```

## Subagent 병렬 운영 상세

병렬화의 목적은 많은 파일을 동시에 고치는 것이 아니라, master가 안전하게 통합할 수 있는 독립 결과물을 빠르게 모으는 것이다.

Subagent 유형:

- Explorer: read-only 조사. coverage, source bundle, topology, validation gate, frontend gate를 분석한다. 파일을 수정하지 않는다.
- Proposal worker: `docs/subagent-proposals/<package-id>-<topic>.md`만 작성한다. 중앙 JSON/TS 파일은 수정하지 않는다.
- Package worker: master가 명시한 disjoint write scope만 수정한다. 같은 wave에서 다른 worker와 중앙 파일을 공유하지 않는다.
- Verifier: master 통합 후 테스트 실패, coverage regression, browser regression을 read-only로 분석한다.
- Master: 중앙 JSON/TS 통합, final conflict resolution, audit/test/browser verification, plan checkbox update를 담당한다.

병렬 wave 원칙:

- 한 wave에서 최대 4-6개 subagent를 사용한다.
- 중앙 파일 owner는 wave당 1명만 둔다.
- central file owner가 필요한 경우, 다른 worker는 proposal 문서까지만 만든다.
- worker가 구현을 끝내도 checkbox를 지우지 않는다. master가 검증을 통과시킨 뒤에만 체크한다.
- subagent 결과가 서로 충돌하면 generated coverage report와 deterministic gate를 우선한다.

권장 wave 구조:

| Wave | 목적 | 병렬 subagent | Master 작업 |
| --- | --- | --- | --- |
| W0 | 계획/계약 정리 | coverage explorer, gate explorer, source bundle explorer, topology math explorer | master plan 보강, stale 문서/fixture 정리 항목 확정 |
| W1 | WP-01 완료 | FSR/NTC proposal, divider validator proposal, eval/browser proposal | resistive divider topology 직렬 통합, audit/test 실행 |
| W2 | WP-02 digital input/switch | switch family proposal, digital sensor module proposal, input UI control proposal | digital input validator와 simulation family 통합 |
| W3 | WP-04 display expansion | I2C display proposal, SPI display proposal, LED-array proposal | display topology와 render/simulation primitive 통합 |
| W4 | WP-05 light/sound output | RGB LED proposal, WS2812 proposal, active buzzer proposal, laser warning proposal | output family validator와 warning policy 통합 |
| W5 | WP-06 high-current/motor/relay | transistor/low-side proposal, H-bridge proposal, stepper proposal, relay proposal | high-current gate와 external supply policy 통합 |
| W6 | WP-07/WP-09 power/passive/prototyping | power rail proposal, passive network proposal, connector/surface proposal | hidden short/rail/connector DRC 통합 |
| W7 | WP-08 controller substitution | board pin-map proposals by voltage domain | board-specific pin resolver와 voltage domain policy 통합 |
| W8 | WP-10/WP-11/WP-12 protocol/module/IC | I2C/SPI/UART/wireless/interface proposals | bus family simulator와 restricted claims 통합 |

Subagent ticket template:

```text
Ticket:
Package:
Owned files:
Read-only context files:
Parts:
Topology families:
Required source claim ids:
Required validator rules:
Required simulation evidence:
Required render footprints:
Positive fixtures:
Negative fixtures:
Browser/E2E evidence:
Do not touch:
Completion report format:
```

Worker prompt 기본 규칙:

```text
You are not alone in the codebase. Do not revert user or other worker edits.
Only edit the owned files listed in this ticket.
If a central file outside your scope needs changes, write a proposal under docs/subagent-proposals instead.
Do not promote a part to simulation-ready without source claims, validator, render footprint, simulation contract, v2 route/bundle, evals, and tests.
Report changed files and tests run.
```

## Master 검증 명령

각 package 통합 후 최소 검증:

```bash
npm test -- --test-name-pattern "<package or topology name>"
npm run audit:sources
npm run audit:context:v2
npm run audit:capabilities
npm run typecheck
npm run build
```

주요 wave 통합 후 전체 검증:

```bash
npm test
npm run audit:sources
npm run audit:context:v2
npm run audit:capabilities
npm run typecheck
npm run build
npm run test:e2e
```

live/browser 검증:

- app과 agent server를 최신 코드로 재시작한다.
- 대표 prompt를 브라우저에서 입력한다.
- build confirmation이 나온다.
- 확정 후 canvas가 보인다.
- build-ready artifact에서만 Run이 활성화된다.
- build-ready artifact에서만 verified current path 또는 signal/bus activity가 보인다.
- unsupported hardware artifact는 diagnostic scene을 보일 수 있지만 Run/current animation은 비활성 상태여야 한다.
- missing exact footprint artifact는 placeholder geometry를 보일 수 있지만 build-ready로 주장하지 않는다.
- safety-blocked artifact는 no-scene policy response 또는 safe-equivalent scene으로 이유와 provenance를 설명한다.

## Topology Coverage Map

전체 부품은 아래 topology family로 커버한다. 부품 하나를 끝내는 것이 아니라, 같은 topology에 속한 부품을 묶어 처리한다.

- [ ] T01 Controller board substitution
  - Arduino Nano, Mega, Leonardo, Micro, Pro Mini, ESP32, ESP8266, Pico, STM32, Teensy, ATtiny85
- [ ] T02 Breadboard/prototyping surface substitution
  - full/mini breadboard, perfboard, blank PCB, proto shield, headers, terminals
- [ ] T03 Power source and regulated rail
  - battery clips, AA holder, barrel jack, breadboard PSU, LiPo, 7805
- [x] T04 Simple digital input
  - limit switch, reed switch, slide switch, toggle switch, touch sensor
- [x] T05 Matrix/multi digital input
  - DIP switch, 1x4 keypad, 4x4 keypad
- [ ] T06 Analog input to controller
  - trimmer pot remaining; joystick axes, FSR, thermistor, TMP36, water level done
- [ ] T07 Analog sensor to OLED display
  - soil moisture, rain, gas, flame, sound sensor analog outputs, water level, TMP36, FSR, thermistor
- [ ] T08 Analog sensor threshold to output
  - LDR-like, soil moisture, rain, gas, flame, sound threshold outputs
- [x] T09 Digital sensor to output/display
  - PIR, Hall, IR receiver, line tracker, vibration, tilt, color sensor
- [x] T10 Single-wire environmental sensor display
  - DHT11 and DHT22 done
- [x] T11 I2C and clocked-data sensor readout
  - BMP280, HMC5883L, MPU6050, MAX30102, and HX711 done
- [ ] T12 SPI/RFID sensor readout
  - RC522 and SPI display modules done; MCP3008 remains in WP-12
- [ ] T13 UART/serial module readout
  - GPS done; Bluetooth and WiFi command-mode modules remain in WP-11 where safe
- [ ] T14 I2C display output
  - LCD 16x2, LCD 20x4, OLED 1.3
- [ ] T15 SPI display output
  - Nokia 5110, TFT 1.8, E-paper
- [ ] T16 LED array/display output
  - 7-seg, TM1637, MAX7219 matrix
- [ ] T17 RGB/addressable light output
  - RGB LED, WS2812B strip, NeoPixel ring
- [ ] T18 Sound output
  - passive buzzer already done, active buzzer remaining
- [ ] T19 Servo output with current warning
  - SG90 already done, MG996R remaining
- [ ] T20 Low-side transistor/MOSFET switch
  - 2N2222, IRF520, laser module, motor/fan/pump/vibration motor
- [ ] T21 H-bridge DC motor control
  - L293D, L298N, DC motor, fan, pump
- [ ] T22 Stepper motor control
  - A4988, DRV8825, ULN2003, NEMA17, 28BYJ-48
- [ ] T23 Relay controlled low-voltage load
  - relay 1ch, relay 4ch
- [ ] T24 Protection and passive conditioning
  - diodes, zener, schottky, polyfuse, capacitors, inductor, crystal
- [ ] T25 Logic/expander/interface IC
  - 74HC595, PCF8574, NE555, ADS1115, MCP3008, LM358, level shifter
- [ ] T26 Wired communication module
  - CAN, RS485, USB host shield
- [ ] T27 Wireless communication module
  - ESP-01, HC-05, LoRa, NRF24L01, SIM800L
- [ ] T28 Safety-blocked or restricted component
  - MOV and any unsafe mains-like request

## Work Packages

### WP-00 Coverage Infrastructure

- [x] Add a generated coverage report artifact for 132 visual parts.
- [x] Add an audit assertion that every visual part has an explicit target state: simulation-ready or unsafe-blocked.
- [x] Add package-level progress table that can be updated by workers.
- [x] Add stricter runnable gate: valid simulation must have non-empty current/signal path when topology expects it.

Evidence:

- `npm run audit:visual-coverage -- --write` generated `docs/visual_part_simulation_coverage_report.md`.
- `npm test` passed with the new visual coverage and runnable-gate regression tests.

### WP-00.5 Gate and Contract Hardening

Purpose: part promotion 전에 agent가 build/run 가능 상태를 잘못 노출하지 않도록 gate drift와 stale contract를 먼저 잡는다.

Tasks:

- [x] Frontend `canBuildAgentResult()`가 server `buildRunnableReport.runnable`과 같은 기준을 쓰도록 정렬한다.
- [ ] `buildRunnableReport`를 family-specific runnable evidence로 확장한다.
  - current path
  - digital state
  - analog slider/readout
  - display readout
  - PWM activity
  - servo angle
  - bus activity
  - fault/blocked overlay
- [x] unsupported/context-gap artifact와 buildable current artifact를 분리한다.
- [x] unsupported response에 structured supported alternative를 추가한다.
- [x] "그걸로 진행해줘" 같은 follow-up이 직전 blocked artifact가 아니라 supported alternative로 resolve되게 한다.
- [x] unsupported/gap recovery E2E를 추가한다.
- [x] render DRC blocking condition에 critical footprint missing, endpoint anchor missing, rendered component missing을 명확히 포함한다.
- [x] legacy support bundle과 v2 manifest의 source/canonical refs를 같은 promotion gate로 검사한다.
- [x] `button-controlled-light-output`, `sound-alert-output`, `servo-motion-output`의 v2 route/manifest migration 계획을 확정한다.
- [x] stale 문서와 fixture를 정리한다: `docs/구현_계획문서.md`, `context-source-bundle-backlog.md`, outdated unsupported E2E fixture.
- [x] `compileRequirementMarkdown()`의 build-ready 문구를 `buildRunnableReport` 결과와 정렬한다.
- [x] share/import 경로가 snapshot validation/simulation flag만 보지 않고 runnable gate 결론을 보존하도록 정렬한다.
- [x] global eval corpus를 WP-03~WP-12 promoted family 상태에 맞게 정리한다. 남은 target context-gap이 0개이므로 generalization report도 expected/observed context-gap 0개를 검증한다.
- [x] solver-gate contract wording을 정리한다: `buildRunnableReport`는 Run/share/build-ready strict gate이고, `solverGateResult`는 diagnostic/placeholder/safe-equivalent visible scene availability를 제어한다.

Evidence:

- 2026-06-01: frontend build eligibility now requires `buildRunnableReport.runnable === true`.
- 2026-06-01: non-runnable agent drafts no longer become `conversationContext.currentArtifact` or `awaitingBuildConfirmation`.
- 2026-06-01: supported-alternative follow-ups were first recovered from assistant suggestions, then replaced with the structured `supportedAlternatives[]` contract below.
- 2026-06-01: `buildRunnableReport` now blocks forged valid simulations that omit validation-required current/signal path ids, while allowing state-only runnable evidence when no path is required.
- 2026-06-01: missing render footprints are treated as simulation-blocking render DRC.
- 2026-06-01: `supportedAlternatives[]` and `conversationContext.pendingSupportedAlternative` were added to the server/client contract, so follow-up routing no longer depends on frontend assistant-message text scraping.
- 2026-06-01: render DRC now centrally blocks `MISSING_RENDER_FOOTPRINT`, `RENDER_CONNECTION_ENDPOINT_MISSING`, `SIMULATION_ENDPOINT_ANCHOR_MISSING`, and `SIMULATION_PATH_COMPONENT_MISSING`.
- 2026-06-01: `audit:context:v2` now resolves v2 canonical refs against actual part, footprint, simulation primitive, topology, and source claim catalogs; supported v2 source refs must match legacy support bundle source claims, and the CLI exits non-zero on failure.
- 2026-06-01: corrected v2 manifest drift for `display-text-output`, `digital-light-output`, `analog-led-dimmer`, `light-sensor-triggered-output`, and `distance-sensor-display`.
- 2026-06-01: added v2 bundle manifests, summaries, evals, routes, and audit coverage for `button-controlled-light-output`, `sound-alert-output`, and `servo-motion-output`; `v2-button-light-sound-output` now loads button and buzzer bundles together for multi-output requests.
- 2026-06-01: refreshed stale source-bundle and implementation docs, moved the planned context-gap E2E fixture from already-supported soil moisture to remaining `fsr-pressure`, then retargeted it to `bmp280` after FSR support landed.
- 2026-06-01: promoted `fsr-pressure` and `thermistor-ntc` as two-pin resistive-sensor voltage divider circuits using `resistor-10k`, dedicated topology templates, render footprint, validator, source claims, v2 bundle refs, eval rows, and current/signal paths.
- 2026-06-01: `compileRequirementMarkdown()` now receives `buildRunnableReport`; blocked drafts expose `_Build runnable: blocked_`, suppress build-ready parts/wiring/current-flow details, and include runnable gate reasons instead of treating valid validation/simulation alone as build-ready.
- 2026-06-01: share snapshot, import, schema, card, public view, and share markdown paths now preserve or enforce `buildRunnableReport`; non-demo shares cannot be valid or simulation-available unless `buildRunnableReport.runnable === true`.
- 2026-06-01: conversation `currentArtifact` schema/prompt now carries `buildRunnableReport`, and the Deepagents `compile_simulation_plan` tool returns the runnable gate evidence beside the simulation plan.
- 2026-06-02: before WP-05, the WP-01 through WP-04 context contracts were moved to generated aggregate source directories for `part-capabilities`, `render-footprints`, `topology-templates`, and `capability-graph`; see `docs/context_layer_refactor_methodology.md`.
- 2026-06-02: solver-gate contract wording now treats clarification-only/meta unsupported turns as no-scene, but allows hardware-shaped unsupported specs to render diagnostic context, missing exact footprints to use placeholder geometry, and unsafe requests to show safe-equivalent scenes without opening Run/share/build-ready claims.
- Verification baseline: rerun the full suite or targeted display/context suites after each package promotion, then keep `npm run context:check`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm run audit:capabilities`, `npm run audit:sources`, `npm run audit:context:v2`, and `npm run audit:visual-coverage -- --write` green.
- Verification: targeted Playwright blocked/gap/chat/share tests 5 passing, `npm run audit:context:v2` passing with zero manifest consistency issues.
- Verification: `npm run eval:generalization` 5 passing, `npx tsx --test tests/unit/contextV2Audit.test.ts tests/unit/contextV2Architecture.test.ts tests/unit/contextRouting.test.ts tests/unit/generalizationEval.test.ts` 31 passing, `npm run audit:context:v2` now reports 11/11 supported v2 bundles migrated with only the 3 unsupported capabilities missing bundles.
- Verification: `npm run audit:visual-coverage -- --write` now reports 131 simulation-ready parts, 132 target-achieved parts, WP-01 11/11, WP-02 14/14, WP-03 5/5, WP-04 11/11, WP-05 8/8, WP-06 18/18, WP-07 19/19, WP-08 12/12, WP-09 10/10, WP-10 9/9, WP-11 8/8, WP-12 7/7, and 0 remaining target parts.
- Verification: `npm run context:check`, `npm test` 247/247, `npm run typecheck`, `npm run build`, `npm run audit:sources`, `npm run audit:capabilities`, and `npm run audit:context:v2` passed after the generated-source and prompt-budget refactor.

Exit criteria:

- server와 frontend의 build/run gate가 같은 결론을 낸다.
- non-buildable blocked draft가 다음 turn의 `currentArtifact`로 오인되지 않는다.
- supported alternative follow-up이 반복 질문 없이 새 synthesis request로 이어진다.
- supported bundle evidence가 source claim 존재만 보는 shallow check에서 canonical refs 존재 검증까지 확장된다.

### WP-01 Analog Sensor Display Generalization

Purpose: one topology should unlock many student sensor readout requests.

Parts:

- [x] soil-moisture
- [x] water-level-sensor
- [x] tmp36-temp
- [x] ldr-module
- [x] fsr-pressure
- [x] thermistor-ntc
- [x] acs712-current
- [x] rain-sensor
- [x] flame-sensor
- [x] mq2-gas
- [x] sound-sensor

Required topology:

- [x] `controller-analog-sensor-i2c-display`
- [x] `controller-analog-sensor-threshold-output`
- [x] `controller-resistive-sensor-divider-i2c-display`
- [x] `controller-resistive-sensor-divider-threshold-output`

Validation:

- [x] analog AO/OUT must connect to analog input with `signal: analog`
- [x] sensor display requests must include a display
- [x] OLED SDA/SCL must be valid
- [x] common ground required
- [x] unsafe gas/flame claims must remain educational, not calibrated safety instrumentation
- [x] two-pin resistive sensors must use an explicit voltage divider reference resistor
- [x] FSR/thermistor simulation must be qualitative, not calibrated force/temperature measurement

Evidence:

- 2026-06-01: promoted powered analog module family (`soil-moisture`, `water-level-sensor`, `tmp36-temp`, `acs712-current`, `rain-sensor`, `flame-sensor`, `mq2-gas`, `sound-sensor`) to simulation-ready.
- Added generic 3-pin/4-pin analog sensor footprints, v2 bundles/routes, source/support bundles, eval prompts, topology templates, analog display/threshold current-path compilation, and required-path runnable gate.
- 2026-06-01: added `resistor-10k`, `fsr-pressure`, and `thermistor-ntc` canonical registry entries; mapped the two visual parts through crosswalk; added `resistive-sensor-2pin` render footprint; and added resistive divider display/threshold topologies.
- 2026-06-01: `validateCircuitSpec()` now rejects missing fixed divider references, missing A0 midpoint, missing ground return through the reference resistor, and non-analog midpoint wiring for two-pin resistive sensors.
- 2026-06-01: `compileSimulationPlan()` now requires `resistive-sensor-divider-current`, `resistive-sensor-analog-signal`, `resistive-threshold-sensing-divider`, `resistive-threshold-analog-signal`, OLED bus, OLED current, and LED current evidence for the matching resistive topologies.
- `npm run audit:visual-coverage -- --write` reports WP-01 at 11/11 with no remaining WP-01 parts.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run audit:capabilities`, `npm run audit:context:v2`, and `npm run audit:sources` passed.

Next implementation note:

- WP-01 through WP-12 are closed. Future expansion should follow the same package contracts without changing completed families back into one-off part rules.

### WP-02 Digital Sensor and Switch Generalization

Parts:

- [x] push-button
- [x] ultrasonic-hcsr04
- [x] limit-switch
- [x] reed-switch
- [x] slide-switch
- [x] toggle-switch
- [x] ttp223-touch
- [x] hall-effect-sensor
- [x] ir-receiver
- [x] line-tracker
- [x] pir-hc-sr501
- [x] sw420-vibration
- [x] tilt-ball-sensor
- [x] tcs3200-color

Required topology:

- [x] `controller-digital-input-display`
- [x] `controller-digital-input-output`
- [x] `controller-pulse-digital-sensor-display`

Validation:

- [x] digital signal pin exists
- [x] pullup/pulldown or module output semantics are explicit
- [x] output current paths remain separate from input signal activity

Evidence:

- 2026-06-01: promoted passive switch inputs (`limit-switch`, `reed-switch`, `slide-switch`, `toggle-switch`) and powered digital input modules (`ttp223-touch`, `hall-effect-sensor`, `line-tracker`, `pir-hc-sr501`, `sw420-vibration`, `tilt-ball-sensor`) to simulation-ready.
- 2026-06-01: promoted pulse-like digital sensors (`ir-receiver`, `tcs3200-color`) with qualitative pulse/state simulation, not calibrated protocol decoding or RGB measurement.
- Added `digital-input-display-readout` and `digital-input-threshold-output` capabilities, v2 bundles/routes, source/support bundles, eval prompts, footprints, topology templates, `digital_input_state` primitive, and required-path runnable gates.
- `validateCircuitSpec()` now rejects floating passive switch inputs, missing module power/ground, missing pulse control pins, invalid digital signal types, and missing input/display/output evidence for the matching topologies.
- `compileSimulationPlan()` now separates digital input state activity from LED load current, display bus activity, module supply current, and pulse input signal paths.
- Verification: targeted `agentWorkflow` digital input/pulse/DHT regression suite passed 98/98, `npm run audit:context:v2` passed with 13 supported v2 bundles and zero manifest consistency issues, and `npm run audit:sources` passed with 13 supported source bundles.
- Verification: full `npm test` passed 227/227, `npm run typecheck` passed, `npm run build` passed, and `npm run test:e2e` passed 58/58 with 8 live-agent skips.

### WP-03 Matrix and Multi-Input

Parts:

- [x] dip-switch-4
- [x] keypad-4x4
- [x] membrane-keypad-1x4
- [x] joystick-module
- [x] rotary-encoder

Required topology:

- [x] `controller-matrix-input-display`
- [x] `controller-quadrature-input-display`
- [x] `controller-dual-analog-input-display`

Validation:

- [x] multiple signal pins cannot collapse onto one row accidentally
- [x] row/column count must match part contract
- [x] joystick axes map to two analog inputs
- [x] encoder CLK/DT/SW roles are distinct

Evidence:

- 2026-06-01: promoted `dip-switch-4`, `keypad-4x4`, `membrane-keypad-1x4`, `joystick-module`, and `rotary-encoder` to simulation-ready.
- Added `matrix-input-display-readout`, `joystick-display-readout`, and `rotary-encoder-display-readout` capabilities, v2 bundles/routes, source/support bundles, eval prompts, footprints, topology templates, primitives, and current/signal path contracts.
- `validateCircuitSpec()` now rejects reused matrix/controller pins, missing DIP or membrane references, duplicate joystick axes, missing joystick switch, duplicate rotary CLK/DT/SW pins, missing module power/ground, and missing OLED display evidence.
- `compileSimulationPlan()` now emits matrix scan/sense or switch signal paths, joystick supply/X/Y/SW/display-bus paths, rotary supply/CLK/DT/SW/display-bus paths, and OLED module current evidence.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts --test-name-pattern "matrix|joystick|rotary|topology|validation report"` passed 102/102.
- Verification: `npx tsx --test tests/unit/contextRouting.test.ts tests/unit/contextPacketCapability.test.ts tests/unit/generalizationEval.test.ts` passed 32/32.
- Verification: `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, and `npm run audit:visual-coverage -- --write` passed.

### WP-04 Display Expansion

Parts:

- [x] oled-096-i2c
- [x] lcd-16x2
- [x] lcd-20x4
- [x] oled-13-i2c
- [x] 7seg-1digit
- [x] 7seg-4digit-tm1637
- [x] 8x8-matrix-max7219
- [x] neopixel-ring-12
- [x] epaper-213
- [x] nokia-5110
- [x] tft-18

Required topology:

- [x] `controller-i2c-character-display`
- [x] `controller-spi-display`
- [x] `controller-led-array-display`
- [x] `controller-addressable-led-display`
- [x] `controller-bare-seven-segment-display`

Validation:

- [x] I2C display family uses the existing I2C pin-role/common-ground validation path
- [x] I2C and SPI buses cannot be confused
- [x] LED array modules require power/current warnings where relevant
- [x] Bare 7-segment segments require per-segment current limiting and common ground
- [x] promoted display module simulation is qualitative, not pixel-perfect device emulation

Evidence:

- 2026-06-01: promoted `lcd-16x2`, `lcd-20x4`, and `oled-13-i2c` as simulation-ready I2C text display alternatives.
- 2026-06-01: promoted `7seg-4digit-tm1637`, `8x8-matrix-max7219`, and `neopixel-ring-12` as simulation-ready LED-array/addressable display module alternatives.
- 2026-06-01: promoted `tft-18`, `nokia-5110`, and `epaper-213` as simulation-ready SPI display alternatives.
- 2026-06-01: promoted bare `7seg-1digit` as a resistor-aware single-digit 7-segment display, separate from TM1637/MAX7219 module wiring.
- Added canonical part capabilities, render footprints, visual-library crosswalk mappings, h-eduware-derived source claims, v2 bundle allowed-part refs, and eval rows for explicit LCD/OLED display requests.
- Added LED-array/addressable display source claims, support bundles, v2 routes/bundles, render footprints, topology templates, qualitative simulation primitives, eval rows, validator rules, and current/signal path contracts.
- Added SPI display source claims, support bundle, v2 route/bundle, render footprints, topology template, qualitative `spi_display_state` primitive, eval rows, validator rules, and SPI data/clock/select/control signal path contracts.
- `buildContextPacket()` now keeps generic display requests on the default OLED path, but swaps default OLED out when the student explicitly asks for `lcd-16x2`, `lcd-20x4`, or `oled-13-i2c`.
- `buildContextPacket()` now routes explicit TM1637, MAX7219, 8x8 matrix, and NeoPixel ring requests to compact display-module bundles instead of overmatching them as generic LEDs or OLED text displays.
- `buildContextPacket()` now routes explicit TFT, Nokia 5110, and e-paper display requests to the SPI display bundle and prunes generic display siblings that would bloat the prompt or confuse the quality gate.
- `validateCircuitSpec()` and topology inference now treat OLED/LCD as an I2C text display family while preserving sensor-specific topologies for distance, DHT11, analog, resistive, digital, matrix, joystick, and rotary readouts.
- `validateCircuitSpec()` and topology inference now treat TM1637/MAX7219 displays as controller LED-array display modules and NeoPixel rings as addressable LED display modules, with module power, ground, data, clock, and select checks as applicable.
- `validateCircuitSpec()` and topology inference now treat TFT/Nokia/e-paper display modules as SPI display modules, with power, ground, data, clock, chip select, and control signal checks.
- `validateCircuitSpec()` and topology inference now treat bare 1-digit 7-segment displays as GPIO segment loads with one 220 ohm resistor per driven segment, common ground, dedicated render footprint, and qualitative segment-state simulation.
- Verification: `npx tsx --test tests/unit/contextPacketCapability.test.ts tests/unit/contextRouting.test.ts tests/unit/agentWorkflow.test.ts --test-name-pattern "LCD|display family|topology selector|topology templates|validation report|ultrasonic distance display|DHT11 temperature humidity display|prunes sibling"` passed 133/133.
- Verification: `npx tsx --test tests/unit/contextPacketCapability.test.ts tests/unit/contextRouting.test.ts tests/unit/contextV2Architecture.test.ts tests/unit/contextV2Audit.test.ts tests/unit/contextCoverage.test.ts tests/unit/generalizationEval.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/agentWorkflow.test.ts` passed 178/178 after SPI display promotion.
- Verification: `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, `npx tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts`, and `npm run audit:visual-coverage -- --write` passed.
- Verification: `npm test` passed 247/247, including the LED-array/addressable/SPI/bare 7-segment workflow regressions, context source aggregate check, prompt-budget coverage, and context routing coverage; `npm run typecheck` and `npm run build` passed.
- Verification: `npx tsx --test tests/unit/contextPacketCapability.test.ts --test-name-pattern "bare single digit"` passed 12/12 after adding Korean `1자리 7세그먼트` routing coverage.

### WP-05 Light and Sound Outputs

Parts:

- [x] led-5mm-blue
- [x] led-5mm-green
- [x] led-5mm-red
- [x] passive-buzzer
- [x] rgb-led-common-cathode
- [x] ws2812b-strip
- [x] laser-diode-module
- [x] active-buzzer

Required topology:

- [x] `controller-rgb-led-current-limited-output`
- [x] `controller-addressable-led-display`
- [x] `controller-direct-low-current-load`
- [x] `controller-powered-light-module-output`

Validation:

- [x] RGB channels need separate resistors unless module contract says otherwise
- [x] WS2812/NeoPixel power warnings are visible
- [x] laser module is power-warning and must avoid unsafe eye-safety claims

Evidence:

- 2026-06-02: promoted `active-buzzer`, `rgb-led-common-cathode`, `laser-diode-module`, and `ws2812b-strip` as simulation-ready light/sound output alternatives.
- Added canonical part capabilities, render footprints, visual-library crosswalk mappings, h-eduware-derived source claims, v2 bundle allowed-part refs, topology templates, qualitative simulation primitives, validation rules, warning policy, and current/signal path contracts for the WP-05 remaining set.
- `buildContextPacket()` now preserves explicit WP-05 part choices and prunes generic siblings, so `active-buzzer`, `rgb-led-common-cathode`, `laser-diode-module`, and `ws2812b-strip` requests do not silently fall back to piezo, 5mm LED, resistor, or NeoPixel ring defaults.
- `validateCircuitSpec()` and topology inference now treat active buzzers as direct low-current loads, common-cathode RGB LEDs as per-channel resistor-limited outputs, laser modules as powered light modules with safety warnings, and WS2812B strips as addressable LED display modules.
- `compileSimulationPlan()` now emits deterministic buzzer current, RGB channel current, powered-light supply/control, and WS2812B supply/data paths for the matching WP-05 topologies.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts` passed 107/107 with WP-05 validator/render/simulation coverage.
- Verification: `npx tsx --test tests/unit/contextPacketCapability.test.ts tests/unit/contextRouting.test.ts` passed 34/34 with explicit WP-05 routing/pruning coverage.
- Verification: `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, and `npm run audit:capabilities` passed; coverage report now shows WP-05 at 8/8 with 0 remaining.

### WP-06 Servo, Motor, Driver, Relay, High-Current

Parts:

- [x] sg90-servo
- [x] 2n2222-npn
- [x] mg996r-servo
- [x] vibration-motor
- [x] dc-fan-5v
- [x] dc-motor-130
- [x] mini-water-pump
- [x] solenoid-valve
- [x] stepper-28byj48
- [x] nema17-stepper
- [x] a4988-stepper
- [x] drv8825-stepper
- [x] uln2003-driver
- [x] l293d-driver
- [x] l298n-driver
- [x] irf520-mosfet
- [x] relay-1ch
- [x] relay-4ch

Required topology:

- [x] `controller-servo-external-power-warning`
- [x] `controller-transistor-low-side-load`
- [x] `controller-mosfet-module-load`
- [x] `controller-hbridge-dc-motor`
- [x] `controller-uln2003-unipolar-stepper`
- [x] `controller-step-dir-bipolar-stepper`
- [x] `controller-relay-low-voltage-load`

Validation:

- [x] high-current loads cannot be powered directly from GPIO
- [x] external supply and common ground are represented
- [x] flyback/protection requirements are explicit
- [x] relay examples are low-voltage only; mains control is blocked

Evidence:

- 2026-06-02: promoted `mg996r-servo` as a simulation-ready high-torque servo variant while preserving the existing SG90/micro-servo track.
- Added the `large-servo` render footprint, `controller-servo-external-power-warning` topology, MG996R source claims, v2 servo bundle canonical refs, explicit routing/pruning keywords, and workflow coverage for external-power warning behavior.
- `validateCircuitSpec()` now routes MG996R requests through the external-power warning topology, emits a high-torque servo power warning, and keeps common-ground/PWM signal contracts visible before simulation can run.
- `compileSimulationPlan()` now treats `controller-servo-external-power-warning` as a servo-runnable topology with deterministic `servo-supply-current` and `servo-pwm-signal` paths.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts tests/unit/contextRouting.test.ts tests/unit/contextV2Architecture.test.ts tests/unit/contextV2Audit.test.ts` passed 144/144 with MG996R validator, render, simulation, routing, and v2 canonical-ref coverage.
- MG996R checkpoint verification: `npm run context:parts:build`, `npm run context:footprints:build`, `npm run context:topologies:build`, `npm run context:capabilities:build`, `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, and `npm run audit:capabilities` passed; coverage report showed WP-06 at 2/18 with 16 remaining before the low-side switched load slice.
- Verification: `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e` passed; Playwright reported 58 passed and 8 live-agent-gated skips.
- 2026-06-02: promoted the low-side switched load family: `2n2222-npn`, `irf520-mosfet`, `dc-motor-130`, `dc-fan-5v`, `mini-water-pump`, `solenoid-valve`, and `vibration-motor`.
- Added `controller-transistor-low-side-load` and `controller-mosfet-module-load` topology contracts, low-side switched load source claims, render footprints, v2 route/bundle refs, and a shared `low_side_switched_load_state` primitive.
- `validateCircuitSpec()` now rejects direct motor GPIO drive, requires the 2N2222 base resistor, requires IRF520 signal/common-ground wiring, and emits qualitative high-current/flyback warnings for motor-like loads.
- `compileSimulationPlan()` now emits deterministic `low-side-load-supply-current:<load>` and `low-side-load-control-signal:<load>` paths for MOSFET, transistor, and integrated vibration-module examples.
- Routing now keeps explicit servo requests on `v2-servo-motion-output`, while DC motor/MOSFET requests use `v2-low-side-switched-load-output` and mains motor counterexamples stay on `unsupported-safety`.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts tests/unit/contextRouting.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts` passed 141/141 after adding low-side workflow, routing, and eval coverage.
- Verification: `npm run context:parts:build`, `npm run context:footprints:build`, `npm run context:topologies:build`, `npm run context:capabilities:build`, `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, and `npm run audit:capabilities` passed; coverage report now shows WP-06 at 9/18 with 9 remaining.
- Verification: full `npm test` passed 256/256, `npm run typecheck` passed, `npm run build` passed, and `npm run test:e2e` passed 58/58 with 8 live-agent-gated skips after the low-side switched load slice.
- 2026-06-02: promoted the stepper driver family: `stepper-28byj48`, `nema17-stepper`, `uln2003-driver`, `a4988-stepper`, and `drv8825-stepper`.
- Added `controller-uln2003-unipolar-stepper` and `controller-step-dir-bipolar-stepper` topology contracts, dedicated stepper render footprints, source claims, v2 route/bundle refs, and the qualitative `stepper_motor_state` simulation primitive.
- `validateCircuitSpec()` now rejects direct stepper coil GPIO drive, requires driver/control wiring, preserves STEP/DIR alternatives, and emits external-power/qualitative-simulation warnings instead of pretending to model exact coil physics.
- Routing now keeps valid stepper requests on `v2-stepper-motor-output`, prunes low-side/servo overmatch, and sends direct-GPIO or 220V/AC stepper counterexamples to `unsupported-safety` without opening synthesis.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts` passed 113/113 with stepper validator, render, and simulation coverage.
- Verification: `npx tsx --test tests/unit/contextRouting.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts` passed 31/31 after adding supported, direct-GPIO invalid, and unsafe stepper eval rows.
- Verification: `npm run typecheck`, `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, and `npm run audit:capabilities` passed; coverage report now shows WP-06 at 14/18 with 4 remaining.
- 2026-06-02: promoted the H-bridge and relay closeout set: `l293d-driver`, `l298n-driver`, `relay-1ch`, and `relay-4ch`.
- Added `controller-hbridge-dc-motor` and `controller-relay-low-voltage-load` topology contracts, H-bridge and relay render footprints, source claims, support bundles, v2 routes/bundles, context pruning, and qualitative `hbridge_motor_state` / `relay_switch_state` simulation primitives.
- `validateCircuitSpec()` now validates H-bridge motor output/control wiring, rejects direct motor GPIO counterexamples before synthesis, validates relay input/contact paths, keeps relay LED loads out of the generic LED series-path validator, and blocks mains relay language deterministically.
- `compileSimulationPlan()` now emits H-bridge motor current/control paths and relay coil/contact load paths only after topology validation evidence is present.
- Routing now keeps explicit L298N/L293D requests on `v2-hbridge-motor-output`, explicit low-voltage relay requests on `v2-relay-low-voltage-output`, and direct motor or mains relay counterexamples on `unsupported-safety` within prompt budget.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts` passed 116/116 with H-bridge and relay validator, render, simulation, and topology evidence coverage.
- Verification: `npx tsx --test tests/unit/contextRouting.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts` passed 33/33 with relay/H-bridge route pruning and prompt budget coverage.
- Verification: `npm run typecheck`, `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, and `npm run audit:capabilities` passed; coverage report now shows WP-06 at 18/18 with 0 remaining.

### WP-07 Power, Regulation, Protection, Passive Components

Parts:

- [x] potentiometer
- [x] resistor-axial
- [x] trimmer-pot
- [x] 9v-battery-clip
- [x] aa-battery-holder
- [x] barrel-jack
- [x] breadboard-psu
- [x] lipo-battery-1s
- [x] screw-terminal-2pin
- [x] 7805-regulator
- [x] ceramic-cap
- [x] electrolytic-cap
- [x] diode-1n4007
- [x] schottky-diode
- [x] zener-diode
- [x] polyfuse
- [x] inductor-axial
- [x] crystal-16mhz
- [x] varistor-mov

Required topology:

- [x] `external-low-voltage-power-rail`
- [x] `regulated-5v-rail`
- [x] `protection-passive-in-series-or-parallel`
- [x] `timing-passive-context-only`
- [x] `mains-protection-component-blocked`

Validation:

- [x] battery and external supply polarity is explicit
- [x] LiPo is power-warning
- [x] MOV is unsafe-blocked for student breadboard simulation
- [x] passive-only circuits do not pretend to have active run simulation

Evidence:

- 2026-06-02: promoted `trimmer-pot` as a simulation-ready adjustable passive input by reusing the analog divider PWM dimmer contract with a trimmer-specific footprint and `A/W/B` pin model.
- Added canonical part capability, visual-library crosswalk mapping, h-eduware-derived source claims, v2 analog dimmer bundle refs, context sufficiency eval rows, and Korean/English routing tests.
- `buildContextPacket()` now treats explicit trimmer wording as an analog dimmer input alternative and prunes the default `potentiometer-10k`; the same pruning helper now only replaces required parts in the same replacement category, preserving unrelated required inputs such as ultrasonic sensors.
- `compileSimulationPlan()` reuses the validated `analog_pwm_dimmer` paths for trimmer dimmers: sensing divider, analog signal, and LED forward current.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts tests/unit/contextRouting.test.ts tests/unit/contextPacketCapability.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts` passed 166/166.
- Verification: `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, and `npm run typecheck` passed; coverage report now shows WP-07 at 4/19 with 15 remaining.
- 2026-06-02: promoted `breadboard-psu`, `9v-battery-clip`, `aa-battery-holder`, `barrel-jack`, `screw-terminal-2pin`, and `7805-regulator` as qualitative low-voltage power rail/regulator parts.
- Added canonical power capabilities, render footprints, visual-library crosswalk mappings, h-eduware-derived source claims, a `low-voltage-power-rail` capability/v2 bundle/route, context sufficiency eval rows, and state-only simulation primitives for rail/regulator evidence.
- `validateCircuitSpec()` now checks declared low-voltage DC power, source polarity to breadboard rails or regulator input, 7805 input source, regulated output rail, and common ground; mains/wall outlet language remains blocked before render/simulation.
- `compileSimulationPlan()` now accepts these rail/regulator circuits through state-only runnable evidence instead of fabricating load current paths.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts tests/unit/contextRouting.test.ts tests/unit/contextPacketCapability.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts` passed 171/171.
- Verification: `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, and `npm run typecheck` passed; coverage report showed WP-07 at 10/19 with 9 remaining at this checkpoint.
- 2026-06-02: promoted `lipo-battery-1s`, `ceramic-cap`, `electrolytic-cap`, `diode-1n4007`, `schottky-diode`, `zener-diode`, `polyfuse`, `inductor-axial`, and `crystal-16mhz` as low-voltage power/passive/protection/timing context parts.
- Added canonical part capabilities, render footprints, visual-library crosswalk mappings, h-eduware-derived source claims, support bundles, v2 bundles/routes, state-only simulation primitives, and context sufficiency eval rows for the promoted passive set.
- `validateCircuitSpec()` now blocks mains passive/MOV requests before simulation, blocks unsafe LiPo handling language, and rejects reversed electrolytic polarity in passive context.
- `compileSimulationPlan()` now accepts passive/protection/timing circuits through state-only runnable evidence and does not fabricate current-flow animation for passive-only context.
- Verification: `npx tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/contextRouting.test.ts tests/unit/contextPacketCapability.test.ts` passed 48/48 after adding passive/timing routing and prompt-budget coverage.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts tests/unit/generalizationEval.test.ts` passed 127/127 after adding passive state-only workflow and unsafe timing counterexample coverage.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts tests/unit/contextRouting.test.ts tests/unit/contextPacketCapability.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts` passed 175/175 for the combined target suite.
- Verification: `npm run context:check`, `npm run audit:visual-coverage -- --write`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, and `npm run typecheck` passed; coverage report now shows WP-07 at 19/19 with 0 remaining.

### WP-08 Controller Board Expansion

Parts:

- [x] arduino-uno-r3
- [x] arduino-nano
- [x] arduino-mega2560
- [x] arduino-leonardo
- [x] arduino-micro
- [x] arduino-pro-mini
- [x] attiny85-board
- [x] esp32-devkit
- [x] esp8266-nodemcu
- [x] raspberry-pi-pico
- [x] stm32-bluepill
- [x] teensy40

Required topology:

- [x] `controller-board-pin-map-substitution`
- [x] `controller-voltage-domain-policy`

Validation:

- [x] pin aliases are board-specific
- [x] voltage domain is explicit, especially 3.3V boards
- [x] Uno-only assumptions do not leak into other boards

Closeout:

- 2026-06-02: WP-08 is closed at 12/12 for controller-board state-only context. Arduino Nano, Mega 2560, Leonardo, Micro, Pro Mini, ATtiny85 Digispark, ESP32 DevKit, ESP8266 NodeMCU, Raspberry Pi Pico, STM32 Blue Pill, and Teensy 4.0 now have part capabilities, visual crosswalk mappings, source claims, render footprints, topology/validation contracts, v2 bundle refs, supported eval rows, unsupported counterexamples, and runtime state-only simulation coverage.
- Scope note: WP-08 deliberately does not mean every existing Uno circuit bundle can silently substitute every controller board. Non-Uno LED/sensor/display circuit requests now produce an explicit controller substitution support gap until that specific circuit bundle opts in with validated wiring.
- Verification: `npm run context:check`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, `npm run audit:visual-coverage -- --write`, `npx tsx --test tests/unit/contextCoverage.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts tests/unit/contextRouting.test.ts tests/unit/contextPacketCapability.test.ts tests/unit/agentWorkflow.test.ts`, and `npm run typecheck` passed; coverage report now shows WP-08 at 12/12 with 0 remaining.

### WP-09 Prototyping and Connector Surfaces

Parts:

- [x] breadboard-half
- [x] dupont-jumper-wires
- [x] breadboard-full
- [x] breadboard-mini
- [x] perfboard-5x7
- [x] pcb-blank-single
- [x] proto-shield-uno
- [x] header-male-40pin
- [x] header-female-40pin
- [x] screw-terminal-4pin

Required topology:

- [x] `prototyping-surface-context-only`
- [x] `connector-wiring-context-only`

Validation:

- [x] render placement rules exist
- [x] connector pins do not create invisible shorts
- [x] prototyping surfaces do not infer breadboard, solder, PCB, or shield continuity without an explicit topology contract

Evidence:

- 2026-06-02: promoted `breadboard-full`, `breadboard-mini`, `perfboard-5x7`, `pcb-blank-single`, `proto-shield-uno`, `header-male-40pin`, `header-female-40pin`, and `screw-terminal-4pin` as simulation-ready state-only prototyping/connector context.
- Added canonical part capabilities, render footprints, source claims, hardware support bundles, v2 bundle manifests, context routes, topology templates, and state-only simulation primitives for `prototyping-surface-context` and `connector-wiring-context`.
- `validateCircuitSpec()` and topology inference now keep WP-09 context parts state-only: they can render and produce expected state evidence, but they do not create current paths, hidden nets, solder bridges, rail power, or terminal power sources by themselves.
- `buildContextPacket()` routes mini/full breadboard, perfboard, blank PCB, proto shield, headers, and 4-pin screw terminal prompts to compact WP-09 bundles and prunes broad light, button, display, and power-rail overmatches.
- Verification: `npx tsx --test tests/unit/agentWorkflow.test.ts --test-name-pattern "WP-09"` passed 124/124 with WP-09 workflow coverage.
- Verification: `npx tsx --test tests/unit/contextRouting.test.ts tests/unit/contextPacketCapability.test.ts --test-name-pattern "WP-09|prototyping|connector"` passed 49/49 with WP-09 routing, pruning, and bundle artifact coverage.
- Verification: `npm run context:check`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, `npx tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts`, `npm run audit:visual-coverage -- --write`, and `npm run typecheck` passed; coverage report now shows WP-09 at 10/10 with 0 remaining.
- Verification: `npm test` passed 281/281 and `npm run build` passed.

### WP-10 Sensor Protocol Modules

Parts:

- [x] dht11
- [x] dht22
- [x] bmp280
- [x] hmc5883l
- [x] hx711-loadcell
- [x] max30102-pulse
- [x] mpu6050
- [x] rc522-rfid
- [x] gps-neo6m

Required topology:

- [x] `controller-single-wire-sensor-i2c-display`
- [x] `controller-i2c-sensor-display`
- [x] `controller-clocked-data-sensor-i2c-display`
- [x] `controller-spi-sensor-display`
- [x] `controller-uart-sensor-display`

Validation:

- [x] protocol pins match exact bus roles
- [x] sensor readings are qualitative educational states
- [x] medical/navigation/security/certified-measurement claims are restricted

Status:

- 2026-06-02: WP-10 is closed at 9/9. DHT22, BMP280, HMC5883L, MPU6050, MAX30102, HX711, RC522, and GPS NEO-6M now have source claims, part capabilities, render footprints, topology/validation contracts, simulation current/signal path contracts, v2 bundle refs, supported eval rows, unsupported counterexamples, routing/pruning coverage, and browser-visible context-gap regression coverage for remaining unsupported parts.
- Verification: `npm run context:check`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, `npm run audit:visual-coverage -- --write`, and `npm run typecheck` passed; coverage report now shows WP-10 at 9/9 with 0 remaining.
- Verification: targeted WP-10 workflow/routing/eval suites passed, including `agentWorkflow` 126/126, context routing/pruning 51/51, context sufficiency/generalization 6/6, and Playwright planned-context-gap regression 2/2.

### WP-11 Communication Modules

Parts:

- [x] esp01-wifi
- [x] hc05-bluetooth
- [x] lora-ra02
- [x] nrf24l01-radio
- [x] sim800l-gsm
- [x] mcp2515-can
- [x] rs485-module
- [x] usb-host-shield

Required topology:

- [x] `controller-uart-communication-module`
- [x] `controller-spi-communication-module`
- [x] `controller-differential-bus-module`
- [x] `wireless-module-command-state`

Validation:

- [x] wireless modules do not imply internet/cloud backend simulation
- [x] GPS/tracking/privacy-sensitive requests are blocked or reframed
- [x] SIM800L and radio power warnings are visible

Status:

- 2026-06-02: WP-11 is closed at 8/8. ESP-01, HC-05, SIM800L, LoRa Ra-02, nRF24L01, MCP2515 CAN, RS-485, and USB Host Shield now have source claims, part capabilities, render footprints, topology/validation contracts, local command/status or bus-activity simulation paths, v2 bundle refs, route/pruning coverage, supported eval rows, and unsupported overclaim counterexamples.
- Verification: `npm run context:check`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, and `npm run audit:visual-coverage -- --write` passed; coverage report now shows WP-11 at 8/8 with 0 remaining and WP-12 at 7/7.
- Verification: `npm test -- tests/unit/contextSufficiencyEval.test.ts` and `npm test -- tests/unit/generalizationEval.test.ts` both passed the full unit sweep at 287/287.

### WP-12 Logic, Interface, and IC Expansion

Parts:

- [x] 74hc595-shift
- [x] pcf8574-expander
- [x] ne555-timer
- [x] ads1115-adc
- [x] mcp3008-adc
- [x] lm358-opamp
- [x] i2c-level-shifter

Implemented topology contracts:

- [x] `controller-logic-interface-context`
- [x] `controller-i2c-interface-context`
- [x] `controller-spi-interface-context`
- [x] `controller-analog-timing-interface-context`
- [x] `level-shifted-i2c-bus`

Validation:

- [x] IC pins must not be treated as generic unknown pins
- [x] supply voltage and ground are mandatory
- [x] level shifting is qualitative voltage-domain context only, not a regulator/current booster simulation
- [x] ADC/op-amp precision and NE555 exact timing overclaims are blocked

Status:

- 2026-06-02: WP-12 is closed at 7/7. 74HC595, PCF8574, ADS1115, MCP3008, NE555, LM358, and I2C level shifter now have source claims, part capabilities, render footprints, topology/validation contracts, qualitative current/signal paths, v2 bundle refs, supported eval rows, unsupported overclaim counterexamples, and routing/pruning coverage.
- Verification: `npx tsx --test tests/unit/contextPacketCapability.test.ts tests/unit/agentWorkflow.test.ts` passed with 149/149 tests after WP-12 workflow coverage landed.
- Verification: `npx tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts tests/unit/contextRouting.test.ts` passed with 39/39 tests after pruning `controller-board-substitution` from explicit level-shifter requests and updating the full-coverage eval expectation to zero context-gap rows.
- Verification: `npm run context:check`, `npm run audit:context:v2`, `npm run audit:sources`, `npm run audit:capabilities`, `npm run audit:visual-coverage -- --write`, and `npm run typecheck` passed after the WP-12 closeout.

## Global Remaining Checklist by Family

### adjustable-passive

- [x] trimmer-pot

### analog-interface-ic

- [x] ads1115-adc
- [x] lm358-opamp
- [x] mcp3008-adc

### capacitive-passive

- [x] ceramic-cap
- [x] electrolytic-cap

### connector-wiring

- [x] header-female-40pin
- [x] header-male-40pin

### discrete-switch-ic

- [x] 2n2222-npn

### display-i2c

- [x] lcd-16x2
- [x] lcd-20x4
- [x] oled-13-i2c

### display-led-array

- [x] 7seg-1digit
- [x] 7seg-4digit-tm1637
- [x] 8x8-matrix-max7219
- [x] neopixel-ring-12

### display-spi

- [x] epaper-213
- [x] nokia-5110
- [x] tft-18

### driver-ic

- [x] a4988-stepper
- [x] drv8825-stepper
- [x] irf520-mosfet
- [x] l293d-driver
- [x] l298n-driver
- [x] uln2003-driver

### frequency-or-inductive-passive

- [x] crystal-16mhz
- [x] inductor-axial

### human-input-analog

- [x] joystick-module
- [x] rotary-encoder

### human-input-digital

- [x] limit-switch
- [x] reed-switch
- [x] slide-switch
- [x] toggle-switch
- [x] ttp223-touch

### level-shifter-interface

- [x] i2c-level-shifter

### light-output

- [x] laser-diode-module
- [x] rgb-led-common-cathode
- [x] ws2812b-strip

### logic-or-interface-ic

- [x] 74hc595-shift
- [x] ne555-timer
- [x] pcf8574-expander

### matrix-or-multi-input

- [x] dip-switch-4
- [x] keypad-4x4
- [x] membrane-keypad-1x4

### motor-or-inductive-output

- [x] dc-fan-5v
- [x] dc-motor-130
- [x] mini-water-pump
- [x] nema17-stepper
- [x] solenoid-valve
- [x] stepper-28byj48
- [x] vibration-motor

### power-regulation-ic

- [x] 7805-regulator

### power-source-or-connector

- [x] 9v-battery-clip
- [x] aa-battery-holder
- [x] barrel-jack
- [x] breadboard-psu
- [x] lipo-battery-1s
- [x] screw-terminal-2pin

### protection-passive

- [x] diode-1n4007
- [x] polyfuse
- [x] schottky-diode
- [x] varistor-mov
- [x] zener-diode

### prototyping-surface

- [x] breadboard-full
- [x] breadboard-mini
- [x] pcb-blank-single
- [x] perfboard-5x7
- [x] proto-shield-uno
- [x] screw-terminal-4pin

### relay-output

- [x] relay-1ch
- [x] relay-4ch

### sensor

- [x] dht22

### sensor-analog

- [x] acs712-current
- [x] fsr-pressure
- [x] thermistor-ntc
- [x] tmp36-temp
- [x] water-level-sensor

### sensor-analog-digital

- [x] flame-sensor
- [x] mq2-gas
- [x] rain-sensor
- [x] soil-moisture
- [x] sound-sensor

### sensor-digital

- [x] hall-effect-sensor
- [x] ir-receiver
- [x] line-tracker
- [x] pir-hc-sr501
- [x] sw420-vibration
- [x] tcs3200-color
- [x] tilt-ball-sensor

### sensor-i2c-or-spi

- [x] bmp280
- [x] hmc5883l
- [x] hx711-loadcell
- [x] max30102-pulse
- [x] mpu6050
- [x] rc522-rfid

### sensor-serial

- [x] gps-neo6m

### servo-output

- [x] mg996r-servo

### sound-output

- [x] active-buzzer

### wired-communication

- [x] mcp2515-can
- [x] rs485-module
- [x] usb-host-shield

### wireless-communication

- [x] esp01-wifi
- [x] hc05-bluetooth
- [x] lora-ra02
- [x] nrf24l01-radio
- [x] sim800l-gsm

## First Deletion Order

작업은 아래 순서로 체크박스를 지워간다.

1. WP-00.5: build/run gate drift, blocked artifact carryover, source/v2 bundle shallow checks를 먼저 정리한다.
2. WP-01: FSR/thermistor resistive divider까지 마무리해서 analog sensor family를 닫는다. (완료)
3. WP-02: digital sensor/switch generalization을 구현한다. (완료)
4. WP-03: matrix and multi-input controls를 구현한다. (완료)
5. WP-04: display expansion을 구현한다. (완료)
6. Context layer generated-source refactor를 먼저 안정화한다. (WP-01~04 완료)
7. WP-05: light/sound outputs를 구현한다. (완료)
8. WP-06: high-current/motor/relay family를 power-warning 중심으로 구현한다. (완료)
9. WP-07 power/passive/protection과 WP-09 prototyping/connector surface는 완료했다.
10. WP-10: protocol sensor modules를 구현한다. (완료)
11. WP-08: controller board substitution을 구현한다. (완료)
12. WP-11: communication module family를 구현한다. (완료)
13. WP-12: interface IC family 7개를 구현한다.
14. 모든 remaining family checklist가 0이 될 때까지 coverage report를 재생성하고 반복한다.

## Immediate Subagent Backlog

다음 구현 착수 전, master는 아래 ticket들을 subagent에 병렬 배정한다.

| Ticket | Type | Output | Purpose |
| --- | --- | --- | --- |
| T-WP00-GATE | Explorer/Proposal | `docs/subagent-proposals/wp00-family-runnable-evidence-plan.md` | family-specific runnable evidence와 markdown/share gate alignment 범위 확정 |
| T-WP00-CONTEXT | Explorer/Proposal | `docs/subagent-proposals/wp00-context-carryover-plan.md` | blocked artifact와 supported alternative follow-up 복구 회귀 범위 유지 |
| T-WP00-SOURCES | Explorer/Proposal | `docs/subagent-proposals/wp00-source-v2-contract-plan.md` | support bundle과 v2 manifest promotion gate 회귀 범위 유지 |
| T-WP04-DISPLAY | Proposal | `docs/subagent-proposals/wp04-display-expansion-contract.md` | bare 7-segment topology, validator, and qualitative simulation evidence 설계 |
| T-GAP-EVALS | Explorer/Proposal | `docs/subagent-proposals/remaining-family-gap-eval-plan.md` | WP-03~WP-12 representative context-gap eval rows 설계 |

새 part promotion은 계속 package 단위로 진행하되, source claims, validator, render, simulation, v2 bundle, eval, audit/test evidence가 모두 닫힌 뒤에만 체크박스를 완료로 바꾼다.

## Subagent Completion Review

master는 subagent 결과를 받은 뒤 아래 순서로만 통합한다.

1. Proposal 문서가 package 범위와 중앙 파일 충돌 규칙을 지켰는지 확인한다.
2. coverage report의 package ownership과 plan checklist가 맞는지 확인한다.
3. source claim 없는 promotion, validator 없는 footprint, simulation primitive 없는 route를 반려한다.
4. central JSON/TS 변경은 master가 직렬로 통합한다.
5. package 최소 검증 명령을 돌린다.
6. generated report를 재생성한다.
7. browser/E2E evidence를 확인한다.
8. 이 문서의 checkbox와 evidence를 업데이트한다.

## 문서 갱신 규칙

- Worker가 구현을 끝냈다고 해서 체크박스를 지우지 않는다.
- Master가 audit/test/browser evidence를 확인한 뒤에만 체크박스를 지운다.
- 체크박스를 지울 때는 같은 커밋 또는 같은 작업 묶음에서 증거를 남긴다.
- 수치가 바뀌면 이 문서의 현재 스냅샷을 갱신한다.
- 계획 자체가 바뀌면 "왜 바뀌었는지"를 해당 WP 아래에 짧게 기록한다.
