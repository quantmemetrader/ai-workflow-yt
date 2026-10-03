/**
 * 使用指南 / User guide, served at /userguide for anyone (the owner, 2 Oct:
 * "host the guide here, open to all, and in English too"). The same text as
 * the Claude doc the guide was written in, in both languages, with the
 * screenshots taken on 2 Oct 2026 (public/userguide/*.png).
 */

export type Block =
  | { t: "p"; zh: string; en: string }
  | { t: "ul"; zh: string[]; en: string[] }
  | { t: "ol"; zh: string[]; en: string[] }
  | { t: "table"; zh: string[][]; en: string[][] }
  | { t: "img"; src: string; zh: string; en: string };

export type Section = { id: string; zh: string; en: string; blocks: Block[] };

const p = (zh: string, en: string): Block => ({ t: "p", zh, en });
const ul = (zh: string[], en: string[]): Block => ({ t: "ul", zh, en });
const ol = (zh: string[], en: string[]): Block => ({ t: "ol", zh, en });
const table = (zh: string[][], en: string[][]): Block => ({ t: "table", zh, en });
const img = (src: string, zh: string, en: string): Block => ({ t: "img", src: `/userguide/${src}`, zh, en });

export const GUIDE_TITLE = { zh: "腾亚创变使用指南", en: "Tengya Studio User Guide" };
export const GUIDE_LEAD = {
  zh: "腾亚创变是工作室的一站式视频平台：AI 同事帮你找选题、写脚本、剪视频、出报告，你负责拍板。这份指南按你平时干活的顺序，讲清楚每个页面能做什么、怎么做。",
  en: "Tengya is the studio's all-in-one video platform: AI colleagues find topics, write scripts, cut videos and write reports; you make the calls. This guide follows the order you work in and explains what each page does and how to use it.",
};
export const GUIDE_DATE = "2026-10-02";

