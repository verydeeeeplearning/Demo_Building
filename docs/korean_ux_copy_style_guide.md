# H-eduware Korean UX Copy Style Guide

## Purpose

H-eduware의 기본 사용자는 회로를 배우는 학생이다. 한국어 UI는 영어 문장을 번역한 느낌이 아니라, 한국어로 먼저 설계한 학습 도구처럼 읽혀야 한다.

## Voice

- 짧고 직접적으로 쓴다.
- 버튼은 사용자가 하려는 행동으로 쓴다.
- 설명문은 친절하지만 과하게 격식 있게 쓰지 않는다.
- 학생에게 내부 구현 용어를 노출하지 않는다.
- 회로/전자 부품의 표준 약어는 억지로 번역하지 않는다.

## Preferred Terms

| English or internal term | Korean UI term |
| --- | --- |
| Part library | 부품함 |
| Circuit inspector | 회로 설명 |
| Selected circuit explanation | 선택한 부분 |
| Currently hovered | 마우스를 올린 부분 |
| Ask about this circuit | 회로에 대해 물어보기 |
| File explorer | 프로젝트 문서 |
| Context coverage | 참고 자료 확인 |
| Grounding sources | 참고한 자료 |
| Validation warnings | 확인이 필요한 점 |
| Render warnings | 화면 표시 경고 |
| Connections | 연결선 |
| Hardware | 부품과 연결 |

## Allowed Technical Terms

다음 용어는 학생에게도 익숙하거나 회로 학습에서 표준으로 쓰이므로 그대로 둔다.

- Arduino
- OLED
- LED
- GND
- SDA
- SCL
- PWM
- I2C
- USB
- Deepagents

## Terms To Avoid In Student-Facing UI

아래 용어는 개발자나 시스템 내부 용어처럼 들리므로, 학생이 보는 UI에서는 피한다.

- 인스펙터
- 컨텍스트
- 충족도
- 렌더
- 트레이스
- 아티팩트
- 에이전트 근거
- Context Layer
- coverage
- render
- trace
- agent evidence

## Button Labels

좋은 예:

- 실행
- 물어보기
- 이 부분 물어보기
- 보기 초기화
- 화면 맞춤
- 데모 불러오기

피해야 할 예:

- 질문
- 인터랙션 시작
- 컨텍스트 보기
- 렌더 확인

## Hardware Terms

회로 신호와 핀 이름은 번역하지 않는다.

좋은 예:

- `GND가 빠지면 화면이 불안정해질 수 있습니다.`
- `SDA는 화면에 보낼 데이터를 전달합니다.`
- `Arduino A5 핀에서 OLED SCL 핀으로 클록 신호를 보냅니다.`

피해야 할 예:

- `접지선 기준 신호 맥락이 누락됩니다.`
- `자료선 충족도가 부족합니다.`

## Review Checklist

새 한국어 문구를 추가할 때 확인한다.

- 학생이 바로 이해할 수 있는가?
- 버튼은 행동을 말하는가?
- 내부 시스템 용어가 들어가지 않았는가?
- 한국어 문장으로 자연스럽게 읽히는가?
- 모바일에서 버튼 안에 들어갈 만큼 짧은가?
- 영어 technical term을 억지로 번역하지 않았는가?
