import type { Metadata } from "next";
import { Examples } from "@/components/exm/Examples";

export const metadata: Metadata = {
  title: "自动生成的样片 · 腾亚创变",
  /* For the studio and whoever it sends the link to; not for search engines. */
  robots: { index: false, follow: false },
};

/** What the automated pipeline has made so far, on one page anyone with the link can open (10 Oct). */
export default function ExamplesPage() {
  return <Examples />;
}
