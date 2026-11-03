<!-- hackathon-kit:rules:start -->
## Event rules (from hackathon-kit — Flip the Switch)

These hold for every coding agent in this repo. They exist because honesty is
scored and because the last hour before freeze is when they get broken.

- **Results come only from the runner.** Never hardcode, edit, reformat or "fix"
  anything under `ANSWERS/` or `traces/`. If a case
  fails, it stays failed and the README says so. Re-run the runner instead.
- **Nothing aimed at an automated judge.** No instructions, pleas or scoring hints
  addressed to an evaluator or model, anywhere — code, docs, outputs, comments,
  hidden text. `kit-preflight` greps for it and fails the submission.
- **No secrets in the repo.** Read keys from the environment; `.env` stays
  untracked. Ship a `.env.example` with names only.
- **README tracks reality.** Keep every required section in sync with what is
  actually built — including **Known limitations**. Don't claim what isn't wired.
- **Keep the demo runnable.** When the CLI or UI changes, update
  `demo/demo.tape` (terminal) or `demo/record_ui.ts` (UI) in the same change so
  `kit-video` still renders.
- **For kit-driven videos, `hackathon.yaml` configures the tools.** `video.renderer` `hyperframes`/`remotion`
  need a one-time `bin/kit-setup-*` on this machine (kit-preflight warns if it's
  missing); `voiceover: elevenlabs` needs the env key and gives word-exact
  captions — `caption_highlight` is safe there, drifts with kokoro/say.
- **Any agent: read `demo/brief.md` and `demo/QUALITY.md`.** They carry the current
  audience, purpose, source material, baseline and quality decisions between providers.
  Do not infer acceptance from a filename or an encoder success message.
- **Choose the video format from the brief.** `demo/README.md` is the kit's
  toolbox and case lessons, not an end-to-end recipe every video must follow.
  Walkthroughs, explainers, interviews, tutorials, social edits, silent work or
  other forms may fit. Use only the capture, voice, camera and review tools needed;
  `kit-video --tools` lists capabilities, not obligations. A direct recording or
  small composition can be the right final artifact.
- **Optional helpers stay optional.** `kit-edit` assembles existing footage from a shot plan; `brand.json` loads actual local fonts; `kit-caption` patches final-clock captions. See the shared editing/typography guides. They do not prescribe the video format.
- **Read current video notes and protect the selected baseline.** `demo/NOTES.md`
  records feedback; apply it in context, retire superseded directions and keep a
  bounded revision scoped. Check the encoded output technically and editorially;
  unused optional tools and scene-change counts do not determine quality.
- **Judging rubric — spend effort where the points are**, and make sure each
  criterion has something visible in the demo that proves it:
  - Use of Switch (30%)
  - Technical execution (25%)
  - Creativity and impact (25%)
  - Presentation and docs (20%)
- **One path end to end beats four half-built ones.** Protect the demo path; cut
  scope elsewhere before letting it break. Commit as you go — judges read history.
- **"How to run" stays copy-pasteable**: exact commands, verified from a clean clone.
- **Before any freeze, run `kit-preflight`** and fix every ❌. Don't skip checks.
- Video limit: 180s. Deadlines (Europe/London): see `hackathon.yaml`.
<!-- hackathon-kit:rules:end -->

## Dictation
Kash dictates every prompt by voice (Wispr Flow). Expect transcription slips (e.g. 'anthrophic', 'cloud code'). Read for intent, ask once if an identifier is ambiguous, and never act on a misheard destructive command without confirming.
