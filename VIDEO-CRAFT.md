# Cutting video here

The rules the Video Edit module is built to, and the prompt the agent works
under. Distilled from the studio's own reference work in `~/videoediting`:

- `PLAYBOOK.md` — what makes a launch film read as expensive, reverse-engineered
  from Apple's own films.
- `HOOKS.md` — what the best product clips do in their first 1.5 seconds,
  studied frame by frame from three posts.
- `BRAND-TRUTH.md` — the lesson that a brand value written in prose drifts from
  what the product actually ships, and only the shipped value is true.

The text lives in `lib/video/craft.ts` as `VIDEO_CRAFT`, and `lib/ai/prompt.ts`
puts it in front of the agent whenever the module is `video`. It is built in
rather than seeded into the knowledge table on purpose: it is mostly a list of
things *not* to do, and that is exactly the part of a prompt that must not be
able to go missing because somebody tidied a row. Anything written in Admin
under the `video` module is added on top and overrides it.

## The one rule

**Subtract.** Every other rule is a way of removing something.

| The instinct | What the studio does |
|---|---|
| Show everything | One idea per shot |
| Fill the frame | Leave it empty |
| Mix fonts for interest | One type system, everywhere |
| Colour the whole scene | Colour only the subject |
| Make transitions exciting | Make them invisible |
| Big music, big effects | Music locked to the cut, effects near-silent |

## Where the rules are enforced, not just written

A prompt that says "one treatment, never three" and a preset list that offers
outline-plus-shadow-plus-glow is a prompt that will be ignored. So:

- **`CAPTION_PRESETS`** (`lib/video/craft.ts`) offers four styles, each with
  exactly one of a plate, an outline or a shadow. There is no neon and no
  stacking.
- **`toAss`** (`lib/video/ass.ts`) wraps to two lines by balancing them rather
  than shrinking the type, because type that changes size shot to shot is what
  viewers notice without knowing why.
- **The word-by-word preset** refuses to run on captions that were never timed.
  `canKaraoke` requires measured word timings on 80% of cues; without them the
  project falls back to the whole-line preset. A caption that claims to follow
  the voice and drifts is worse than one that never claimed to.
- **`Graphics.tsx`** offers five kinds, not fifty. A menu of forty effects is
  how a video ends up wearing six of them.
- **`Graphic`** (`remotion/src/Graphics.tsx`) gives everything the same spring
  in, the same direction, and a faster exit than entrance — *nothing moves
  after it arrives*.

## Make the video

`lib/video/director.ts` is the whole job from one brief. Drop the clips in,
write what the video should be, press the button (or tell the assistant
"make the video"): the longest take goes on the timeline, the rest stay as
cutaways; the footage is transcribed with word timings; the dead air comes
out and the hook is found (`autoedit.ts`, now told the brief); one model call
designs the rest — the caption look, every graphic with its arrival, the
punch-ins, the cutaways, the pictures to find on Openverse — and, when asked,
the file is rendered in the same job. Progress is written to
`video_projects.director` and the strip above the editor shows each step.

The design is checked before a row is written: a `stat` whose number was never
said is dropped, two punch-ins inside twenty seconds become one, a cutaway is
shortened to its clip, at most one text graphic is on screen at a time.
Everything it wrote is one ⌘Z away, because the editor snapshots the project
before it starts.

What the render can do now, beyond stills that fade:

- **Arrivals** (`options.enter` on a graphic): fade, rise, pop, slide, drop.
  All on one ease-out curve over 0.22s, all done by FFmpeg on the still, so a
  graphic still costs one Chrome render.
- **Punch-ins** (`kind: punch`): the picture pushes in 1.1–1.3× over a quarter
  of a second and cuts back. One `scale` with a per-frame factor and a
  centred crop, about 30% on top of the encode.
- **Cutaways** (`kind: broll`): a clip from the bin over the picture for a
  few seconds, trimmed at input, the interview's sound untouched.
- **Punch captions** (`captionPreset: pop`): one to three words at a time,
  uppercase, each group popping in on the beat of the voice. Word timings or
  nothing, like the other karaoke preset. Every caption line now fades in
  and out over 90/60ms.

## The channel's own format

`HOUSE_FORMAT` in `lib/video/craft.ts` is one of the channel's finished
videos read frame by frame: the statement hook, the header from ten seconds,
the watermark and footnote for the whole run, bilingual captions with the
keywords lit in the accent, a picture or cutaway for every named thing, a stat
for every number, a punch-in on the punchline. The director designs to it and
a person can check the result against the reference. The same text is a
knowledge row in Admin so the studio can change it.

