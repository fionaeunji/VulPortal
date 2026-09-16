# VulPortal — 사내 IT 자산 취약점 관리 포털

자산 정보는 엑셀로 등록하고, 취약점 정보(NVD·EPSS·CISA KEV)는 매일 자동으로 가져와
자산과 매칭한 뒤 위험도·조치 기한을 계산해 대시보드로 보여주는 웹 포털입니다.

> 이 문서는 개발 지식이 없는 담당자도 따라 할 수 있도록 작성했습니다.
> 현재는 **7단계(취약점 관리 화면 + 상태 변경 + 감사 로그)** 까지 반영되어 있습니다.

## 기술 구성

| 구분 | 내용 |
| --- | --- |
| 웹 앱 | Next.js (App Router) + TypeScript, Node.js 22 LTS |
| 데이터베이스 | Databricks Unity Catalog 의 Delta 테이블 (SQL Warehouse 로 접속) |
| DB 드라이버 | `@databricks/sql` (Databricks SQL Driver for Node.js) |
| 취약점 수집 | Databricks Job (Python 노트북, 매일 06:00 KST) — 4단계에서 추가 |
| 운영 배포 | Databricks Apps — 9단계에서 추가 |

## 로컬에서 실행하기

### 1. Node.js 설치

1. https://nodejs.org 에서 **22 LTS** 버전을 내려받아 설치합니다.
2. 터미널(명령 프롬프트)에서 아래 명령으로 버전을 확인합니다.

```bash
node --version   # v22.x.x 가 나오면 정상
```

### 2. 소스 내려받기 및 의존성 설치

```bash
git clone https://github.com/fionaeunji/VulPortal.git
cd VulPortal
npm ci
```

### 3. .env.local 작성

1. `.env.example` 파일을 복사해 같은 폴더에 `.env.local` 이라는 이름으로 저장합니다.
2. 아래 값을 채웁니다.

| 항목 | 어디서 찾나요 |
| --- | --- |
| `DATABRICKS_HOST` | 브라우저에서 Databricks 에 접속했을 때 주소창의 주소 (예: `https://adb-xxxx.azuredatabricks.net`) |
| `DATABRICKS_WAREHOUSE_ID` | Databricks 좌측 메뉴 **SQL Warehouses** → 사용할 웨어하우스 → **Connection details** 탭 → `HTTP path` 의 마지막 부분 (`/sql/1.0/warehouses/` 뒤의 문자열) |
| `DATABRICKS_TOKEN` | Databricks 우측 상단 프로필 → **Settings** → **Developer** → **Access tokens** → **Generate new token** |
| `DATABRICKS_CATALOG` / `DATABRICKS_SCHEMA` | 테이블을 만들 카탈로그와 스키마 이름. 기본값 `main` / `vuln_portal` |
| `SYNC_JOB_ID` | 취약점 수집 Job 의 ID. Databricks 좌측 메뉴 **Workflows** → `vulportal_sync_vuln` → 주소창 끝 숫자. 비우면 "지금 수동 실행" 버튼이 꺼집니다 |

`.env.local` 은 `.gitignore` 에 포함되어 있어 저장소에 올라가지 않습니다. 개인 토큰은 절대 다른 곳에 복사하지 마세요.

### 4. SQL Warehouse 연결 테스트

```bash
npm run db:check
```

아래처럼 출력되면 성공입니다. (웨어하우스가 꺼져 있으면 시작까지 1~5분 걸릴 수 있습니다)

```
1) 환경변수 확인
2) Warehouse 접속 테스트 (SELECT 1) ...
   성공
3) 테이블 준비 (sql/schema.sql)
   성공: 6개 문장 실행
4) 테이블 목록
   - users
   - assets
   - vulnerabilities
   - asset_vulnerabilities
   - sync_logs
   - audit_logs
연결 테스트 완료
```

### 5. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 열면 연결 상태 화면이 나옵니다.
`http://localhost:3000/api/health` 에서는 `{"app":"ok","db":"ok"}` 형태의 상태를 확인할 수 있습니다.

## 로그인과 권한

