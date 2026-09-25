import Link from "next/link";

/**
 * "查看全部 >": the way out of a Home panel to the page it summarises.
 *
 * *"For each module of home page, add a button to enter detail page."* Sits
 * in a `Fold`'s right-hand slot, outside the fold toggle, so it is a link
 * beside a button rather than one inside another. Quiet on purpose — grey
 * until pointed at — because Home has seven of them and the panels are the
 * point, not the exits.
 *
 * `prefetch={false}`: every target is a full module page, and prefetching
 * seven of them on every Home render is the load this studio's box cannot
 * spare. The caller decides whether to draw it at all — only when the viewer
 * holds the module the target needs, since `requireModule` would bounce them
 * straight back to `/`.
 *
 * The hover styles are `DETAIL_LINK_CSS`, drawn once by the screen that uses
 * these, so seven links do not each carry a <style>.
 */
export function DetailLink({ href, zh, label, labelEn }: { href: string; zh: boolean; label?: string; labelEn?: string }) {
  return (
    <Link href={href} prefetch={false} className="home-detail">
      {zh ? (label ?? "查看全部") : (labelEn ?? "View all")}
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
      </svg>
    </Link>
  );
}

export const DETAIL_LINK_CSS = `
.home-detail { display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 6px 0 8px; border-radius: 7px; font-size: 12px; font-weight: 500; color: #8a8a8a; text-decoration: none; white-space: nowrap; flex-shrink: 0; transition: color .15s ease, background-color .15s ease; }
.home-detail:hover { color: #171717; background: #f4f4f2; }
.home-detail:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
`;