export const SECTIONS: Section[] = [
  {
    id: "start",
    zh: "开始之前",
    en: "Before you start",
    blocks: [
      img("login.png", "登录页", "The sign-in page"),
      p("打开 tengya.media，用邮箱和密码登录。没有账号的话，请管理员邀请你：你会收到一封邀请邮件，点里面的按钮，填好名字、设好密码就能进来。", "Open tengya.media and sign in with your email and password. No account yet? Ask an admin to invite you: you get an email, press the button in it, enter your name and a password, and you are in."),
      ul(
        [
          "请用电脑浏览器打开。剪辑、脚本和表格是按电脑屏幕做的，手机上会提示你换电脑。",
          "网站全部是简体中文。不需要也不要打开浏览器的「翻译」。如果浏览器或插件把字转成了繁体，网站会自动转回来。",
          "想看英文界面：右下角头像旁的「简 / EN」，或者 设置 › 语言 › English。",
          "左边栏是你能用的所有模块。上半部分是做视频的日常工作，「后台」下面是员工管理、财务、账务、法务、人事和设置。你看不到的模块，是还没给你开通；点进去会提示你找管理员开通。",
          "谁能看到什么：每个项目、文件、脚本都有「谁能看」。默认是全工作室可见；改成「仅自己」或指定同事，别人就看不到了。",
        ],
        [
          "Use a desktop browser. Editing, scripts and tables are built for a desktop screen; on a phone the site asks you to switch.",
          "The whole site is in Simplified Chinese. You do not need the browser's Translate, and should not turn it on. If a browser or extension converts the text to Traditional, the site converts it back.",
          "For the English interface: the language switch (简 / EN) next to your avatar at the bottom left, or Settings › Language › English.",
          "The left bar lists every module you can use. The upper part is the daily video work; under Back office (后台) are staff, finance, accounting, legal, HR and settings. A module you cannot see has not been switched on for you; opening it tells you to ask an admin.",
          "Who sees what: every project, file and script has a visibility setting. The default is the whole studio; set it to only you, or to named colleagues, and nobody else sees it.",
        ],
      ),
    ],
  },
  {
    id: "home",
    zh: "首页",
    en: "Home",
    blocks: [
      img("home.png", "首页：等你做的事、策划今日提报、右边的助理", "Home: what is waiting on you, the planner's report, the assistant on the right"),
      p("首页告诉你今天该做什么，并且一键开始一条新视频。", "Home tells you what to do today and starts a new video in one press."),
      ul(
        [
          "等你做的事：需要你审批、确认或补素材的事，点一下直接到对应页面。不想再看到的一条，点「不再提醒」。",
          "策划今日提报：策划每天早上 8 点根据研究员的晨报提一个选题，并排好每个 AI 同事今天的活。点「用这个做一条视频」，项目马上建好。计划一发出来，文案（原「文案」）就已经提前把这个选题的初稿写好了，卡片上会显示「文案已写好初稿」，点「打开写好的稿子」就能看。管理员可以点「换一份」让策划换一个选题。",
          "做一条新视频：一句话写主题，选视频多长，点「开始」。想让文案照某个范例的写法来写，先点回形针附上范例稿或资料。",
          "AI 同事：办公室里每个 AI 同事现在在忙什么，点一位同事可以直接交代。",
          "进行中的视频：每条视频到了哪一步，点「继续」接着做。",
          "右边的助理：随时问问题、派活，也可以附文件让它读。",
        ],
        [
          "Waiting on you: things that need your approval, confirmation or footage; one click opens the right page. Press Don't remind me (不再提醒) to stop seeing one.",
          "The planner's report: at 8 every morning the planner proposes a topic from the researcher's morning brief and lines up each AI colleague's work. Press Make this video (用这个做一条视频) and the project is created at once. As soon as the plan is out, the scriptwriter has already drafted that topic; the card says First draft ready (文案已写好初稿) and Open the draft (打开写好的稿子) opens it. Admins can press Another one (换一份) to ask for a different topic.",
          "New video: write the topic in one sentence, pick a length, press Start (开始). To have the writer follow a sample, attach it with the paperclip first.",
          "AI colleagues: what each one is doing in the office right now; click one to give them work.",
          "Videos under way: where each video is, with Continue (继续) to carry on.",
          "The assistant on the right: ask anything, hand out work, attach files for it to read.",
        ],
      ),
    ],
  },
  {
    id: "office",
    zh: "AI 同事办公室",
    en: "The AI colleagues' office",
    blocks: [
      img("team.png", "AI 同事办公室：上排是一条视频走的路，下排是法务、财务和你的助理", "The office: the top row is the path a video takes; the bottom row is legal, finance and your assistant"),
      p("左边栏「AI 同事」是一间像素风的办公室，一眼看清每个 AI 同事在干什么。", "AI colleagues (AI 同事) in the left bar is a pixel-art office that shows at a glance what every AI colleague is doing."),
      table(
        [
          ["AI 同事", "负责什么"],
          ["研究员", "找热点、查数据、每天早上发晨报"],
          ["策划", "每天提选题、给同事排活"],
          ["文案", "写脚本、改脚本、审批前的检查"],
          ["剪辑师", "转写素材、粗剪、出成片、做封面"],
          ["撰稿人", "写文章、发布文案、小红书文案"],
          ["法务", "合同起草和审阅、合规"],
          ["财务", "预算、花费、报告"],
          ["你的助理", "回答问题、帮你派活（全工作室共用一套设置）"],
        ],
        [
          ["Colleague", "Does what"],
          ["Researcher", "Trends, data, the morning brief every day"],
          ["Planner", "Proposes the day's topic and assigns the work"],
          ["Scriptwriter", "Writes and rewrites scripts, checks them before approval"],
          ["Editor", "Transcribes footage, rough cut, final render, covers"],
          ["Writer", "Articles, post captions, Xiaohongshu copy"],
          ["Legal", "Drafting and reviewing contracts, compliance"],
          ["Finance", "Budget, spend, reports"],
          ["Your assistant", "Answers questions and hands out work (one shared setup for the studio)"],
        ],
      ),
      ul(
        [
          "头顶的气泡：「工作中」正在干活，气泡里写着它正在做什么和进度；「等你」在等你决定或审批；「空闲」可以派活。",
          "点一位同事，会弹出小卡片：派任务（直接在卡片里写一句，回答出现在右边的指挥中心）、聊天（打开它的对话）、训练（打开它的训练页）。",
          "底下的卡片：每个同事的状态和当前任务，也有同样的三个按钮。",
          "习惯列表的话，右上角切到「列表」。",
        ],
        [
          "The bubble over each head: Working (工作中) means at work, and the bubble says what and how far; Waiting on you (等你) is waiting on your decision or approval; Idle (空闲) is free for work.",
          "Click a colleague for a small card: Assign a task (派任务) to write a line right there, with the answer in the command centre on the right; Chat (聊天) to open their conversation; Train (训练) to open their training page.",
          "The cards along the bottom show each colleague's status and current task, with the same three buttons.",
          "Prefer a list? Switch to List (列表) at the top right.",
        ],
      ),
    ],
  },
  {
    id: "projects",
    zh: "项目",
    en: "Projects",
    blocks: [
      img("project.png", "项目页：选题、脚本、剪辑、发布、复盘五步", "A project: topic, script, edit, publish, review"),
      p("一条视频就是一个项目，它的对话、脚本、素材、成片和数据都在一个地方。项目页顶上的步骤就是做视频的顺序：", "One video is one project: its chat, script, footage, render and numbers live in one place. The steps across the top are the order the work goes:"),
      ol(
        [
          "选题：这条视频讲什么，研究员找来的证据和数据。",
          "脚本：文案自动写初稿，你来改、来批。",
          "剪辑：上传素材。脚本一批准、素材一到，剪辑师就自动开始剪、加字幕、出成片，不用再派活。",
          "发布：成片一出来，撰稿人会自动写好发布文案，剪辑师做好封面，都放在这一步里。你看一眼、选渠道、发出去，或者标记为已发布。",
          "复盘：发出后各平台的播放和互动，AI 写复盘结论。",
          "文件：这个项目用到的所有文件，包括在对话里发的附件。",
        ],
        [
          "Topic: what the video is about, with the researcher's evidence and numbers.",
          "Script: the writer drafts it; you edit and approve.",
          "Edit: upload footage. Once the script is approved and footage is in, the editor starts cutting, captioning and rendering by itself; nobody has to ask.",
          "Publish: when the render lands, the writer drafts the post and the editor makes covers, all on this step. You look it over, pick channels and send it, or mark it as published elsewhere.",
          "Review: views and engagement on each platform after posting, with the AI's review.",
          "Files: everything this project uses, including attachments posted in its chat.",
        ],
      ),
      ul(
        [
          "对话：项目右边的对话是这条视频的工作群。@ 一位 AI 同事或同事来派活；不想让 AI 回复的消息，写上「无需回复」。可以附文件，文件会自动放进「文件」。",
          "改名：点标题旁的铅笔，脚本的名字会跟着改。",
          "谁能看 / 分享：可以设成全工作室、仅自己或指定同事；也可以开「有链接的人可查看 / 可编辑」，把链接发给同事。通过链接进来的人只看得到脚本。",
          "归档：做完的项目可以归档，在「项目 › 已归档」里找得到，归档后脚本只能看不能改。",
          "删除：项目、它的脚本和剪辑会一起从列表里消失。",
        ],
        [
          "Chat: the chat on the right is this video's working group. @ an AI colleague or a person to hand them something; add No reply needed (无需回复) to a message the AI should leave alone. Attach files; they land in Files automatically.",
          "Rename: the pencil next to the title; the script's name follows.",
          "Visibility and sharing: the whole studio, only you, or named colleagues; or turn on link access (view or edit) and send the link. Someone arriving by link sees only the script.",
          "Archive: finished projects can be archived and found under Projects › Archived (项目 › 已归档); an archived script is read-only.",
          "Delete: the project, its script and its edit disappear from the lists together.",
        ],
      ),
    ],
  },
  {
    id: "script",
    zh: "脚本编辑器",
    en: "The script editor",
    blocks: [
      img("script.png", "脚本编辑器：工具栏、文档、右边的 AI 助手", "The script editor: toolbar, document, AI assistant on the right"),
      p("脚本页像一份在线文档：边写边自动保存，右上角显示「已保存」。", "The script page works like an online document: it saves as you type, and the top right says Saved (已保存)."),
      p("初稿怎么来", "Where the first draft comes from"),
      ul(
        [
          "从选题、策划提报或「做一条新视频」开始的项目，文案会自动写初稿，一般一两分钟。页面上显示「文案正在写初稿」，写好会自己出现。",
          "某个 AI 模型暂时不可用时，会自动换另一个模型重写，你不用管。",
          "页面是空的？直接在底部 AI 栏写下你想要的稿子（可以附范例），按发送，文案就按你的要求写初稿。",
        ],
        [
          "A project started from a topic, the planner's report or New video (新视频) gets its draft written by the scriptwriter, usually within a minute or two. The page shows Writing the first draft (文案正在写初稿) and the draft appears by itself.",
          "If one AI model is temporarily unavailable, another takes over; nothing to do on your side.",
          "Empty page? Type what you want in the AI bar at the bottom (attach a sample if you like) and send; the writer drafts to your brief.",
        ],
      ),
      p("让文案改稿", "Having the writer revise"),
      ul(
        [
          "底部的 AI 栏或右边「AI 助手」：写下怎么改，比如「开头更抓人」。也可以点「一键改」，或「换个风格」：照范例风格重写、故事型、新闻快讯、干货清单、对比测评、情绪共鸣、反常识开头。",
          "点回形针可以附一份范例或资料，只用于这一次修改。",
          "改法会标在文档里：每一处可以「接受」「拒绝」或「再改改」，也可以一次全部接受。",
        ],
        [
          "The AI bar at the bottom or the AI assistant (AI 助手) on the right: say how it should change, such as a stronger opening. Or press a one-touch edit, or Change style (换个风格): rewrite in the sample's style, story, news flash, checklist, comparison, emotional, counter-intuitive opening.",
          "The paperclip attaches a sample or notes for this one edit.",
          "Changes are marked in the document: accept, reject or redo each one, or accept them all at once.",
        ],
      ),
      p("版本、批注、审批", "Versions, comments, approval"),
      ul(
        [
          "版本：右边「版本」看历史，可以恢复任何一版（现在的稿子会先存成一版）。「保存为新版本」可以写备注。",
          "批注：选中文字后按 Ctrl+Alt+M，或点工具栏的批注按钮。批注可以回复，整条讨论留在页边。",
          "审批：「发给同事审阅」请同事批准；也可以「我自己审阅通过」。批准后脚本锁定，剪辑师照这一版剪；要改就点「继续编辑」，会生成新版本。",
        ],
        [
          "Versions: the Versions (版本) tab shows the history; restore any version (the current draft is saved first). Save as new version (保存为新版本) takes a note.",
          "Comments: select text and press Ctrl+Alt+M, or the comment button on the toolbar. Comments can be replied to; the thread stays in the margin.",
          "Approval: Send to a colleague for review (发给同事审阅) asks a colleague to approve; or Approve it myself (我自己审阅通过). Once approved the script locks and the editor cuts from that version; Keep editing (继续编辑) unlocks it as a new version.",
        ],
      ),
      p("导入、导出和快捷键", "Import, export and shortcuts"),
      ul(
        [
          "「导入文档」可以替换或接在后面，Word 里的标题和加粗会保留；替换前会自动备份一版。",
          "「导出 / 下载」：Word、PDF、纯文本、Markdown。",
          "常用快捷键：Ctrl+K 插入链接，Ctrl+F 查找，Ctrl+H 替换，Ctrl+/ 看全部快捷键，Ctrl+Shift+C 字数统计。（Mac 用 ⌘）",
        ],
        [
          "Import document (导入文档) replaces the page or appends; Word headings and bold survive, and a version is saved before a replace.",
          "Export / Download (导出 / 下载): Word, PDF, plain text, Markdown.",
          "Shortcuts: Ctrl+K link, Ctrl+F find, Ctrl+H replace, Ctrl+/ all shortcuts, Ctrl+Shift+C word count (⌘ on a Mac).",
        ],
      ),
    ],
  },
  {
    id: "chat",
    zh: "和 AI 同事聊天",
    en: "Chatting with AI colleagues",
    blocks: [
      img("chat.png", "和 AI 同事聊天", "Chatting with an AI colleague"),
      img("model-picker.png", "选模型", "Picking a model"),
      p("左边栏「消息」里可以和任何一位 AI 同事单独聊，每个页面右边也有一个随时可用的助理。", "Under Messages (消息) you can talk to any AI colleague on their own, and every page has an assistant on the right."),
      ul(
        [
          "选谁回答：在某个同事的页面里，就是这位同事回答。想问别人，在消息里 @ 他，比如「@文案」。",
          "选模型：输入框下方的「模型」。一般用「自动」；也可以选 Claude、通义千问、Kimi、智谱、DeepSeek 等，只对这次提问生效。选的模型临时不可用时会自动换一个。",
          "附文件：点回形针、把文件拖进来，或直接粘贴截图。AI 会读完整个文件再回答；文件只你自己看得到，不会拿去训练。",
          "有用 / 不好：每条回答下面点一下。「不好」可以写下哪里不好，AI 会从这些反馈里总结改进建议。",
          "教它：「教 XX：以后都这样做」写一条规则。管理员教的直接生效；其他同事教的会交给管理员确认。",
          "管理对话：左边「最近」里指到一条对话上，点「…」可以重命名或删除；「新对话」开始新的一轮。",
        ],
        [
          "Who answers: on a colleague's page, that colleague. To ask someone else, @ them in the message, such as @文案 (the scriptwriter).",
          "Model: the Model (模型) control under the box. Auto (自动) is the usual choice; you can also pick Claude, Qwen, Kimi, GLM, DeepSeek and others for that one message. If the picked model is briefly unavailable, another answers.",
          "Attachments: the paperclip, drag a file in, or paste a screenshot. The AI reads the whole file before answering; the file is private to you and never used for training.",
          "Helpful / Not good (有用 / 不好) under each answer. Not good (不好) lets you say what was wrong; the AI turns this feedback into improvement suggestions.",
          "Teach it: write a rule that starts with Teach (教), such as 教 XX：以后都这样做 (from now on, always do it this way). An admin's rule takes effect at once; another colleague's goes to an admin to confirm.",
          "Managing conversations: hover one under Recent (最近) and press … to rename or delete; New chat (新对话) starts a new one.",
        ],
      ),
    ],
  },
  {
    id: "channels",
    zh: "频道与私信",
    en: "Channels and direct messages",
    blocks: [
      p("频道是大家一起讨论的地方，私信是两个人之间的对话。", "Channels are where everyone talks; a direct message is between two people."),
      ul(
        [
          "系统频道：#研究日报 每天早上发晨报和策划的工作计划；#制作 是文案和剪辑师交接的地方；#公告 只有管理员能发。",
          "新建频道：可以选公开或「私密」。名字和已有频道重复时会提醒你换个名字。",
          "@AI 同事：在频道里 @ 一位 AI 同事，它会看上下文后回答；消息里附的文件它也会读。",
          "编辑和删除：自己发的消息可以改和删；私密频道可以退出；建频道的人或管理员可以归档频道。私信和系统频道不能归档。",
          "窄屏幕：窗口比较窄时，右边的助理会收起来，点顶部的闪光按钮打开，按 Esc 或点 × 关掉。",
        ],
        [
          "System channels: Research daily (#研究日报) carries the morning brief and the planner's work plan; Production (#制作) is where the writer hands over to the editor; only admins post in Announcements (#公告).",
          "New channel: public or private (私密). A name already in use asks you for another.",
          "@ an AI colleague in a channel and it answers with the context in mind; it reads attached files too.",
          "Edit and delete your own messages; leave a private channel; the channel's creator or an admin can archive it. Direct messages and system channels cannot be archived.",
          "Narrow windows fold the assistant away; the spark button at the top opens it, Esc or × closes it.",
        ],
      ),
    ],
  },
  {
    id: "research",
    zh: "选题",
    en: "Topics",
    blocks: [
      img("research.png", "选题：推荐", "Topics: recommendations"),
      img("hot.png", "热点榜", "The trending list"),
      img("backlog.png", "我的储备", "Saved topics and watched keywords"),
      img("inbox.png", "评论收件箱", "The comment inbox"),
      p("选题页帮你决定下一条拍什么。任何一个选题点「做成视频」就会建项目，文案自动写初稿。", "The topics page helps you decide what to shoot next. Make a video (做成视频) on any topic starts a project, and the writer drafts it."),
      table(
        [
          ["页面", "用来做什么"],
          ["推荐", "研究员今天挑的几个选题，每个都有证据和数据；不感兴趣的可以收起，10 秒内可以撤销"],
          ["热点榜", "抖音、小红书、微博、B 站、YouTube 等平台现在最热的 AI、加密、科技、商业内容，每几个小时更新；管理员可以点 × 把不相关的一条对全工作室隐藏"],
          ["我的储备", "存下来的选题和关注的词。加一个词（比如 RWA），研究员会一直看它在各平台的热度；「排期看板」给选题安排负责人和日期"],
          ["搜索与对比", "几个词的热度走势放在一起比，可以导出报告"],
          ["收件箱", "各平台观众的评论和提问，可以让 AI 起草回复"],
        ],
        [
          ["Page", "What it is for"],
          ["Recommended (推荐)", "The researcher's picks for today, each with evidence and numbers; dismiss one you do not want, undo within 10 seconds"],
          ["Trending (热点榜)", "What is trending right now on Douyin, Xiaohongshu, Weibo, Bilibili, YouTube and others in AI, crypto, tech and business, refreshed every few hours; admins can × a row to hide it for the studio"],
          ["My saved (我的储备)", "Saved topics and watched words. Add a word (RWA, say) and the researcher keeps watching its heat across platforms; the schedule board (排期看板) assigns an owner and a date to a topic"],
          ["Search and compare (搜索与对比)", "Compare several words' trends side by side and export a report"],
          ["Inbox (收件箱)", "Viewers' comments and questions from every platform, with AI-drafted replies"],
        ],
      ),
    ],
  },
  {
    id: "publish",
    zh: "发布与账号数据",
    en: "Publishing and account data",
    blocks: [
      img("publish.png", "发布：渠道和记录", "Publish: channels and the log"),
      img("covers.png", "项目的发布一步：封面和 AI 成片", "A project's publish step: covers and the AI render"),
      img("analytics.png", "账号数据", "Account data"),
      p("发布负责把成片发出去，账号数据和复盘告诉你发出去以后效果怎么样。", "Publish sends the finished video out; account data and the review tell you how it did."),
      ul(
        [
          "渠道：「发布」里连接 YouTube、LinkedIn 等账号。每个渠道会显示「可发布」「需要重新授权」或「暂时受限」。授权到期的渠道，重新授权后才能发。",
          "发布一条视频：一般在项目的「发布」一步里发；也可以在发布页「新建发布」。先写文案、选渠道，批准后后台自动发出。「封面」卡片里是剪辑师做的三张封面，各配一个标题：选一张，发布时会随视频发到支持封面的平台（比如 YouTube）；不满意点「重做封面」。在别的地方发了的，可以在项目里标记为已发布。",
          "账号数据：每个账号和每条视频的播放、点赞、评论、互动率。点进一条视频可以看走势图，数据覆盖超过一周时可以切 7 / 28 / 90 天。视频号（谢亚芳-创变派）的数字平台不开放读取，点卡片上的「手动填写」填进去；单条视频贴分享链接就能加。",
          "复盘：项目发出后，在「复盘」里看各平台的数据，AI 会写一份复盘结论，告诉你哪里做得好、下次怎么改。平台没提供的数据会留空，不会显示一个假的 0。",
        ],
        [
          "Channels: connect YouTube, LinkedIn and other accounts under Publish (发布). Each shows Ready (可发布), Reconnect (需要重新授权) or Limited (暂时受限). An expired channel posts again once reconnected.",
          "Posting a video: usually from the project's Publish (发布) step; or New post (新建发布) on the publish page. Write the caption, pick channels; once approved it goes out from the back end. The Cover (封面) card holds the editor's three covers, each with a title: pick one and it goes out with the video to platforms that take a cover (YouTube, for one); Redo covers (重做封面) makes new ones. A video posted elsewhere can be marked as published in the project.",
          "Account data: views, likes, comments and engagement per account and per video. Open a video for its trend; with more than a week of data you can switch 7 / 28 / 90 days. WeChat Channels (谢亚芳-创变派) cannot be read by the platform, so its tile takes numbers through Enter manually (手动填写), and a video by its share link.",
          "Review: after posting, Review (复盘) shows each platform's numbers and the AI writes a review: what worked, what to change next time. Numbers a platform does not provide are left blank, never shown as a fake 0.",
        ],
      ),
    ],
  },
  {
    id: "article",
    zh: "文章",
    en: "Articles",
    blocks: [
      p("「文章」是撰稿人写长文的地方：公众号、专栏、平台长帖。每篇文章有版本、审批和发布记录。", "Articles (文章) is where the writer makes long-form pieces: WeChat articles, columns, long posts. Each has versions, an approval and a publishing log."),
      ul(
        [
          "写初稿：填标题、角度、语言，点「写初稿」。撰稿人只用脚本和你给的资料里的事实，不编数字。在聊天里对撰稿人说「写一篇关于……的文章」也一样。",
          "改稿：在「这一版需要有什么不同」里写要求（比如「第一段缩短到两句，其他不动」），点「重写」。要求会当作修改指令来执行，其余内容保持原样，不会把你的话抄进文章。在页面右边的聊天里说「把开头改成提问」也可以。",
          "核对事实：点「核对事实」，文中的数字、日期、人名、引语会逐条上网核对，标出「属实」「有出入」「无法证实」和依据。它只给结论，不改文章。",
          "版本：每次重写前自动存一版，列表里能看到全部版本，点「恢复」回到任何一版。已批准并锁定的文章要先在「发布日志」里撤回，再恢复。",
          "审批和发布：发给同事审批，批准后可以发布到各个目的地，发布记录都在「发布日志」里。",
        ],
        [
          "First draft: fill in the title, angle and language, press Write first draft (写初稿). The writer uses only the facts from the script and the material you give it. Asking the writer in chat for an article does the same.",
          "Revising: write what should change under What should change in this version (这一版需要有什么不同), such as shortening the first paragraph, and press Rewrite (重写). The request is applied as an edit; the rest stays, and your words are never pasted into the piece. Telling the writer in the chat on the right works too.",
          "Check facts (核对事实): every number, date, name and quote in the text is looked up live and marked True (属实), Differs (有出入) or Cannot verify (无法证实) with the evidence. It reports; it does not change the article.",
          "Versions: one is kept before every rewrite, all are listed, and Restore (恢复) returns to any of them. An approved, locked article is retracted in the Publishing log (发布日志) first.",
          "Approval and publishing: send it to a colleague to approve; once approved it can go to each destination, logged under the Publishing log (发布日志).",
        ],
      ),
    ],
  },
  {
    id: "library",
    zh: "资料库与在线文档",
    en: "Libraries and online documents",
    blocks: [
      img("legal.png", "法务资料库", "The legal library"),
      p("法务、财务、账务各有一个资料库，用来放合同、发票和记录。同部门的同事都能看、能改。", "Legal, finance and accounting each have a library for contracts, invoices and records. Everyone in the department can read and edit."),
      ul(
        [
          "上传：把文件拖进资料库，可以一次拖多个。AI 会自动读完（显示「AI 已读」），之后问法务或财务时它会用上这些文件。",
          "在线编辑：点「编辑」，Word、PDF、文本都能在网页里直接改，标题和加粗会保留，边改边保存。点文档名可以改名。",
          "下载：右上角「下载」可以拿到 Word 或 PDF；上传时的原文件一直保留。",
          "分享：「分享」里可以设谁能看，或者分享给某位同事「可查看」或「可编辑」，列表里点 × 可以收回。",
          "新建文档：资料库里点「新建文档」，直接在网页里写。",
          "用来训练：想让 AI 以后照某个文件的做法来做，就点那个文件右边的「用来训练」。",
          "批量删除：「选择多个」勾选后「删除所选」，文件进回收站，30 天内可以恢复。",
        ],
        [
          "Upload: drag files into the library, several at once. The AI reads each one, marked Read by AI (AI 已读), and uses them when you ask legal or finance anything.",
          "Edit online: Edit (编辑) opens Word, PDF and text files in the browser; headings and bold survive, and it saves as you type. Click the name to rename.",
          "Download: Download (下载) at the top right gives Word or PDF; the original upload is always kept.",
          "Share: set who can see it, or share it with a colleague as view or edit; × in the list takes it back.",
          "New document (新建文档) writes a new document right in the browser.",
          "Use for training (用来训练) on a file teaches the AI to work the way that file does.",
          "Bulk delete: Select several (选择多个), tick, Delete selected (删除所选); files go to the trash and can be restored for 30 days.",
        ],
      ),
    ],
  },
  {
    id: "files",
    zh: "文件",
    en: "Files",
    blocks: [
      img("files.png", "文件", "Files"),
      p("「文件」是工作室所有文件的总仓库。", "Files (文件) is the studio's whole file store."),
      ul(
        [
          "上传和文件夹：拖进来就能上传，大视频也可以；可以建文件夹整理。",
          "素材库：剪辑师常用的空镜和素材。",
          "分享：文件页里设「谁可以看」，或分享给指定同事。「共享给我」里是同事分享给你的文件。",
          "文档在线编辑：文档类文件的页面上有「在线编辑」。",
          "回收站：删掉的文件在这里保留 30 天，可以恢复；文件的主人或管理员可以「永久删除」。",
          "没有权限改的文件，不会显示重命名和删除按钮。",
        ],
        [
          "Upload and folders: drag to upload, big videos too; folders keep things tidy.",
          "The stock library (素材库) holds the editor's stock footage and b-roll.",
          "Share: set who can see a file on its page, or share it with named colleagues. Shared with me (共享给我) lists what colleagues shared with you.",
          "Documents have Edit online (在线编辑) on their page.",
          "Trash keeps deleted files for 30 days; the owner or an admin can Delete forever (永久删除).",
          "A file you cannot edit shows no rename or delete buttons.",
        ],
      ),
    ],
  },
  {
    id: "train",
    zh: "AI 训练",
    en: "Training the AI",
    blocks: [
      img("train.png", "AI 训练：文案的模型、工作说明、它在学习", "Training: the scriptwriter's model, instructions, what it is learning"),
      p("在「AI 同事 › 训练」里，可以把每位 AI 同事教成工作室想要的样子。每位同事一页：", "Under AI colleagues › Training (AI 同事 › 训练) you shape each AI colleague the way the studio wants. One page per colleague:"),
      ul(
        [
          "名字和职责：管理员可以给每位 AI 同事改名字（比如把「文案」叫成你们习惯的称呼）和改一句话职责。改完后所有页面、@ 和它自己的提示都用新名字，旧名字也还认得。",
          "用哪个模型：给这位同事单独选一个模型，其他同事不受影响；不选就跟着工作室默认。「全部模型」里可以选任何可用的模型。",
          "工作说明：它每次干活都必须遵守的要求，一行一条，比如「开头 3 秒必须有钩子」「不要用‘家人们’」。每次修改都会留版本。",
          "范例：上传一两篇你喜欢的稿子，它会照着写。",
          "它在学习：同事们的「有用 / 不好」、拒绝的改法、退回意见都会记在这里。每攒够 8 条新反馈，它会自己总结几条规则；管理员点「采纳」才会加进工作说明，点「忽略」就不加。",
          "试一试：改完说明后可以当场测一句，看看效果。",
          "普通同事可以看、可以在聊天里给反馈；修改说明和模型由管理员来做。",
        ],
        [
          "Name and role: admins can rename any AI colleague (call the scriptwriter, 文案, whatever the team says) and rewrite its one-line role. The new name appears on every screen, in @mentions and in its own prompt; the old name still works.",
          "Model: give this colleague its own model without affecting the others; unset, it follows the studio default. All models (全部模型) lists every model available.",
          "Instructions: the rules it follows every time, one per line, such as a hook in the first 3 seconds, or never saying “family” (家人们). Every edit keeps a version.",
          "Samples: upload one or two pieces you like and it writes like them.",
          "It is learning: colleagues' Helpful / Not good (有用 / 不好), rejected edits and send-backs collect here. Every 8 new pieces of feedback it proposes a few rules; an admin's Adopt (采纳) adds one to the instructions, Ignore (忽略) drops it.",
          "Try it (试一试) tests a line right after you change the instructions.",
          "Members can read and give feedback in chat; admins change instructions and models.",
        ],
      ),
    ],
  },
  {
    id: "admin",
    zh: "后台与设置",
    en: "Back office and settings",
    blocks: [
      img("admin.png", "员工管理", "Staff"),
      img("settings.png", "设置：默认模型和 AI 支出", "Settings: default model and AI spend"),
      p("这部分主要给管理员用。", "This part is mostly for admins."),
      ul(
        [
          "员工管理 › 加人：填邮箱、选角色（管理员 / 成员 / 访客）和能打开的模块，点「发送邀请」，对方会收到邀请邮件；也可以复制链接通过微信发给对方。",
          "员工管理 › 直接建号：「直接创建账号」会生成一个密码，把账号和密码交给同事即可。",
          "未加入的邀请可以「重发邮件」或「撤销」；权限矩阵一张表看清谁能打开哪个模块。",
          "设置 › 默认 AI 模型：全工作室默认用哪个模型。常用的几个以卡片形式列出，「更多模型」里可以选其他的。",
          "设置 › AI 支出：本月全工作室花了多少。AI 同事替谁做的事就算在谁头上；没人叫它做的（晨报、热点榜）算「自动任务」。",
          "财务 › AI 服务余额：AI 账户还剩多少钱，快用完时请及时充值。",
          "自动化：晨报、工作计划等自动任务的开关和时间。安全：改密码、开启两步验证。",
        ],
        [
          "Staff › Add person: email, role (admin / member / guest) and the modules they can open, then Send invitation (发送邀请); they get an invitation email. Or copy the link and send it over WeChat.",
          "Staff › Create account directly (直接创建账号) makes an account with a generated password to hand to the colleague.",
          "Pending invitations can be re-sent or withdrawn; the permission matrix shows who can open which module.",
          "Settings › default AI model: the studio-wide default. The usual ones are tiles; More models (更多模型) lists the rest.",
          "Settings › AI spend: this month's spend for the studio. Work an AI colleague did for someone counts under that person; unprompted work (the brief, the trending list) counts as Automatic tasks (自动任务).",
          "Finance › AI service balance: what is left on the AI account; top up before it runs out.",
          "Automation: the switches and times for the brief, the plan and other scheduled tasks. Security: change password, two-step sign-in.",
        ],
      ),
    ],
  },
  {
    id: "faq",
    zh: "常见问题",
    en: "Troubleshooting",
    blocks: [
      table(
        [
          ["遇到的情况", "怎么办"],
          ["页面上出现繁体字或怪字", "网站会自动转回简体。如果还是有，关掉浏览器的「翻译」和繁简转换插件（Chrome 右上角拼图图标 › 管理扩展程序），然后刷新"],
          ["初稿一直没出来", "文案会自动换模型重试几轮，一般几分钟内会到。如果出现红色的「初稿没写成」，点「重试」，或者在底部 AI 栏写下要求直接让它写"],
          ["AI 回答说服务出错", "稍等一下再试，或者在「模型」里换一个。财务页的「AI 服务余额」可以看是不是余额用完了"],
          ["点进某个模块提示「没有权限」", "请管理员在「员工管理」里给你开通"],
          ["页面说「系统刚更新了一个新版本」", "刷新一下就好。网站更新后，开着的旧页面会提示你刷新；已经保存的内容都在"],
          ["脚本改不了", "脚本已批准锁定，点「继续编辑」；或者项目已归档，先取消归档"],
          ["邀请邮件没收到", "看看垃圾邮件；管理员可以点「重发邮件」，或直接复制邀请链接发给对方"],
        ],
        [
          ["What you see", "What to do"],
          ["Traditional or odd characters on a page", "The site converts them back by itself. If they stay, turn off the browser's Translate and any Chinese conversion extension (Chrome: the puzzle icon › Manage extensions), then refresh"],
          ["The first draft never arrives", "The writer retries with other models for a few rounds and usually lands within minutes. If a red bar saying The draft was not written (初稿没写成) appears, press Retry (重试), or type what you want into the AI bar at the bottom"],
          ["The AI says the service failed", "Wait a moment and try again, or pick another model under Model (模型). Finance › AI service balance shows whether the account ran dry"],
          ["A module says No permission (没有权限)", "Ask an admin to switch it on for you under Staff management (员工管理)"],
          ["The page says a new version was released", "Refresh. After an update, an old tab left open asks you to refresh; everything saved is still there"],
          ["The script cannot be edited", "It is approved and locked: press Keep editing (继续编辑). Or the project is archived: unarchive it first"],
          ["The invitation email did not arrive", "Check spam; an admin can re-send it, or copy the invitation link and send it directly"],
        ],
      ),
    ],
  },
];
