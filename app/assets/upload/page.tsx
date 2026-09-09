import { getCurrentUser } from "@/lib/auth";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

/** 자산 엑셀 업로드 화면 (관리자 전용). */
export default async function AssetUploadPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return (
      <main className="container">
        <h1>자산 엑셀 업로드</h1>
        <div className="alert-error">관리자만 사용할 수 있는 화면입니다.</div>
      </main>
    );
  }
  return (
    <main className="container">
      <h1>자산 엑셀 업로드</h1>
      <p className="muted">
        1행은 헤더, 2행부터 자산을 입력한 .xlsx 파일(10MB 이하)을 올립니다. 먼저 &quot;미리보기&quot;로 오류를 확인한 뒤
        저장하세요. 오류 행이 하나라도 있으면 저장되지 않습니다.
      </p>
      <p>
        {/* 파일 다운로드는 페이지 이동이 아니므로 일반 링크를 사용합니다 */}
        <a href="/api/assets/template" download className="button-link secondary">
          템플릿 다운로드
        </a>
      </p>
      <UploadForm />
    </main>
  );
}
