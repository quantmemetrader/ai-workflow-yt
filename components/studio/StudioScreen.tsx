"use client";

import * as React from "react";
import Link from "next/link";
import { notify } from "@/lib/client/notify";
import { uploadFiles } from "@/lib/client/upload";
import { cloneVoiceAction, generatePictureAction, generateVideoAction, speakAction, studioJobsAction, studioVoicesAction, talkingHostAction } from "@/app/(app)/studio/actions";

type Voice = { id: string; name: string; lang: "zh" | "en" | null; gender: string | null; source: "local" | "elevenlabs" };
type Model = { id: string; zh: string; en: string; noteZh: string; image: string | null };
type Tab = "host" | "voice" | "clone" | "image" | "video";
type Engine = { id: string; for: "image" | "video"; zh: string; en: string; noteZh: string };

/**
 * 配音和生成 (7 Oct): voice-over from text, a cloned voice from a recording,
 * and a short video from a description. Each says plainly what it needs
 * when something is not set up, and everything made goes to Files.
 */
export function StudioScreen({ zh, models, engines, imageLocal, falReady, isAdmin }: { zh: boolean; models: Model[]; engines: Engine[]; imageLocal: boolean; falReady: boolean; isAdmin: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [tab, setTab] = React.useState<Tab>("host");
  const [voices, setVoices] = React.useState<Voice[] | null>(null);
  const [eleven, setEleven] = React.useState<string>("");
  const loadVoices = React.useCallback(() => {
    void studioVoicesAction().then((r) => {
      const v = r as { voices?: Voice[]; eleven?: string; error?: string };
      if (v.error) return notify(v.error);
      setVoices(v.voices ?? []);
      setEleven(v.eleven ?? "");
    });
  }, []);
  React.useEffect(loadVoices, [loadVoices]);

  return (
    <div className="st">
      <style>{CSS}</style>
      <div className="st-head">
        <h1>{t("配音和生成", "Voice & video")}</h1>
        <p>{t("让主持人照着稿子说话、把文字变成配音、克隆一个声音、生成剪辑用的画面、用一句话生成一段视频。做好的都放在「文件」里，可以直接拖进剪辑。", "Text to voice-over, clone a voice, or make a short video from a sentence. Everything goes to Files, ready to edit.")}</p>
      </div>
      <div className="st-tabs" role="tablist">
        {([["host", t("主持人口播", "Host talking")], ["voice", t("配音", "Voice-over")], ["clone", t("克隆声音", "Clone a voice")], ["image", t("AI 生成图片", "AI pictures")], ["video", t("AI 生成视频", "AI video")]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className="st-tab" data-on={tab === k ? "" : undefined} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "host" ? <HostPanel zh={zh} voices={voices} eleven={eleven} engines={engines} ready={falReady} isAdmin={isAdmin} onClone={() => setTab("clone")} /> : null}
      {tab === "voice" ? <VoicePanel zh={zh} voices={voices} eleven={eleven} isAdmin={isAdmin} /> : null}
      {tab === "clone" ? <ClonePanel zh={zh} eleven={eleven} isAdmin={isAdmin} onCloned={() => { loadVoices(); setTab("voice"); }} /> : null}
      {tab === "image" ? <ImagePanel zh={zh} local={imageLocal} /> : null}
      {tab === "video" ? <VideoPanel zh={zh} models={models} ready={falReady} isAdmin={isAdmin} /> : null}
    </div>
  );
}

function ElevenNote({ zh, eleven, isAdmin }: { zh: boolean; eleven: string; isAdmin: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  if (eleven === "ok" || !eleven) return null;
  return (
    <div className="st-note">
      {eleven === "no-key"
        ? t("还没有设置 ElevenLabs 密钥：现在只能用工作室自己的声音。", "No ElevenLabs key yet: only the studio's own voices for now.")
        : eleven === "refused"
          ? t("ElevenLabs 目前拒绝服务器所在的网络，它的声音库和克隆暂时用不了；工作室自己的声音照常可用。我们正在接通。", "ElevenLabs is refusing the server's network, so its library and cloning are unavailable for now; the studio's own voices work.")
          : t("ElevenLabs 暂时连不上，稍后再试。", "ElevenLabs can't be reached right now.")}
      {isAdmin && eleven === "no-key" ? (
        <>
          {" "}
          <Link href="/admin?tab=credentials">{t("去设置密钥", "Set the key")}</Link>
        </>
      ) : null}
    </div>
  );
}

const HOST_KEY = "tg:studio-host";

/** 主持人口播: her photo or a clip, the words, a voice; the video lands in Files. */
function HostPanel({ zh, voices, eleven, engines, ready, isAdmin, onClone }: { zh: boolean; voices: Voice[] | null; eleven: string; engines: Engine[]; ready: boolean; isAdmin: boolean; onClone: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [host, setHost] = React.useState<{ id: string; name: string; kind: "image" | "video" } | null>(null);
  const [text, setText] = React.useState("");
  const [voice, setVoice] = React.useState("");
  const [engine, setEngine] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [rows, setRows] = React.useState<{ jobId: string; text: string; status: string; progress: number; error: string | null; fileId?: string }[]>([]);
  const pick = React.useRef<HTMLInputElement | null>(null);
  /* The host's photo is chosen once and remembered on this computer. */
  React.useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(HOST_KEY) ?? "null");
      if (v?.id) setHost(v);
    } catch {
      /* nothing remembered */
    }
  }, []);
  React.useEffect(() => {
    if (!voice && voices?.length) setVoice((voices.find((v) => /avon|亚芳/i.test(v.name)) ?? voices.find((v) => v.source === "elevenlabs") ?? voices.find((v) => v.lang === "zh" && v.gender === "female") ?? voices[0]).id);
  }, [voices, voice]);
  /* Only what can run now: the free one always, fal.ai's engines once their key is set (10 Oct: "just show which is available"). */
  const fits = engines.filter((e) => (!host || e.for === host.kind) && (ready || e.id.startsWith("local/")));
  React.useEffect(() => {
    if (!fits.some((e) => e.id === engine)) setEngine(fits[0]?.id ?? "");
  }, [fits, engine]);
  const live = rows.some((r) => r.status === "queued" || r.status === "running");
  React.useEffect(() => {
    if (!live) return;
    const tick = window.setInterval(async () => {
      const r = (await studioJobsAction(rows.map((x) => x.jobId))) as { jobs?: { id: string; status: string; progress: number; error: string | null; result: { fileId?: string } | null }[] };
      setRows((cur) => cur.map((x) => {
        const j = r.jobs?.find((y) => y.id === x.jobId);
        return j ? { ...x, status: j.status, progress: j.progress, error: j.error, fileId: j.result?.fileId } : x;
      }));
    }, 4000);
    return () => window.clearInterval(tick);
  }, [live, rows]);
  const upload = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await uploadFiles(list, {
        onDone: (id, file) => {
          const next = { id, name: file.name, kind: file.type.startsWith("video/") ? ("video" as const) : ("image" as const) };
          setHost(next);
          try {
            localStorage.setItem(HOST_KEY, JSON.stringify(next));
          } catch {
            /* not remembered, still chosen */
          }
        },
      });
    } finally {
      setUploading(false);
    }
  };
  const go = async () => {
    if (!host) return;
    setBusy(true);
    try {
      const r = (await talkingHostAction({ hostFileId: host.id, text, voiceId: voice, engine })) as { error?: string; jobId?: string };
      if (r.error) return notify(r.error);
      setRows((cur) => [{ jobId: r.jobId!, text, status: "queued", progress: 0, error: null }, ...cur]);
      notify(engine.startsWith("local/") ? t("开始生成了：本机对口型大约每分钟视频等 7 分钟，可以先做别的", "Started; the on-server lip-sync takes about 7 minutes per minute of video") : t("开始生成了，通常要 2 到 6 分钟，可以先做别的", "Started; it usually takes 2–6 minutes"), "ok");
    } finally {
      setBusy(false);
    }
  };
  const cloned = voices?.filter((v) => v.source === "elevenlabs") ?? [];
  return (
    <div className="st-card">
      {!ready && !engine.startsWith("local/") ? (
        <div className="st-note">
          {t("这种生成方式需要 fal.ai 密钥（和「AI 生成视频」用同一个）；「本机对口型（免费）」不需要密钥。", "This engine needs a fal.ai key (the same one as AI video); the free on-server lip-sync needs none.")}
          {isAdmin ? <> <Link href="/admin?tab=credentials">{t("去设置密钥", "Set the key")}</Link></> : t("请管理员设置。", " Ask an admin to set it.")}
        </div>
      ) : null}
      <p className="st-help">{t("上传主持人一张清晰的正脸照片，或一段她面对镜头说话的视频，写下要说的话，选她的声音，就能生成她照稿说话的视频。只用本人同意使用的肖像和声音。", "Upload a clear front-facing photo of the host, or a clip of her talking to camera, write the words and pick her voice: you get a video of her saying them. Only use a likeness and voice the person has agreed to.")}</p>
      <label className="st-label">{t("1. 主持人的照片或视频", "1. The host's photo or clip")}</label>
      <div className="st-row">
        <button type="button" className="st-ghost" disabled={uploading} onClick={() => pick.current?.click()}>
          {uploading ? t("上传中…", "Uploading…") : host ? t("换一个", "Change") : t("上传照片或视频", "Upload a photo or clip")}
        </button>
        <span className="st-count">{host ? `${host.kind === "video" ? t("视频", "Clip") : t("照片", "Photo")}：${host.name}` : t("正脸、光线好、不戴口罩墨镜；视频 10 到 60 秒最好", "Front-facing, well lit; a clip of 10–60 s works best")}</span>
        <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" hidden onChange={(e) => void upload(e.target.files).then(() => (e.target.value = ""))} />
      </div>
      <label className="st-label">{t("2. 要说的话", "2. What she says")}</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={t("粘贴口播稿。一次最多 1500 字（约 5 分钟），长稿分几段生成。", "Paste the script, up to 1,500 characters (about 5 minutes).")} />
      <label className="st-label">{t("3. 声音", "3. The voice")}</label>
      <div className="st-row">
        <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label={t("声音", "Voice")}>
          {!voices ? <option>{t("正在读取声音…", "Loading voices…")}</option> : null}
          {cloned.length ? (
            <optgroup label={t("克隆和 ElevenLabs 的声音", "Cloned and ElevenLabs voices")}>
              {cloned.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </optgroup>
          ) : null}
          <optgroup label={t("工作室的声音", "Studio voices")}>
            {(voices ?? []).filter((v) => v.source === "local").map((v) => (
              <option key={v.id} value={v.id}>{v.name}{v.gender ? ` · ${v.gender === "female" ? t("女声", "female") : t("男声", "male")}` : ""}</option>
            ))}
          </optgroup>
        </select>
        {!cloned.length ? <button type="button" className="st-link" onClick={onClone}>{eleven === "ok" ? t("先克隆主持人的声音 →", "Clone her voice first →") : t("想用她本人的声音？先克隆 →", "Want her own voice? Clone it →")}</button> : null}
      </div>
      <label className="st-label">{t("4. 生成方式", "4. How it is made")}</label>
      <div className="st-row">
        <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label={t("生成方式", "Engine")}>
          {fits.map((e) => <option key={e.id} value={e.id}>{zh ? e.zh : e.en} · {e.noteZh}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" className="st-solid" disabled={busy || (!ready && !engine.startsWith("local/")) || !host || !text.trim() || !voice} onClick={() => void go()}>
          {busy ? t("提交中…", "Sending…") : t("生成口播视频", "Make the video")}
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.jobId} className="st-out">
          <div className="st-out-name">{r.text.slice(0, 60)}</div>
          {r.status === "succeeded" && r.fileId ? (
            <>
              <video controls src={`/api/files/${r.fileId}/download`} style={{ maxHeight: 320, borderRadius: 8 }} />
              <a href={`/api/files/${r.fileId}/download?download=1`}>{t("下载视频", "Download")}</a>
              <Link href={`/files/${r.fileId}`}>{t("在文件里打开（可以拖进剪辑）", "Open in Files")}</Link>
            </>
          ) : r.status === "failed" || r.status === "cancelled" ? (
            <span className="st-err">{r.error ?? t("没生成成功", "Failed")}</span>
          ) : (
            <span className="st-bar"><span style={{ width: `${Math.max(4, Math.round(r.progress * 100))}%` }} /></span>
          )}
        </div>
      ))}
      <p className="st-help">{t("先读成配音（也会放进「文件」），再让照片或视频里的她照着说。按 fal.ai 的价格计费，约每分钟 1 到 6 美元，视生成方式而定。", "The words are read first (that audio also goes to Files), then her photo or clip is made to say them. Billed by fal.ai, roughly US$1–6 a minute depending on the engine.")}</p>
    </div>
  );
}

