# Builds lib/text/standard-chars.ts and lib/text/vocab.ts.
#
#   python3 scripts/gen-zh.py
#
# Sources (public standards, fetched into /tmp on first run):
#   《通用规范汉字表》 (国务院 2013, 8105 characters), from Wikisource's
#     transcription: https://zh.wikisource.org/wiki/通用规范汉字表
#     (original: https://www.gov.cn/gzdt/att/att/site1/20130819/tygfhzb.pdf)
#   《第一批异形词整理表》 (教育部/国家语委 GF 1001-2001, 338 groups), from
#     https://zh.wikisource.org/wiki/第一批异形词整理表 (pages 4-10)
#   Mainland vocabulary for Hong Kong / Taiwan words: picked by hand from
#     OpenCC's TWPhrasesRev.txt and HKPhrasesRev.txt
#     (https://github.com/BYVoid/OpenCC/tree/master/data/dictionary), keeping
#     only words that have one meaning, so nothing inside a longer word is
#     rewritten by mistake. OpenCC's full tables are not used as they are:
#     資料→數據 would turn 參考資料 into 参考数据.
import os, re, sys, glob, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = "/tmp"


def fetch(title, name):
    path = os.path.join(TMP, name)
    if os.path.exists(path) and os.path.getsize(path) > 100:
        return open(path, encoding="utf-8").read()
    url = "https://zh.wikisource.org/w/index.php?title=" + urllib.parse.quote(title) + "&action=raw"
    data = urllib.request.urlopen(url, timeout=60).read().decode("utf-8")
    open(path, "w", encoding="utf-8").write(data)
    return data


# ---------------------------------------------------------------- 8105 characters
raw = fetch("通用规范汉字表", "ws-tygfhzb.txt")
entries = {}
for m in re.finditer(r"^:(\d{4}) (.+)$", raw, re.M):
    n = int(m.group(1))
    cj = re.findall(r"[㐀-䶿一-鿿\U00020000-\U0002FFFF]", m.group(2))
    if cj and n not in entries:
        entries[n] = cj[0]
missing = [i for i in range(1, 8106) if i not in entries]
if missing:
    sys.exit("standard table: missing numbers " + str(missing[:10]))
chars = "".join(entries[i] for i in sorted(entries))

# ---------------------------------------------------------------- 异形词
EXCLUDE = set("""标识 份子 沈思 花着 丁宁 连结 热中 就坐 入坐 元来 原故 原由 支解 枝解 人材 图象 影象 录象 录相 关连
份内 份外 份量 成份 本份 笔划 这末 那末 热呼 子细 架式 分付 山查 推委 委过 转游 展转 干与 留连 落莫 平空 情素 无宁 夜消
案语 胞子 磁器 定单 定户 定婚 定货 定阅 端五 傅会 股分 过份 含胡""".split())
pairs = []
for p in range(4, 11):
    page = fetch("Page:第一批异形词整理表.pdf/%d" % p, "ws-yxc-%d.txt" % p)
    for line in page.splitlines():
        line = re.sub(r"<ref>.*?</ref>", "", line)
        line = re.sub(r"<ref>.*", "", line)
        line = re.sub(r"<sub>(.*?)</sub>", r"\1", line).strip()
        m = re.match(r"^\*([一-鿿]+)——([一-鿿、]+)\s", line)
        if not m:
            continue
        rec = m.group(1)
        for v in m.group(2).split("、"):
            if v and v != rec and v not in EXCLUDE:
                pairs.append((v, rec))
if len(pairs) < 250:
    sys.exit("variant list: only %d pairs parsed" % len(pairs))

# ---------------------------------------------------------------- vocabulary
# Hong Kong / Taiwan word → the word a mainland reader uses. Keys are given in
# Traditional; the Simplified spelling of each key is added below, so text that
# was already converted character by character (网路, 软体, 人工智慧) is fixed too.
VOCAB = """
人工智慧 人工智能
演算法 算法
大型語言模型 大语言模型
網際網路 互联网
網路 网络
無線網路 无线网络
伺服器 服务器
資料庫 数据库
資料夾 文件夹
資訊 信息
訊息 消息
訊號 信号
視訊 视频
軟體 软件
硬體 硬件
韌體 固件
應用程式 应用程序
程式碼 代码
原始碼 源代码
方程式 方程式
程式 程序
作業系統 操作系统
記憶體 内存
硬碟 硬盘
隨身碟 U盘
光碟 光盘
滑鼠 鼠标
螢幕 屏幕
印表機 打印机
晶片 芯片
雷射 激光
解析度 分辨率
畫素 像素
縮圖 缩略图
頻寬 带宽
寬頻 宽带
超連結 超链接
連結 链接
選單 菜单
視窗 窗口
介面 界面
使用者 用户
帳號 账号
帳戶 账户
帳單 账单
記帳 记账
轉帳 转账
對帳 对账
帳目 账目
登入 登录
搜尋引擎 搜索引擎
搜尋 搜索
預設 默认
載入 加载
當機 死机
除錯 调试
效能 性能
最佳化 优化
機率 概率
變數 变量
函式 函数
迴圈 循环
陣列 数组
字串 字符串
數位化 数字化
數位相機 数码相机
數位內容 数字内容
數位轉型 数字化转型
智慧型手機 智能手机
行動裝置 移动设备
行動電話 移动电话
行動支付 移动支付
行動應用 移动应用
雲端運算 云计算
社群媒體 社交媒体
社群網站 社交网站
部落格 博客
部落客 博主
直播主 主播
關鍵字 关键词
點閱率 点击率
按讚 点赞
讚好 点赞
業配 广告合作
上載 上传
電郵 电子邮件
短訊 短信
手提電話 手机
影印 复印
相片 照片
質素 质量
速遞 快递
雪櫃 冰箱
樓價 房价
計程車 出租车
捷運 地铁
腳踏車 自行车
公車 公交车
行銷 营销
數位行銷 数字营销
執行長 首席执行官
營運長 首席运营官
財務長 首席财务官
專案 项目
計畫 计划
範本 模板
模版 模板
儀表板 仪表盘
回覆 回复
答覆 答复
甚麼 什么
甚么 什么
惟一 唯一
其它 其他
"""
# The last two are not in GF 1001-2001; they are the forms 《现代汉语词典》 (7th ed.)
# and newsroom style guides recommend, and models write 其它 and 惟一 often.


