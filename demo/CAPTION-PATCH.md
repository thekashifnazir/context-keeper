# Word-following captions without rebuilding the film

> **Making or quoting a video? Take inventory first.** Run `hackathon-kit/bin/kit-video --tools`
> and `hackathon-kit/bin/kit-scene --list` before choosing a method or giving a time: tools land
> often and this page may not list them. Then pick the route in
> [VIDEO-ROUTES.md](../VIDEO-ROUTES.md) and estimate from its measured step costs. Ready-made scenes
> render in seconds and only new code takes long, so never offer a frame-by-frame render
> (1–4 h) unless no existing scene fits.

`bin/kit-caption` applies the tools repo's saved-word loading and canonical script
alignment to a finished MP4. The active word changes colour; the line stays still.
It copies audio, checks its packet hash, checks duration/frame count, and fully decodes
the result before delivery. It never calls TTS or publishes. A new output name protects
the selected source; existing outputs require `--overwrite`.

## Final-clock cues

Cues are a JSON list. Times are seconds of the **final output**, including an opener:

```json
[{"text":"Try a sample.","start":1.2,"end":2.8,
  "words":[["Try",1.2,1.6],["a",1.6,1.8],["sample.",1.8,2.7]]}]
```

```sh
<kit>/bin/kit-caption --video approved.mp4 --cues cues.json --out with-karaoke.mp4 \
  --font 'Your font' --fonts-dir ./fonts --size 40 --margin-bottom 79 \
  --highlight '#C9F27B'
```

Use TTF, OTF or TTC fonts, not WOFF2. These geometry/colour values are examples for a
1080p film, not a format mandate. Match the subject's brand and readability needs.
If no fonts directory is supplied, libass resolves the requested system font.

## Existing segmented narration

Cues can omit `words` when accompanied by `--segments timing.json --word-dir ./audio`.
Each segment has `id`, `text`, `voice_start`, optional `tempo` (default 1), and optional
`voice_end`. `<id>.words.json` is the kit's saved ElevenLabs sidecar. Raw times become
`voice_start + raw_time / tempo`; a shifted opener must be reflected in `voice_start`.
No new synthesis is required. Alternatively `--words words.json` accepts a list of
`[text,start,end]` tuples or `{text,start,end}` objects, already on the final clock.

Word spelling must match the canonical cue text. Drift, overlap, non-finite times or
missing timings fail rather than creating plausible-looking invented highlights.
A plain SRT remains useful for accessibility but does not carry animated colours.

## Replacing burned captions

Use caption-free picture when available. When adding highlighting to an existing
captioned cut, preserve the old cue text, wrapping, font and position; an opaque pill
with slightly larger padding can cover the original. Inspect its edges in the output.
This does not recover UI hidden behind old captions. If words/layout change, masking
or rebuilding the caption layer may be necessary; do not put a smaller new line over
a larger old one and call it fixed.

Output siblings: `.ass` and `.verification.json`. Technical verification is not editorial
acceptance: inspect highlights on names, short words, pauses and the last cue.

## Actual local brand fonts

`kit-caption --brand demo/brand.json` loads the declared caption face and accent; explicit CLI font/highlight options override them. Run `kit-setup-fonts` once for inspection/conversion. The helper uses the internal family name for libass rather than assuming the browser alias is installed. See [BRANDING.md](BRANDING.md). Plain cue captions need no invented word times; karaoke still requires real final-clock words.
