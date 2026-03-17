# DB Migrator Tool

Python + FastAPI + Next.js 기반의 **DB-agnostic** 데이터 마이그레이션 도구입니다.

## 핵심 변경점
- 백엔드 코드에서 Oracle 전용 드라이버/문법 의존은 제거하고, **SQLAlchemy 기반 공통 구조**를 유지합니다.
- DB 연결은 **Database URL** 기반으로 처리합니다.
- 운영 DB 연결을 위해 **Oracle DBAPI(`oracledb`)는 기본 런타임에 포함**합니다.
- 로컬 빠른 smoke는 **PostgreSQL 테스트 컨테이너**로 실행하고, Oracle은 **별도 Dockerized Oracle Free smoke lane**으로 검증합니다.

## 주요 기능
- Source / Target DB 연결 테스트
- Source / Target 테이블 목록 조회
- 단일 DB 대상 Table DDL 추출 (table / index / constraint / partition warning)
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

이 스크립트는 **Windows 전용 로컬 개발 진입점**입니다.
- uv + npm 기반으로 backend / frontend를 직접 실행합니다.
- Docker 검증/배포 스택은 다루지 않습니다.

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

이 스크립트는 **Linux 전용 Docker 진입점**입니다.
- 운영형 스택
- PostgreSQL 테스트 스택
- Oracle 컨테이너 검증 스택
을 목적별 명령으로 구분해 관리합니다.

지원 명령:
```bash
bash scripts/linux/run_docker.sh prod-up
bash scripts/linux/run_docker.sh prod-down

bash scripts/linux/run_docker.sh test-start
bash scripts/linux/run_docker.sh test-down
bash scripts/linux/run_docker.sh test-clean

bash scripts/linux/run_docker.sh oracle-start
bash scripts/linux/run_docker.sh oracle-smoke
bash scripts/linux/run_docker.sh oracle-down
bash scripts/linux/run_docker.sh oracle-clean
```

- `prod-up`: 운영형 Docker 스택 기동 (prod frontend build 결과 사용)
- `prod-down`: 운영형 Docker 스택 중지
- `test-start`: PostgreSQL 테스트 컨테이너 + backend + frontend 기동 → API smoke 테스트 실행
- `test-down`: 테스트 스택만 중지
- `test-clean`: 테스트 스택 중지 + 테스트 이미지/볼륨 정리
- `oracle-start`: Oracle XE + backend + frontend 기동 (수동 UI/API 확인용)
- `oracle-smoke`: Oracle XE + backend + frontend 기동 → runtime preflight + Oracle API smoke 실행
- `oracle-down`: Oracle 검증 스택 중지
- `oracle-clean`: Oracle 검증 스택/이미지/볼륨 정리

기본 프론트 포트:
- 운영(prod-up): `http://localhost:3000`
- PostgreSQL 테스트(test-start): `http://localhost:3001`
- Oracle 검증(oracle-start / oracle-smoke): `http://localhost:3002`

## 테스트 모드
`test-start`는 PostgreSQL 컨테이너를 띄우고, 아래 테스트 데이터를 미리 준비합니다.

- DB: `test_db`
- Source schema/table: `source_schema.users` *(created_at 기준 데일리 RANGE 파티션 테이블)*
- Target schema/table: `target_schema.users`
- 테스트 계정: `test_user / test_password`

프론트는 테스트 모드에서 아래 값이 **기본 입력 상태**로 열립니다.
- Source URL
- Target URL
- Source/Target schema
- Source/Target table
- DDL URL
- DDL schema/table
- selected columns
- key columns
- strategy
- date filter column

> 보안상 테스트 프리셋은 **password를 브라우저 환경변수로 주입하지 않습니다.**
> 테스트 모드에서는 **DSN / Database URL 하나만 입력**하도록 UI가 단순화되어 있습니다.
> `bash scripts/linux/run_docker.sh test-start` 실행 시 프론트도 자동으로 함께 뜨며 `http://localhost:3001` 에서 확인할 수 있습니다.

## 연결 방식
프론트엔드와 API는 별도 username/password 입력보다 **Database URL(DSN)** 중심으로 동작합니다.

예시:
- SQLite: `sqlite:///./data/local.db`
- PostgreSQL: `postgresql+psycopg://user:password@host:5432/dbname`
- MySQL: `mysql+pymysql://user:password@host:3306/dbname`
- Oracle: `oracle+oracledb://user:password@host:1521/?service_name=SERVICE`

