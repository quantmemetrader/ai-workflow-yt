import type { Plan, PlanCut } from "@/lib/video/capcut/plan";

/**
 * The same cut as FCPXML 1.9, beside the draft.
 *
 * Neither 剪映 nor CapCut imports it; it is here for whoever opens the edit
 * in DaVinci Resolve or Final Cut Pro instead, which both read it with the
 * trims, the order, the cutaways (lane 1) and the sound (lane −1) intact.
 * Captions are left to the SRT files next to it, which every editor imports.
 *
 * Media are named relative to the zip's top folder (`<draft>/materials/…`);
 * Resolve and Final Cut ask to relink a relative path, and pointing them at
 * that folder once finds every clip.
 */
export function toFcpxml(input: { title: string; width: number; height: number; plan: Plan; folderName: string }): string {
  const { plan } = input;
  const f = (ms: number) => `${Math.round((Math.max(0, ms) * 30) / 1000)}/30s`;
  const assetId = new Map<string, string>();
  const resources: string[] = [`    <format id="r0" name="tengya-${input.width}x${input.height}" frameDuration="1/30s" width="${input.width}" height="${input.height}"/>`];
  plan.media.forEach((m, i) => {
    const id = `r${i + 1}`;
    assetId.set(m.key, id);
    const src = `../${encodeURI(input.folderName)}/${m.rel}`;
    const video = m.type === "video";
    const duration = m.kind === "photo" ? 0 : m.durationMs;
    resources.push(
      `    <asset id="${id}" name="${esc(m.name)}" start="0s" duration="${m.kind === "photo" ? "0s" : f(duration)}" hasVideo="${video ? 1 : 0}" hasAudio="${m.kind === "photo" ? 0 : 1}"${video ? ` format="r0"` : ""} audioSources="1" audioChannels="2">\n      <media-rep kind="original-media" src="${esc(src)}"/>\n    </asset>`,
    );
  });

  /** A cut or a cutaway that lives under a spine item, at the parent's own clock. */
  const connected = (c: PlanCut, lane: number, parent: { offset: number; start: number }) => {
    const ref = assetId.get(c.media);
    if (!ref) return "";
    const offset = parent.start + (c.startMs - parent.offset);
    return `          <asset-clip ref="${ref}" lane="${lane}" offset="${f(offset)}" start="${f(c.sourceInMs)}" duration="${f(c.lengthMs)}" name="${esc(nameOf(plan, c.media))}"/>`;
  };

  const spine = plan.cuts.map((c) => {
    const children = [...plan.overlays.map((o) => ({ o, lane: 1 })), ...plan.audio.map((o) => ({ o, lane: -1 }))]
      .filter(({ o }) => o.startMs >= c.startMs && o.startMs < c.startMs + c.lengthMs)
      .map(({ o, lane }) => connected(o, lane, { offset: c.startMs, start: c.title !== undefined ? 0 : c.sourceInMs }))
      .filter(Boolean);
    if (c.title !== undefined) {
      const body = children.length ? `\n${children.join("\n")}\n        ` : "";
      return `        <gap name="${esc(c.title || "Title")}" offset="${f(c.startMs)}" start="0s" duration="${f(c.lengthMs)}">${body}</gap>`;
    }
    const ref = assetId.get(c.media);
    const body = children.length ? `\n${children.join("\n")}\n        ` : "";
    return `        <asset-clip ref="${ref}" offset="${f(c.startMs)}" start="${f(c.sourceInMs)}" duration="${f(c.lengthMs)}" name="${esc(nameOf(plan, c.media))}">${body}</asset-clip>`;
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.9">`,
    `  <resources>`,
    ...resources,
    `  </resources>`,
    `  <library>`,
    `    <event name="${esc(input.title)}">`,
    `      <project name="${esc(input.title)}">`,
    `        <sequence format="r0" duration="${f(plan.durationMs)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `      <spine>`,
    ...spine,
    `      </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    ``,
  ].join("\n");
}

function nameOf(plan: Plan, key: string): string {
  return plan.media.find((m) => m.key === key)?.name ?? key;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
