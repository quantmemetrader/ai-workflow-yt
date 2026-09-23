/**
 * Where an article can go.
 *
 * Its own file, with no `server-only` on it, because the editor needs this
 * list in the browser and `lib/article/service.ts` needs it on the server.
 *
 * `kind` is stored as text rather than an enum: the studio publishes to places
 * that have no API and no account in this product — a 公众号, a newsletter, a
 * client's own site — and a closed list would make the honest cases
 * unrecordable. This is the set the screen offers, not the set the database
 * accepts.
 */
export type Destination = { kind: string; label: string; labelZh: string };

export const DESTINATIONS: Destination[] = [
  { kind: "wechat", label: "WeChat", labelZh: "微信公众号" },
  { kind: "website", label: "Website", labelZh: "官网" },
  { kind: "newsletter", label: "Newsletter", labelZh: "邮件通讯" },
  { kind: "linkedin", label: "LinkedIn", labelZh: "领英" },
  { kind: "xiaohongshu", label: "Xiaohongshu", labelZh: "小红书" },
  { kind: "media", label: "A publication", labelZh: "媒体投稿" },
  { kind: "other", label: "Somewhere else", labelZh: "其他" },
];

export const destinationLabel = (kind: string, zh: boolean): string => {
  const found = DESTINATIONS.find((d) => d.kind === kind);
  return found ? (zh ? found.labelZh : found.label) : kind;
};
