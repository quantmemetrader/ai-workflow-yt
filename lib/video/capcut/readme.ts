/**
 * 使用说明.txt, at the top of the zip.
 *
 * Plain text with Windows line endings, because Notepad is what opens it on
 * half the studio's machines; Chinese first, English under it. It says where
 * the folder goes, what to do when the app does not list it, and exactly
 * what did not come across, so nobody spends an afternoon looking for a
 * punch-in that was never exported.
 */
export function readme(input: { app: "jianying" | "capcut"; title: string; folderName: string; notes: string[]; languages: string[] }): string {
  const jianying = [
    "     剪映 Mac：     ~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
    "     剪映 Windows： %LOCALAPPDATA%\\JianyingPro\\User Data\\Projects\\com.lveditor.draft",
  ];
  const capcut = [
    "     CapCut Mac：   ~/Movies/CapCut/User Data/Projects/com.lveditor.draft",
    "     CapCut Windows：%LOCALAPPDATA%\\CapCut\\User Data\\Projects\\com.lveditor.draft",
  ];
  const appName = input.app === "capcut" ? "CapCut" : "剪映专业版";
  const lines = [
    `《${input.title}》${appName} 草稿`,
    "",
    "压缩包里有：",
    `  ${input.folderName}/      剪映草稿文件夹（素材在里面的 materials 文件夹）`,
    "  备用文件/                 字幕 SRT（每种语言一个）和 时间线.fcpxml",
    "",
    "一、用剪映 / CapCut 打开（推荐）",
    "  1. 先完全退出剪映 / CapCut。",
    `  2. 把「${input.folderName}」整个文件夹移到草稿目录：`,
    ...(input.app === "capcut" ? capcut : jianying),
    "     （改过草稿位置的，以剪映「设置 > 草稿位置」里显示的为准。Mac 上在访达里按 Command+Shift+G 粘贴路径即可前往。）",
    "  3. 打开剪映，草稿列表里就有这条视频，点开即可继续剪。",
    "  4. 如果素材显示丢失：点「重新链接」，选草稿文件夹里的 materials 文件夹，一次即可全部找回。",
    "",
    `  这份草稿是按${appName}的格式写的；${input.app === "capcut" ? "用剪映打开请在腾亚里选「剪映专业版」重新导出" : "用 CapCut 打开请在腾亚里选「CapCut」重新导出"}。`,
    "",
    "二、如果草稿列表里没有出现",
    "  1. 先彻底退出再重新打开一次，或者随便进入另一个草稿再退出，列表会重新读取草稿目录。",
    "  2. 仍然没有：较新版本的剪映 / CapCut 会加密自己的草稿，个别版本不显示从外部放入的草稿。这时请用备用方式：",
    "     · 新建项目，导入 materials 文件夹里的素材，按文件名顺序放上时间线。",
    "     · 字幕：「文本 > 本地字幕 > 导入」，选「备用文件」里的 SRT。",
    "     · 时间线.fcpxml 可以在 DaVinci Resolve、Final Cut Pro 中打开，剪辑点和顺序都在（剪映和 CapCut 都不支持导入 XML）。",
    "",
    "三、导出时的说明",
    ...(input.notes.length ? input.notes.map((n) => `  · ${n}`) : ["  · 全部内容都已导出。"]),
    ...(input.languages.length ? [`  · 字幕语言：${input.languages.join("、")}。`] : []),
    "",
    "----",
    "English",
    `${input.app === "capcut" ? "CapCut" : "JianYing Pro"} draft of "${input.title}".`,
    `Quit the app, move the folder "${input.folderName}" into the drafts folder above, and open the app: the draft is in the list.`,
    "If it is not listed, quit and reopen the app, or open and close any other draft so it rereads the folder.",
    "If clips show as missing, choose Relink and point it at the materials folder once.",
    "If the app does not list the draft (newer builds encrypt their own drafts and may ignore outside ones), import the media",
    "from materials, then the SRT under 备用文件 via Text > Local captions. 时间线.fcpxml opens in DaVinci Resolve and Final Cut Pro.",
    "",
  ];
  return lines.join("\r\n");
}
