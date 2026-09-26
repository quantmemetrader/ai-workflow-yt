#!/usr/bin/env python3
"""
Text to speech, on this box, for narration and voice-overs.

Why this exists: ElevenLabs refuses this server's IP and the account is a free
tier of 10,000 characters a month, so a studio that wants a narrated video from
a script cannot get one from it. This machine has 16 cores and no GPU, which
is exactly what Kokoro-82M was built for.

The engine is Kokoro-82M (Apache-2.0, https://huggingface.co/hexgrad/Kokoro-82M):
  - v1.1-zh for Mandarin: 100 voices from a professional dataset LongMaoData
    granted for this use, plus three English ones (af_maple, af_sol, bf_vale);
  - v1.0 for the better English voices (af_heart, am_michael, bf_emma, ...).
Measured here, 8 threads: a 174-character Mandarin paragraph (43 s of audio)
in 4.9 s, real-time factor 0.115, and the local Whisper reads it back at a 1.2%
character error rate (both errors are 它 heard as 他, the same sound).

It prints exactly ONE JSON object on stdout and nothing else, because
`lib/video/tts/local.ts` parses stdout whole. Every diagnostic goes to stderr.

    echo "模型蒸馏，就是让一个小模型向大模型学习。" | \\
      /opt/tts/venv/bin/python /opt/tts/speak.py --voice zf_001 --out /tmp/a.mp3

    # what the app sends: sentences it has already split, each with the pause after it
    /opt/tts/venv/bin/python /opt/tts/speak.py --json --out /tmp/a.wav < request.json
      {"voice": "zf_001", "speed": 1.0,
       "sentences": [{"text": "...", "pauseMs": 350}, {"text": "...", "pauseMs": 700}]}

The JSON on stdout:
    {"engine": "kokoro", "model": "v1.1-zh", "voice": "zf_001", "sampleRate": 24000,
     "durationMs": 9123, "out": "/tmp/a.wav",
     "sentences": [{"i": 0, "text": "...", "startMs": 120, "endMs": 3480,
                    "words": [{"text": "模", "start": 0.12, "end": 0.31}, ...]}]}

`startMs`/`endMs` are where the voice starts and stops inside the finished file
(not where the sentence's slot starts), and every `words` entry is one Han
character (punctuation rides on the character before it) or one English word,
with times in seconds on the same clock. Those are what captions are cut from.
"""

import os
import sys