UI에서는 하나의 Database URL / DSN만 입력하면 됩니다.  
예: `oracle+oracledb://user:password@host:1521/?service_name=XEPDB1`

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
ORACLE_TEST_URL="oracle+oracledb://user:pass@host:1521/?service_name=SERVICE" python3 scripts/verify_oracle_runtime.py
python3 scripts/verify_oracle_runtime.py "oracle+oracledb://user:pass@host:1521/?service_name=SERVICE"
```

실제 Oracle 접속이 가능한 환경이라면, 앱의 `/connections/test`로도 smoke 확인을 수행하세요.

### Oracle Docker smoke
로컬 Oracle Free 컨테이너 검증 lane은 `docker-compose.oracle.yml` + `scripts/oracle/initdb/001_seed_oracle_smoke.sql` 기반입니다.

```bash
bash scripts/linux/run_docker.sh oracle-start
bash scripts/linux/run_docker.sh oracle-smoke
```

`oracle-start`는 다음을 수행합니다.
- Oracle Free 컨테이너 기동
- `ORACLE_SOURCE` / `ORACLE_TARGET` user 생성
- `ORACLE_SOURCE.USERS` 파티션 테이블 + seed row 생성
- `ORACLE_TARGET.USERS` target seed row 생성
- backend 기동
- frontend 기동
- Migration / DDL 기본 연결정보 preset 주입

`oracle-smoke`는 위 스택을 띄운 뒤 추가로 다음을 수행합니다.
- `python scripts/verify_oracle_runtime.py --connect` preflight
- backend API 기준 connection / metadata / DDL / actual MERGE migration smoke
- target 직접 조회로 `ID=1` update, `ID=2/3` insert, `ID=99` sentinel 보존 확인

기본 로컬 URL:
- source: `oracle+oracledb://oracle_source:oracle_source_pass@127.0.0.1:1521/?service_name=XEPDB1`
- target: `oracle+oracledb://oracle_target:oracle_target_pass@127.0.0.1:1521/?service_name=XEPDB1`

정리:

```bash
bash scripts/linux/run_docker.sh oracle-down
bash scripts/linux/run_docker.sh oracle-clean
```

### Oracle live smoke
pytest 기반 Oracle live smoke도 유지합니다.

필수 env:
- `ORACLE_SOURCE_URL` 또는 `ORACLE_TEST_URL`
- `ORACLE_TEST_TABLE` *(기본값 `USERS`)*

선택 env:
- `ORACLE_SOURCE_USERNAME`
- `ORACLE_SOURCE_PASSWORD`
- `ORACLE_SOURCE_SCHEMA`
- `ORACLE_TARGET_URL`
- `ORACLE_TARGET_USERNAME`
- `ORACLE_TARGET_PASSWORD`
- `ORACLE_TARGET_SCHEMA`
- `ORACLE_EXPECT_TARGET_COUNT`
- `ORACLE_EXPECT_UPDATED_NAME`
- `ORACLE_EXPECT_TARGET_IDS`

실행:

```bash
pytest -q -m oracle_live tests/test_oracle_live_smoke.py
```

`oracle-start` 뒤에 아래처럼 바로 실행할 수 있습니다.

```bash
ORACLE_SOURCE_URL="oracle+oracledb://oracle_source:oracle_source_pass@127.0.0.1:1521/?service_name=XEPDB1" ORACLE_TARGET_URL="oracle+oracledb://oracle_target:oracle_target_pass@127.0.0.1:1521/?service_name=XEPDB1" ORACLE_SOURCE_SCHEMA=ORACLE_SOURCE ORACLE_TARGET_SCHEMA=ORACLE_TARGET ORACLE_TEST_TABLE=USERS pytest -q -m oracle_live tests/test_oracle_live_smoke.py
```

검증 항목:
- connection test
- source/target table 목록 조회
- column metadata 조회
- Oracle DDL 추출 + partition section 확인
- representative migration preview (`preview_mode`, `preview_notes`)
- 실제 MERGE migration + target row 검증

## MySQL 연결 준비
- 기본 구현 경로는 `mysql+pymysql://...` 입니다.
- MySQL smoke 검증 시에는 드라이버 설치 후 `/connections/test` 및 실제 migration flow 를 함께 확인하세요.

## SQL Preview 정책
- Migration 결과/preview에 표시되는 SQL은 dialect-aware compiled SQL 기준으로 노출합니다.
- 일부 전략(MERGE fallback 등)은 실제 실행 흐름 설명을 위해 `preview_notes`에 보조 설명이 함께 제공될 수 있습니다.
- `dml_preview` 본문에는 helper 문구를 섞지 않고, `preview_mode` / `preview_notes`로 별도 표시합니다.

## 검증 명령

단위/계약 테스트:

```bash
pytest -q tests/test_metadata_service.py tests/test_migration_service.py tests/test_ddl_service.py tests/test_db_compatibility.py
```

PostgreSQL smoke:

```bash
bash scripts/linux/run_docker.sh test-start
```

기대 증적:
- `/connections/test` 성공 응답의 `dialect`
- `/metadata/ddl` 결과의 `warning_codes`
- `/jobs/{id}` terminal status=`SUCCESS`

Oracle Docker smoke:

```bash
bash scripts/linux/run_docker.sh oracle-smoke
```

기대 증적:
- Oracle runtime preflight JSON 출력 (`connect_ok=true`)
- oracle smoke JSON evidence의 `source_connection.dialect=oracle`
- oracle smoke JSON evidence의 `job_status=SUCCESS`
- oracle smoke JSON evidence의 `updated_row_name=Alice Oracle`, `migrated_ids=[1, 2, 3]`

## 참고
- `MERGE`, `DELETE_INSERT`는 key 컬럼이 필요합니다.
- DB 독립성을 위해 `MERGE`는 내부적으로 **update 후 없으면 insert** 방식으로 처리합니다.
- `truncate_before_load`는 특정 DB의 TRUNCATE 문 대신 **대상 테이블 비우기(delete all)** 로 동작합니다.
