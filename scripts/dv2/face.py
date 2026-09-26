#!/usr/bin/env python3
"""
Where the presenter's face is, sampled through a video.

    python face.py VIDEO [--every 2] [--width 540] [--start S] [--end S]
                         [--times 1.5,8.0,...] [--model PATH] [--min-score 0.6]

Prints one JSON object on stdout:

    {"width": 540, "height": 960, "every": 2, "total": 190, "detected": 188,
     "samples": [{"t": 0.0, "box": [x, y, w, h], "eyeY": 0.34, "chinY": 0.47, "score": 0.93}, ...],
     "median": {"box": [x, y, w, h], "eyeY": 0.34, "chinY": 0.47}}

Every coordinate is a share of the frame (0–1), measured on the frame as
ffmpeg shows it (rotation metadata applied), so the same numbers work at any
render size. `eyeY` is the mean of the two eye landmarks; `chinY` is the
bottom of the face box, which YuNet draws at the chin. `box` is
[left, top, width, height] of the largest face in the frame.

The detector is YuNet (face_detection_yunet_2023mar.onnx, MIT, from
OpenCV's model zoo) through opencv-python-headless, in its own venv at
/home/ubuntu/.venvs/dv2face — cv2 is deliberately not installed anywhere else
on the box, and this script never imports anything outside the standard
library plus cv2/numpy. `lib/video/face.ts` runs it with an argv array and
reads the JSON; nothing here writes a file.

Two sampling modes:

  --every N     one frame every N seconds through the whole file (or between
                --start and --end), decoded in a single ffmpeg pass. This is
                the face track of a raw take.
  --times a,b   one seek per timestamp. Slower per frame, right for checking a
                finished render at the moments the host is on screen.

Frames arrive as raw BGR over a pipe, never as files on disk.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys

import cv2
import numpy as np

DEFAULT_MODEL = os.environ.get(
    "FACE_MODEL",
    os.path.expanduser("~/.venvs/dv2face/models/face_detection_yunet_2023mar.onnx"),
)


def probe_size(video):
    """The frame size as ffmpeg will output it, rotation applied."""
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate",
            "-of", "json", video,
        ],
        capture_output=True, text=True, timeout=60, check=True,
    ).stdout
    info = json.loads(out)["streams"][0]
    w, h = int(info["width"]), int(info["height"])
    rotation = 0
    for sd in info.get("side_data_list") or []:
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    tag = (info.get("tags") or {}).get("rotate")
    if tag is not None:
        try:
            rotation = int(tag)
        except ValueError:
            pass
    if abs(rotation) % 180 == 90:
        w, h = h, w
    return w, h


def scaled_size(w, h, width):
    """The analysis size: `width` wide, height to match, both even."""
    out_h = max(2, int(round(width * h / w / 2)) * 2)
    return width, out_h


def read_frames(video, out_w, out_h, vf, extra_args, limit=None):
    """Raw BGR frames from one ffmpeg pass, as a generator of numpy arrays."""
    args = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        *extra_args, "-i", video, "-vf", vf, "-an",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frame_bytes = out_w * out_h * 3
    n = 0
    try:
        while limit is None or n < limit:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape((out_h, out_w, 3))
            n += 1
    finally:
        try:
            proc.stdout.close()
        except OSError:
            pass
        proc.wait(timeout=30)


def make_detector(model, w, h, min_score):
    return cv2.FaceDetectorYN.create(model, "", (w, h), min_score, 0.3, 5000)


def detect(detector, frame):
    """The largest face in the frame as normalised numbers, or None."""
    h, w = frame.shape[:2]
    _, faces = detector.detect(frame)
    if faces is None or len(faces) == 0:
        return None
    # YuNet rows: x, y, w, h, right-eye x/y, left-eye x/y, nose, mouth corners, score.
    best = max(faces, key=lambda f: float(f[2]) * float(f[3]))
    x, y, bw, bh = (float(v) for v in best[:4])
    eye_y = (float(best[5]) + float(best[7])) / 2
    return {
        "box": [round(x / w, 4), round(y / h, 4), round(bw / w, 4), round(bh / h, 4)],
        "eyeY": round(eye_y / h, 4),
        "chinY": round((y + bh) / h, 4),
        "score": round(float(best[14]), 3),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--every", type=float, default=2.0)
    ap.add_argument("--width", type=int, default=540)
    ap.add_argument("--start", type=float, default=None)
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--times", type=str, default=None, help="comma-separated seconds; one seek each")
    ap.add_argument("--model", type=str, default=DEFAULT_MODEL)
    ap.add_argument("--min-score", type=float, default=0.6)
    args = ap.parse_args()

    if not os.path.exists(args.model):
        print(json.dumps({"error": f"no model at {args.model}"}))
        return 2

    src_w, src_h = probe_size(args.video)
    out_w, out_h = scaled_size(src_w, src_h, args.width)
    detector = make_detector(args.model, out_w, out_h, args.min_score)

    samples = []
    total = 0
    if args.times:
        times = [float(t) for t in args.times.split(",") if t.strip()]
        for t in times:
            total += 1
            got = None
            for frame in read_frames(args.video, out_w, out_h, f"scale={out_w}:{out_h}", ["-ss", f"{t:.3f}"], limit=1):
                got = detect(detector, frame)
            samples.append({"t": round(t, 3), **(got or {"box": None, "eyeY": None, "chinY": None, "score": 0})})
    else:
        extra = []
        if args.start is not None:
            extra += ["-ss", f"{args.start:.3f}"]
        if args.end is not None:
            extra += ["-t", f"{max(0.0, args.end - (args.start or 0.0)):.3f}"]
        vf = f"fps=1/{args.every},scale={out_w}:{out_h}"
        t0 = args.start or 0.0
        for i, frame in enumerate(read_frames(args.video, out_w, out_h, vf, extra)):
            total += 1
            got = detect(detector, frame)
            samples.append({"t": round(t0 + i * args.every, 3), **(got or {"box": None, "eyeY": None, "chinY": None, "score": 0})})

    hits = [s for s in samples if s["box"] is not None]
    median = None
    if hits:
        median = {
            "box": [round(statistics.median(s["box"][k] for s in hits), 4) for k in range(4)],
            "eyeY": round(statistics.median(s["eyeY"] for s in hits), 4),
            "chinY": round(statistics.median(s["chinY"] for s in hits), 4),
        }
    print(json.dumps({
        "width": out_w, "height": out_h, "every": None if args.times else args.every,
        "total": total, "detected": len(hits), "samples": samples, "median": median,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