# Set before torch is imported: its OpenMP pool reads the ceiling once. Six of
# the sixteen cores, the same deal the local Whisper has: a voice-over is never
# what the studio waits on, a render is, and one starting beside this still
# gets ten cores to itself.
_THREADS = os.environ.get("TTS_THREADS", "6")
os.environ.setdefault("OMP_NUM_THREADS", _THREADS)
os.environ.setdefault("MKL_NUM_THREADS", _THREADS)
# The ~700 MB of weights live beside the venv, never in the home directory of
# whichever user runs the job, and are never fetched at run time: a job that
# silently downloads a model is a job that hangs when the network does.
os.environ.setdefault("HF_HOME", os.environ.get("TTS_CACHE", "/opt/tts/models"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import argparse  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402
import warnings  # noqa: E402

logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
# jieba (misaki's Chinese word splitter) announces its dictionary at DEBUG.
logging.getLogger("jieba").setLevel(logging.WARNING)
warnings.filterwarnings("ignore")

SAMPLE_RATE = 24000
# One duration frame of Kokoro's predictor is 600 samples at 24 kHz.
FRAME_S = 600 / SAMPLE_RATE

ZH_REPO = "hexgrad/Kokoro-82M-v1.1-zh"
EN_REPO = "hexgrad/Kokoro-82M"
# English voices that only exist in (and sound best from) v1.0.
V10_ONLY = {
    "af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "af_nova", "af_sky", "af_alloy", "af_jessica", "af_river",
    "am_michael", "am_fenrir", "am_puck", "am_echo", "am_eric", "am_liam", "am_onyx", "am_adam", "am_santa",
    "bf_emma", "bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_fable", "bm_lewis", "bm_daniel",
}

# Mandarin sentence punctuation, and what misaki writes for it in phonemes.
CLAUSE = "，、；：,;:"
FINAL = "。！？!?…"
PUNCT = CLAUSE + FINAL + "“”‘’\"'（）()《》〈〉「」『』【】—-~·"
HAN = re.compile(r"[㐀-鿿豈-﫿]")
OPENERS = "“‘（(《〈「『【"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ------------------------------------------------------------------ reading

HAN_DIGITS = dict(zip("0123456789", "零一二三四五六七八九"))


def speakable_zh(text):
    """What the Mandarin G2P should *read*, for text that writes it another way.

    misaki turns digits into words with cn2an, which takes a hyphen before a
    digit for a minus sign and knows nothing of product names. Measured in
    the phonemes it produced (and heard back by Whisper as "GPT-FOOS"):

        GPT-4        "GPT 负四"          minus four
        RTX 4090     "RTX 四千零九十"     a model number read as a quantity
        1,000美元    "一，零美元"         the separator read as a pause
        10:30        "十：三十"           a clause break in the middle of a time
        -5℃          "❓五摄氏度"          an unknown symbol, i.e. a gap
        3-5倍        "三负五倍"

    Only what is spoken changes. The caption timings are still cut against
    the text as written (`Engine.say`), so the screen keeps "GPT-4".
    """
    t = text
    t = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", t)  # 1,000 -> 1000
    t = re.sub(r"(?<![\d:])([01]?\d|2[0-4]):([0-5]\d)(?![\d:])", r"\1点\2", t)  # 10:30 -> 10点30
    t = re.sub(r"(?<=\d):(?=\d)", "比", t)  # 16:9, 3:1 -> 16比9, 3比1
    t = re.sub(r"(\d{4})\s*[-~～–—至到]\s*(\d{4})(?=年)", r"\1年到\2", t)  # 2025-2026年 -> 2025年到2026年
    t = re.sub(r"(?<=\d)\s*[-~～–]\s*(?=\d)", "到", t)  # 3-5倍 -> 3到5倍
    t = re.sub(r"(?<=[A-Za-z])-(?=\d)", " ", t)  # GPT-4, COVID-19 -> GPT 4, COVID 19
    t = re.sub(r"(?<![A-Za-z0-9])-(?=\d)", "负", t)  # -5 -> 负5
    # A long number straight after a name is a model number, said digit by
    # digit: RTX 4090 is 四零九零. (H100 stays 一百, which is how it is said.)
    t = re.sub(
        r"(?<=[A-Za-z])(\s?)(\d{4,})(?![\d.,%年])",
        lambda m: m.group(1) + "".join(HAN_DIGITS[c] for c in m.group(2)),
        t,
    )
    return t


# ------------------------------------------------------------------ splitting

def split_sentences(text, max_len=90):
    """Sentences, for text that arrived as one blob (the standalone mode).

    The app splits for itself and sends `--json`; this is the same rule for a
    person at a terminal. A sentence ends at 。！？!?；… or a line break; a
    fragment under four characters joins the one before it; anything past
    `max_len` is cut at the comma nearest its middle, because Kokoro was not
    trained on long inputs and rushes them.
    """
    parts = []
    for para in re.split(r"\n+", text.strip()):
        buf = ""
        for piece in re.split(r"(?<=[。！？!?；;…])", para):
            piece = piece.strip()
            if not piece:
                continue
            if buf and len(re.sub(r"\W", "", piece)) < 4:
                buf += piece
                continue
            if buf:
                parts.append(buf)
            buf = piece
        if buf:
            parts.append(buf)
    out = []
    for s in parts:
        out.extend(_halve(s, max_len))
    return out


def _halve(s, max_len):
    if len(s) <= max_len:
        return [s]
    cuts = [m.end() for m in re.finditer(r"[，、,：:]", s)]
    if not cuts:
        return [s]
    mid = len(s) / 2
    at = min(cuts, key=lambda c: abs(c - mid))
    if at <= 4 or at >= len(s) - 4:
        return [s]
    return _halve(s[:at], max_len) + _halve(s[at:], max_len)


# ------------------------------------------------------------------ engine

class Engine:
    def __init__(self, voice, threads):
        import torch

        torch.set_num_threads(int(threads))
        from kokoro import KModel, KPipeline

        try:  # jieba sets its own logger to DEBUG on import; stderr is for real trouble
            import jieba

            jieba.setLogLevel(logging.WARNING)
        except Exception:
            pass

        self.voice = voice
        self.lang = voice[0]  # z, a, b
        self.repo = EN_REPO if voice in V10_ONLY else ZH_REPO
        self.model_name = "v1.0" if self.repo == EN_REPO else "v1.1-zh"
        self.model = KModel(repo_id=self.repo).eval()
        if self.lang == "z":
            # English words inside Mandarin ("OpenAI 发布了…") are phonemised by
            # the English G2P rather than read out as question marks.
            en = KPipeline(lang_code="a", repo_id=self.repo, model=False)

            def en_callable(t):
                try:
                    return next(en(t)).phonemes
                except Exception:  # an unpronounceable token is skipped, not fatal
                    return ""

            self.pipe = KPipeline(lang_code="z", repo_id=self.repo, model=self.model, en_callable=en_callable)
        else:
            self.pipe = KPipeline(lang_code=self.lang, repo_id=self.repo, model=self.model)

    def speed_for(self, base):
        """Kokoro's own mitigation for rushing on long inputs (make_zh.py in the
        model repo): full speed up to ~83 phoneme tokens, easing to 0.8 of it at
        183. Applied to Mandarin only; the English model does not need it."""
        if self.lang != "z":
            return base

        def f(n):
            s = 1 if n <= 83 else (1 - (n - 83) / 500 if n < 183 else 0.8)
            return base * s * 1.1

        return f

    def say(self, text, speed):
        """One sentence -> (float32 audio, [(start_s, end_s, word)], speech_start_s, speech_end_s)."""
        import numpy as np

        audio_parts, words = [], []
        offset = 0.0
        speech_start = speech_end = None
        spoken = speakable_zh(text) if self.lang == "z" else text
        results = [r for r in self.pipe(spoken, voice=self.voice, speed=self.speed_for(speed), split_pattern=None) if r.audio is not None]
        # Captions are timed against the text as written ("GPT-4"), not what
        # the G2P was handed ("GPT 4"). A rewritten sentence always holds a
        # digit, so zh_words spreads it clause by clause, which needs only the
        # text and the clause marks. With one chunk (a sentence of the length
        # the app sends always is) that text is the whole sentence.
        shown = text if spoken != text and len(results) == 1 else None
        for r in results:
            a = r.audio.numpy().astype("float32")
            dur = r.output.pred_dur.tolist() if r.output is not None and r.output.pred_dur is not None else None
            if dur:
                lead = dur[0] * FRAME_S
                tail = dur[-1] * FRAME_S
                if speech_start is None:
                    speech_start = offset + lead
                speech_end = offset + len(a) / SAMPLE_RATE - tail
                if self.lang == "z":
                    # Where the sound really stops: the predictor gives the
                    # last tone mark of a sentence a long tail of silence.
                    thr = max(0.004, 0.02 * float(np.max(np.abs(a)))) if len(a) else 0.0
                    loud = np.flatnonzero(np.abs(a) > thr) if len(a) else []
                    limit = (int(loud[-1]) / SAMPLE_RATE + 0.05) if len(loud) else len(a) / SAMPLE_RATE
                    words += [(s + offset, e + offset, w) for s, e, w in zh_words(shown or r.graphemes, r.phonemes, dur, self.model.vocab, limit)]
                else:
                    for t in r.tokens or []:
                        if t.start_ts is None or t.end_ts is None:
                            continue
                        w = t.text.strip()
                        if w:
                            words.append((t.start_ts + offset, t.end_ts + offset, w))
            audio_parts.append(a)
            offset += len(a) / SAMPLE_RATE
        if not audio_parts:
            return np.zeros(0, dtype="float32"), [], 0.0, 0.0
        audio = np.concatenate(audio_parts)
        if self.lang != "z":
            words = attach_punctuation(words)
        return trim(audio, words, speech_start or 0.0, speech_end or offset)


def trim(audio, words, speech_start, speech_end):
    """Cut the model's own silence down to a breath at either end.

    Kokoro opens every call with about half a second of nothing and closes
    with a little more, so three sentences joined as they come out have a
    second of dead air between them — the pause *we* ask for on top. Trimmed
    to 60 ms before the first sound and 120 ms after the last, the pause the
    caller asks for is the pause the listener hears. The threshold is relative
    to the sentence's own peak, so a quiet voice is not trimmed into.
    """
    import numpy as np

    if not len(audio):
        return audio, words, speech_start, speech_end
    thr = max(0.004, 0.02 * float(np.max(np.abs(audio))))
    loud = np.flatnonzero(np.abs(audio) > thr)
    if not len(loud):
        return audio, words, speech_start, speech_end
    a0 = max(0, int(loud[0]) - int(0.06 * SAMPLE_RATE))
    a1 = min(len(audio), int(loud[-1]) + int(0.12 * SAMPLE_RATE))
    shift = a0 / SAMPLE_RATE
    length = (a1 - a0) / SAMPLE_RATE

    def clamp(t):
        return max(0.0, min(length, t - shift))

    words = [(clamp(s), clamp(e), w) for s, e, w in words]
    return audio[a0:a1], words, clamp(max(speech_start, loud[0] / SAMPLE_RATE)), clamp(min(speech_end, loud[-1] / SAMPLE_RATE))


def zh_words(text, phonemes, dur, vocab, limit=None):
    """Per-word timings for one Mandarin chunk, from the duration predictor.

    Kokoro predicts a length for every phoneme it is given, which is where the
    audio's timing actually comes from, so these are measurements of the file,
    not estimates spread across a line. misaki writes one syllable per Han
    character, each ending in its tone digit, and keeps clause punctuation, so
    the syllables can be counted off against the characters.

    When the counts do not match — digits read out as words ("2025" is four
    syllables), English inside the sentence — the clauses are still anchored at
    their punctuation and the characters inside a clause share its time by an
    estimate of how long each takes to say. Never worse than a clause off.
    """
    # Time of each phoneme character (skipping ones not in the vocab, exactly
    # as KModel.forward does), after the leading <bos> frame.
    t = dur[0] * FRAME_S
    ph_times = []  # (char, start, end) for chars that reached the model
    k = 1
    for ch in phonemes:
        if ch in vocab:
            d = dur[k] * FRAME_S if k < len(dur) - 1 else 0.0
            ph_times.append((ch, t, t + d))
            t += d
            k += 1
        else:
            ph_times.append((ch, t, t))

    # Syllables, the words they belong to, and clause marks. misaki separates
    # jieba's words with "/" (and English with spaces), so a syllable knows
    # which word it is in: captions then break between words ("机器人"), never
    # inside one ("机" / "器人").
    syl, marks = [], []
    cur_start = None
    word = 0
    for ch, s, e in ph_times:
        if ch in " /":
            cur_start = None
            word += 1
            continue
        if ch in ",.!?;:—…":
            marks.append((s, e))
            cur_start = None
            word += 1
            continue
        if cur_start is None:
            cur_start = s
        if ch in "12345":
            syl.append((cur_start, e, word))
            cur_start = None

    units = text_units(text)
    han = [u for u in units if u[1] == "han"]
    other = [u for u in units if u[1] in ("latin", "digit")]
    if limit is not None:
        syl = [(min(a, limit), min(b, limit), w) for a, b, w in syl]
    if syl and len(han) == len(syl) and not other:
        out, j, prefix, fresh = [], 0, "", True
        for u, kind in units:
            if kind == "han":
                s0, e0, wid = syl[j]
                j += 1
                if out and out[-1][3] == wid and not fresh:
                    out[-1][1] = e0
                    out[-1][2] += u
                else:
                    out.append([s0, e0, prefix + u, wid])
                    prefix = ""
                fresh = False
            elif u.strip():
                # Closing marks ride on the word before; an opening quote or
                # bracket waits for the word after. Either way a word ends
                # here, whatever the phonemes say (misaki drops quote marks).
                if out and u not in OPENERS:
                    out[-1][2] += u
                else:
                    prefix += u
                fresh = True
        if prefix and out:
            out[-1][2] += prefix
        return [(a, b, w) for a, b, w, _ in out]

    # Fallback: clause by clause, each clause ending where its punctuation's
    # pause begins (the final 。's frames are silence, not speech).
    speech_start = ph_times[0][1] if ph_times else 0.0
    return group_words(spread(units, speech_start, t if limit is None else min(t, limit), marks), text)


def group_words(items, text):
    """Han characters back into words (jieba, which misaki already loaded), so
    the fallback's captions break between words as the exact path's do."""
    try:
        import jieba

        compact = re.sub(r"\s+", "", text)
        owner = []
        for ti, tok in enumerate(jieba.lcut(compact)):
            owner += [ti] * len(tok)
    except Exception:
        return items
    out, pos = [], 0
    for s0, e0, w in items:
        n = len(re.sub(r"\s+", "", w))
        first = owner[pos] if pos < len(owner) else -1
        is_han = bool(HAN.search(w)) and not re.search(r"[A-Za-z0-9]", w)
        if out and is_han and out[-1][3] and out[-1][4] == first and not re.search(r"[^\w]$", out[-1][2]):
            out[-1][1] = e0
            out[-1][2] += w
            out[-1][4] = owner[pos + n - 1] if pos + n - 1 < len(owner) else first
        else:
            last = owner[pos + n - 1] if 0 <= pos + n - 1 < len(owner) else first
            out.append([s0, e0, w, is_han, last])
        pos += n
    return [(a, b, w) for a, b, w, _, _ in out]


def text_units(text):
    """The sentence as speakable units: Han characters, runs of Latin letters,
    runs of digits, and the punctuation between them (kept, so the units always
    join back into the exact text).

    A name joined to its number by a hyphen is one unit ("GPT-4", "COVID-19",
    "Wi-Fi"), and so is a number with separators ("1,000,000"): as two units
    the caption breaker could end a line on "GPT-" and start the next on "4".
    """
    out = []
    for m in re.finditer(r"[A-Za-z][A-Za-z'’]*(?:-[A-Za-z0-9]+)*|\d+(?:[.,]\d+)*%?|[㐀-鿿豈-﫿]|\s+|.", text):
        u = m.group(0)
        if HAN.fullmatch(u):
            out.append((u, "han"))
        elif re.fullmatch(r"[A-Za-z].*", u):
            out.append((u, "latin"))
        elif re.fullmatch(r"\d.*", u):
            out.append((u, "digit"))
        elif u.isspace():
            out.append((u, "space"))
        else:
            out.append((u, "punct"))
    return out


def weight(u, kind):
    if kind == "han":
        return 1.0
    if kind == "digit":
        return max(1.0, len(re.sub(r"\D", "", u)) * 1.0)
    if kind == "latin":
        return max(1.0, len(u) / 3.0)
    return 0.0


def spread(units, start, end, marks):
    """Share the sentence's time across its units, clause by clause.

    `marks` are the (start, end) times of the punctuation the phonemes kept.
    When the text has as many clause marks as the phonemes do, clause i runs
    from the end of mark i-1 to the start of mark i: the pause a comma buys is
    nobody's character. Otherwise the whole sentence is one clause, still
    ending before a trailing mark's silence.
    """
    clauses, cur = [], []
    for u in units:
        cur.append(u)
        if u[1] == "punct" and u[0] in CLAUSE + FINAL:
            clauses.append(cur)
            cur = []
    trailing = cur  # text after the last mark (usually nothing)
    spans = []
    if clauses and len(marks) == len(clauses):
        at = start
        for c, (m0, m1) in zip(clauses, marks):
            spans.append((c, at, max(at, min(m0, end))))
            at = min(m1, end)
        if trailing:
            spans.append((trailing, at, max(at, end)))
    else:
        stop = min(end, marks[-1][0]) if marks else end
        spans.append(([u for c in clauses for u in c] + trailing, start, max(start, stop)))
    out = []
    prefix = ""  # an opening quote or bracket rides on the word after it
    for c, a0, a1 in spans:
        total = sum(weight(*u) for u in c) or 1.0
        t = a0
        for u, kind in c:
            w = weight(u, kind)
            if w == 0:
                if out and kind == "punct" and u not in OPENERS:
                    out[-1][2] += u
                elif out and kind == "space":
                    out[-1][2] += u
                else:
                    prefix += u
                continue
            d = (a1 - a0) * w / total
            out.append([t, t + d, prefix + u])
            prefix = ""
            t += d
    if prefix and out:
        out[-1][2] += prefix
    return [(s, e, w.strip()) for s, e, w in out if w.strip()]


def attach_punctuation(words):
    """English tokens come with punctuation as tokens of their own; captions
    want "learning." not "learning" and ".", so marks ride on the word before."""
    out = []
    for s, e, w in words:
        if out and re.fullmatch(r"[^\w\s]+", w):
            ps, pe, pw = out[-1]
            out[-1] = (ps, pe, pw + w)
        else:
            out.append((s, e, w))
    return out


# ------------------------------------------------------------------ output

def write_audio(path, audio, loudnorm):
    import numpy as np
    import soundfile as sf

    if path.lower().endswith(".wav") and not loudnorm:
        sf.write(path, audio, SAMPLE_RATE, subtype="PCM_16")
        return
    # Anything else goes through ffmpeg: MP3, and the loudness pass the app
    # also runs (-16 LUFS integrated, -1.5 dBTP), for a person testing here.
    tmp = path + ".raw.wav"
    sf.write(tmp, np.asarray(audio, dtype="float32"), SAMPLE_RATE, subtype="PCM_16")
    af = ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] if loudnorm else []
    codec = ["-c:a", "libmp3lame", "-b:a", "160k"] if path.lower().endswith(".mp3") else []
    try:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp, *af, "-ar", "44100", *codec, path],
            check=True,
        )
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser(description="Speak text with Kokoro-82M; audio to --out, timings as JSON on stdout.")
    ap.add_argument("--voice", default=None, help="a Kokoro voice id: zf_001…zf_099, zm_009…zm_100, af_heart, am_michael, bf_emma, …")
    ap.add_argument("--speed", type=float, default=None, help="1.0 is the voice's natural pace")
    ap.add_argument("--out", required=True, help="where to write the audio: .wav, or .mp3 through ffmpeg")
    ap.add_argument("--text", default=None, help="the text; read from stdin when omitted")
    ap.add_argument("--json", action="store_true", help="stdin is a JSON request with pre-split sentences")
    ap.add_argument("--pause-ms", type=int, default=350, help="silence after each sentence in text mode")
    ap.add_argument("--threads", type=int, default=int(_THREADS))
    ap.add_argument("--loudnorm", action="store_true", help="normalise to -16 LUFS (ffmpeg loudnorm)")
    args = ap.parse_args()

    raw = args.text if args.text is not None else sys.stdin.read()
    if args.json:
        req = json.loads(raw)
        voice = args.voice or req.get("voice")
        speed = args.speed if args.speed is not None else float(req.get("speed") or 1.0)
        sentences = [(str(s.get("text", "")).strip(), int(s.get("pauseMs", args.pause_ms))) for s in req.get("sentences", [])]
    else:
        voice = args.voice
        speed = args.speed if args.speed is not None else 1.0
        sentences = [(s, args.pause_ms) for s in split_sentences(raw)]
    sentences = [(s, max(0, min(5000, p))) for s, p in sentences if s]
    if not voice or not re.fullmatch(r"[abz][fm]_[a-z0-9]+", voice):
        print(f"not a Kokoro voice id: {voice!r}", file=sys.stderr)
        return 2
    if not sentences:
        print("there is nothing to say", file=sys.stderr)
        return 2
    speed = max(0.5, min(2.0, speed))

    import numpy as np

    engine = Engine(voice, args.threads)
    pieces, timings = [], []
    at = 0.0
    for i, (text, pause_ms) in enumerate(sentences):
        audio, words, s0, s1 = engine.say(text, speed)
        pieces.append(audio)
        timings.append({
            "i": i,
            "text": text,
            "startMs": round((at + s0) * 1000),
            "endMs": round((at + s1) * 1000),
            "words": [{"text": w, "start": round(at + s, 3), "end": round(at + e, 3)} for s, e, w in words],
        })
        at += len(audio) / SAMPLE_RATE
        if pause_ms and i < len(sentences) - 1:
            pieces.append(np.zeros(int(SAMPLE_RATE * pause_ms / 1000), dtype="float32"))
            at += pause_ms / 1000
    audio = np.concatenate(pieces) if pieces else np.zeros(0, dtype="float32")
    write_audio(args.out, audio, args.loudnorm)

    json.dump(
        {
            "engine": "kokoro",
            "model": engine.model_name,
            "voice": voice,
            "speed": speed,
            "sampleRate": SAMPLE_RATE,
            "durationMs": round(len(audio) / SAMPLE_RATE * 1000),
            "out": args.out,
            "sentences": timings,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # stdout stays clean; the wrapper reports stderr
        print(f"speak.py failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
