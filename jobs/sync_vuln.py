# Databricks notebook source
# MAGIC %md
# MAGIC # VulPortal 취약점 수집 노트북
# MAGIC
# MAGIC 매일 06:00 KST 에 Databricks Job 으로 실행됩니다. (앱의 "지금 수동 실행" 버튼으로도 실행)
# MAGIC
# MAGIC 수집 순서: **NVD → EPSS → CISA KEV → 자산 매칭 → 위험도 재계산**
# MAGIC 각 단계 결과는 `sync_logs` 테이블에 남기며, 한 단계가 실패해도 다음 단계는 계속 진행합니다.
# MAGIC
# MAGIC Job 파라미터 (databricks.yml 에서 전달)
# MAGIC | 이름 | 설명 | 기본값 |
# MAGIC | --- | --- | --- |
# MAGIC | catalog | Unity Catalog 카탈로그 | main |
# MAGIC | schema | 스키마 | vuln_portal |
# MAGIC | run_id | Job 실행 ID (`{{job.run_id}}`) | (없음) |
# MAGIC | triggered_by | SCHEDULE 또는 수동 실행한 사용자 이메일 | SCHEDULE |
# MAGIC
# MAGIC 시크릿: NVD API 키는 `vuln-portal/nvd-api-key` 에서 읽습니다. (없어도 동작하지만 느립니다)

# COMMAND ----------

import gzip
import io
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests
from pyspark.sql import Row
from pyspark.sql.types import (
    BooleanType,
    DoubleType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

# ── 고정 설정 (외부 주소는 코드에 고정합니다. 사용자 입력으로 URL 을 만들지 않습니다) ──
NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
EPSS_CSV_URL = "https://epss.empiricalsecurity.com/epss_scores-current.csv.gz"
KEV_JSON_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

HTTP_TIMEOUT_SEC = 30          # 모든 외부 호출 타임아웃
HTTP_RETRIES = 3               # 재시도 횟수
NVD_PAGE_SIZE = 2000           # NVD 한 번에 받는 건수 (최대 2000)
NVD_MAX_WINDOW_DAYS = 120      # NVD 날짜 범위 최대 120일
NVD_INITIAL_YEARS = 2          # 최초 수집 시 최근 2년 공개분만
NVD_OVERLAP_HOURS = 1          # 증분 수집 시 겹치게 받는 시간 (누락 방지)
KEV_BACKFILL_LIMIT = 1500      # KEV 에 있는데 우리 테이블에 없는 CVE 를 NVD 에서 추가로 받는 최대 건수
LOCK_EXPIRE_HOURS = 6          # 이 시간이 지난 RUNNING 기록은 죽은 것으로 보고 무시
USER_AGENT = "VulPortal-sync/1.0"

# COMMAND ----------

# ── 파라미터 읽기 ──
dbutils.widgets.text("catalog", "main")
dbutils.widgets.text("schema", "vuln_portal")
dbutils.widgets.text("run_id", "")
dbutils.widgets.text("triggered_by", "SCHEDULE")

CATALOG = dbutils.widgets.get("catalog").strip()
SCHEMA = dbutils.widgets.get("schema").strip()
RUN_ID = dbutils.widgets.get("run_id").strip() or f"manual-{uuid.uuid4()}"
TRIGGERED_BY = dbutils.widgets.get("triggered_by").strip()[:254] or "SCHEDULE"

# 식별자는 소문자·숫자·밑줄만 허용 (SQL 에 들어가므로 엄격히 검사)
IDENT_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
if not IDENT_RE.match(CATALOG) or not IDENT_RE.match(SCHEMA):
    raise ValueError("catalog/schema 이름은 소문자·숫자·밑줄만 허용됩니다")

spark.sql("USE CATALOG IDENTIFIER(:c)", args={"c": CATALOG})
spark.sql("USE SCHEMA IDENTIFIER(:s)", args={"s": SCHEMA})
print(f"대상: {CATALOG}.{SCHEMA}, run_id={RUN_ID}, triggered_by={TRIGGERED_BY}")

# COMMAND ----------

def now_utc():
    """현재 시각(UTC)을 돌려줍니다."""
    return datetime.now(timezone.utc)


def get_nvd_api_key():
    """Databricks 시크릿에서 NVD API 키를 읽습니다. 없으면 None (로그·출력에 절대 찍지 않음)."""
    try:
        key = dbutils.secrets.get(scope="vuln-portal", key="nvd-api-key")
        return key.strip() or None
    except Exception:
        print("NVD API 키 시크릿이 없어 키 없이 진행합니다 (속도 제한: 30초당 5회)")
        return None


def safe_error_message(err):
    """오류 메시지에서 토큰·키처럼 보이는 문자열을 지우고 500자로 자릅니다."""
    text = f"{type(err).__name__}: {err}"
    text = re.sub(r"apiKey=[^&\s]+", "apiKey=[REDACTED]", text)
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "[UUID]", text, flags=re.I)
    return text[:500]