function VoicePanel({ zh, voices, eleven, isAdmin }: { zh: boolean; voices: Voice[] | null; eleven: string; isAdmin: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [text, setText] = React.useState("");
  const [voice, setVoice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [made, setMade] = React.useState<{ id: string; name: string; durationMs: number }[]>([]);
  React.useEffect(() => {
    if (!voice && voices?.length) setVoice((voices.find((v) => v.lang === "zh" && v.source === "local") ?? voices[0]).id);
  }, [voices, voice]);
  const go = async () => {
    setBusy(true);
    try {
      const r = (await speakAction(text, voice)) as { error?: string; id?: string; name?: string; durationMs?: number };
      if (r.error) return notify(r.error);
      setMade((m) => [{ id: r.id!, name: r.name!, durationMs: r.durationMs ?? 0 }, ...m]);
      notify(t("配音好了，已放进「文件」", "Done; it's in Files"), "ok");
    } finally {
      setBusy(false);
    }
  };
  const groups: [string, Voice[]][] = voices
    ? [
        [t("克隆和 ElevenLabs 的声音", "Cloned and ElevenLabs voices"), voices.filter((v) => v.source === "elevenlabs")],
        [t("中文声音", "Chinese voices"), voices.filter((v) => v.source === "local" && v.lang === "zh")],
        [t("英文声音", "English voices"), voices.filter((v) => v.source === "local" && v.lang === "en")],
      ]
    : [];
  return (
    <div className="st-card">
      <ElevenNote zh={zh} eleven={eleven} isAdmin={isAdmin} />
      <label className="st-label">{t("要读的文字", "Text to read")}</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={t("粘贴口播稿，空一行就是一个停顿。一次最多 5000 字。", "Paste the script; a blank line is a pause. Up to 5,000 characters.")} />
      <div className="st-row">
        <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label={t("声音", "Voice")}>
          {!voices ? <option>{t("正在读取声音…", "Loading voices…")}</option> : null}
          {groups.filter(([, list]) => list.length).map(([label, list]) => (
            <optgroup key={label} label={label}>
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.gender ? ` · ${v.gender === "female" ? t("女声", "female") : t("男声", "male")}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="st-count">{t(`${text.length} 字`, `${text.length} chars`)}</span>
        <button type="button" className="st-solid" disabled={busy || !text.trim() || !voice} onClick={() => void go()}>
          {busy ? t("生成中…", "Generating…") : t("生成配音", "Make voice-over")}
        </button>
      </div>
      {made.map((m) => (
        <div key={m.id} className="st-out">
          <div className="st-out-name">{m.name} · {Math.round(m.durationMs / 1000)}s</div>
          <audio controls src={`/api/files/${m.id}/download`} />
          <a href={`/api/files/${m.id}/download?download=1`}>{t("下载 MP3", "Download MP3")}</a>
          <Link href={`/files/${m.id}`}>{t("在文件里打开", "Open in Files")}</Link>
        </div>
      ))}
    </div>
  );
}

function ClonePanel({ zh, eleven, isAdmin, onCloned }: { zh: boolean; eleven: string; isAdmin: boolean; onCloned: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [name, setName] = React.useState("");
  const [samples, setSamples] = React.useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement | null>(null);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      await uploadFiles(list, { onDone: (id, f) => setSamples((s) => [...s, { id, name: f.name }]) });
    } finally {
      setUploading(false);
    }
  };
  const go = async () => {
    setBusy(true);
    try {
      const r = (await cloneVoiceAction(name, samples.map((s) => s.id))) as { error?: string; voiceId?: string };
      if (r.error) return notify(r.error);
      notify(t("新声音做好了，在「配音」里可以选它", "The new voice is ready in Voice-over"), "ok");
      onCloned();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="st-card">
      <ElevenNote zh={zh} eleven={eleven} isAdmin={isAdmin} />
      <p className="st-help">{t("上传同一个人 1 到 5 段清晰的录音（合计 1 分钟以上，没有背景音乐），就能做出一个像他的声音，之后在「配音」里选它。只克隆本人同意的声音。", "Upload 1–5 clean recordings of one person (a minute or more in total, no music) to make a voice like theirs. Only clone a voice with the person's consent.")}</p>
      <label className="st-label">{t("新声音的名字", "Name of the new voice")}</label>
      <input className="st-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("例如：亚芳本人", "e.g. Avon")} />
      <label className="st-label">{t("声音样本", "Recordings")}</label>
      <div className="st-row">
        <button type="button" className="st-ghost" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? t("上传中…", "Uploading…") : t("选录音文件", "Choose recordings")}
        </button>
        <span className="st-count">{samples.map((s) => s.name).join("、") || t("还没有样本（mp3、wav、m4a 都行）", "No recordings yet (mp3, wav, m4a)")}</span>
        <input ref={input} type="file" accept="audio/*,video/mp4" multiple hidden onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
      </div>
      <button type="button" className="st-solid" disabled={busy || !name.trim() || !samples.length || eleven !== "ok"} onClick={() => void go()}>
        {busy ? t("克隆中…", "Cloning…") : t("克隆这个声音", "Clone this voice")}
      </button>
    </div>
  );
}

/** AI 生成图片: the cinematic still a reel cuts to; made on this machine (free, about five minutes) or on Pollinations (seconds). */
function ImagePanel({ zh, local }: { zh: boolean; local: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [prompt, setPrompt] = React.useState("");
  const [aspect, setAspect] = React.useState<"portrait" | "landscape" | "square">("portrait");
  const [quality, setQuality] = React.useState<"quick" | "fine">("quick");
  const [rows, setRows] = React.useState<{ jobId: string; prompt: string; status: string; progress: number; error: string | null; fileId?: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const live = rows.some((r) => r.status === "queued" || r.status === "running");
  React.useEffect(() => {
    if (!live) return;
    const tick = window.setInterval(async () => {
      const r = (await studioJobsAction(rows.map((x) => x.jobId))) as { jobs?: { id: string; status: string; progress: number; error: string | null; result: { fileId?: string } | null }[] };
      setRows((cur) => cur.map((x) => {
        const j = r.jobs?.find((y) => y.id === x.jobId);
        return j ? { ...x, status: j.status, progress: j.progress, error: j.error, fileId: j.result?.fileId } : x;
      }));
    }, 4000);
    return () => window.clearInterval(tick);
  }, [live, rows]);
  const go = async () => {
    setBusy(true);
    try {
      const r = (await generatePictureAction({ prompt, aspect, engine: "local", quality })) as { error?: string; jobId?: string };
      if (r.error) return notify(r.error);
      setRows((cur) => [{ jobId: r.jobId!, prompt, status: "queued", progress: 0, error: null }, ...cur]);
      notify(quality === "fine" ? t("开始生成了，精细模式大约 5 分钟一张，可以先做别的", "Started; the fine mode takes about 5 minutes a picture") : t("开始生成了，大约 2 分钟，可以先做别的", "Started; about 2 minutes"), "ok");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="st-card">
      {!local ? <div className="st-note">{t("图片生成器现在没在运行，请管理员重启它。", "The picture generator is not running; ask an admin to restart it.")}</div> : null}
      <p className="st-help">{t("用一句话生成一张电影感的画面，剪辑时切过去用。写清楚：主体、场景、光线、镜头、氛围，英文效果最好；画面里不要文字。做好的图在「文件」里，可以直接拖进剪辑。", "One sentence becomes a cinematic still to cut to. Say the subject, setting, light, lens and mood; English works best; no text in the picture. Finished pictures are in Files, ready to drag into the edit.")}</p>
      <label className="st-label">{t("画面描述", "Describe the picture")}</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder={t("例如：a trading floor at dusk, every screen glowing red, one trader standing still, cinematic, 35mm, shallow depth of field", "e.g. a trading floor at dusk, every screen glowing red, one trader standing still, cinematic, 35mm")} />
      <div className="st-row">
        <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} aria-label={t("画质", "Quality")}>
          <option value="quick">{t("快速（约 2 分钟）", "Quick (about 2 minutes)")}</option>
          <option value="fine">{t("精细（约 5 分钟，更大更清晰）", "Fine (about 5 minutes, larger and sharper)")}</option>
        </select>
        <select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)} aria-label={t("画幅", "Aspect")}>
          <option value="portrait">{t("竖屏 9:16", "Portrait 9:16")}</option>
          <option value="landscape">{t("横屏 16:9", "Landscape 16:9")}</option>
          <option value="square">{t("方形 1:1", "Square 1:1")}</option>
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" className="st-solid" disabled={busy || !local || prompt.trim().length < 4} onClick={() => void go()}>
          {busy ? t("提交中…", "Sending…") : t("生成图片", "Generate")}
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.jobId} className="st-out">
          <div className="st-out-name">{r.prompt.slice(0, 80)}</div>
          {r.status === "succeeded" && r.fileId ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${r.fileId}/download`} alt="" style={{ maxHeight: 360, maxWidth: "100%", borderRadius: 8, objectFit: "contain" }} />
              <a href={`/api/files/${r.fileId}/download?download=1`}>{t("下载", "Download")}</a>
              <Link href={`/files/${r.fileId}`}>{t("在文件里打开（可以拖进剪辑）", "Open in Files")}</Link>
            </>
          ) : r.status === "failed" || r.status === "cancelled" ? (
            <span className="st-err">{r.error ?? t("没生成成功", "Failed")}</span>
          ) : (
            <span className="st-bar"><span style={{ width: `${Math.max(4, Math.round(r.progress * 100))}%` }} /></span>
          )}
        </div>
      ))}
      <p className="st-help">{t("在我们自己的服务器上生成，免费，不限张数；一次做一张，排队按先后。", "Made on our own server, free, no limit; one at a time, in the order asked.")}</p>
    </div>
  );
}

