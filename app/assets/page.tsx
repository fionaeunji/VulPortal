import Link from "next/link";
import { ASSET_TYPES, EXPOSURES, exposureLabel } from "@/lib/asset-rules";
import { listAssets, listQuerySchema, type AssetRecord } from "@/lib/assets";
import { getCurrentUser } from "@/lib/auth";
import AssetTable from "./AssetTable";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 자산 관리 목록 화면: 검색·필터·페이지. 수정/삭제는 관리자만 (서버 API 가 재검사). */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const raw = {
    q: firstValue(sp.q),
    assetType: firstValue(sp.assetType) || undefined,
    exposure: firstValue(sp.exposure) || undefined,
    page: firstValue(sp.page),
    sort: firstValue(sp.sort),
    order: firstValue(sp.order),
  };
  const parsed = listQuerySchema.safeParse(raw);
  const q = parsed.success ? parsed.data : listQuerySchema.parse({});

  const user = await getCurrentUser();
  const isAdmin = user?.role === "ADMIN";

  let items: AssetRecord[] = [];
  let total = 0;
  let loadError = false;
  try {
    const result = await listAssets(q);
    items = result.items;
    total = result.total;
  } catch {
    loadError = true;
  }
  const pageCount = Math.max(1, Math.ceil(total / q.pageSize));

  const linkFor = (page: number) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.assetType) p.set("assetType", q.assetType);
    if (q.exposure) p.set("exposure", q.exposure);
    p.set("sort", q.sort);
    p.set("order", q.order);
    p.set("page", String(page));
    return `/assets?${p.toString()}`;
  };

  return (
    <main className="container">
      <div className="page-head">
        <h1>자산 관리</h1>
        <div className="actions">
          {/* 파일 다운로드는 페이지 이동이 아니므로 일반 링크를 사용합니다 */}
          <a href="/api/assets/template" download className="button-link secondary">
            템플릿 다운로드
          </a>
          {isAdmin ? (
            <Link href="/assets/upload" className="button-link">
              엑셀 업로드
            </Link>
          ) : null}
        </div>
      </div>

      <form className="form-row card" method="get" action="/assets">
        <label>
          검색 (자산명·제조사·제품명·담당자·IP)
          <input type="text" name="q" maxLength={100} defaultValue={q.q ?? ""} />
        </label>
        <label>
          자산유형
          <select name="assetType" defaultValue={q.assetType ?? ""}>
            <option value="">전체</option>
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          노출구분
          <select name="exposure" defaultValue={q.exposure ?? ""}>
            <option value="">전체</option>
            {EXPOSURES.map((e) => (
              <option key={e} value={e}>
                {exposureLabel(e)}
              </option>
            ))}
          </select>
        </label>
        <label>
          정렬
          <select name="sort" defaultValue={q.sort}>
            <option value="assetName">자산명</option>
            <option value="assetType">자산유형</option>
            <option value="exposure">노출구분</option>
            <option value="vendor">제조사</option>
            <option value="department">담당부서</option>
            <option value="updatedAt">수정일</option>
          </select>
        </label>
        <label>
          순서
          <select name="order" defaultValue={q.order}>
            <option value="asc">오름차순</option>
            <option value="desc">내림차순</option>
          </select>
        </label>
        <button type="submit">조회</button>
      </form>

      {loadError ? <div className="alert-error">자산 목록을 불러오지 못했습니다. DB 연결을 확인하세요.</div> : null}

      <p className="muted">
        총 {total.toLocaleString()}건 · {q.page}/{pageCount} 페이지
      </p>
      <AssetTable items={items} isAdmin={isAdmin} />

      <div className="pager">
        {q.page > 1 ? <Link href={linkFor(q.page - 1)}>← 이전</Link> : <span className="muted">← 이전</span>}
        <span>
          {q.page} / {pageCount}
        </span>
        {q.page < pageCount ? <Link href={linkFor(q.page + 1)}>다음 →</Link> : <span className="muted">다음 →</span>}
      </div>
    </main>
  );
}