def http_get(url, params=None, headers=None):
    """GET 요청을 타임아웃 30초·최대 3회 재시도로 보냅니다. 리다이렉트 허용, TLS 검증 유지."""
    merged_headers = {"User-Agent": USER_AGENT}
    if headers:
        merged_headers.update(headers)
    last_error = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            resp = requests.get(url, params=params, headers=merged_headers, timeout=HTTP_TIMEOUT_SEC, allow_redirects=True)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {resp.status_code}")
            resp.raise_for_status()
            return resp
        except Exception as err:  # 네트워크 오류·일시적 서버 오류는 잠시 쉬고 재시도
            last_error = err
            wait = 5 * attempt
            print(f"  요청 실패({attempt}/{HTTP_RETRIES}): {safe_error_message(err)} → {wait}초 후 재시도")
            time.sleep(wait)
    raise RuntimeError(f"외부 요청 실패: {safe_error_message(last_error)}")

# COMMAND ----------

# ── sync_logs 기록 도우미 ──

def log_start(source):
    """수집 단계 시작을 sync_logs 에 RUNNING 으로 기록하고 로그 ID 를 돌려줍니다."""
    log_id = str(uuid.uuid4())
    spark.sql(
        """INSERT INTO sync_logs (id, run_id, source, status, started_at, finished_at, processed_count, error_message, triggered_by)
           VALUES (:id, :run_id, :source, 'RUNNING', current_timestamp(), NULL, NULL, NULL, :by)""",
        args={"id": log_id, "run_id": RUN_ID, "source": source, "by": TRIGGERED_BY},
    )
    return log_id


def log_finish(log_id, status, processed=0, error=None):
    """수집 단계 결과(SUCCESS/FAILED/SKIPPED)를 sync_logs 에 반영합니다."""
    spark.sql(
        """UPDATE sync_logs SET status = :status, finished_at = current_timestamp(),
                  processed_count = :cnt, error_message = :err WHERE id = :id""",
        args={"status": status, "cnt": int(processed), "err": error, "id": log_id},
    )


def run_step(source, func):
    """한 단계를 실행하고 결과를 기록합니다. 실패해도 예외를 밖으로 던지지 않아 다음 단계가 계속됩니다."""
    log_id = log_start(source)
    print(f"[{source}] 시작")
    try:
        count = func()
        if count is None:
            log_finish(log_id, "SKIPPED", 0, None)
            print(f"[{source}] 건너뜀")
            return True
        log_finish(log_id, "SUCCESS", count, None)
        print(f"[{source}] 성공: {count}건")
        return True
    except Exception as err:
        message = safe_error_message(err)
        log_finish(log_id, "FAILED", 0, message)
        print(f"[{source}] 실패: {message}")
        return False


def acquire_lock():
    """다른 수집이 실행 중이면 False. 아니면 이번 실행을 ALL/RUNNING 으로 기록(앱이 미리 만든 QUEUED 행이 있으면 갱신)."""
    cutoff = now_utc() - timedelta(hours=LOCK_EXPIRE_HOURS)
    running = spark.sql(
        """SELECT run_id FROM sync_logs
           WHERE source = 'ALL' AND status = 'RUNNING' AND run_id <> :run_id AND started_at > :cutoff""",
        args={"run_id": RUN_ID, "cutoff": cutoff},
    ).collect()
    if running:
        print(f"다른 수집(run_id={running[0]['run_id']})이 실행 중이라 종료합니다")
        return False
    spark.sql(
        """MERGE INTO sync_logs AS t
           USING (SELECT :run_id AS run_id) AS s
           ON t.run_id = s.run_id AND t.source = 'ALL'
           WHEN MATCHED THEN UPDATE SET status = 'RUNNING', started_at = current_timestamp()
           WHEN NOT MATCHED THEN INSERT (id, run_id, source, status, started_at, finished_at, processed_count, error_message, triggered_by)
             VALUES (:id, :run_id, 'ALL', 'RUNNING', current_timestamp(), NULL, NULL, NULL, :by)""",
        args={"run_id": RUN_ID, "id": str(uuid.uuid4()), "by": TRIGGERED_BY},
    )
    return True


