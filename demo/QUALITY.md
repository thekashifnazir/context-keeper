# Making good videos across agents

> **Making or quoting a video? Take inventory first.** Run `hackathon-kit/bin/kit-video --tools`
> and `hackathon-kit/bin/kit-scene --list` before choosing a method or giving a time: tools land
> often and this page may not list them. Then pick the route in
> [VIDEO-ROUTES.md](VIDEO-ROUTES.md) and estimate from its measured step costs. Ready-made scenes
> render in seconds and only new code takes long, so never offer a frame-by-frame render
> (1–4 h) unless no existing scene fits.

This is a portable working contract, not an aesthetic preset or a promise that a
renderer can judge taste. Use the current brief, available material and the owner's
selected cut. Any capable agent should be able to see the same decisions, run the
same small tools, and inspect the same deliverable.

## Start with what the viewer gets

Choose the format and production route separately. A product showcase, builder update,
tutorial, documentary or designed explanation have different jobs. Avoid letting the
scaffold's headings, a renderer's demo or an effects inventory choose the story.

A practical sequence is: understand the purpose and constraints; inspect the available
assets and actual product/results; select a story and appropriate visual plan; measure
speech when used; build at the cheapest suitable route; inspect the encoded result.
These steps may happen in another order for footage-led work or a bounded revision.
Use an early sample when it resolves uncertainty, not as an automatic approval gate.

`demo/brief.md` carries these choices between agents. Fill only useful fields. No need
to ask the owner for information already established in the conversation or repository.

## Decisions that mattered in the worked case

- The result-first app showcase and the personal builder update used the same assets
  but different scripts and priorities. Compressing one into the other missed its job.
- Existing app results, branding, feedback and studies provided better material than
  invented example screens. Research evidence kept its actual scope.
- Native app footage showed behavior; a graph animation made a comparison legible.
  An animation earned its place by explaining something, rather than ticking a tool box.
- Several features stayed inside one plant/workspace. The viewer could absorb new
  details without locating a new layout on every sentence. Another genre can benefit
  from faster resets; the transferable test is comprehension in sequence.
- A matched zoom made the answer readable. Wrapping every screenshot in extra boxes
  reduced the useful pixels. Check the final viewing size, including a phone.
- Dissolving unrelated text-heavy layouts produced double text. Cuts, matched views,
  restrained wipes or a transition through a suitable background solved different joins.
  There is no single transition to apply everywhere.
- A brief existing brand animation added recognition without a long preamble. Its
  presence and length came from the brief; every video does not need an opener.
- The voice was measured before final fitting. Saved word timings were mapped through
  tempo and final offsets, then karaoke was patched without regenerating narration.
- The selected baseline and protected ranges made later revisions small and predictable.
  A good isolated shot still needed checking in the assembled film.

This result benefited from multiple editorial iterations and accumulated owner feedback.
Preserve those decisions and examples, rather than crediting a magic prompt or assuming
one model will always produce them unaided.

## What to inspect before calling it good

| Dimension | Useful evidence / question | Common failure |
| --- | --- | --- |
| Purpose | Can someone say what this is and why it matters at the right point? | A polished film answering the wrong brief |
| Product / subject | Is the important action/result visible and truthful? | A marketing-page tour or designed illustration mistaken for actual UI |
| Reading | Can text and UI be read at delivery size before the next movement? | Tiny nested screens, captions over evidence, a reveal with no settled hold |
| Continuity | Does the next view preserve or intentionally re-establish context? | A new layout per sentence; overlapping text in transitions |
| Speech / captions | Are names correct and cues/highlights on the words? | Evenly invented timings; a changed voice clock; stale captions |
| Sound | Is the voice clear, with appropriate music level and clean endings? | Silent fallback, clipping or narration cut to satisfy the time cap |
| Integrity | Are benefits, measurements and illustrations clearly distinguished? | Intended impact presented as a measured outcome |
| Delivery | Does the actual file decode, play, seek and meet its real limits? | File-exists tests mistaken for editorial approval |

A contact sheet locates layout defects; it does not prove motion or reading time.
Inspect the actual joins, camera landings and encoded playback. Prefer changes tied
to a specific observed issue; more render rounds, effects or detected cuts are not
quality scores.

## Reusable execution

- `bin/kit-video`: configured capture/assembly. Check actual renderer support; a changed
  backend can change features. Read warnings and `demo/build/delivery.json`.
- `bin/kit-caption`: current-word captions on a finished video, using saved final-clock
  words. No new voice call or recapture. See [caption patch guide](CAPTION-PATCH.md).
- `video/captions.py`: canonical spelling + saved ElevenLabs/Whisper word alignment.
- `demo/brief.md`, `demo/NOTES.md`: current decisions, baseline and feedback. Retire
  superseded directions instead of accumulating every historical suggestion.
- `VIDEO-PLAYBOOK.md`: approaches and capabilities; `VIDEO-ROUTES.md`: production cost.

Agent entry points generated by `kit-init` are `AGENTS.md` and `CLAUDE.md`, from one
canonical rules block. A different agent can read this guide and the same project brief
without relying on another provider's hidden memory, personal paths or conversation.
For a handoff, include the exact candidate/baseline, what is protected, final clock,
asset provenance, rebuild command, checks run, and what still needs human judgment.

## Keep examples varied

Useful references can include a real-product walkthrough, an evidence explanation,
a personal update, a silent task demo or an energetic launch. Keep each example's
purpose, context and reasons alongside it. Do not copy proprietary footage into the
shared kit, invent popularity thresholds, or let one successful case become the only
permitted form. A fixture can check mechanics; it cannot stand in for editorial taste.

## Checking changes to the kit

`tests/run.sh` includes contract tests and small real FFmpeg fixtures. The optional
`python3 tests/render_quality.py --out <temporary-directory>` renders short and absent
bookend cases through installed HyperFrames and Remotion, decodes them and checks the
planned body is visible. It uses an isolated Remotion public directory and no TTS calls.
Run these when changing the relevant mechanics; they are not mandatory creative steps
for every video. They test timing and rendering, not whether a story is compelling.

Optional execution helpers: [kit-edit](video/EDITING.md) supplies source/output clocks, camera moves, transitions and explicit audio for existing footage. [Local typography](video/BRANDING.md) loads actual licensed fonts across renderers and caption patches. Neither chooses the story or mandates a visual style. Preserve settled reading time when selecting transitions.
