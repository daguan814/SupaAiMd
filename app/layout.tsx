import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "墨序 · AI 笔记",
  description: "把想法写下来，让思路清晰起来。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