# Character-level Simplified spelling, from the same OpenCC table simplified.ts uses.
sys.path.insert(0, ROOT)
ts = open(os.path.join(ROOT, "lib/text/simplified.ts"), encoding="utf-8").read()
FROM = re.search(r'const FROM =\s*"([^"]+)"', ts).group(1)
TO = re.search(r'const TO =\s*"([^"]+)"', ts).group(1)
f, t = list(FROM), list(TO)
table = dict(zip(f, t)) if len(f) == len(t) else {}
if not table:
    # the strings hold astral characters; walk by code point
    import unicodedata
    f = [c for c in FROM]
    t = [c for c in TO]
    table = dict(zip(f, t))


def simp(s):
    return "".join(table.get(c, c) for c in s)


vocab = []
seen = set()
for line in VOCAB.strip().splitlines():
    k, v = line.split()
    for key in (k, simp(k)):
        if key not in seen:
            seen.add(key)
            vocab.append((key, v))
for v, rec in pairs:
    if v not in seen:
        seen.add(v)
        vocab.append((v, rec))

# A longer key must win over a shorter one inside it (程式碼 before 程式, 方程式 before 程式).
vocab.sort(key=lambda kv: -len(kv[0]))


def js(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


std = """/**
 * 《通用规范汉字表》: the 8105 characters the State Council published in 2013
 * as the standard set for modern Chinese. Anything the AI employees write
 * should be spelt from these; a character outside the set is either
 * Traditional (toSimplified fixes it), a rare variant, or a converter's
 * garbage (「艸藁」for 草稿, 2 Oct). Generated by scripts/gen-zh.py from
 * Wikisource's transcription of the table; edit that, not this.
 */
const STANDARD = %s;

const SET = new Set(Array.from(STANDARD));

/** True when the character is in the standard set. */
export function isStandardChar(ch: string): boolean {
  return SET.has(ch);
}

/**
 * The Chinese characters in `text` that are outside the standard set, each
 * once, in order of first appearance. Punctuation, Latin and digits are not
 * Chinese characters and never count.
 */
export function nonStandardChinese(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const cjk = (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x20000 && cp <= 0x2ffff);
    if (!cjk || SET.has(ch) || seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

export const STANDARD_CHAR_COUNT = %d;
""" % (js(chars), len(entries))

voc = """/**
 * Words a mainland reader would not use, replaced by the ones they would.
 *
 * Two kinds, both applied after character conversion by `toSimplified`:
 *
 * 1. Hong Kong / Taiwan vocabulary that survives character conversion
 *    (網路→网路 is still not 网络; 軟體, 人工智慧, 演算法, 伺服器, 資訊,
 *    甚麼). The list is hand-picked from OpenCC's TWPhrasesRev / HKPhrasesRev
 *    tables, keeping only words with a single meaning, so a longer word is
 *    never rewritten from the inside (OpenCC's own 資料→數據 would make
 *    參考資料 into 参考数据, so it is not here).
 * 2. 《第一批异形词整理表》 (GF 1001-2001): variant spellings and the
 *    recommended form (惟一→唯一, 身份 stays, 精采→精彩, 帐本→账本, 折衷→折中),
 *    minus the variants that are also ordinary words in another sense
 *    (份子钱, 加热中, 决定单价).
 *
 * Longest key first, so 程式碼→代码 and 方程式 (kept) win over 程式→程序.
 * Generated by scripts/gen-zh.py; edit that, not this.
 */
const PAIRS: [string, string][] = [
%s
];

const MAP = new Map<string, string>(PAIRS);
const LONGEST = PAIRS.reduce((n, [k]) => Math.max(n, k.length), 0);
const FIRST = new Set(PAIRS.map(([k]) => k[0]));

/** The same text with mainland vocabulary and standard word forms. */
export function mainlandVocab(text: string): string {
  if (!text) return text;
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (!FIRST.has(text[i])) {
      out += text[i];
      i += 1;
      continue;
    }
    let hit: string | undefined;
    let n = Math.min(LONGEST, text.length - i);
    for (; n > 1; n--) {
      hit = MAP.get(text.slice(i, i + n));
      if (hit !== undefined) break;
    }
    if (hit !== undefined) {
      out += hit;
      i += n;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

export const VOCAB_COUNT = %d;
""" % (",\n".join("  [%s, %s]" % (js(k), js(v)) for k, v in vocab), len(vocab))

open(os.path.join(ROOT, "lib/text/standard-chars.ts"), "w", encoding="utf-8").write(std)
open(os.path.join(ROOT, "lib/text/vocab.ts"), "w", encoding="utf-8").write(voc)
print("standard chars:", len(entries), "distinct", len(set(chars)))
print("vocab entries:", len(vocab), "(variants", len(pairs), ")")
