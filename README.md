# DB Migrator Tool

Python + FastAPI + Next.js 기반의 **DB-agnostic** 데이터 마이그레이션 도구입니다.

## 핵심 변경점
- 백엔드 코드에서 Oracle 전용 드라이버/문법 의존은 제거하고, **SQLAlchemy 기반 공통 구조**를 유지합니다.
- DB 연결은 **Database URL** 기반으로 처리합니다.
- 운영 DB 연결을 위해 **Oracle DBAPI(`oracledb`)는 기본 런타임에 포함**합니다.
- 로컬 테스트는 무거운 Oracle 컨테이너 대신 **PostgreSQL 테스트 컨테이너**로 바로 실행할 수 있습니다.

## 주요 기능
- Source / Target DB 연결 테스트
- Source / Target 테이블 목록 조회
- 공통 컬럼 선택
- INSERT / MERGE / DELETE_INSERT
- 날짜 컬럼 기준 기간 필터
- 멀티 테이블 일괄 마이그레이션
- 컬럼 마스킹(NONE / NULL / FIXED / HASH / PARTIAL)
- Dry Run / 실제 실행 분리
- 백그라운드 Job 실행 및 진행률 조회
- SQLite 기반 Job 이력 저장

## 요구 사항
- Python 3.11+
- Node.js 20.9+

## 실행 정책
- **Windows**: uv 기반 실행만 지원
- **Linux**: Docker 기반 실행만 지원

## Windows 실행
```bat
scripts\windows\run_uv.bat
```

이 스크립트는:
- 스크립트 위치를 기준으로 프로젝트 루트를 자동 탐색
- `uv sync`
- FastAPI backend 실행
- 최초 실행 시 `frontend/package-lock.json`이 있으면 `npm ci --no-audit --no-fund`로 고정 버전 설치
- 이미 `frontend/node_modules`가 있으면 다음 실행부터는 frontend 설치를 건너뜀
- frontend dev 서버 실행

권장 사항:
- **Node.js 20.9+** 사용
- 가능하면 **LTS 버전(Node 20 또는 22)** 사용
- 스크립트는 다른 디렉터리에서 실행하거나 더블클릭으로 실행해도 동작하도록 작성되어 있습니다.
- 프론트엔드 재설치가 필요하면 Windows cmd에서 `set FORCE_FRONTEND_INSTALL=1` 후 스크립트를 실행하세요.

## Linux 실행
대표 실행 스크립트:
```bash
bash scripts/linux/run_docker.sh <command>
```

지원 명령:
```bash
bash scripts/linux/run_docker.sh prod-up
bash scripts/linux/run_docker.sh prod-down

bash scripts/linux/run_docker.sh test-start
bash scripts/linux/run_docker.sh test-down
bash scripts/linux/run_docker.sh test-clean
```

- `prod-up`: 운영형 Docker 스택 기동 (prod frontend build 결과 사용)
- `prod-down`: 운영형 Docker 스택 중지
- `test-start`: PostgreSQL 테스트 컨테이너 + backend + frontend 기동 → smoke 테스트 실행
- `test-down`: 테스트 스택만 중지
- `test-clean`: 테스트 스택 중지 + 테스트 이미지/볼륨 정리

## 테스트 모드
`test-start`는 PostgreSQL 컨테이너를 띄우고, 아래 테스트 데이터를 미리 준비합니다.

- DB: `test_db`
- Source schema/table: `source_schema.users`
- Target schema/table: `target_schema.users`
- 테스트 계정: `test_user / test_password`

프론트는 테스트 모드에서 아래 값이 **기본 입력 상태**로 열립니다.
- Source URL
- Target URL
- Source/Target schema
- Source/Target table
- selected columns
- key columns
- strategy
- date filter column

## 연결 방식
프론트엔드와 API는 `username/password/dsn` 대신 **Database URL** 중심으로 동작합니다.

예시:
- SQLite: `sqlite:///./data/local.db`
- PostgreSQL: `postgresql://user:password@host:5432/dbname`
- Oracle: `oracle+oracledb://user:password@host:1521/?service_name=SERVICE`

`username`, `password` 필드는 URL에 포함하지 않았을 때만 보조적으로 사용할 수 있습니다.

## Oracle 운영 연결 준비
- 기본 Python 의존성에 `oracledb`가 포함되어 있습니다.
- Docker backend 이미지도 같은 `requirements.txt`를 설치하므로 Oracle URL을 해석할 수 있습니다.
- 기본 연결 방식은 **python-oracledb Thin mode** 입니다.
  - 일반적인 Oracle 연결에는 Oracle Client 라이브러리가 필요하지 않습니다.
  - 구형/특수 Oracle 환경에서만 Thick mode가 필요할 수 있습니다.

### Oracle preflight
드라이버 import와 SQLAlchemy Oracle URL 해석 가능 여부를 즉시 확인:

```bash
python3 scripts/verify_oracle_runtime.py
python3 scripts/verify_oracle_runtime.py "oracle+oracledb://user:pass@host:1521/?service_name=SERVICE"
```

실제 Oracle 접속이 가능한 환경이라면, 앱의 `/connections/test`로도 smoke 확인을 수행하세요.

## 참고
- `MERGE`, `DELETE_INSERT`는 key 컬럼이 필요합니다.
- DB 독립성을 위해 `MERGE`는 내부적으로 **update 후 없으면 insert** 방식으로 처리합니다.
- `truncate_before_load`는 특정 DB의 TRUNCATE 문 대신 **대상 테이블 비우기(delete all)** 로 동작합니다.
