"use client";

import * as React from "react";

/**
 * The first draft, step by step, with a running clock (Rahul, 4 Oct: "show all
 * the steps happening on site or anyone will feel it's dead"). Polls the
 * project's draft state every two seconds while it is writing.
 */
const STEPS: { key: string; zh: string; en: string }[] = [
  { key: "queued", zh: "排队", en: "Queued" },
  { key: "draft", zh: "写初稿", en: "Writing" },
  { key: "extend", zh: "补足时长", en: "Lengthening" },
  { key: "polish", zh: "润色", en: "Polishing" },
];

export function DraftProgress({ projectId, zh }: { projectId: string; zh: boolean }) {
  const [state, setState] = React.useState<{ stage: string | null; since: string | null }>({ stage: null, since: null });
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    let alive = true;
    const pull = async () => {
      const r = await fetch(`/api/projects/${projectId}/draft`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (alive && j) setState({ stage: j.stage, since: j.since });
    };
    void pull();
    const a = window.setInterval(pull, 2000);
    const b = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(b); };
  }, [projectId]);
  const current = Math.max(0, STEPS.findIndex((s) => s.key === (state.stage ?? "draft")));
  const secs = state.since ? Math.max(0, Math.round((now - Date.parse(state.since)) / 1000)) : 0;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className="gd-status" data-tone="run" role="status" aria-live="polite">
      <span className="gd-status-dot" />
      <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexGrow: 1, minWidth: 200 }}>
        <span>{zh ? "文案正在写初稿" : "The writer is drafting"}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {STEPS.map((s, i) => (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, padding: "1px 8px", borderRadius: 99, border: "1px solid", borderColor: i < current ? "#cdeed9" : i === current ? "#1a73e8" : "#e2e2e2", color: i < current ? "#278f5e" : i === current ? "#1a73e8" : "#999999", fontWeight: i === current ? 600 : 400 }}>
                {i < current ? "✓ " : ""}{zh ? s.zh : s.en}
              </span>
              {i < STEPS.length - 1 ? <span style={{ color: "#c7c7c7", fontSize: 11 }}>›</span> : null}
            </span>
          ))}
        </span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: "#5f6368", fontSize: 12.5 }}>{clock}</span>
      </span>
    </div>
  );
}
