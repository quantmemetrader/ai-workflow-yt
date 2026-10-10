"use client";

import * as React from "react";

/**
 * /exm1 (10 Oct): what the automated pipeline has produced so far, on one
 * page for the studio to look at. Everything here was made on the studio's
 * own server from a one-line topic or a short clip of the host.
 */
type L = "zh" | "en";

export function Examples() {
  const [lang, setLang] = React.useState<L>("zh");
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return (
    <div className="ex">
      <style>{CSS}</style>
      <header className="ex-head">
        <div className="ex-brand">腾亚创变 · Tengya</div>
        <div className="ex-lang" role="group" aria-label="Language">
          <button type="button" data-on={lang === "zh" ? "" : undefined} onClick={() => setLang("zh")}>中文</button>
          <button type="button" data-on={lang === "en" ? "" : undefined} onClick={() => setLang("en")}>EN</button>
        </div>
      </header>
      <main className="ex-main">
        <h1>{t("自动生成的样片：现在能做到什么", "Automatic samples: what it makes today")}</h1>
        <p className="ex-lede">{t("下面每一样都是 10 月 10 日在我们自己的服务器上做出来的，没有付费服务，没有专门拍摄。主持人素材用的是一段旧的 480p 预览（自带字幕），所以画面里有两层字幕和旧标题；换成一段没有字幕的原始视频，这些就没有了。", "Everything below was made on our own server on 10 Oct: no paid service, nothing filmed for it. The host clip was an old 480p preview with captions burned in, which is why two caption layers and an old title show; a raw clip of her removes that.")}</p>

        <section className="ex-card">
          <h2>{t("1. 整条视频，一句话开始", "1. A whole reel from one line")}</h2>
          <p>{t("输入一句话主题 →「文案」写稿 → 用她的克隆声音读 → 她的视频对上口型（15 秒素材来回循环）→ 剪辑师加空镜、字幕 → 渲染。全程约 10 分钟，47 秒成片。", "One-line topic → the writer drafts → read in her cloned voice → her clip lip-synced (15 s looped) → the editor adds b-roll and captions → rendered. About 10 minutes, a 47-second film.")}</p>
          <video controls playsInline preload="metadata" src="/exm1/auto-reel.mp4" poster="/exm1/auto-reel-sheet.png" />
          <a className="ex-dl" href="/exm1/auto-reel.mp4" download>{t("下载 MP4（17 MB）", "Download the MP4 (17 MB)")}</a>
        </section>

        <section className="ex-card">
          <h2>{t("2. 只看对口型", "2. The lip-sync alone")}</h2>
          <p>{t("12 秒她的真实视频，嘴型对到一句新的配音。只重做嘴部，眼睛、手、背景都是原片。服务器 CPU 上 81 秒做完，免费。", "12 s of her real footage, mouth re-timed to a new voice line. Only the mouth is regenerated; eyes, hands, background are the original. 81 s on the server's CPU, free.")}</p>
          <video controls playsInline preload="metadata" src="/exm1/lipsync-12s.mp4" />
        </section>

        <section className="ex-card">
          <h2>{t("3. 她的声音", "3. Her voice")}</h2>
          <p>{t("她 ElevenLabs 账号里的两个克隆声音，各读同一段话。", "The two clones on her ElevenLabs account, reading the same line.")}</p>
          <div className="ex-row">
            <div><div className="ex-cap">Avon Hsieh</div><audio controls preload="none" src="/exm1/voice-avon-1.mp3" /></div>
            <div><div className="ex-cap">Avon Hsieh 2</div><audio controls preload="none" src="/exm1/voice-avon-2.mp3" /></div>
          </div>
        </section>

        <section className="ex-card">
          <h2>{t("4. 生成的画面（剪辑时切过去的镜头）", "4. Generated stills (the cutaways)")}</h2>
          <p>{t("服务器自己生成，免费。「精细」约 5 分钟一张，「快速」约 2 分钟。", "Made on the server, free. Fine: about 5 minutes each; quick: about 2.")}</p>
          <div className="ex-grid">
            {[
              ["gen-trading-floor.jpg", t("精细 · 交易大厅", "Fine · trading floor")],
              ["gen-robot-fine.jpg", t("精细 · 工厂机器人", "Fine · factory robot")],
              ["gen-robot-quick.jpg", t("快速 · 工厂机器人", "Quick · factory robot")],
              ["gen-harbour-quick.jpg", t("快速 · 雨夜维港", "Quick · harbour in rain")],
            ].map(([f, cap]) => (
              <figure key={f}>
                <a href={`/exm1/${f}`} target="_blank" rel="noopener noreferrer"><img src={`/exm1/${f}`} alt={cap} loading="lazy" /></a>
                <figcaption>{cap}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="ex-card ex-dark">
          <h2>{t("要让它真正好看，需要的素材", "What makes it properly good")}</h2>
          <ul>
            <li>{t("一段 60 到 90 秒她面对镜头自然说话的原始视频：无字幕、无音乐、正脸、光线好、竖屏、1080p 或 4K。句与句之间闭嘴停顿。", "A raw 60–90 s clip of her talking to camera: no captions, no music, front-facing, well lit, vertical, 1080p or 4K, mouth closed between sentences.")}</li>
            <li>{t("有条件的话再拍一个微侧的角度。", "A second, slightly angled take if possible.")}</li>
            <li>{t("三到五张正脸照片。", "Three to five front-facing photos.")}</li>
          </ul>
        </section>
        <section className="ex-card">
          <h2>{t("费用：现在的做法要花多少钱", "Costs: what this way of working costs")}</h2>
          <p>{t("按一条 1 分钟的视频算。第一组是现在已经在用的；第二组是可选的付费升级，不开也能出片。价格为各服务商 2026 年 10 月公开标价，按量计费的以当时为准。", "Per one-minute reel. The first group is what runs today; the second is optional paid upgrades, not needed to make a video. Prices are the providers' public list prices as of Oct 2026.")}</p>
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead><tr><th>{t("项目", "Item")}</th><th>{t("费用", "Cost")}</th><th>{t("说明", "Note")}</th></tr></thead>
              <tbody>
                <tr className="ex-group"><td colSpan={3}>{t("现在已经在用（整条视频自动生成）", "Running today (the automatic reel)")}</td></tr>
                <tr><td>{t("写稿、选题、剪辑决策（Qwen / DeepSeek / Kimi）", "Drafting, topics, cut decisions (Qwen / DeepSeek / Kimi)")}</td><td>{t("约 US$0.05 / 条", "≈ US$0.05 per reel")}</td><td>{t("你们自己的 OpenRouter 账号，按用量扣", "Your own OpenRouter account, pay as you go")}</td></tr>
                <tr><td>{t("她的克隆声音读稿（ElevenLabs）", "Her cloned voice (ElevenLabs)")}</td><td>{t("套餐内：Creator US$22 / 月", "In plan: Creator, US$22 / month")}</td><td>{t("每月 13 万字 ≈ 300 分钟口播；克隆已含", "131k characters a month ≈ 300 minutes of narration; cloning included")}</td></tr>
                <tr><td>{t("她的口型（本机对口型）", "Her lips (on-server lip-sync)")}</td><td>{t("免费", "Free")}</td><td>{t("我们的服务器，约 7 分钟算 1 分钟视频", "Our server, about 7 minutes per minute of video")}</td></tr>
                <tr><td>{t("生成的画面（本机 Z-Image）", "Generated stills (on-server Z-Image)")}</td><td>{t("免费", "Free")}</td><td>{t("快速 2 分钟 / 精细 5 分钟一张，不限张数", "2 or 5 minutes each, no limit")}</td></tr>
                <tr><td>{t("图片和空镜素材（Pexels、Pixabay、Unsplash、Wikimedia、NASA）", "Pictures and b-roll (Pexels, Pixabay, Unsplash, Wikimedia, NASA)")}</td><td>{t("免费", "Free")}</td><td>{t("免费密钥；成片里带来源署名", "Free keys; credits shown in the film")}</td></tr>
                <tr><td>{t("字幕、剪辑、渲染、导出剪映", "Captions, cut, render, CapCut export")}</td><td>{t("免费", "Free")}</td><td>{t("都在我们的服务器上", "All on our server")}</td></tr>
                <tr><td>{t("Claude（可选模型）", "Claude (optional model)")}</td><td>{t("约 US$0.02–0.05 / 次对话", "≈ US$0.02–0.05 per turn")}</td><td>{t("Sonnet 5.5：每百万字输入 US$2、输出 US$10", "Sonnet 5.5: US$2 in / US$10 out per million tokens")}</td></tr>
                <tr><td><b>{t("一条 1 分钟视频合计", "One-minute reel, total")}</b></td><td><b>{t("约 US$0.05–0.15", "≈ US$0.05–0.15")}</b></td><td>{t("加上 ElevenLabs 月费和 OpenRouter 充值", "plus the ElevenLabs plan and OpenRouter top-ups")}</td></tr>
                <tr className="ex-group"><td colSpan={3}>{t("可选的付费升级", "Optional paid upgrades")}</td></tr>
                <tr><td>{t("更清晰的口型（fal.ai lip-sync）", "Sharper lips (fal.ai lip-sync)")}</td><td>{t("US$3 / 分钟视频", "US$3 per minute of video")}</td><td>{t("Pro 版 US$5 / 分钟；需要 fal.ai 密钥", "Pro US$5 / min; needs a fal.ai key")}</td></tr>
                <tr><td>{t("照片说话（可灵数字人 / Fabric）", "Photo talking (Kling avatar / Fabric)")}</td><td>{t("US$3.4 / 分钟 · US$4.8–9 / 分钟", "US$3.4 / min · US$4.8–9 / min")}</td><td>{t("没有她的视频时用；fal.ai 密钥", "When there is no clip of her; fal.ai key")}</td></tr>
                <tr><td>{t("AI 动态镜头（凭空生成 5 秒画面）", "AI motion clips (a 5-second shot from words)")}</td><td>{t("US$0.09–0.42 / 段（Atlas Cloud、Higgsfield API）；fal.ai US$1.40 / 段", "US$0.09–0.42 each (Atlas Cloud, Higgsfield API); fal.ai US$1.40 each")}</td><td>{t("Wan 2.6 最便宜，可灵 3.0 画质最稳；按秒计费", "Wan 2.6 cheapest, Kling 3.0 steadiest; billed per second")}</td></tr>
                <tr><td>{t("租用 GPU 做顶级口型（LatentSync）", "Rented GPU for top lip-sync (LatentSync)")}</td><td>{t("约 US$0.05 / 分钟视频", "≈ US$0.05 per minute of video")}</td><td>{t("按小时租用，约 US$0.4 / 小时；需一天接入", "Hourly rental, ≈ US$0.4 / hour; a day to set up")}</td></tr>
                <tr><td>{t("专业级声音克隆（ElevenLabs PVC）", "Professional voice clone (ElevenLabs PVC)")}</td><td>{t("套餐内含 1 个", "1 included in the plan")}</td><td>{t("她本人录 30 分钟以上清晰音频", "She records 30+ minutes of clean audio")}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
        <footer className="ex-foot">{t("2026 年 10 月 10 日", "10 Oct 2026")}</footer>
      </main>
    </div>
  );
}

const CSS = `
.ex { min-height: 100vh; background: #f7f6f2; color: #1c1b19; font-size: 15px; line-height: 1.7; -webkit-text-size-adjust: 100%; }
.ex-head { display: flex; align-items: center; justify-content: space-between; max-width: 860px; margin: 0 auto; padding: 18px 20px 0; }
.ex-brand { font-size: 13px; font-weight: 600; letter-spacing: .02em; color: #6b675f; }
.ex-lang { display: inline-flex; border: 1px solid #dcd9d0; border-radius: 999px; overflow: hidden; background: #fff; }
.ex-lang button { border: 0; background: none; padding: 5px 13px; font: inherit; font-size: 12.5px; color: #6b675f; cursor: pointer; }
.ex-lang button[data-on] { background: #1c1b19; color: #fff; }
.ex-main { max-width: 860px; margin: 0 auto; padding: 22px 20px 60px; }
.ex h1 { font-size: 26px; line-height: 1.3; font-weight: 700; margin: 6px 0 12px; letter-spacing: -.01em; }
.ex-lede { margin: 0 0 18px; color: #3b3934; }
.ex-card { margin-top: 18px; padding: 20px; background: #fff; border: 1px solid #e3e0d7; border-radius: 14px; }
.ex-card h2 { font-size: 18px; font-weight: 650; margin: 0 0 6px; }
.ex-card p { margin: 0 0 12px; color: #3b3934; }
.ex-card video { display: block; width: 100%; max-width: 360px; aspect-ratio: 9/16; background: #000; border-radius: 12px; }
.ex-dl { display: inline-block; margin-top: 10px; font-size: 13.5px; color: #1f448f; text-decoration: none; }
.ex-row { display: flex; gap: 20px; flex-wrap: wrap; }
.ex-row audio { display: block; width: 300px; max-width: 100%; }
.ex-cap { font-size: 12.5px; color: #6b675f; margin-bottom: 4px; }
.ex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.ex-grid figure { margin: 0; }
.ex-grid img { display: block; width: 100%; aspect-ratio: 9/16; object-fit: cover; border-radius: 10px; border: 1px solid #e3e0d7; }
.ex-grid figcaption { font-size: 12.5px; color: #6b675f; margin-top: 4px; }
.ex-table-wrap { overflow-x: auto; border: 1px solid #e3e0d7; border-radius: 12px; }
.ex-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 560px; }
.ex-table th { text-align: left; font-weight: 600; color: #6b675f; padding: 10px 12px; border-bottom: 1px solid #e3e0d7; font-size: 12.5px; background: #faf9f6; }
.ex-table td { padding: 9px 12px; border-bottom: 1px solid #f0eee7; vertical-align: top; }
.ex-table tr:last-child td { border-bottom: 0; }
.ex-group td { background: #f3f1ea; font-weight: 600; color: #1c1b19; }
.ex-dark { background: #1c1b19; color: #f3f1ea; }
.ex-dark h2 { color: #fff; }
.ex-dark ul { margin: 0; padding-left: 20px; list-style: disc; }
.ex-dark li { margin-bottom: 6px; }
.ex-foot { margin-top: 22px; font-size: 12.5px; color: #8b877e; text-align: center; }
@media (max-width: 560px) { .ex h1 { font-size: 22px; } .ex-card { padding: 16px; } }
`;
