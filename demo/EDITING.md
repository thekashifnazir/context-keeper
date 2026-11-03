# Optional multi-shot editing

> **Making or quoting a video? Take inventory first.** Run `hackathon-kit/bin/kit-video --tools`
> and `hackathon-kit/bin/kit-scene --list` before choosing a method or giving a time: tools land
> often and this page may not list them. Then pick the route in
> [VIDEO-ROUTES.md](../VIDEO-ROUTES.md) and estimate from its measured step costs. Ready-made scenes
> render in seconds and only new code takes long, so never offer a frame-by-frame render
> (1–4 h) unless no existing scene fits.

`bin/kit-edit` edits existing clips and stills using a small JSON plan. It has no implicit
title cards, voice generation, effects quota or publication step. A showcase, tutorial,
interview excerpt, silent demonstration or other format can use the same mechanics.
It can also be useful for a bounded revision where the original sources are available.

```sh
<kit>/bin/kit-edit --plan demo/edit.json --dry-run
<kit>/bin/kit-edit --plan demo/edit.json --out demo/output/review-v1.mp4
```

`edit-plan.example.json` illustrates the contract; it references placeholder media and
ranges. Adapt it to actual footage. `kit-init` ships this as `demo/edit.example.json`.
Keep the story, evidence and owner-selected baseline in the project brief.

## One clock

Paths are relative to the plan file. `in` / `out` are SOURCE seconds. A shot's `duration`
is its OUTPUT length. If omitted on video, it uses the source-range duration. Stills
require duration. Explicit duration retimes video; the report records speed and output
ranges. Duration is quantized once to whole frames. `--dry-run` prints this final clock
before rendering. An optional `max_seconds` refuses an overlong plan; it never cuts off
the ending automatically.

Cuts and transitions share the same nominal boundaries. Transitions get frozen picture
handles outside the native shots, so adding one does not move voice/caption timestamps
or subtract reading holds. They cannot overlap each other across a shot. The report
stores actual transition frames; a requested fraction of a second is frame-quantized.

## Shots and camera

Each shot has `source`, optional `id`, `kind`, `in`, `out`, `duration`, `transition`,
`camera`, `role`, and `note`. IDs must be unique. Role/note distinguish actual UI,
editorial illustration, staged material and reference footage; they do not add labels
on screen automatically. Describe sources honestly.

The default fits the entire image without stretching; padding uses `background`.
Optional camera rectangles are `[x,y,width,height]` in ORIGINAL source pixels, matching
the output aspect ratio. `start` and `end` define the view, `start_at`/`end_at` define the
movement inside the shot, and `easing` is `smooth`, `linear` or `ease_out`. A missing
start shows the entire padded source. Define a settled hold where the viewer needs one;
the editor does not decide its reading length. Non-square source pixels must first be
normalized. Still inputs support PNG, JPEG, WebP and BMP; animated images should become
video inputs.

Transitions belong to the INCOMING shot:

- `cut` (default): immediate handoff, often appropriate for matched action.
- `dissolve`: briefly blend compatible images; inspect text overlap.
- `wipe_left`: replace content without ghosting both text layers.
- `fade_color`: fade through an explicit background colour between different layouts.
- `xfade` with `effect`: a calm ffmpeg xfade (`smoothup`, `smoothleft`, `zoomin`, `hblur`, `fadegrays`, …; the list is in `edit.py`). `smoothup` at 0.8 s joined designed scenes and bright live footage without the hard reset a colour dip gave (Outage Desk, Oct 2026).

A transition object has `type`, optional `seconds` and, for the colour handoff, `color`.
These choices reproduce mechanics used in the worked case; they are not a rule to apply
all of them, or to use them in every genre.

## Explicit audio

Every plan chooses `audio.mode`:

- `none`: intentional silent picture (or music only).
- `source`: audio follows each source range on nominal shot boundaries. Image/missing
  audio segments are silent and reported. Picture transitions do not crossfade voices.
  Video retiming with source sound requires explicit `allow_retime: true`.
- `external`: use a final narration/mix from `source`, optional `in`/`out`, `offset`, and
  `gain_db`. A longer track is refused; extend the picture or explicitly select a range.

Optional `music` has `source`, `gain_db` (quiet default −24 dB), `loop` (default false),
`fade_in` and `fade_out`. Audio is mixed at 48 kHz and encoded once to AAC. This helper
preserves the chosen gains; it does not automatically normalize loudness. Listen and
measure the actual mix. Use a finished mix when its speech/music balance is approved.

## Captions and typography

Optional `captions` has a `source` cue JSON on the FINAL clock. `highlight: true` requires
real per-word times using the caption helper contract. Plain captions need only text,
start and end. Optional `font`, `size`, `margin_bottom`, `padding`, `color` (highlight)
and `background` control the caption treatment.

Optional `brand` points to a local typography JSON described in [BRANDING.md](BRANDING.md).
It supplies the actual caption font and highlight colour. No brand treatment is forced
when absent. Existing burned captions are not removed by this editor; use clean footage
or deliberately rebuild/mask their layer, as explained in [CAPTION-PATCH.md](CAPTION-PATCH.md).

## Delivery and preservation

Output must be a new MP4. `--overwrite` allows replacing a candidate but never source
media or a hard link to it. The final encode is H.264/yuv420p/BT.709; it is decoded and
checked against planned duration/frame count. The `.edit.json` sibling records source
hashes, source/output clocks, camera, transitions, audio choice, brand provenance and
output checksum. These are technical checks; inspect readability, joins, tone, audio
and the real encoded output before editorial acceptance. Private media stay in the
project, not in the tools repo.
