import type { Metadata } from "next";
import { ClaudeOptions } from "@/components/options/ClaudeOptions";

export const metadata: Metadata = {
  title: "怎么用上 Claude：可选方案 · 腾亚创变",
  /* For the studio and whoever it sends the link to; not for search engines. */
  robots: { index: false, follow: false },
};

/** Every route to Claude for the studio, on one page anyone with the link can open (Ryan, 9 Oct). */
export default function ClaudeOptionsPage() {
  return <ClaudeOptions />;
}