def release_lock(all_ok, processed):
    """전체 실행 결과를 ALL 행에 기록합니다."""
    spark.sql(
        """UPDATE sync_logs SET status = :status, finished_at = current_timestamp(), processed_count = :cnt,
                  error_message = :err
           WHERE run_id = :run_id AND source = 'ALL'""",
        args={
            "status": "SUCCESS" if all_ok else "FAILED",
            "cnt": int(processed),
            "err": None if all_ok else "일부 단계 실패 (각 단계 기록 참고)",
            "run_id": RUN_ID,
        },
    )

# COMMAND ----------

# ── NVD (CVSS 점수·영향 CPE) ──

VULN_SCHEMA = StructType([
    StructField("cve_id", StringType(), False),
    StructField("description", StringType(), True),
    StructField("cvss_score", DoubleType(), True),
    StructField("cvss_vector", StringType(), True),
    StructField("cvss_version", StringType(), True),
    StructField("affected_cpes", StringType(), True),
    StructField("published_at", TimestampType(), True),
    StructField("last_modified_at", TimestampType(), True),
])


def parse_nvd_time(text):
    """NVD 시각 문자열('2024-01-01T00:00:00.000')을 UTC datetime 으로 바꿉니다."""
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "")).replace(tzinfo=timezone.utc)


