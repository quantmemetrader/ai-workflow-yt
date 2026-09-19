import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Agent Platform",
  description: "Internal work platform for Aura Farmers, Inc. — build in progress.",
};

/** `lang` matches DEFAULT_LOCALE in lib/i18n.ts. It was zh-Hant-HK while every
 * string shipped is Simplified, which hands a screen reader the wrong
 * pronunciation and the browser the wrong font stack. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans-CN">
      <body>{children}</body>
    </html>
  );
}