function VideoPanel({ zh, models, ready, isAdmin }: { zh: boolean; models: Model[]; ready: boolean; isAdmin: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [prompt, setPrompt] = React.useState("");
  const [model, setModel] = React.useState(models[0]?.id ?? "");
  const [aspect, setAspect] = React.useState<"16:9" | "9:16" | "1:1">("9:16");
  const [seconds, setSeconds] = React.useState(5);
  const [image, setImage] = React.useState<{ id: string; name: string } | null>(null);
  const [rows, setRows] = React.useState<{ jobId: string; prompt: string; status: string; progress: number; error: string | null; fileId?: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const pic = React.useRef<HTMLInputElement | null>(null);
  const live = rows.some((r) => r.status === "queued" || r.status === "running");
  React.useEffect(() => {
    if (!live) return;
    const tick = window.setInterval(async () => {
      const r = (await studioJobsAction(rows.map((x) => x.jobId))) as { jobs?: { id: string; status: string; progress: number; error: string | null; result: { fileId?: string } | null }[] };
      setRows((cur) => cur.map((x) => {
        const j = r.jobs?.find((y) => y.id === x.jobId);
        return j ? { ...x, status: j.status, progress: j.progress, error: j.error, fileId: j.result?.fileId } : x;
      }));
    }, 4000);
    return () => window.clearInterval(tick);
  }, [live, rows]);
  const go = async () => {
    setBusy(true);
    try {
      const r = (await generateVideoAction({ prompt, model, aspect, seconds, imageFileId: image?.id })) as { error?: string; jobId?: string };
      if (r.error) return notify(r.error);
      setRows((cur) => [{ jobId: r.jobId!, prompt, status: "queued", progress: 0, error: null }, ...cur]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="st-card">
      {!ready ? (
        <div className="st-note">
          {t("AI 生成视频需要 fal.ai 密钥（一个密钥就能用可灵、海螺、即梦）。", "AI video needs a fal.ai key (one key covers Kling, Hailuo and Seedance).")}
          {isAdmin ? <> <Link href="/admin?tab=credentials">{t("去设置密钥", "Set the key")}</Link></> : t("请管理员设置。", " Ask an admin to set it.")}
        </div>
      ) : null}
      <label className="st-label">{t("画面描述", "Describe the shot")}</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder={t("谁、在哪、在做什么、什么镜头。例如：夜晚的香港维港，镜头从海面缓缓推向灯火通明的高楼，电影感。", "Who, where, doing what, which camera move.")} />
      <div className="st-row">
        <select value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("模型", "Model")}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {zh ? m.zh : m.en} · {m.noteZh}
            </option>
          ))}
        </select>
        <select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)} aria-label={t("画幅", "Aspect")}>
          <option value="9:16">{t("竖屏 9:16", "Portrait 9:16")}</option>
          <option value="16:9">{t("横屏 16:9", "Landscape 16:9")}</option>
          <option value="1:1">{t("方形 1:1", "Square 1:1")}</option>
        </select>
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label={t("时长", "Length")}>
          <option value={5}>{t("约 5 秒", "~5 s")}</option>
          <option value={10}>{t("约 10 秒", "~10 s")}</option>
        </select>
      </div>
      <div className="st-row">
        <button type="button" className="st-ghost" onClick={() => pic.current?.click()}>
          {image ? t(`起始画面：${image.name}`, `First frame: ${image.name}`) : t("可选：上传一张起始画面", "Optional: a first frame")}
        </button>
        {image ? <button type="button" className="st-link" onClick={() => setImage(null)}>{t("去掉", "Remove")}</button> : null}
        <input ref={pic} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files; if (f?.length) void uploadFiles(f, { onDone: (id, file) => setImage({ id, name: file.name }) }); e.target.value = ""; }} />
        <span style={{ flex: 1 }} />
        <button type="button" className="st-solid" disabled={busy || !ready || prompt.trim().length < 4} onClick={() => void go()}>
          {busy ? t("提交中…", "Sending…") : t("生成视频", "Generate")}
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.jobId} className="st-out">
          <div className="st-out-name">{r.prompt.slice(0, 60)}</div>
          {r.status === "succeeded" && r.fileId ? (
            <>
              <video controls src={`/api/files/${r.fileId}/download`} style={{ maxHeight: 280, borderRadius: 8 }} />
              <Link href={`/files/${r.fileId}`}>{t("在文件里打开", "Open in Files")}</Link>
            </>
          ) : r.status === "failed" || r.status === "cancelled" ? (
            <span className="st-err">{r.error ?? t("没生成成功", "Failed")}</span>
          ) : (
            <span className="st-bar"><span style={{ width: `${Math.max(4, Math.round(r.progress * 100))}%` }} /></span>
          )}
        </div>
      ))}
      <p className="st-help">{t("生成一段通常要 1 到 4 分钟，按 fal.ai 的价格计费（每段约 0.2 到 1 美元）。只生成工作室有权使用的内容。", "A clip usually takes 1–4 minutes and is billed by fal.ai (about US$0.2–1 each).")}</p>
    </div>
  );
}

