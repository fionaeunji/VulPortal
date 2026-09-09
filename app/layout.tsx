import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VulPortal - IT 자산 취약점 관리",
  description: "사내 IT 자산 취약점 관리 포털",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