별도의 비밀번호 로그인은 없습니다. 운영(Databricks Apps)에서는 플랫폼이 붙여 주는
`X-Forwarded-Email` 헤더로 사용자를 식별합니다. 이 헤더는 Databricks 가 로그인한 사용자 정보로
채워 주며, 앱은 Databricks 를 거치지 않은 요청을 받지 않습니다.

| 상황 | 동작 |
| --- | --- |
| 헤더가 없는 요청 | 401 응답, 감사 로그에 `LOGIN_DENIED` 기록 |
| `users` 테이블에 없는 이메일 | 조회자(VIEWER) 권한으로만 접근 |
| `users` 테이블에 ADMIN 으로 등록된 이메일 | 관리자 권한 (자산 삭제·전체 교체·수집 실행·사용자 관리 가능) |
| 관리자가 한 명도 없을 때 | 앱 시작 시 `INITIAL_ADMIN_EMAIL` 을 관리자로 자동 등록 |

로컬 개발에서는 헤더가 없으므로 `.env.local` 의 `DEV_USER_EMAIL` 값을 로그인 사용자로 사용합니다.
이 기능은 운영 빌드(`NODE_ENV=production`)에서는 동작하지 않습니다.

사용자 추가와 권한 변경은 **관리자 설정 › 사용자 관리** 화면(`/admin/users`)에서 관리자만 할 수 있습니다.
모든 변경은 `audit_logs` 테이블에 누가·언제·무엇을 바꿨는지 기록됩니다.

### 로컬에서 권한을 직접 확인해 보는 방법

1. `.env.local` 에 `DEV_USER_EMAIL` 과 `INITIAL_ADMIN_EMAIL` 을 같은 이메일로 설정하고 `npm run dev` 실행
2. http://localhost:3000 상단에 "관리자" 배지와 "관리자 설정" 메뉴가 보이는지 확인
3. `/admin/users` 에서 다른 이메일을 조회자로 추가
4. `.env.local` 의 `DEV_USER_EMAIL` 을 그 이메일로 바꾸고 서버를 다시 시작하면 "조회자" 배지가 보이고 `/admin/users` 가 막힙니다

## 대시보드

첫 화면입니다. 모든 집계에서 "해당 없음"으로 제외한 건은 뺍니다.

| 구성 | 내용 |
| --- | --- |
| 상단 카드 4개 | 총 취약점 건수, 긴급 취약점(미조치), 조치율, 기한 초과 |
| 위험도별 분포 | 긴급/우선/주의별 미조치·완료·전체 건수 (막대 차트 + 표) |
| 긴급 조치 대상 | 위험도 긴급 + 미조치, 기한 빠른 순 최대 100건 |
| 자산별 취약점 현황 | 자산별 긴급/우선/주의 건수, 기한 초과, 조치율. 긴급 많은 순 최대 100건 |
| 최근 수집 상태 | 마지막 동기화 시각·성공 여부와 단계별 결과 |

각 카드·차트·표의 **엑셀 Export** 버튼은 해당 항목만, 상단의 **전체 Export** 는 시트별로 나뉜 xlsx 하나를 내려받습니다.
표는 화면에 100건까지만 보여도 Export 에는 전체가 담깁니다. Export 파일의 문자열은 수식으로 해석되지 않도록 처리됩니다.

## 취약점 관리 (상태 변경)

자산과 매칭된 취약점 목록입니다. 위험도·상태·노출구분·담당부서·기한 초과 조건으로 걸러 보고, 현재 조건 전체를 엑셀로 내려받을 수 있습니다.

| 상태 | 뜻 | 누가 바꿀 수 있나 |
| --- | --- | --- |
| 미조치 / 진행중 / 완료 / 위험수용 | 조치 진행 상태. 완료로 바꾸면 완료일이 자동 기록되고, 다른 상태로 되돌리면 완료일이 지워집니다 | 로그인한 모든 사용자 |
| 해당 없음 | 잘못 매칭된 건을 집계에서 제외. "유사 매칭(정확도 낮음)" 건을 검토할 때 사용 | 관리자만 (되돌리기도 관리자만) |

상태 변경은 모두 감사 로그(`audit_logs`)에 "누가·언제·어떤 자산/CVE 를·무엇에서 무엇으로" 형태로 남습니다.

