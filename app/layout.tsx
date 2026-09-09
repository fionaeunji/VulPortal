import type { Metadata } from "next";
import { headers } from "next/headers";
import Nav from "@/app/components/Nav";
import { getCurrentUser } from "@/lib/auth";
import { CSRF_HEADER } from "@/lib/csrf";
import "./globals.css";

export const metadata: Metadata = {
  title: "VulPortal - IT 자산 취약점 관리",
  description: "사내 IT 자산 취약점 관리 포털",
};

// 사용자 정보는 요청마다 다르므로 정적 생성을 끕니다.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const csrfToken = h.get(CSRF_HEADER) ?? "";
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    // DB 오류 시에도 화면은 뜨게 두고, 각 페이지에서 상태를 안내합니다.
  }
  return (
    <html lang="ko">
      <head>
        <meta name="csrf-token" content={csrfToken} />
      </head>
      <body>
        <Nav user={user} />
        {children}
      </body>
    </html>
  );
}