const CSS = `
.st { flex-grow: 1; min-width: 0; overflow-y: auto; padding: 22px 28px 40px; display: flex; flex-direction: column; gap: 14px; max-width: 920px; }
.st-head h1 { margin: 0; font-size: 20px; font-weight: 600; color: #171717; }
.st-head p { margin: 6px 0 0; font-size: 13px; color: #6b6b6b; line-height: 1.6; }
.st-tabs { display: flex; gap: 4px; border-bottom: 1px solid #ebeae6; }
.st-tab { border: 0; background: none; padding: 9px 14px; font: inherit; font-size: 14px; color: #6b6b6b; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.st-tab[data-on] { color: #171717; font-weight: 600; border-bottom-color: #171717; }
.st-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid #ebeae6; border-radius: 12px; background: #fff; }
.st-label { font-size: 12.5px; font-weight: 600; color: #3c3c3c; }
.st-card textarea, .st-input { border: 1px solid #dcdbd6; border-radius: 9px; padding: 10px 12px; font: inherit; font-size: 13.5px; line-height: 1.6; outline: none; resize: vertical; }
.st-input { height: 38px; padding: 0 12px; }
.st-card textarea:focus, .st-input:focus, .st-card select:focus { border-color: #171717; }
.st-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.st-card select { height: 36px; border: 1px solid #dcdbd6; border-radius: 9px; padding: 0 10px; font: inherit; font-size: 13px; background: #fff; max-width: 100%; }
.st-count { font-size: 12px; color: #8a8a8a; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-solid, .st-ghost { height: 36px; padding: 0 16px; border-radius: 9px; font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.st-solid { border: 0; background: #171717; color: #fff; align-self: flex-start; }
.st-ghost { border: 1px solid #dcdbd6; background: #fff; color: #171717; }
.st-solid:disabled, .st-ghost:disabled { opacity: .45; cursor: default; }
.st-link { border: 0; background: none; color: #1a73e8; font: inherit; font-size: 12.5px; cursor: pointer; }
.st-note { padding: 9px 12px; border-radius: 9px; background: #fef7e0; color: #5c4400; font-size: 12.5px; line-height: 1.6; }
.st-note a { color: #1a73e8; }
.st-help { margin: 0; font-size: 12px; color: #8a8a8a; line-height: 1.6; }
.st-out { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid #f0efeb; border-radius: 10px; font-size: 12.5px; }
.st-out a { color: #1a73e8; text-decoration: none; }
.st-out-name { font-weight: 500; color: #2b2b2b; }
.st-err { color: #c42b2b; }
.st-bar { display: block; height: 6px; border-radius: 3px; background: #eeede9; overflow: hidden; }
.st-bar span { display: block; height: 100%; background: #171717; transition: width .4s ease; }
`;