## 자산 관리 (엑셀 업로드)

1. **자산 관리** 메뉴에서 **템플릿 다운로드**를 눌러 `.xlsx` 템플릿을 받습니다.
2. 1행 헤더는 그대로 두고 2행부터 자산을 입력합니다. (예시 2행은 지우세요)

   | 자산유형 | 자산명 | 제조사 | 제품명 | 버전 | CPE | 노출구분(경계면/내부) | 담당자 | 담당부서 | IP |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

   - 자산유형: 서버, NW장비, 보안시스템, 스토리지, 클라우드자산, 기타 중 하나
   - 자산명: 필수. 파일 안에서 중복 불가 (대소문자 구분 없음)
   - CPE: 비우면 `cpe:2.3:a:{제조사}:{제품명}:{버전}:*:*:*:*:*:*:*` 형식으로 자동 생성
   - 시트가 여러 개여도 1행 헤더가 템플릿과 같은 시트는 모두 읽습니다.
3. **엑셀 업로드**(관리자) 화면에서 파일을 고르고 **미리보기**를 누릅니다.
   - 오류 행이 있으면 시트·행 번호·이유가 표시되고 저장되지 않습니다.
   - 자산명이 겹치면 "시트 'A' 5행에 이미 있습니다"처럼 알려줍니다.
4. 오류가 없으면 처리 방식을 고르고 실행합니다.
   - **추가/갱신**: 자산명이 같으면 수정, 없으면 추가
   - **전체 교체**: 기존 자산을 모두 지우고 파일 내용으로 교체. 한 문장(INSERT OVERWRITE)으로 처리되어 실패 시 기존 데이터가 그대로 남습니다.
5. 목록에서 검색·필터·정렬이 가능하며, 관리자는 개별 수정·삭제를 할 수 있습니다.

제한: 파일 10MB 이하, 20,000행 이하. 파일은 서버에 저장되지 않고 메모리에서 처리 후 버립니다.

## 취약점 수집 (Databricks Job)

취약점 정보는 앱이 아니라 Databricks Job(`jobs/sync_vuln.py`, Python 노트북)이 매일 06:00 KST 에 수집합니다.
앱은 결과를 조회하고 상태를 바꾸는 일만 합니다.

| 순서 | 수집원 | 내용 |
| --- | --- | --- |
| 1 | NVD CVE API 2.0 | CVSS 점수·벡터·영향 CPE. 최초 1회는 최근 2년 공개분, 이후에는 변경분만(`lastModStartDate`) |
| 2 | EPSS | 전체 CSV 를 내려받아 점수 갱신. `epss_initial` 은 최초 1회만 저장하고 다시 바꾸지 않음 |
| 3 | CISA KEV | 등재 여부·등재일 갱신. 테이블에 없는 KEV CVE 는 NVD 에서 추가로 받음 |
| 4 | 자산 매칭 | 자산 CPE(또는 제조사/제품명/버전)와 취약점 영향 CPE 비교 → `asset_vulnerabilities` 에 추가 |
| 5 | 위험도 재계산 | 미조치 건의 위험도·기한을 최신 CVSS/EPSS/KEV 로 다시 계산 (완료·위험수용·해당없음 건은 유지) |

### 자산-취약점 매칭 규칙

| 자산 상태 | 비교 방법 | 표시 |
| --- | --- | --- |
| CPE 를 직접 입력한 자산 | 취약점 영향 CPE 와 제조사·제품 정확 비교 + 버전(범위) 비교 | CPE 일치 |
| CPE 가 없어 자동 생성된 자산 | 제조사/제품명을 소문자·기호 제거 후 비교 (제조사는 부분 일치 허용) | 유사 매칭(정확도 낮음) |
| 자산 버전이 비어 있는 경우 | 제품이 같으면 버전과 무관하게 매칭 | 유사 매칭(정확도 낮음) |

정확도가 낮은 매칭은 화면에 표시되며, 관리자가 "해당 없음"으로 제외할 수 있습니다(7단계).

### 위험도 판정 (이 순서로 판정)

