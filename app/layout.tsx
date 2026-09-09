import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Agent Platform",
  description: "Internal work platform for Aura Farmers, Inc. — build in progress.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-HK">
      <body>{children}</body>
    </html>
  );
}
