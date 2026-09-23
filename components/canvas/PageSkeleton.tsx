/**
 * Shown by each route's loading.tsx while its server component streams.
 *
 * Without this, App Router keeps the previous page on screen until the new
 * one is ready, so a click reads as "nothing happened" — the studio said the
 * sidebar felt unresponsive. A shell that appears instantly answers the click
 * even when the data behind it takes a moment.
 */
export default function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div data-page-skeleton aria-busy="true" aria-live="polite" style={{ padding: "22px 26px" }}>
      <div className="sk sk-title" />
      <div className="sk sk-sub" />
      <div style={{ marginTop: 22, display: "grid", gap: 10 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="sk sk-row" style={{ width: `${92 - (i % 3) * 14}%` }} />
        ))}
      </div>
    </div>
  );
}