1. CISA KEV 등재 → **긴급**
2. CVSS 9.0 이상 그리고 EPSS 초기값 0.3 이상 → **긴급**
3. CVSS 9.0 이상 그리고 EPSS 초기값 0.1 이상 → **우선**
4. CVSS 7.0 이상 → **주의**
5. 그 외 → 저장하지 않음

### 조치 기한 (탐지일 기준)

| 위험도 | 경계면 자산 | 내부 자산 |
| --- | --- | --- |
| 긴급 | 72시간 | 6주 |
| 우선 | 2주 | 6주 |
| 주의 | 1개월 | 3개월 |

기한이 지났는데 미조치(미조치/진행중)인 건은 "기한 초과"로 표시됩니다.
조치율 = 완료 건수 ÷ (전체 건수 − 위험수용 건수) × 100

- 단계별 결과는 `sync_logs` 테이블에 기록되며 관리자 설정 › 취약점 수집 화면에서 볼 수 있습니다.
- 한 단계가 실패해도 다음 단계는 계속 진행합니다.
- 같은 시간에 두 번 실행되지 않도록 잠금을 겁니다. 실행 중 "지금 수동 실행"을 누르면 "이미 실행 중" 오류(409)가 납니다.

### NVD API 키 등록 (권장)

키가 없으면 30초에 5번만 요청할 수 있어 최초 수집이 오래 걸립니다. https://nvd.nist.gov/developers/request-an-api-key 에서 키를 받은 뒤,
Databricks CLI 로 시크릿에 넣습니다. (CLI 설치는 9단계 운영 배포 절차 참고)

```bash
databricks secrets create-scope vuln-portal
databricks secrets put-secret vuln-portal nvd-api-key --string-value "발급받은키"
```

### Job 배포와 수동 실행 버튼 연결

1. `databricks.yml` 의 `host` 를 사내 워크스페이스 주소로 바꿉니다.
2. `databricks bundle deploy -t prod` 로 Job 을 만듭니다. (자세한 절차는 9단계에서 README 에 추가)
3. Databricks **Workflows** 에서 `vulportal_sync_vuln` 을 열고 주소창 끝의 숫자(Job ID)를 `.env.local` 의 `SYNC_JOB_ID` 에 넣습니다.
4. 앱 서비스 프린시펄(운영) 또는 본인 계정(로컬)에 이 Job 의 **CAN_MANAGE_RUN** 권한이 있어야 버튼이 동작합니다.

## 자주 쓰는 명령

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run db:check` | SQL Warehouse 연결 + 테이블 생성 확인 |
| `npm run lint` | 코드 검사 (eslint-plugin-security 포함, 경고 0건이어야 통과) |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run build` | 운영용 빌드 |
| `npm run audit` | 의존성 취약점 검사 (high 이상 0건 유지) |

## 테이블 정의

`sql/schema.sql` 한 파일에 모든 테이블이 있습니다. 앱을 시작할 때(그리고 `npm run db:check` 때)
`CREATE TABLE IF NOT EXISTS` 로 자동 생성되므로 테이블을 직접 만들 필요가 없습니다.

| 테이블 | 용도 |
| --- | --- |
| `users` | 사용자와 권한(ADMIN/VIEWER) |
| `assets` | 자산 |
| `vulnerabilities` | 취약점 원본(NVD·EPSS·KEV) |
| `asset_vulnerabilities` | 자산-취약점 매칭 결과와 조치 상태 |
| `sync_logs` | 수집 이력 |
| `audit_logs` | 감사 로그 |

## 필요한 Databricks 권한

- 로컬 개발(개인 토큰): 대상 카탈로그에 `USE CATALOG`, 스키마에 `USE SCHEMA`·`CREATE TABLE`·`SELECT`·`MODIFY`. 스키마가 없으면 `CREATE SCHEMA` 권한도 필요합니다.
- 운영(앱 서비스 프린시펄): `vuln_portal` 스키마에 `USE SCHEMA`, `SELECT`, `MODIFY` (그리고 최초 1회 테이블 생성을 위해 `CREATE TABLE`).

운영 배포 절차(Databricks CLI 설치, `databricks bundle deploy`, `databricks apps deploy`)는 9단계에서 이 문서에 추가됩니다.
