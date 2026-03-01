# RAIL

RAIL은 **로컬 우선(Local-first) 멀티 에이전트 워크플로우 데스크톱 앱**입니다.  
개발 작업(특히 게임/콘텐츠/자동화 흐름)에 필요한 실행, 데이터 수집, 결과 문서 확인을 한 곳에서 처리합니다.

---

## 핵심 탭 역할

- **대시보드**: 실행 상태/운영 로그/최근 요약 확인
- **데이터 파이프라인**: 주제별 수집·분석 파이프라인 실행(근거 데이터 생산)
- **에이전트**: 개발 전용 에이전트 워크스페이스(요청-수정-반복)
- **그래프**: DAG(노드 그래프) 기반 워크플로우 구성/실행
- **피드**: 생성 문서/중간 산출물/근거 링크 열람
- **설정**: 엔진 연결, Codex 로그인, 작업 경로, Web 연결 관리

---

## 현재 동작 구조

### 1) 데이터 파이프라인
- 토픽별 `실행하기` 버튼으로 수집/처리 파이프라인 시작
- 실행 결과(브리핑/요약/리스크)는 run 단위로 저장
- 생성 문서는 피드에서 열람

### 2) 에이전트 워크스페이스
- 개발 전용 세트 중심으로 요청/수정 반복
- 디테일 패널에서 **컨텍스트/RAG 소스**(첨부 파일, 최근 데이터 산출물) ON/OFF 선택 후 전송
- 선택한 근거만 포함해 실행 요청 전달

### 3) 그래프(DAG)
- Turn / Transform / Gate 노드로 실행 흐름 구성
- 개별 실행 가능하며 결과는 다른 탭과 run 기준 동기화

### 4) 피드
- 최종 문서와 중간 산출물을 읽기 중심으로 확인
- run 흐름별로 결과 검토/추적

---

## 빠른 시작

```bash
npm install
npm run tauri:dev
```

웹만 확인:

```bash
npm run dev
```

빌드:

```bash
npm run build
```

검사(아키텍처/사이클/빌드/테스트):

```bash
npm run check
```

---

## 개발 스택

- Desktop Shell: Tauri
- Frontend: React + TypeScript + Vite
- Orchestration: DAG Workflow Runtime
- Storage: 로컬 파일(CWD, `.rail/*`), run/snapshot/event 기록

---

## 프로젝트 구조

```txt
src/
  app/                # 앱 조립, 런타임 훅, 상태 연결
  pages/              # 대시보드/데이터/에이전트/그래프/피드/설정
  features/           # 도메인 로직(오케스트레이션, 인텔리전스 등)
  styles/             # 레이어드 CSS
src-tauri/            # Rust backend, 파일 저장/명령
```

---

## 데이터 및 기록

- 실행 기록: run 단위 메타/이벤트/산출물 파일
- 스냅샷: 토픽별 요약/하이라이트/리스크/레퍼런스
- 로그: 시스템/AI 중심 이벤트(사용자 이벤트는 운영 로그에서 제외 가능)

저장 위치는 실행 환경(CWD/앱 설정)에 따라 달라집니다.

---

## 문서

- 보안: [SECURITY.md](./SECURITY.md)
- 약관: [TERMS.md](./TERMS.md)
- 면책: [DISCLAIMER.md](./DISCLAIMER.md)
- 서드파티 고지: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