def format_nvd_time(dt):
    """datetime 을 NVD 파라미터 형식('2024-01-01T00:00:00.000')으로 바꿉니다."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000")


def pick_cvss(metrics):
    """CVSS v3.1 기본점수를 우선, 없으면 v4.0 을 고릅니다. (점수, 벡터, 버전)"""
    for key, version in (("cvssMetricV31", "3.1"), ("cvssMetricV40", "4.0")):
        entries = metrics.get(key) or []
        primary = [m for m in entries if m.get("type") == "Primary"] or entries
        if primary:
            data = primary[0].get("cvssData", {})
            score = data.get("baseScore")
            if score is not None:
                return float(score), data.get("vectorString"), version
    return None, None, None


def extract_affected_cpes(configurations):
    """영향받는 CPE 목록을 뽑습니다. 버전 범위 조건(versionStartIncluding 등)도 함께 저장합니다."""
    result = []
    for config in configurations or []:
        for node in config.get("nodes") or []:
            for match in node.get("cpeMatch") or []:
                if not match.get("vulnerable", False):
                    continue
                item = {"cpe": match.get("criteria")}
                for src, dst in (
                    ("versionStartIncluding", "vsi"),
                    ("versionStartExcluding", "vse"),
                    ("versionEndIncluding", "vei"),
                    ("versionEndExcluding", "vee"),
                ):
                    if match.get(src):
                        item[dst] = match[src]
                result.append(item)
    return result


def parse_nvd_item(item):
    """NVD 응답의 CVE 1건을 우리 테이블 행으로 바꿉니다."""
    cve = item.get("cve", {})
    descriptions = cve.get("descriptions") or []
    english = next((d.get("value") for d in descriptions if d.get("lang") == "en"), None)
    score, vector, version = pick_cvss(cve.get("metrics") or {})
    cpes = extract_affected_cpes(cve.get("configurations"))
    return Row(
        cve_id=cve.get("id"),
        description=(english or "")[:4000] or None,
        cvss_score=score,
        cvss_vector=vector,
        cvss_version=version,
        affected_cpes=json.dumps(cpes, ensure_ascii=False) if cpes else None,
        published_at=parse_nvd_time(cve.get("published")),
        last_modified_at=parse_nvd_time(cve.get("lastModified")),
    )


def fetch_nvd_pages(params, api_key):
    """NVD API 를 페이지 단위로 모두 받아 행 목록으로 돌려줍니다. 속도 제한에 맞춰 잠시 쉬며 호출합니다."""
    headers = {"apiKey": api_key} if api_key else {}
    pause = 0.7 if api_key else 6.5  # 키 있음: 30초당 50회, 없음: 30초당 5회
    rows = []
    start = 0
    while True:
        query = dict(params)
        query.update({"resultsPerPage": NVD_PAGE_SIZE, "startIndex": start})
        resp = http_get(NVD_API_URL, params=query, headers=headers)
        body = resp.json()
        items = body.get("vulnerabilities") or []
        rows.extend(parse_nvd_item(i) for i in items)
        total = int(body.get("totalResults") or 0)
        start += len(items)
        print(f"  NVD {start}/{total}")
        if start >= total or not items:
            break
        time.sleep(pause)
    return rows


def merge_vulnerabilities(rows):
    """받은 CVE 행들을 vulnerabilities 테이블에 MERGE 합니다 (있으면 갱신, 없으면 추가)."""
    if not rows:
        return 0
    df = spark.createDataFrame(rows, VULN_SCHEMA).dropDuplicates(["cve_id"])
    df.createOrReplaceTempView("nvd_batch")
    spark.sql(
        """MERGE INTO vulnerabilities AS t
           USING nvd_batch AS s ON t.cve_id = s.cve_id
           WHEN MATCHED THEN UPDATE SET
             description = s.description, cvss_score = s.cvss_score, cvss_vector = s.cvss_vector,
             cvss_version = s.cvss_version, affected_cpes = s.affected_cpes, published_at = s.published_at,
             last_modified_at = s.last_modified_at, last_synced_at = current_timestamp()
           WHEN NOT MATCHED THEN INSERT
             (cve_id, description, cvss_score, cvss_vector, cvss_version, epss_score, epss_initial, epss_percentile,
              is_kev, kev_date_added, affected_cpes, published_at, last_modified_at, last_synced_at)
             VALUES (s.cve_id, s.description, s.cvss_score, s.cvss_vector, s.cvss_version, NULL, NULL, NULL,
              false, NULL, s.affected_cpes, s.published_at, s.last_modified_at, current_timestamp())"""
    )
    return df.count()


def last_successful_nvd_sync():
    """마지막으로 성공한 NVD 수집의 시작 시각을 돌려줍니다. 없으면 None (최초 수집)."""
    row = spark.sql(
        "SELECT MAX(started_at) AS ts FROM sync_logs WHERE source = 'NVD' AND status = 'SUCCESS'"
    ).collect()[0]
    ts = row["ts"]
    return ts.replace(tzinfo=timezone.utc) if ts and ts.tzinfo is None else ts


def date_windows(start, end):
    """시작~끝 기간을 120일 이하 구간으로 나눕니다 (NVD 제한)."""
    windows = []
    cursor = start
    while cursor < end:
        stop = min(cursor + timedelta(days=NVD_MAX_WINDOW_DAYS), end)
        windows.append((cursor, stop))
        cursor = stop
    return windows


def sync_nvd():
    """NVD 수집: 최초에는 최근 2년 공개분, 이후에는 마지막 성공 시각 이후 변경분만 받습니다."""
    api_key = get_nvd_api_key()
    end = now_utc()
    last = last_successful_nvd_sync()
    total = 0
    if last is None:
        start = end - timedelta(days=365 * NVD_INITIAL_YEARS)
        print(f"  최초 수집: 공개일 {start.date()} ~ {end.date()}")
        for w_start, w_end in date_windows(start, end):
            rows = fetch_nvd_pages({"pubStartDate": format_nvd_time(w_start), "pubEndDate": format_nvd_time(w_end)}, api_key)
            total += merge_vulnerabilities(rows)
    else:
        start = last - timedelta(hours=NVD_OVERLAP_HOURS)
        print(f"  증분 수집: 수정일 {start.isoformat()} 이후")
        for w_start, w_end in date_windows(start, end):
            rows = fetch_nvd_pages({"lastModStartDate": format_nvd_time(w_start), "lastModEndDate": format_nvd_time(w_end)}, api_key)
            total += merge_vulnerabilities(rows)
    return total

# COMMAND ----------

# ── EPSS (악용 가능성 점수) ──

EPSS_SCHEMA = StructType([
    StructField("cve_id", StringType(), False),
    StructField("epss", DoubleType(), True),
    StructField("percentile", DoubleType(), True),
])


def sync_epss():
    """EPSS 전체 CSV(gzip)를 내려받아 우리 테이블에 있는 CVE 의 점수를 갱신합니다. epss_initial 은 최초 1회만 저장."""
    resp = http_get(EPSS_CSV_URL)
    text = gzip.decompress(resp.content).decode("utf-8")
    rows = []
    for line in io.StringIO(text):
        if line.startswith("#") or line.startswith("cve,"):
            continue  # 첫 줄 주석(모델 버전)과 헤더 건너뜀
        parts = line.strip().split(",")
        if len(parts) < 3 or not parts[0].startswith("CVE-"):
            continue
        try:
            rows.append(Row(cve_id=parts[0], epss=float(parts[1]), percentile=float(parts[2])))
        except ValueError:
            continue
    if not rows:
        raise RuntimeError("EPSS CSV 에서 읽은 행이 없습니다")
    df = spark.createDataFrame(rows, EPSS_SCHEMA).dropDuplicates(["cve_id"])
    df.createOrReplaceTempView("epss_batch")
    result = spark.sql(
        """MERGE INTO vulnerabilities AS t
           USING epss_batch AS s ON t.cve_id = s.cve_id
           WHEN MATCHED THEN UPDATE SET
             epss_score = s.epss,
             epss_initial = coalesce(t.epss_initial, s.epss),
             epss_percentile = s.percentile,
             last_synced_at = current_timestamp()"""
    ).collect()
    updated = int(result[0]["num_updated_rows"]) if result and "num_updated_rows" in result[0].asDict() else 0
    print(f"  EPSS 행 {len(rows)}건 중 우리 테이블과 일치 {updated}건")
    return updated

# COMMAND ----------

# ── CISA KEV (실제 악용 확인 목록) ──

KEV_SCHEMA = StructType([
    StructField("cve_id", StringType(), False),
    StructField("date_added", StringType(), True),
])


def sync_kev():
    """CISA KEV JSON 을 내려받아 is_kev/kev_date_added 를 갱신합니다. 우리 테이블에 없는 KEV CVE 는 NVD 에서 추가로 받습니다."""
    resp = http_get(KEV_JSON_URL)
    body = resp.json()
    entries = body.get("vulnerabilities") or []
    rows = [
        Row(cve_id=e.get("cveID"), date_added=e.get("dateAdded"))
        for e in entries
        if e.get("cveID", "").startswith("CVE-")
    ]
    if not rows:
        raise RuntimeError("KEV JSON 에서 읽은 항목이 없습니다")
    df = spark.createDataFrame(rows, KEV_SCHEMA).dropDuplicates(["cve_id"])
    df.createOrReplaceTempView("kev_batch")

    # 1) 우리 테이블에 없는 KEV CVE 를 NVD 에서 받아 채웁니다 (긴급 판정 대상이므로 반드시 필요)
    missing = [r["cve_id"] for r in spark.sql(
        "SELECT k.cve_id FROM kev_batch k LEFT ANTI JOIN vulnerabilities v ON v.cve_id = k.cve_id"
    ).collect()]
    if missing:
        api_key = get_nvd_api_key()
        pause = 0.7 if api_key else 6.5
        print(f"  테이블에 없는 KEV CVE {len(missing)}건 → NVD 에서 최대 {KEV_BACKFILL_LIMIT}건 보충")
        fetched = []
        for cve_id in missing[:KEV_BACKFILL_LIMIT]:
            if not re.match(r"^CVE-\d{4}-\d{4,}$", cve_id):
                continue
            try:
                fetched.extend(fetch_nvd_pages({"cveId": cve_id}, api_key))
            except Exception as err:
                print(f"  {cve_id} 보충 실패: {safe_error_message(err)}")
            time.sleep(pause)
        merge_vulnerabilities(fetched)

    # 2) KEV 등재 표시 갱신
    spark.sql(
        """MERGE INTO vulnerabilities AS t
           USING kev_batch AS s ON t.cve_id = s.cve_id
           WHEN MATCHED THEN UPDATE SET
             is_kev = true, kev_date_added = to_date(s.date_added), last_synced_at = current_timestamp()"""
    )
    # 3) KEV 에서 빠진 CVE 는 표시 해제
    spark.sql(
        """UPDATE vulnerabilities SET is_kev = false, kev_date_added = NULL
           WHERE is_kev = true AND cve_id NOT IN (SELECT cve_id FROM kev_batch)"""
    )
    return len(rows)

# COMMAND ----------

# ── 자산 매칭 · 위험도 재계산 (5단계에서 구현) ──

def match_assets():
    """자산 CPE 와 취약점 영향 CPE 를 비교해 asset_vulnerabilities 를 만듭니다. (5단계에서 구현 예정)"""
    return None  # None 을 돌려주면 SKIPPED 로 기록됩니다


def recalculate_severity():
    """위험도(긴급/우선/주의)와 조치 기한을 다시 계산합니다. (5단계에서 구현 예정)"""
    return None

# COMMAND ----------

# ── 전체 실행 ──

if not acquire_lock():
    dbutils.notebook.exit("SKIPPED: another sync is running")

results = []
try:
    results.append(run_step("NVD", sync_nvd))
    results.append(run_step("EPSS", sync_epss))
    results.append(run_step("KEV", sync_kev))
    results.append(run_step("MATCH", match_assets))
    results.append(run_step("SEVERITY", recalculate_severity))
finally:
    total_processed = spark.sql(
        "SELECT COUNT(*) AS c FROM vulnerabilities"
    ).collect()[0]["c"]
    release_lock(all(results) if results else False, total_processed)

print("완료:", "모든 단계 성공" if all(results) else "일부 단계 실패 (sync_logs 확인)")
