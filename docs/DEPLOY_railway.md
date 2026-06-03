# Railway 배포 가이드 (프론트 + 에이전트 서버 통합)

프론트엔드(Vite 빌드)와 에이전트 서버(`server/index.ts`)를 **하나의 Railway 서비스**로
배포한다. 서버가 `/api/*`와 정적 자산(`dist/`)을 함께 서빙한다.

## 작동 방식
- 빌드: `npm run build` → Vite가 `dist/`에 정적 자산 생성
- 시작: `npm start` → `tsx server/index.ts`가 `PORT`에서 리슨, `/api/*` 처리 + `dist/` 서빙
- 프론트는 프로덕션 빌드에서 same-origin(`/api/...`)으로 백엔드 호출

## 사전 준비
- Railway 계정 + GitHub 저장소 연결
- OpenAI API 키

## 배포 단계

### 1. 프로젝트 생성
1. Railway 대시보드 → **New Project** → **Deploy from GitHub repo**
2. 이 저장소 선택. `railway.json`을 읽어 빌드/시작 명령을 자동 적용한다.

### 2. 환경변수 설정 (Variables 탭)
| 변수 | 값 | 비고 |
|------|-----|------|
| `OPENAI_API_KEY` | `sk-...` | 필수 |
| `H_EDUWARE_AGENT_MODEL` | `gpt-4o-mini` 등 | 필수 |
| `H_EDUWARE_PUBLIC_APP_URL` | `https://<도메인>.up.railway.app` | 공유 링크/CORS |
| `H_EDUWARE_SHARE_ROOT` | `/data/shared-projects` | 볼륨 경로(아래 3단계) |

> `PORT`는 Railway가 자동 주입하므로 설정하지 않는다.

### 3. 영구 볼륨 (공유 기능 데이터)
공유한 프로젝트가 재배포 후에도 남으려면 볼륨이 필요하다.
1. 서비스 → **Settings → Volumes → New Volume**
2. Mount path: `/data`
3. `H_EDUWARE_SHARE_ROOT`를 `/data/shared-projects`로 설정 (서버가 없으면 자동 생성)

> 볼륨을 안 붙이면 공유 데이터는 재배포 시 사라진다(데모용으론 무방).

### 4. 도메인 발급
1. 서비스 → **Settings → Networking → Generate Domain**
2. 발급된 URL을 `H_EDUWARE_PUBLIC_APP_URL`에 다시 반영하고 재배포

### 5. 확인
- `https://<도메인>/` → 앱 로드
- `https://<도메인>/api/agent/health` → `{"ok":true,...}` (키/모델 설정 시)
- 자연어로 회로 생성 → AI 응답
- 공유 링크 생성 → 새 탭에서 `?share=` 링크 열림

## 로컬에서 프로덕션 모드 검증
```bash
npm run build
H_EDUWARE_AGENT_PORT=8787 npm start
# http://127.0.0.1:8787 접속 — 프론트와 API가 같은 포트에서 동작
```

## 트러블슈팅
| 증상 | 원인 / 해결 |
|------|------------|
| `Frontend build not found` | `npm run build` 미실행 → `dist/` 없음. 빌드 명령 확인 |
| `/api/agent/health`가 `ok:false` | `OPENAI_API_KEY` / `H_EDUWARE_AGENT_MODEL` 누락 |
| 공유 데이터 사라짐 | 볼륨 미설정 또는 `H_EDUWARE_SHARE_ROOT` 경로 불일치 |
| AI 호출 타임아웃 | 모델/키 확인. Railway 상시 서버라 함수 타임아웃은 없음 |
