# Video playbook — choices, tools and lessons

> **Take inventory before anything else:** run `bin/kit-video --tools` and `bin/kit-scene --list`
> before choosing a method or quoting a time (see §8's lesson; this keeps recurring).
>
> **First, pick the build route:** [VIDEO-ROUTES.md](VIDEO-ROUTES.md). Patching a finished
> cut takes minutes; rendering every frame takes hours. Use the cheapest route that can make
> the change, and tell the owner the choice and its time.

Use this as a reference for making different kinds of video, not a sequence to follow
literally. The viewer, purpose, available material and owner's brief determine the
format. Tool availability and a successful previous example do not determine it.

The older case studies in §8 describe what worked or failed in particular projects.
Their scene counts, voices, pacing, stage rails, title cards and production order are
examples to evaluate, not defaults for a new job. The calmer product video is another
case study; it does not make every future video a calm explainer.

For the cross-agent quality contract and project handoff, see [VIDEO-QUALITY.md](VIDEO-QUALITY.md). `kit-init` ships it as `demo/QUALITY.md` alongside a flexible `demo/brief.md`.

## Start with the job, then choose an approach

Use the information already provided. Clarify only gaps that materially change the
result; do not turn this into a mandatory questionnaire or another approval ceremony.

- Who is watching, where, and what should they understand, feel or do?
- What material exists: working UI, real recordings, interviews, research, diagrams,
  brand assets, a script or an already selected cut?
- What tone and viewing conditions fit: instructional, personal, energetic, restrained,
  mobile/muted, presentation room, or something else?
- What constraints actually apply: duration, submission rules, delivery format,
  accessibility, permissions, deadline and budget?
- Is this a new direction or a bounded revision of an exact existing artifact?

| Approach to consider | Useful when | Watch for |
| --- | --- | --- |
| Real-product walkthrough | The experience and working behavior are the proof | A long page tour without a clear outcome |
| Decision/result-first demo | A visible result explains the value quickly | A result without enough context to trust it |
| Designed explainer | A process or invisible mechanism needs illustration | Replacing the real product with slides or tiny screenshot cards |
| Founder/interview/story-led piece | A person and their experience carry the meaning | Over-scripting away the speaker's natural voice |
| Launch/trailer/social cut | Attention, emotion or a concise benefit is the aim | Importing its fast cadence into a dense tutorial or research story |
| Tutorial or longer walkthrough | Understanding a task matters more than compression | Removing the pauses or context a learner needs |
| Evidence/case-study film | Findings and their practical meaning are the story | Confusing intended benefits with measured outcomes |

These can be combined. A silent demonstration, a raw screen recording, a one-shot
explanation or a format not listed here can be the right answer. Choose a useful starting
hypothesis, show a cheap sample if the direction is uncertain, then respond to the review.

## What carries across formats, and what does not

**Keep:** truthful claims and provenance; respect for permissions and the selected
baseline; an artifact that meets its actual delivery requirements; an honest account of
what was tested; and a real look at the encoded result before calling it done.

**Choose for this job:** narrative order, visual density, number of chapters, reading
holds, presence of voice/music/captions, style, camera movement, transitions, render
technology and review cadence. Accessibility or platform rules can make some of these
requirements; otherwise they are creative decisions, not universal prescriptions.

There is no target number of cuts, mandatory narrator, required stage rail, fixed
three-second opening, compulsory effect, or obligation to try every style. Technical
checks cannot decide which candidate the owner prefers.

For one relevant case, see [calm-product-video lessons](../docs/calm-product-video-workflow.md)
and its [optional brief/revision starter](video/calm-product-demo/README.md). Use it when
its problems resemble yours, especially excessive visual resets or revision scope drift.

## Using the kit versus taking a direct route

The kit is a toolbox. You can use capture, captions, voice or verification helpers alone,
use a configured renderer, or make a small direct HTML/Remotion composition. Do not set up
an entire pipeline just to make a minor edit to an existing video.

The config-driven `kit-*` commands read `hackathon.yaml`. That is a **tool contract**,
not a requirement that every video project use the kit. When choosing that route:

```sh
cp <kit>/templates/hackathon.yaml <project>/hackathon.yaml
<kit>/bin/kit-init <project> --config <project>/hackathon.yaml
```

Fill the relevant fields from the actual brief. `kit-init` keeps edited files and
updates its marked rules block. Kit commands are not automatically on PATH:

| You are in… | Commands are addressed as… |
| --- | --- |
| tools vault | `hackathon-kit/bin/kit-video --repo <project>` |
| project | `<kit>/bin/kit-video --repo .` |

## §0 Inventory — capabilities, not a checklist to exhaust

`kit-video --tools` lists what is available. The table below describes kit capabilities
and implementation defaults; it does not recommend enabling all of them. Install only
what the chosen job needs. An unused optional tool is not a quality defect.

| Capability | What it adds | Where | Driven by |
| --- | --- | --- | --- |
| Timing plan | title 3s + body + end 3s, hard cap, refuses overruns | `kit-video --plan` | `video.max_seconds`, `target_seconds` |
| Script → voiceover | ElevenLabs (word-exact timings) → Apple Premium `say` → Kokoro → `say` → own `demo/vo.wav` | `demo/script.md`, `video/tts.py` | `video.voiceover`, `voice_id`, `voice_settings` |
| Word timings | when each word is spoken — pace the capture to it | `kit-video --timings` | needs a VO |
| Captions | burned-in, timed to the voice; optional per-word highlight | `video/captions.py` | `video.captions`, `caption_band`, `caption_highlight` |
| Capture: terminal | VHS tape of the real CLI | `demo/demo.tape` | `video.mode: terminal` |
| Capture: ui | Playwright recording with a visible gliding cursor, click rings, `highlight()` zoom, `label:` callouts, `at()` pacing | `demo/record_ui.ts` | `video.mode: ui` |
| Capture: live app at 2× | Real UI recorded as lossless 2× PNG frames with real timestamps, a visible gliding cursor and click rings; logs element boxes so zooms land in post without upscaling | `video/live/record_live.cjs` (steps from JSON) | none: standalone |
| Ready-made scenes | Seekable motion-graphics scenes filled from JSON: logo sting, title/end card, pipeline rail, items arriving, label capped by a rule, cited sentences being checked | `video/scenes/` + `bin/kit-scene` | none: standalone |
| Multi-shot edit | Clips and stills on one clock: source ranges, camera rectangles, cut/dissolve/wipe/colour-fade, external voice, captions | `bin/kit-edit`, `video/EDITING.md` | a JSON plan |
| Word-following captions on a finished cut | Current word highlighted, audio untouched, verification sidecar | `bin/kit-caption`, `video/CAPTION-PATCH.md` | cue JSON |
| Local typography | Real product fonts loaded by cards, captions, renderers | `video/BRANDING.md`, `bin/kit-setup-fonts` | `video.brand_file` |
| Capture: screen/loom | any hand-made recording dropped in `demo/raw/` | — | `video.mode: screen` |
| Capture: talking head | raw take → silence-only cuts on the frame grid, never on a word edge; the cut list prints and waits for a yes; the result is re-transcribed to catch clipped words | `bin/kit-cut <take.mov>` → `demo/raw/cut.mp4` | whisper model (`kit-setup-voice`) |
| Storyboard preview | one still per script cue for a cheap layout/story review when useful | `kit-video --storyboard` → `demo/build/storyboard.png` | a take/capture in `demo/raw/` |
| Folder contract | `brand.md` (the look), `moves.md` (what the references do), `references/` (outlier videos only), `NOTES.md` (dated rules) — kit-init writes all of them | `demo/` | use when relevant |
| Capture: motion explainer | a designed GSAP scene page as the "recording" — app as screenshot insets, beats timed to the word. An available process-led example: `video/motion-explainer/stage-rail/` | `video/motion-explainer/README.md` | `mode: ui` + explainer recorder |
| Post-capture camera + callouts | spring-zoom to each flagged element, pinned callout chips, retimable without re-recording | `record_ui.ts` emits `cues.json`; HyperFrames comp consumes it | `renderer: hyperframes` (records flat automatically) |
| Styles (6 looks) | ops-console · launch · release · studio · editorial · keynote | `styles/README.md` | `video.style` (hyperframes only) |
| Motion effects (15) | clip→clip effects on the capture: cube-spin, shatter, portal, … | `README.md` effects table, `docs/reel-effects-harvest.md` | `video.effects: [{name, at, len?, words?}]` |
| Renderers | ffmpeg (always) · HyperFrames (styles, camera, music) · Remotion (React comp) | `README.md` renderer sections | `video.renderer` |
| Frame-exact capture | explainer pages recorded as paused-animation PNG frames, not realtime JPEG | `video/motion-explainer/*/record_ui.ts` | `video.capture: frames` (default) / `realtime` (live apps only) |
| Sentence captions | whole-sentence boxed caption, progressive word highlight, every style | `video/hf.py` shared layer | `video.caption_mode: sentence` (default) / `fragment` |
| Expressive VO | per-sentence synthesis with `{rate, pause, emph, pitch}` markup, whisper word timings | `video/vo_expressive.py` | trailing `{...}` on script lines; `video.sentence_gap_ms` |
| Designed cards | logo tile, real type, blurred app backdrop | `video/cards.py` | `project.icon` / `project.logo`, `brand_color` |
| Music bed | ducked under the VO | HyperFrames | `video.music` |
| Review page | scrub the comp, hot-swap all 6 styles on the same footage, edit labels + timings, export `demo-override.json` | `demo/build/hf/review.html` | hyperframes build |
| Contact sheet | every build: a frame every 4s in one image | `demo/build/contact.png` | always |
| Preflight | video file, duration, size, tracking, effects deps, judge-facing text, secrets | `kit-preflight` (`--json`) | always |
| Posts | platform posts from the same config | `kit-posts` | `templates/posts/` |
| Conventions | beat grammar, caption placement, loudness, platform rules | `docs/motion-design-tools.md`, `docs/reel-effects-harvest.md` | read, don't configure |


## §1 Find the story and production order

For a planned narrated demo, an outline and measured voiceover can give the visuals a
reliable clock. For interviews, existing recordings or spontaneous demonstrations, the
footage or transcript may come first. For a visual-only piece, there may be no narration.
Do not force these into the same script-first process.

When useful, record an audience-facing story spine and a facts ledger. A common demo
shape is problem → one working path → evidence → practical benefit, but a result-first
opening, personal story or another order can serve the material better. A numerical hook
is useful only when it is relevant and supported.

If using the kit's narration lane, `demo/script.md` and `kit-video --timings` provide the
spoken clock. The kit's word-rate estimate is a planning aid: measure the actual voice,
pauses and reading needs. Display copy may use digits while synthesis needs another
pronunciation; keep both aligned and verify them.

`[cue: …]` markers can describe useful changes. They need not create a new scene:
several ideas may share a composition, or one action may deserve a longer unbroken take.
An optional `kit-video --storyboard` contact sheet can make the direction cheap to review.
Use the existing agreement; do not demand a fresh sign-off at every tool step.

## §2 Choose the evidence and capture method

| Material | Available route |
| --- | --- |
| Terminal / CLI | VHS through `terminal` mode |
| Working web app | Playwright/UI recording or an existing real screen capture |
| Invisible process | Designed graphics, potentially combined with actual product evidence |
| Existing recording | `screen` mode or a direct editing/compositing route |
| Talking head | Keep the original performance; `kit-cut` can propose silence-only edits |

Use actual UI where the claim is about app behavior. Explanatory diagrams and clearly
labelled illustrations are legitimate for concepts, plans or processes; do not present
them as captured functionality. Reuse completed evidence when appropriate. A playbook
does not authorize new evaluations, paid calls, data exposure or publishing.

**Verify the input, not just the output.** `mode: ui` assumes `demo/raw/ui/capture.mp4`
is a recording of the product — but nothing checks that. Before building, grab one
frame of the *source* (`ffmpeg -ss 15 -i demo/raw/ui/capture.mp4 -frames:v 1`): if the
capture is itself a recording of a designed explainer page, every downstream layer
faithfully polishes a slideshow and the contact sheet looks "on-spec" while being the
wrong video entirely. (Burned on the herbtwin sponsor clip, 2026-10-26.)

**Let the product remain legible when it carries the story.** For a walkthrough,
large real capture with an intentional camera move can be more useful than small
screens inside layers of framing. Put annotations where they help attention; do not
scatter chips over the evidence. Other compositions can be appropriate for explainers,
interviews or evidence stories. Element bounds from recorder cues make UI camera targets
repeatable; inspect their landing at delivery size. A full-bleed edit, karaoke captions
and a few type moments were one relevant experiment, not the only valid format. The
larger multi-source editing lane remains queued in `docs/post-event-todo.md`.

For scripted UI capture, start the app and set `KIT_APP_URL` if needed. HyperFrames can
use flat capture plus `cues.json` for later camera/callout timing. Highlight what helps
attention; not every spoken noun or click needs another effect.

## §3 Choose visual treatment and sound

Start from the product/subject's design and the brief. The six kit styles are available
looks, not a mapping from industry to mandatory aesthetic. A direct composition or plain
capture may fit better than any preset.

- **Layout and rhythm:** use stable anchors and longer holds when the viewer must read;
  use faster variation when it serves the story. Neither cadence is universally better.
- **Camera and callouts:** consider a crop, pan or zoom when a detail would otherwise be
  illegible. Check its landing and hold. Do not shrink the rest of the product to add
  framing for its own sake.
- **Transitions/effects:** use only when they clarify a relationship, emotion or shift.
  The effects engine offers choices such as `spotlight`, `portal` or `screen-in-screen`;
  plain cuts, gentle dissolves or no transitions may be more appropriate. There is no
  quota. If using an effect, inspect its entrance and exit with the actual content.
- **Voice:** original performance, recorded narration, synthesis or no voice are all
  options. Test names and tone on a short sample when speech matters. Do not regenerate
  approved audio for an unrelated visual edit.
- **Captions:** choose readable phrasing and placement for the platform, audience and
  accessibility requirements. Do not apply short social fragments to every format or
  let captions obscure the evidence.
- **Music:** use it only if it helps, is permitted and leaves speech understandable.
- **Branding:** choose what helps recognition; an intro, persistent chrome and a branded
  end card are options, not three requirements. Preserve approved asset/licence conditions.

Kit-specific controls (`video.style`, `video.effects`, `video.music`, caption options and
camera cues) are documented in [README.md](README.md). Check the actual flags/config
before use rather than inventing a new option.

## §4 Build at the appropriate cost

For the config-driven route:

```sh
kit-preflight
kit-video --plan
kit-video
```

These commands describe that route; they are not required for a direct edit. Probe the
chosen renderer on a short range before committing to an expensive capture. Use a cheap
rough when choosing direction, and final-resolution rendering when readability or delivery
needs it. Measure throughput before deciding concurrency.

Read warnings. Distinguish a broken required capability from an optional fallback that
still meets the brief. If a fallback materially changes the result, disclose it and fix or
review it; do not claim the missing feature ran. The kit's “not used” inventory is
informational. It is not a list of omissions that every video must justify or enable.

For revisions, keep the selected baseline, protected content and changed ranges explicit.
An isolated preview may include context or an exit tail; that extra time does not
implicitly change the full film's clock. Preserve prior versions and content-hash caches.

## §5 Verify the artifact and review the editorial result

Use checks appropriate to the change and delivery. A visual-only revision needs changed
ranges and their joins inspected; a new narration, retime or composition can require a
broader pass. Before delivery, check the finished encoded artifact as a whole. Do not
render extra rounds merely to satisfy a pass count.

| Check | What it can establish |
| --- | --- |
| `ffprobe` / full decode / applicable `kit-preflight` rows | Duration, size, codec, frame/audio properties and export failures |
| Caption/geometry checks | Timing, clipping, bounds and possible collisions |
| Contact sheets and transition strips | Visual issues at selected instants; not the whole viewing experience |
| Watching the sequence, with its intended sound/viewing conditions | Readability, continuity, emphasis, tone and whether the story works |
| Comparison with the selected baseline | Whether a bounded revision improved the requested part without changing protected parts |
| Owner's selection | Editorial acceptance; technical validity alone is not this |

For an animated join, a strip can help: `ffmpeg -i demo/demo.mp4 -vf "select='between(t,A,B)',fps=6,scale=480:-1,tile=6x2" -frames:v 1 /tmp/strip.jpg`.
Set A/B from the actual output clock, not an assumed title-card offset. If using a kit
review page, inspect the chosen design; there is no obligation to cycle through every style.

Record notes as timestamp + observation + intended change. Keep general lessons separate
from project preferences, and retire notes superseded by a new direction. Clarify ambiguous
feedback that changes the workflow being shown. If the owner returns to a named earlier
artifact, that artifact becomes the base; do not reassemble rejected experiments into it.

Exit when the applicable requirements pass and the agreed editorial result is accepted.
Use the real cap and an appropriate margin rather than silently changing duration. Stop
for a specific remaining defect, not because a previous project took more rounds.

## §6 Variants and comparison, when useful

Variants are optional. Explore them cheaply when the direction is uncertain; once a base
is selected, a requested detail edit should not reopen every creative decision.

- Re-skinning and retiming are possible through the kit review/override flow when using
  that renderer. They are capabilities, not automatic next steps.
- A portrait/social version should be composed for that audience. The kit's optional
  `video.formats: ["9:16"]` output letterboxes the body; inspect whether that is legible
  enough instead of assuming a landscape explainer becomes a good social edit.
- `kit-video --compare ref.mp4` reports detected scene changes, first change and duration.
  Treat these as diagnostics, not an editorial score or an instruction to add cuts.
- Contact-sheet density (`video.contact_every` or `--sweep`) is a sampling choice. More
  samples help locate defects; they do not specify how often the video should change.
- `kit-posts` can prepare publication copy when that is part of the job.

## §7 Deliver what was agreed

Record the accepted artifact and source version, hashes, applicable check results and
rebuild entry point. Supply the formats needed: for example MP4, captions, thumbnail and
upload copy. A direct local file may be the right review/delivery method; hosting is optional.

Leave time for the actual submission/upload rules and verify access from the intended
viewer. Publish, push or submit only within the user's authorization and project workflow.
An honest working recording can be the right final deliverable; it need not wait for a
more elaborate rendering pipeline to finish. Keep earlier candidates distinct from the
accepted final.

## §8 Case lessons — observations with context

These are reports from particular productions, not rules to apply wholesale. For each,
consider the audience, material, constraints and failure it addressed. Reuse the principle
when it fits; do not inherit its genre, pacing, narrator or layout merely because it worked
there. Technical facts about a named tool remain scoped to that implementation/version.

### Product walkthrough built from real runs

Learned on a B2B product demo (an AI assistant driving a packaging and testing service through MCP tools), built in four rounds over one afternoon. The observations below describe what helped that cut.

- **Ground every beat in real product evidence before writing a word.** Reuse completed captures and traces when they prove the behavior, especially when the owner has ruled out new runs. For authorized fresh recordings, dry-run the scene and save transcripts (`claude -p --output-format stream-json`), screenshots, outputs and timings in one evidence folder per beat. Assemble from that evidence, never invented behavior. Dry runs can also expose the traps listed below; they do not authorize paid calls or new studies by themselves.
- **Write the script for the buyer, not the builder.** Ask who is watching and what they would do with it. For a partner, the story is "every app your customers need, done this way", not "look what one app did". Close on what works today, and say plainly what comes next.
- **Give the video one visual backbone.** An animated pipeline of the stages, with a token travelling along it, works well. Each stage builds the artefact it produced (a card with the real numbers: install settings, pass/fail counts, cost, a link). Open and close on the full overview, and make sure every stage fits in frame there.
- **Put real artefacts beside the animation.** Real screenshots, rendered real documents, and chat panels showing the trimmed, real conversation text. Viewers trust it more than mock-ups, and it answers "is this real?" without a word.
- **Caption the awkward truths.** If a screenshot shows something odd (a warning dialog the environment causes), caption it honestly rather than cutting it. Never imply a capability that isn't live.
- **Apply the brand from its own rules,** with logos copied in unmodified (never recoloured or stretched). A branded intro and end card replace any default black cards.
- **Test the voice by listening back with transcription.** Render a 15-second sample per candidate voice, then transcribe each sample. This catches mispronounced product names: several voices said "cloud" for "Claude". Build the voiceover sentence by sentence and let those timings drive the captions and every animation, so a voice swap is one command and a few minutes' re-render.
- **Check with contact sheets at several timestamps per scene,** not one frame per scene. They catch clipped text, half-visible labels during camera pans, and content left over from the previous scene. One render showed the first app's "package ready" card during the second app's scene.
- **Version every render** (v1, v2…) and keep the old ones; feedback arrives as "the last one but…".
- **Choose the appropriate production route.** Reusing kit effects helped this example; other jobs can be simpler as a direct edit or small composition. Avoid developing a renderer during an editorial revision. Fold reusable findings back into the tools.
- **These lessons are reproducible, not just prose.** `pack/10-what-makes-it-good.md` restates them for the pack, and `video/motion-explainer/stage-rail/README.md` is the same pattern as a copyable template — one backbone, real artefacts, honest verdicts.

**Traps the dry runs caught** (any live demo of an agent driving a service):
- a loaded machine can take minutes to start an MCP server, longer than the client's start-up timeout, so there are no tools (close heavy apps, warm the server first, raise the timeout);
- rolling daily usage caps get used up by the rehearsals;
- ending the assistant mid-wait can leave server-side work locked;
- the assistant skips your tool if it can do the job itself, so name the tool in the prompt;
- a model hand-copying a long base64 payload corrupts it, so never stage a demo on that path.

### v2 looked worse — the five quality regressions and their fixes (2026-10-25)

A kit-built explainer looked soft and the VO sounded stilted. The forensics and fixes:

- **Realtime JPEG screencast** banded and stalled at scene changes → `video.capture: frames` is now the default for explainers: the recorder pauses all animation (GSAP globalTimeline, WAAPI, or a page-level `window.__seek(t)` hook — the hook wins), steps the clock at the output fps, screenshots lossless PNGs at the full output size (`video.width × height`, deviceScaleFactor 1) and encodes once near-lossless (libx264 crf 10, preset slow). `realtime` stays only as an explicit opt-in for live-app recordings.
- **Upscale** — release scaled a 1600×800 capture 1.16× → when the capture is already output size, styles place it 1:1 (`frame_full`); the wrap never scales a full-size capture.
- **Grain** — every style's grain is `opacity: var(--grain,0)`, off unless `video.grain` says otherwise.
- **Triple re-encode** — intermediates are near-lossless (crf 10, slow); a rendered file that fits `max_mb` is stream-copied, else one slow crf-18 encode; exactly one lossy AAC encode (48 kHz, 192 kbps) in the whole chain, in the final loudness pass — which is now two-pass linear loudnorm, always `-ar 48000`.
- **Time-stretched VO** — atempo made narration stilted → the plan now fits the VO with `video.card_seconds`, `video.vo_under_cards` (up to 1.5 s over each card), or re-synthesis at a capped ±10% rate; `video.vo_fit: stretch` is the explicit opt-in, and over-length scripts fail with the word count to cut.

### Process lessons from a 60 s pitch built by parallel agents (2026-10-25)

Three rounds and several hours went on process mistakes. These fixes addressed that scripted pitch; evaluate their fit for another format.

**Message before pixels**
- **Pitch shape: hook → problem → live demo → impact → close.** The first draft was a list of facts, and the owner said it "doesn't say much". What fixed it was one spine sentence that every beat proves ("the best advice is often do nothing, and it knows when"). Even the surprising finding (the biggest model over-treated most) was framed as proof of that spine, not as trivia.
- **Write a facts file before the script**, with every number, its exact wording, its source and a "do not say" list (e.g. which step is *not* on the sponsor's model, which features are switched off, which numbers are small samples). Agents then put on-screen text only from the script plus the facts file. This stopped invented copy ("No stack trace. No timeout." was false) from reaching a render.
- **Explain your own jargon in plain words.** "Twin" meant nothing to anyone but the builder; "a simulated copy of your plant" works.
- **Lock the script, then build visuals.** Two video variants were built on a script that was then replaced, and every scene had to be re-keyed. Visuals keyed to line ids plus word timings make that re-key cheap, but locking first is cheaper.
- **Budget words including pauses.** 2.4 words/s is speech only. Expressive pauses added up to 9.4 s and pushed three voices past 60 s. Build the VO and measure it before any visual work, then trim words or pauses, never time-stretch. Close sections overrun first.

**Live demo**
- **A live beat is a real recording of the real product**, never a mock-up. Capture it with headless Chrome at deviceScaleFactor 2: PNG screencast frames, each with its real timestamp, placed on a 30 fps timeline, then downscaled with lanczos. Lossless capture avoided the quality problems in this run; existing approved footage can still be reused without pretending its original codec is lossless.
- **Dense full-page UI was unreadable in this demo.** A crop or camera move made the relevant detail legible. Choose scale and hold from the content and viewing size; the earlier 2–3× / 1.2 s settings were examples, not universal targets. Use adequate source resolution.
- **Speed-ups are labelled honestly** with the actual factor per segment ("sped up ×4"), rounded down, and only while the speed-up plays.
- **Never add UI the product doesn't have**, such as a tag the real page never shows. Never overlay a pre-scripted asset that contradicts the footage: a canned "Found parsley" strip over a coriander run. Regenerate overlays from the run's own logged events.
- **Headless Chromium does not composite `<video>` into screenshots.** Pre-extract clip frames to images and swap the `src` per frame from `__seek`, awaiting `onload`. A recorder must fail loudly on a page error, never hold the last frame.

**Verification**
- **"Verified" means a person or agent looked at the frames.** Claims from OCR, DOM checks or `meta.js` let through overprinted captions, a 20 s frozen live demo and empty scenes, all reported as verified. The minimum: a 0.5–1 fps contact sheet of the whole video, plus full frames at every line start and every 0.5 s across the demo beat, looked at by eye. The reviewer briefs the builder with timestamps ("at 35 s two captions overlap").
- **A fresh-eyes reviewer catches what the builder misses.** Run one per round on the finished file.

**Parallel agents**
- **Never share a mutable input between concurrent builds.** One agent rebuilt the VO while another was rendering against it. Every build snapshots its `vo.wav` + `timings.json` first, and each script version gets its own VO folder.
- **Caches are keyed on the content.** A VO segment cache keyed on the line id alone reused stale audio after a script edit.
- **Split by output, not by step.** Parallel tracks that worked: kit fixes · research ×3 · real assets · VO bake-off · one builder per visual style, all reading the same script and facts files.

**Voice**
- **Name-check every engine** by transcribing the tricky words, and keep TTS-only spellings (e.g. a domain name split into words, "Nebbius" for `say`) out of captions. Whisper's own spelling ("Nemetron") is not a voice defect.
- **Fit the VO by trimming pauses evenly, not by stretching speech.** Chatterbox is fixed-rate, so shorten its gaps; for `say` and Kokoro, re-synthesise within ±10%.

### Retrospective — why that run took hours and still disappointed (2026-10-25)

The owner had made better videos in less time by asking a model directly. These are the
orchestration mistakes, in order of cost:

1. **Building before the message was settled.** Three scripts in a row; visuals were built
   on the first two. In that scripted pitch, settling the message before expensive visuals would have avoided the rework. A footage-led piece can need a different order.
2. **Trusting "verified" from agents.** The kit-built variant was reported fixed and
   verified three times while its live demo was a frozen still. The lead only found out
   by grabbing frames. Rule: whoever reports to the human grabs frames at named
   timestamps *themselves* before saying "done", every round.
3. **Taking the heavy route for a short piece.** For a 60 s pitch, one agent hand-writing
   one seekable HTML page (or a Remotion comp), captured frame by frame, beat the
   config-driven kit route on time and quality. Use the kit's renderer and styles when a
   project needs repeatable builds; consider the direct route for a one-off pitch when it avoids unnecessary infrastructure.
4. **Fixing the tool and the video in the same loop.** Kit bugs (a recorder that never
   called `__seek`, a caption layer on the wrong clock) surfaced one per render. Prove a
   kit change on a 5-second test page with a frame grab before rebuilding a full video.
5. **Too many variants too early.** Three styles × two cuts × three voices multiplied
   every fix. Get one cut right in one style, then make variants.
6. **No stopping rule.** After two failed rounds on the same defect, stop, tell the human
   and offer the simpler route, rather than send a third brief.

### Voices that work (tested on macOS, October 2026)

Product names trip voices up, so test each candidate by rendering the tricky words and transcribing the result back (`say -v "<voice>" -o w.aiff "<words>"`, convert to 16 kHz WAV, then `whisper-cli -m <ggml-small.en.bin> -f w.wav -nt`).

| Voice | Engine | Brand name "X-house" | "Azure" | "Claude" | Verdict |
|---|---|---|---|---|---|
| Serena (Premium), en_GB | `say` | ✅ one word | ✅ | ✅ | **Best overall.** Natural British female |
| Daniel (Enhanced), en_GB | `say` | ⚠️ split into two words | ✅ | ✅ | Good fallback |
| Arthur (Enhanced), en_GB | `say` | ⚠️ split into two words | ✅ | ✅ | Good fallback |
| Jamie (Premium), en_GB | `say` | ⚠️ split | ❌ "as you were" | ✅ | Most natural sound, but mangles Azure |
| Kokoro bm_george | local Kokoro | ✅ | ✅ | ✅ | Usable, flatter. The only Kokoro voice that said "Claude", not "cloud" |
| Kokoro bf_emma and others | local Kokoro | n/a | n/a | ❌ "cloud" | Avoid when the script says "Claude" |
| Chatterbox turbo | local neural TTS | ✅ (cloned ref) | ✅ | ✅ | Most expressive free option; ~6.5 s render per second of audio, fixed rate — the kit retries seeds until whisper hears every word |

- **Chatterbox turbo vs original** (`video.chatterbox.model`): Turbo is the default — faster and needs no tuning, but it ignores `exaggeration`/`cfg_weight`. The original model honours them, so use it when the read needs deliberate expressiveness (and budget the slower render). Give either a `ref_wav` to clone a voice; without one they use the built-in voice. Chatterbox has no rate control: the planner squeezes sentence gaps to fit, and beyond that you cut words or set `vo_fit: stretch` — it is never silently time-stretched.

- **Premium and Enhanced voices aren't installed by default.** Get them from System Settings → Accessibility → Spoken Content → System voice → Manage Voices, at about 300 to 500 MB each. `say -v '?' | grep -E 'Premium|Enhanced'` confirms what's installed. Siri voices can't be used by `say`.
- **Keep the voice swappable.** Build the voiceover sentence by sentence and drive captions and animation from those timings. A voice change is then one command and about 5 minutes' re-render.
- **ElevenLabs** sounds better again. Use it only on an account the work belongs to: company work goes through a company account, never a personal key.
- **Freeing space:** each unused Premium voice can be removed from the same Manage Voices screen.

### Render time: rough cut first, frame-exact last (2026-10-25)

Two 3-minute videos built in parallel on one laptop lost about two hours to capture time.
Frame-exact capture (`video.capture: frames`, the explainer default) is the right quality
for the FINAL, but it is the wrong tool for the first look.

- **Know the cost before you start.** Frame-exact is one browser screenshot per frame:
  3 min × 25 fps ≈ 4,500 frames. Under load it ran at ~1 frame a second (75+ min). Work out
  frames × seconds-per-frame from a 10-second probe before committing to a full capture.
- **Rough cut first, cheap.** For the first watch, capture frame-exact at a low setting
  (12 fps, 1280×720, encode `-preset veryfast`): about 40% of the frames, no banding. Real-time
  capture is faster still, but can band or stall at scene changes (see the regressions list
  above), so use it only for a quick look. Full-resolution frame-exact only once the
  owner has picked the cut.
- **Bound concurrency to the measured machine.** Two captures plus several test suites
  caused contention in this run. Queue heavy work when it hurts throughput; do not assume
  either one worker or many workers is always optimal.
- **Shard for recovery; measure before adding workers.** Frame ranges and valid caches
  make long captures resumable. Increase concurrency only when a probe shows a throughput
  benefit and shared inputs remain immutable.
- **Never return the timeline from `__go`.** The stage-rail template's `__go` ended with
  `return t`, and the recorders called `page.evaluate(s => window.__go(s))`, so Playwright
  serialised the whole (growing) GSAP object graph back to Node on every scene switch:
  ~10 min per switch, then a hang. Fixed in the kit (25 Oct): `__go` stores
  `window.__tl = t`, and every caller uses `page.evaluate(s => { window.__go(s); })`.
  Any custom explainer must do the same. Probe a scene change in the 10-second test.
- **Show the owner something within 30 minutes.** A silent rough with burned-in captions
  is enough to pick a direction. Polish after the pick, never before.
- **Local voices and brand names:** Chatterbox mispronounced "Nemotron", "Nebius", "Tavily"
  and "Toloka" even with respellings; Kokoro (`bm_george`) said them all right. Check
  every voice with a Whisper read-back of the brand-name lines before building on it.


### Calm product-video revision lessons (2026-10-26)

A three-minute evidence-heavy submission finished at 178 seconds. Its accepted version
returned to a calmer baseline after more elaborate assemblies were rejected. The retained
changes were animated research bars, one continuous answer zoom, and clearer care panes
inside the existing workspace. Technical checks had passed on rejected versions too.

- A story beat need not be a new visual chapter. Keep headings, subject context and
  navigation stable while the detail changes; allow the completed result to be read.
- Fix excessive visual resets before adding smoother dissolves. A transition joins
  layouts; it does not remove the viewer's work of understanding a new layout.
- Scope revisions against an exact selected artifact. Test an isolated transition when
  needed, then review its assembly; liking individual parts does not select their combination.
- Keep preview-only tails out of the master clock unless retiming is agreed. Freeze audio
  and captions during a visual-only edit.
- Confirm the product stage being requested: photo recognition, advising and web search
  are distinct. Use actual traces and label primary/fallback roles as recorded.
- Technical QA and editorial acceptance are separate gates. A valid MP4 is not a chosen final.

Full lessons, reproduction steps and a copy-ready kickoff:
[calm-product-video-workflow.md](../docs/calm-product-video-workflow.md).
Starter: [video/calm-product-demo/](video/calm-product-demo/README.md).

### A 49s build-story assembled outside the kit beat three kit-framed attempts (2026-10-27)

For a casual sponsor "how's your build going" form, an agent outside the kit produced
the video the owner submitted, after three kit-framed attempts were rejected (designed
release comp, flat raw footage, floating-card comp with zooms). Same primitives —
GSAP page, ElevenLabs, ffmpeg — no kit machinery. The lesson is not "avoid the kit";
it is which parts of a build carried the quality.

- **The script did most of the work, and it was concrete.** The winning script pulled
  measured numbers straight from the repo's own eval data — "150 test questions cost
  about 40 cents", "Ultra suggested treating when the expert didn't in 12.7% of
  answers; Super, in 2%" — where the rejected scripts used vaguer claims and an
  anecdote. Before writing VO, mine the project for its own measured numbers; the
  repo usually already contains the most persuasive sentence.
- **Per-section voiceover is a better unit than one whole-script render.** The audio
  was four separately synthesised sections (intro / tools / surprise / beyond), each
  with its own word timings, mixed at the end. A weak section can be re-rendered
  alone, and each section's timings drive only its own beats.
- **The lane mattered less than the craft.** The winner was *designed slides with
  small real-product insets* — the same broad shape as the rejected release comp.
  What differed: one idea per frame, kicker labels instead of chrome, editorial
  type, and product evidence appearing as small insets exactly where the claim
  needed it. A template's uniform structure read as a slide deck; a bespoke page
  with the same ingredients read as designed.
- **Verification was per-beat, not one contact sheet.** The work directory kept
  named frame picks at beat timestamps (`pick-24.5.png`…), an automatic cut-point
  log (`edges.txt`), and a billed-character audit for the paid voice (`chars.log`).
- **Shorter won.** 48.7s against a 60s cap beat the 57.6s attempts; density and
  earlier payoffs mattered more than covering everything. (For a 3-minute cap this
  doesn't carry over: placed Devpost videos run long but have no dead air. See
  "What placed Devpost videos do" below.)
- **Nothing required the frame.** `hackathon.yaml`, `kit-video`, styles and effects
  were all unused. The durable value was the components and checks — word timings,
  loudnorm, frame grabs — not the configured pipeline. Judge a build by which of
  its pieces this job needs.

### Outage Desk, 27 Oct 2026: missed tools and a time quote from the table

- **Take inventory first.** The agent read the guides but did not run `kit-video --tools`,
  and `kit-edit` landed in the kit mid-session. It quoted "1.5–2 hours" for a motion-graphics
  version from the routes table; the owner asked three times why. Built from measured parts
  (see VIDEO-ROUTES "Estimate from parts") the job was 20–40 minutes. New code was the
  whole cost, which is why `video/scenes/` and `video/live/` now exist.
- **Check the claim against the saved data, not the old script.** Earlier scripts said
  "the model proposed Reported and code capped it" over a stage where the screen showed
  hand-built reference data and the model had in fact said Unconfirmed itself. The real cap
  was in a later stage's saved run. A screen label like "reference data" is a cue to check.
- **Record at 2× and zoom in post.** CDP screencast frames at device scale 2 gave crisp
  zooms to ~1.9× on a 1600×800 layout; element boxes logged during the walk made each zoom
  land on the right card without guessing.
- **The owner wanted motion graphics to explain, footage to prove.** A pure live-app cut
  with zooms was rejected as "we aren't seeing what is going on": dense UI does not explain
  a pipeline on its own.
- **Reuse the kit's cursor.** The kit's recorders draw a mac-style pointing hand (fingertip
  hotspot); a new recorder written from scratch drew a circle and the owner noticed. The live
  recorder now carries the same hand.
- **Build from the logged times, not the asked-for times.** Puppeteer mouse glides cost tens
  of ms per step under a running screencast; clicks landed up to 4 s late and the edit cut the
  wrong moments. The recorder now glides in fixed eased steps, warns on a late click, waits
  out smooth scrolling before logging a box, and the edit plan reads `events.json`.
- **Explain the sponsor's model properly.** The owner's original walkthrough showed where the
  model sits (four of five pipeline steps) on the app's own Analysis page; the first explainer
  only mentioned it. A pipeline scene with the app's own labels, then live footage of that page,
  restored it.
- **Soften scene↔footage joins.** A 0.4 s colour dip between dark scenes and bright UI read as
  harsh; `kit-edit` `xfade` `smoothup` at 0.8 s did not.

### What placed Devpost videos do, from a 22-video survey (2026-10-27)

This is a survey of 16 placed entries (OpenAI Build Week 2026, Twitch Streamer Tools Hackathon 2024, OpenAI Open Model Hackathon 2025) and 6 that didn't place. 20 videos were measured frame by frame with their captions; the counts and URLs are in twitchprep `docs/research/7-winning-videos.md`.
- **Never open on a static frame.** In the first 10 s, 8 of 14 placings showed the product working and the rest opened on a person or the stakes. 0 of 6 non-placings showed the product, and 5 opened on a README, landing page, dashboard or idle UI.
- **Match the hook to the event.** For creator or streaming events, open on the product inside the real platform with someone reacting. For "AI for real problems" events, opening on the person and the stakes works as well.
- **Use most of a 3-minute cap.** Placed videos clustered at 2:35–3:00 (median 2:50). The rule that generalises across caps is "no dead air": cut every load, wait and login.
- **Live product should be at least half the runtime, code and tooling at most about 20%.** The exceptions carried a strong human story.
- **The build-with-AI beat is short, late and backed by evidence.** Spend 15–35 s in the back half on real artefacts (an agent rules file, a review catch, a test count) and on one decision the builder made. Opening on the tool UI was a losing pattern.
- **Show the AI's decision inside the product**: a reasoning line, a confidence ranking, or a tool-call log with cost or latency.
- **Measured numbers on screen are rare, so one full-screen number card stands out.** Burn captions in, because judges often watch muted and back to back. Pace was 97–177 wpm in placings; the 215+ wpm entries felt rushed.
- **Write-ups open on a problem or a person**, often the builder's own experience, and put the trust or safety constraint in the tagline. Read the write-up aloud and rewrite anything that sounds machine-written.
- **Survey method, to repeat for any event:**
  - Fetch with `yt-dlp` at 360p plus the auto-caption track.
  - With ffmpeg, make one timestamped sheet per video: 6 frames across 0–10 s and 24 evenly spaced frames.
  - Speaking pace is caption word count ÷ duration.
  - YouTube returns HTTP 429 after about 15 rapid requests, so pause 20–30 s between videos.
  - Find past events with `devpost.com/api/hackathons?search=…&status[]=ended`. Devpost pages render reliably through a real browser over CDP.
