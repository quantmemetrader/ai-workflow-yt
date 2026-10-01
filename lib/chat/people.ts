/**
 * Names that tell two people apart (QA, 2 Oct: two colleagues called 「Ryan」
 * sat side by side in the list with nothing between them). A name only one
 * person has is left alone; a shared one gets their title, or the part of
 * their sign-in address before the @ when titles do not separate them.
 * Plain module: the chat's server pages call it.
 */
export function distinctNames(people: { id: string; name: string; email?: string | null; title?: string | null }[]): Map<string, string> {
  const byName = new Map<string, typeof people>();
  for (const p of people) {
    const k = p.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const out = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const titles = group.map((p) => (p.title ?? "").trim());
    const titlesSeparate = titles.every(Boolean) && new Set(titles).size === titles.length;
    for (const p of group) {
      const handle = (p.email ?? "").split("@")[0] || p.id.slice(-4);
      out.set(p.id, `${p.name}（${titlesSeparate ? (p.title ?? "").trim() : handle}）`);
    }
  }
  return out;
}
