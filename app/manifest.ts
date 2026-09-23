import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "腾亚创变 工作台",
    short_name: "腾亚创变",
    description: "选题研究、剧本、剪辑、发布，一个助理全程跟进。",
    start_url: "/chat",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    lang: "zh-CN",
    icons: [
      { src: "/icon", sizes: "64x64", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
