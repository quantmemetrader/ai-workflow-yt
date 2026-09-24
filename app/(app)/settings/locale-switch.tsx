"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { setLocaleAction } from "./actions";

/** zh-CN is the default, English is a toggle (spec §4.1). The choice is stored
 * on the person, not in the browser, so it follows them to another machine. */
export function LocaleSwitch({ current }: { current: Locale }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const zh = current.startsWith("zh");

  return (
    <section className="rounded-xl border border-outline-gray-1 p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink-gray-9">{zh ? "语言" : "Language"}</h2>
      <div className="flex gap-2">
        {/* Simplified and English. zh-HK survives in the `locale` enum
            because old rows still hold it, but the studio publishes in
            Simplified only and it is no longer something to pick. */}
        {(
          [
            ["zh-CN", "简体中文"],
            ["en", "English"],
          ] as [Locale, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            disabled={pending}
            onClick={() =>
              start(async () => {
                await setLocaleAction(value);
                router.refresh();
              })
            }
            className={`h-8 rounded-lg border px-3 text-xs font-medium ${
              current === value
                ? "border-outline-gray-5 bg-surface-gray-7 text-white"
                : "border-outline-gray-2 text-ink-gray-7 hover:bg-surface-gray-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
