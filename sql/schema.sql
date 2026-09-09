-- ============================================================================
-- VulPortal 테이블 정의 (Databricks Unity Catalog / Delta 테이블)
--
-- * 앱 시작 시 lib/db.ts 가 이 파일을 읽어 문장 단위로 실행합니다.
-- * 모든 문장은 CREATE TABLE IF NOT EXISTS 이므로 여러 번 실행해도 안전합니다.
-- * 카탈로그/스키마는 앱이 세션에 지정하므로(DATABRICKS_CATALOG / DATABRICKS_SCHEMA)
--   여기서는 테이블 이름만 적습니다.
-- * 문장 구분은 세미콜론(;) 입니다. 한 줄 주석은 -- 로 시작합니다.
-- ============================================================================

-- 사용자 (권한: ADMIN=관리자, VIEWER=조회자)
CREATE TABLE IF NOT EXISTS users (
  email        STRING    NOT NULL COMMENT '로그인 이메일 (Databricks Apps 헤더 X-Forwarded-Email)',
  display_name STRING             COMMENT '표시 이름',
  role         STRING    NOT NULL COMMENT 'ADMIN 또는 VIEWER',
  is_active    BOOLEAN   NOT NULL COMMENT '비활성 사용자는 조회자 권한으로 취급',
  created_at   TIMESTAMP NOT NULL,
  updated_at   TIMESTAMP NOT NULL,
  created_by   STRING             COMMENT '등록한 관리자 이메일'
) USING DELTA
COMMENT '포털 사용자 및 권한';

-- 자산
CREATE TABLE IF NOT EXISTS assets (
  id           STRING    NOT NULL COMMENT 'UUID',
  asset_type   STRING    NOT NULL COMMENT '서버, NW장비, 보안시스템, 스토리지, 클라우드자산, 기타',
  asset_name   STRING    NOT NULL COMMENT '자산명(호스트명 등). 추가/갱신 시 기준 키',
  vendor       STRING             COMMENT '제조사',
  product_name STRING             COMMENT '제품명',
  version      STRING             COMMENT '버전',
  cpe          STRING             COMMENT 'CPE 2.3 문자열. 없으면 vendor/product/version 으로 자동 생성',
  cpe_source   STRING             COMMENT 'INPUT(입력값) 또는 GENERATED(자동 생성)',
  exposure     STRING    NOT NULL COMMENT 'EXTERNAL(경계면) 또는 INTERNAL(내부)',
  owner        STRING             COMMENT '담당자',
  department   STRING             COMMENT '담당부서',
  ip_address   STRING             COMMENT 'IP 주소(선택)',
  created_at   TIMESTAMP NOT NULL,
  updated_at   TIMESTAMP NOT NULL
) USING DELTA
COMMENT 'IT 자산 목록 (엑셀 업로드로 등록)';

-- 취약점 원본 (NVD / EPSS / CISA KEV 를 합친 결과)
CREATE TABLE IF NOT EXISTS vulnerabilities (
  cve_id          STRING    NOT NULL COMMENT 'CVE 번호 (기본키)',
  description     STRING             COMMENT '영문 설명',
  cvss_score      DOUBLE             COMMENT 'CVSS v3.1 기본점수. 없으면 v4.0',
  cvss_vector     STRING             COMMENT 'CVSS 벡터 문자열',
  cvss_version    STRING             COMMENT '3.1 또는 4.0',
  epss_score      DOUBLE             COMMENT '최신 EPSS 점수 (0~1)',
  epss_initial    DOUBLE             COMMENT '최초 수집 시 EPSS 점수. 이후 갱신하지 않음 (위험도 판정 기준)',
  epss_percentile DOUBLE             COMMENT 'EPSS 백분위 (0~1)',
  is_kev          BOOLEAN   NOT NULL COMMENT 'CISA KEV 등재 여부',
  kev_date_added  DATE               COMMENT 'KEV 등재일',
  affected_cpes   STRING             COMMENT '영향받는 CPE 목록 (JSON 배열 문자열)',
  published_at    TIMESTAMP          COMMENT 'CVE 공개일',
  last_modified_at TIMESTAMP         COMMENT 'NVD 마지막 수정일',
  last_synced_at  TIMESTAMP NOT NULL COMMENT '마지막 동기화 시각'
) USING DELTA
COMMENT '외부 공개 데이터에서 수집한 취약점 원본';

-- 자산-취약점 매칭 결과
CREATE TABLE IF NOT EXISTS asset_vulnerabilities (
  id            STRING    NOT NULL COMMENT 'UUID',
  asset_id      STRING    NOT NULL COMMENT 'assets.id',
  cve_id        STRING    NOT NULL COMMENT 'vulnerabilities.cve_id',
  severity      STRING    NOT NULL COMMENT 'EMERGENCY(긴급) / PRIORITY(우선) / CAUTION(주의)',
  match_method  STRING    NOT NULL COMMENT 'CPE(정확) 또는 FUZZY(문자열 유사, 정확도 낮음)',
  detected_at   TIMESTAMP NOT NULL COMMENT '최초 탐지일',
  due_date      TIMESTAMP NOT NULL COMMENT '조치 기한',
  status        STRING    NOT NULL COMMENT 'OPEN / IN_PROGRESS / DONE / RISK_ACCEPTED / NOT_APPLICABLE',
  completed_at  TIMESTAMP          COMMENT '조치 완료일',
  note          STRING             COMMENT '비고',
  updated_by    STRING             COMMENT '마지막으로 상태를 바꾼 사용자 이메일',
  created_at    TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP NOT NULL
) USING DELTA
COMMENT '자산과 취약점 매칭 결과 및 조치 상태';

-- 수집 이력
CREATE TABLE IF NOT EXISTS sync_logs (
  id            STRING    NOT NULL COMMENT 'UUID',
  run_id        STRING             COMMENT 'Databricks Job 실행 ID (수동/자동 구분용)',
  source        STRING    NOT NULL COMMENT 'NVD / EPSS / KEV / MATCH / SEVERITY / ALL',
  status        STRING    NOT NULL COMMENT 'RUNNING / SUCCESS / FAILED',
  started_at    TIMESTAMP NOT NULL,
  finished_at   TIMESTAMP,
  processed_count BIGINT           COMMENT '처리 건수',
  error_message STRING             COMMENT '오류 메시지 (비밀 정보 제외)',
  triggered_by  STRING             COMMENT '수동 실행 시 사용자 이메일, 자동이면 SCHEDULE'
) USING DELTA
COMMENT '취약점 수집 작업 이력';

-- 감사 로그 (누가 · 언제 · 무엇을)
CREATE TABLE IF NOT EXISTS audit_logs (
  id          STRING    NOT NULL COMMENT 'UUID',
  occurred_at TIMESTAMP NOT NULL,
  actor_email STRING    NOT NULL COMMENT '행위자 이메일',
  action      STRING    NOT NULL COMMENT 'LOGIN_SUCCESS / LOGIN_DENIED / ASSET_DELETE / ASSET_REPLACE_ALL / STATUS_CHANGE / SYNC_RUN / USER_CHANGE 등',
  target_type STRING             COMMENT 'ASSET / ASSET_VULNERABILITY / USER / SYNC',
  target_id   STRING             COMMENT '대상 식별자',
  detail      STRING             COMMENT '추가 정보 (JSON 문자열, 비밀 정보 제외)',
  ip_address  STRING             COMMENT '요청 IP'
) USING DELTA
COMMENT '중요 이벤트 감사 로그';
