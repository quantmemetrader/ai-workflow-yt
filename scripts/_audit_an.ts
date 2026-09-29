import { readFileSync } from "node:fs";
import { hasTraditional, toSimplified } from "@/lib/text/simplified";
const { out, errors } = JSON.parse(readFileSync("/tmp/audit/result.json", "utf8"));
const ALLOW = new Set("AI YouTube LinkedIn TikTok Instagram Facebook Threads Pinterest Catherine GPT OpenAI ChatGPT Claude DeepSeek RWA Reels Muse Meta Anthropic Nvidia Google TPU Sora CZ BTC ETF PDF Word DOCX TXT MD MP4 MB GB KB PNG JPG Gemini Kimi Qwen Grok Mistral Llama Sonnet Opus Haiku Tengya Rednote Bilibili Douyin Zernio TikHub R2 URL ID API Whisper ElevenLabs Openverse Flickr Wikimedia".split(" "));
const trad = new Map<string, Set<string>>();
const eng = new Map<string, Set<string>>();
for (const p of out) {
  if (p.w !== 1280) continue;
  for (const line of String(p.text).split("\n")) if (hasTraditional(line)) { const bad = Array.from(line).filter((c) => toSimplified(c) !== c).join(""); (trad.get(p.r) ?? trad.set(p.r, new Set()).get(p.r)!).add(`[${bad}] ${line.trim().slice(0, 90)}`); }
  for (const t of [...p.ui, ...p.attrs]) {
    const words = String(t).match(/[A-Za-z][A-Za-z'’-]{2,}/g) ?? [];
    const bad = words.filter((x: string) => !ALLOW.has(x));
    if (bad.length && !/[一-鿿]/.test(t)) (eng.get(p.r) ?? eng.set(p.r, new Set()).get(p.r)!).add(String(t).replace(/\s+/g, " ").slice(0, 90));
  }
}
console.log("=== STATUS / SCROLL / LAYOUT ===");
for (const p of out) {
  const flag = p.status !== 200 || p.pageScroll || p.issues.length;
  if (flag) {
    console.log(`${p.w} ${p.r} status=${p.status} scroll=${p.pageScroll}${p.finalUrl.includes(p.r.split("?")[0]) ? "" : " -> " + p.finalUrl}`);
    for (const i of p.issues.slice(0, 12)) console.log(`   ${i.kind} +${i.by}px  "${i.text}"  ${i.el}`);
  }
}
console.log("=== TRADITIONAL ===");
for (const [r, s] of trad) { console.log(r); for (const x of [...s].slice(0, 8)) console.log("   " + x); }
console.log("=== ENGLISH UI (no Chinese in the same label) ===");
for (const [r, s] of eng) { console.log(r); for (const x of [...s].slice(0, 12)) console.log("   " + x); }
console.log("=== PAGE ERRORS ===", errors.slice(0, 10));
