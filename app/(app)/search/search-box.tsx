"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** The search field. Submits on Enter rather than on every keystroke: each
 * query is a database read and an audit entry, and neither should happen
 * because someone is still typing. */
export function SearchBox({ initial, placeholder }: { initial: string; placeholder: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(initial.length, initial.length);
  }, [initial.length]);

  return (
    <form
      style={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 9 }}
      onSubmit={(e) => {
        e.preventDefault();
        router.push(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : "/search");
      }}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: 15, height: 15, stroke: "#999999", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" }}
      >
        <circle cx="11" cy="11" r="6.4" />
        <path d="m15.8 15.8 4 4" />
      </svg>
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        style={{
          flexGrow: 1,
          border: 0,
          outline: "none",
          background: "transparent",
          fontSize: 14,
          fontFamily: "inherit",
          letterSpacing: "inherit",
          color: "#171717",
        }}
      />
    </form>
  );
}
