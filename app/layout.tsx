import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * What the site says about itself to a browser tab, a bookmark, a shared
 * link and a home-screen icon.
 *
 * Internal tool, so search engines are told to stay out; the Open Graph card
 * still matters, because a link to a cut or a script gets pasted into chats
 * all day and should unfurl as the studio rather than as a bare URL.
 */
const SITE = process.env.APP_URL?.startsWith("http") ? process.env.APP_URL : "https://yt.okbro.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  applicationName: "腾亚创变 工作台",
  title: {
    default: "腾亚创变 工作台",
    template: "%s · 腾亚创变",
  },
  description:
    "选题研究、脚本、剪辑、发布，一个助理全程跟进。",
  keywords: ["video", "editing", "script", "research", "YouTube", "剪辑", "脚本", "选题"],
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    type: "website",
    siteName: "腾亚创变 工作台",
    title: "腾亚创变 工作台",
    description: "选题研究、脚本、剪辑、发布，一个助理全程跟进。",
    locale: "zh_CN",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "腾亚创变 工作台",
    description: "选题研究、脚本、剪辑、发布，一个助理全程跟进。",
  },
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#171717",
  width: "device-width",
  initialScale: 1,
};

/** `lang` matches DEFAULT_LOCALE in lib/i18n.ts. It was zh-Hant-HK while every
 * string shipped is Simplified, which hands a screen reader the wrong
 * pronunciation and the browser the wrong font stack. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans-CN">
      <body>
        {children}
        {/* Desktop only until the next release: the editor, timeline and
            tables are not built for a phone, and half-working is worse than
            a clear "not yet". CSS alone, so it is there before any script. */}
        <div className="desktop-only-gate" role="alertdialog" aria-label="请使用电脑访问 · Please use a desktop">
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>请使用电脑访问</div>
            <p style={{ margin: "0 0 18px", color: "#7c7c7c", lineHeight: 1.6 }}>
              手机版将在下一个版本推出。请在电脑浏览器中打开本站。
            </p>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Please use a desktop</div>
            <p style={{ margin: 0, color: "#7c7c7c", lineHeight: 1.6 }}>
              The mobile version is coming in the next release. Open this site in a browser on your computer.
            </p>
          </div>
        </div>
        <style>{`
          .desktop-only-gate { display: none; }
          @media (max-width: 820px) {
            .desktop-only-gate {
              display: flex; position: fixed; inset: 0; z-index: 2147483647;
              align-items: center; justify-content: center; text-align: center;
              padding: 24px 16px; background: #fff; color: #171717;
              font-size: 14px;
            }
            body { overflow: hidden; }
          }
        `}</style>
      </body>
    </html>
  );
}
