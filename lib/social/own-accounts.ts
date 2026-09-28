/**
 * The studio's own accounts on the Chinese platforms, for the 复盘 (review)
 * page's account numbers and the 发布 page's "post it here" list. Given by
 * the client on 28 Sep 2026. None of these platforms has a posting API we
 * can use, so posting there is by hand; the numbers come from TikHub.
 */
export type OwnAccount = {
  platform: "wechat_channels" | "xiaohongshu" | "douyin" | "bilibili";
  zh: string;
  en: string;
  name: string;
  id: string;
  url: string | null;
  /** Where to post by hand (the creator console). */
  studio: string;
};

export const OWN_ACCOUNTS: OwnAccount[] = [
  { platform: "douyin", zh: "抖音", en: "Douyin", name: "谢亚芳-创变派", id: "70962597235", url: "https://v.douyin.com/dCkSfvJOVQk/", studio: "https://creator.douyin.com/" },
  { platform: "xiaohongshu", zh: "小红书", en: "Xiaohongshu", name: "谢亚芳-创变派", id: "95833661636", url: "https://xhslink.cn/m/OPoFsUl39A", studio: "https://creator.xiaohongshu.com/" },
  { platform: "wechat_channels", zh: "微信视频号", en: "WeChat Channels", name: "谢亚芳-创变派", id: "sphmIJVOnl0qc12", url: null, studio: "https://channels.weixin.qq.com/" },
  { platform: "bilibili", zh: "B站", en: "Bilibili", name: "腾亚创变", id: "527018212", url: "https://b23.tv/UkATd23", studio: "https://member.bilibili.com/platform/upload/video/frame" },
];