The `bilingual` caption preset is the one that reads `captions.keywords` and
the second-language track the director writes (`translateCues`), and it is the
first preset to use the bundled Inter beside the box's Noto Sans CJK; libass
is pointed at `remotion/public/fonts` so a caption and a header are set in the
same faces.

## The creator's own channel

`lib/creator/service.ts` mirrors every upload on the connected YouTube
channels through the Data API (titles, descriptions, tags, length, views)
into `creator_videos`, and folds them into one "Creator voice" knowledge row
that `assemblePrompt` carries into every turn. The director, the script
writer and the research angles all read it, so a script sounds like the
channel and a cut looks like one of its videos. The Research screen shows it
under "Your channel, as memory"; the daily social cron re-syncs it; the
agent can look a video up with `creator_videos` and `creator_video`.
Transcripts are held only for videos that were cut here — the platform's
caption download needs an OAuth grant the product does not hold.

## The editor

`components/video/Editor.tsx` is the shape every editor has had since the
nineties, and has because it is right: the bin on the left, the viewer in the
centre, the inspector on the right, and the timeline across the bottom with
every track against one clock and one playhead through all of them.

It replaced a set of forms. Each of those forms worked and the whole was
unusable, because editing is not data entry — it is looking at a picture,
looking at where the sound is, and deciding where the cut goes, and you cannot
do that across four tabs.

- **Dark**, chrome included, because the picture should be the brightest thing
  in the window. Grey furniture around a video is the fastest way to misjudge
  its exposure.
- **Space** plays, **arrows** step (shift for a second), **S** splits at the
  playhead, **Home** goes to the start.
- **The preview plays the sources and seeks between cuts**, so it is honest
  about the edit and approximate about the joins. Captions and graphics are
  drawn over it live from the same numbers the renderer uses. The export is the
  truth; this is for deciding.
- **Waveforms** come from `lib/video/peaks.ts`: ~600 RMS points per clip,
  measured once by the worker straight from storage over a signed URL, so
  opening a project costs nothing and a cut can be placed on a breath.

## Cut this for me

`lib/video/autoedit.ts` takes uploaded clips and returns a first pass:

1. **Transcribe** (ElevenLabs Scribe), keeping word timings.
2. **Remove the dead air** — arithmetic over those timings, in
   `lib/video/ranges.ts`. No model involved. A pause under 600ms is speech,
   because people breathe mid-sentence; anything longer is the part of a raw
   take that makes it unwatchable. 120ms of padding each side so a cut does not
   clip a consonant.
3. **Ask the model what it is about**: the hook, what to keep, what to drop and
   why, chapter marks, who is speaking, a title.
4. **Write it down**: timeline items, captions *re-timed onto the new cut*, and
   graphics.

Two deliberate properties:

- **The model is an improvement, not a dependency.** Removing dead air is most
  of what makes a take watchable and needs no model. When the model times out
  or answers with nonsense, the cut still happens and the result says so. This
  is not theoretical — the first run timed out on a free endpoint, and the
  silence trim carried it.
- **The model's ranges are intersected with measured speech** before anything
  is written. Left alone a model returns round numbers that cut mid-word.

Measured on a 27-second take with three pauses and a deliberate false start:
4.9 seconds end to end, the false start found and cut with the reason "false
start, speaker restarts", and a title written from what was actually said.

## How it renders

```
footage ──► FFmpeg concat ──► overlay graphics ──► burn ASS captions ──► master.mp4
                                    ▲                      ▲
                          Remotion stills (PNG+alpha)   lib/video/ass.ts
```

The first design drew the whole timeline through Chrome with Remotion and
composited the result. The picture was right and it cost **thirteen seconds a
frame** on this box — six hours for a one-minute video — because the machine
shares its 32 cores with a ClickHouse server and a BSC node.

So each graphic is rendered **once**, as a transparent PNG (~11 seconds), and
FFmpeg does the appearing and the leaving. Captions never touch Chrome: libass
draws them during the encode that was happening anyway, which is both free and
frame-accurate.

The stills are drawn in one browser by `remotion/render-stills.mjs` (the bundle
is cached beside the sources), and the film is encoded exactly once: every cut
is a `trim` on its source inside one filter graph, joined by `concat` or
`xfade`, with the punch-ins, graphics, cutaways and captions on the same
graph. Each still is an input bounded to its own window; a looped still
decoded on every frame of the film was, at twenty-five graphics, most of a
render.

## Working on this

```bash
cd remotion
npm install                    # not checked in; the worker needs it to draw graphics
npm run studio                 # scrub the compositions in a browser
npx remotion still src/index.ts Overlay out/x.png --props=props.json --frame=20
```

`remotion/` is deliberately its own workspace with its own `package.json` and
is in `.vercelignore`. It needs Chrome and it only ever runs on the box, the
same as FFmpeg.
