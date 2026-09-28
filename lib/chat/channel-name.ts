/**
 * Chinese names for the channels a studio starts with — display only; the
 * slugs and stored names stay as they are. A channel already named in
 * Chinese keeps its own name. Plain module: the sidebar (client) and the
 * channel page (server) both call it.
 */
const CHANNEL_ZH: Record<string, string> = { announcements: "公告", general: "大厅", random: "闲聊", production: "制作", research: "研究", "research-daily": "研究日报", team: "团队" };

export function channelName(slug: string, name: string): string {
  if (/[一-鿿]/.test(name)) return name;
  return CHANNEL_ZH[slug] ?? CHANNEL_ZH[name.toLowerCase()] ?? name;
}
