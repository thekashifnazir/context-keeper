# Job E and voice live test: idea → done, and the spoken catch-up (morning runbook)

Both are wired into the live agent (`src/agent/main.ts`) and tested offline
(`npx vitest run test/offline/wiring.test.ts test/offline/handoff.test.ts test/offline/voice.test.ts`).
Neither has run live yet: job E needs your "Allow once" clicks. This is the first live run, in a fresh
smoke room, so no demo channel gets a test post. About 30 minutes.

## 0. What's wired, and the flags

| Flag | Default for `npm run agent` | In `npm run eval` | What it does |
|---|---|---|---|
| `CK_JOB_E` | on | off unless you set it | Job A's `new` ideas (and `might-be-related` ones where job A named a new part, labelled "builds on …") go on the owner desk list; "approve I<n>" hands one to Claude Code in `CK_BUILD_ROOM`; the raiser signs it off in the original thread |
| `CK_AUDIO_BRIEF` | on (needs `ELEVENLABS_API_KEY`) | off unless you set it | Job C's ~60 s audio clip, posted under the text brief in the same thread |
| `CK_TALK_LINK` | on (needs `ELEVENLABS_API_KEY` and `agent_id` in `state/voice-ids.json`) | off unless you set it | The brief's last line becomes a per-person "talk it through" link; after the call, its summary posts in the same thread |

`0`, `off`, `false` or `no` turns one off. The eval runner (`eval/replay.ts`, `startAgent`) starts the
agent with all three at `0` unless the eval's own environment sets them. The agent prints which are on
at start: `features: job E on, audio brief on, talk link on`.

Where each hook sits in `main.ts`:
- every message event goes to job E first (`handoff.onMessage`): an "approve I<n>" in the owner desk,
  anything in a build room, and the raiser's or your sign-off reply. Anything else falls through to
  jobs A–D. Another agent's post (any `@switch-agent-` sender) never reaches job A.
- after each job A decision, each `new` idea is noted for you (`noteNewIdeas`, once per idea). So is a
  `might-be-related` one when job A itself chose that verdict, its cited record passed the quote gate,
  and it filled record_verdict's `new_part` (the part the record doesn't have yet, e.g. "a pay-now
  link in the reminder emails"; it lands in the trace item as `new_part`). Code then adds "I've logged
  that part as a new idea: <new part>." to the public reply. The desk note reads "New idea I2 from Rowan in #…
  (4 Nov), builds on product.md §2: <new part>", and the hand-off quotes the new part before the usual
  "Cited context from the record:".
- after the rooms are joined, once per process: `handoff.resume()`. Every 60 s: `handoff.tick()`
  (the nudge, the "still being built" line, timeouts) and, while a talk link is open, a check for a
  finished call.
- while Claude Code works on a hand-off (each at most once per attempt; "approve I<n> again" resets them):
  - `CK_HANDOFF_NUDGE_MIN` (default 2): no report yet → one desk note for you, "I1: no result from
    Claude Code yet. It may be waiting for your OK: open its thread under the hand-off in
    #ck-smoke-build-<MMDD> and click Allow once." A Claude Code post in the build room containing
    "Permission needed" sends the same note at once instead. A card is never taken as the report.
  - `CK_HANDOFF_PROGRESS_MIN` (default 5): no report yet → one line in the raiser's thread, "Still
    being built: Claude Code is working on it in #ck-smoke-build-<MMDD>. I'll post the result here."
    Never after the report or the timeout line.
  - `CK_HANDOFF_TIMEOUT_MIN` (default 30): the timeout line, as before. `0` turns the nudge or the
    progress line off.
- a brief: the talk agent's prompt is refreshed from the room's record, the text brief posts (with the
  link as its last line), then job A goes on as usual while the clip is made and posted. The brief's
  `ck.trace/1` line carries both posts. A dry-run room (not in `CK_POST_ROOMS`) gets neither the clip
  nor the link, and nothing is paid for.

Safety rule in code: the build room is only created and posted in when its name starts with one of
`CK_POST_ROOMS`. If it doesn't (the default `ledgerly-build`, or an existing real `#ledgerly-build`),
the chain stops at the room step, tells you in the desk, and posts nothing in the original thread.
Fix `CK_BUILD_ROOM` and restart: it picks the idea up again.

`send_targeted_message` was checked against the live server's ops listing (`GET /agents/{id}/ops`,
read on 4 Nov at about 00:45): `body` required, plus `target_names`, `target_roles`, `thread_id`. The
code sends `{ target_names: ["claude-code"], body }`, so nothing needed fixing. It returns `event_id`
and `target_statuses` (`live`, `awaiting_manual_poll`, `no_session`, `disconnected`, or `not_permitted`).

## 1. Before you start

- In the checkout that will run the agent (the build repo, after the wiring lane merges).
- Switch Console 0.40.1 open and staying open (risk row 7: a closed Console leaves Claude Code
  looking "live" while it answers nothing).
- `claude-code` in Console: Auto mode **off**, "Me and my agents", working directory the
  ledgerly-demo repo (as on 3 Nov).
- Three Chrome profiles signed in to Slack: yours, **Rowan** and **Sam**.
- Voice: `ELEVENLABS_API_KEY` in `.env`, and `state/voice-ids.json` with an `agent_id`. If it's
  missing, copy it from the checkout that ran `npx tsx src/voice/cli.ts agent-setup` (running
  `agent-setup` again makes a second ElevenLabs agent; see `docs/voice-resources.md`).
- A fresh `state/handoff.json` makes the first idea `I1`. If there's one from an earlier try, the
  next idea gets the next number: use whatever number the desk note shows.
- Make a fresh smoke room, seeded like the demo room (never reuse or delete one; Switch #1202). Do
  this **before** starting the agent: the agent joins its rooms when it starts.
  ```bash
  npm run seed -- --bridge slack --room-name ck-smoke-e-$(date +%m%d) --owner-desk-room $(node -p 'require("./state/owner.json").owner_desk_room')
  ```
- Start the agent with the smoke guards:
  ```bash
  CK_POST_ROOMS=ck-smoke- CK_POST_OWNER=1 CK_BUILD_ROOM=ck-smoke-build-$(date +%m%d) CK_HANDOFF_TIMEOUT_MIN=10 npm run agent
  ```
  Check the start log: `features: job E on, audio brief on, talk link on`, and
  `listening in ck-smoke-e-<MMDD> (posting on)`. `CK_BUILD_ROOM` starts with `ck-smoke-`, so the agent
  may create it and post there. The real `#ledgerly-pilot` and `#ledgerly-build` stay dry-run (their
  drafts are only logged).
- The seed adds only you. In Slack, invite Rowan and Sam to `#ck-smoke-e-<MMDD>`, then have **Sam**
  post "Morning" once. Joining marks him for a welcome brief on his first message; this way it lands
  there, not in Rowan's idea thread at step 8.

## 2. The run (Slack)

Rowan last posted on 13 Sep in the seeded record, so his first message in the smoke room is a
returner's: it gets the catch-up brief first. That's the voice test (§3). Post the idea as his
second message, so its thread is only about the idea.

| # | Who, where | Do | Expect |
|---|---|---|---|
| 1 | **Rowan**, `#ck-smoke-e-<MMDD>` | Post "Morning all, back today." | In its thread: "Welcome back, Rowan. Here's what changed while you were away:", a few bullets, and a last line "Want to talk it through? … https://elevenlabs.io/app/talk-to?…". Within about a minute, an audio clip `catch-up-rowan.mp3` in the same thread. Leave it for §3. |
| 2 | **Rowan**, same room, a new top-level message, a minute after step 1 | Post a new idea, e.g. "What if the overdue reminder emails had a pay-now link?" | Context Keeper replies in its thread that it's recorded (job A `new`). If job A finds it related (live on 4 Nov it said reminders exist, "that part would be new. I've logged it."), it still goes on your list, labelled. |
| 3 | **You**, owner desk | Read "New idea I1 from Rowan in #ck-smoke-e-<MMDD> (<date>): … Reply "approve I1" to hand it to Claude Code." (for a related one: "… (<date>), builds on product.md §4: …"). Type `approve I1` | Desk: "Handing I1 (Rowan's idea) to Claude Code in #ck-smoke-build-<MMDD>." |
| 4 | Slack sidebar | A new channel `#ck-smoke-build-<MMDD>` appears with you in it (Rowan too, if Switch could add him) | Top-level post: "Approved idea I1, raised by Rowan …", the idea quoted, the cited context. Then "@claude-code Hand-off I1 from Context Keeper, approved by Kash. …". Rowan's idea thread: "Approved by Kash: Claude Code is building this in #ck-smoke-build-<MMDD>. I'll post the result here for Rowan to sign off." |
| 5 | **Restart check** | Before clicking anything: Ctrl-C the agent, start it again with the same command | **No second "@claude-code Hand-off I1"** in the build room. (A `resumed` trace line appears only if a step was mid-send when it stopped.) |
| 6 | **You**, build room, Claude Code's thread | Claude Code shows permission cards. Click **Allow once** each time (about 3; never "Allow for this session") | Desk, as soon as the first card shows (or 2 min after the hand-off, whichever comes first), once: "I1: no result from Claude Code yet. It may be waiting for your OK: open its thread under the hand-off in #ck-smoke-build-<MMDD> and click Allow once." If it takes over 5 min, Rowan's thread gets one "Still being built: Claude Code is working on it in #ck-smoke-build-<MMDD>. I'll post the result here." Then Claude Code posts "Done I1: https://github.com/thekashifnazir/ledgerly-demo/issues/N" (top-level). |
| 7 | Rowan's idea thread | — | "Claude Code has done this: <issue link>. Rowan, you raised it, so it's yours to sign off: reply here with "looks right", or "not quite" and what's missing." |
| 8 | **Sam**, same thread | Reply `looks right`, then `looks right` again | No sign-off (only the raiser or you count). One reply in the thread: "Thanks, Sam. Only Rowan, who raised it, or Kash can sign this off." The second try gets nothing (once per person per idea). Neither goes to job A. Anything else Sam says there (not a sign-off) is ordinary chat for job A, as before. |
| 9 | **Rowan**, same thread | Reply `looks right` | "Signed off by Rowan. Closed." Desk: "I1 signed off by Rowan." |

Optional extras, once the main run passes: a second idea where you click **Decline** on the card
(expect "Claude Code couldn't finish I2: …" in Rowan's thread and "approve I2 again" in the desk);
and one where you click nothing for 10 min (expect "No result from Claude Code on this after 10
min…" in Rowan's thread; a late "Done" still asks for sign-off).

## 3. Voice: the clip and "talk it through"

Uses the brief from step 1 (any time in the 3 hours after it posted).

1. **Play the clip.** In Slack, press play on `catch-up-rowan.mp3` in the brief's thread: about 60 s,
   Rowan by first name, no links or ids read out, ending with an offer to talk it through. The agent
   also keeps a copy: `afplay "$(ls -t build/voice/live/*.mp3 | head -1)"`.
2. **Open the talk link** from the brief's last line, in Rowan's Chrome profile (or yours: the name in
   the link is Rowan either way). ElevenLabs' talk page opens; allow the microphone. If it asks you
   to sign in, use your ElevenLabs account (the agent lives there).
3. **Talk for a minute or two**: "What did I miss?", then one question the record can't answer
   (something from today, say), then one request ("Could Sam send me the pilot numbers on Friday?").
   Say thanks and let it end the call.
4. **Wait a minute or two.** The call summary posts in the same brief thread: "Context Keeper · Rowan
   talked it through (N min call)", with "Asked about", "The record didn't say (to follow up)" and
   "New ideas and requests (needs confirming)". Once per call.

If the clip or link doesn't appear, the text brief still stands (fail quiet). The agent log says why:
`voice off: …` at start, `[voice] talk link left out: …`, or `audio_failed: …` on the brief's log line.

## 4. Check the trace

The trace file is `CK_TRACE_FILE` from `.env` (`state/trace.jsonl`). Job E's lines carry a `handoff`
object (step, idea ref, status) and job `E` items:

```bash
node -e 'for (const l of require("fs").readFileSync("state/trace.jsonl","utf8").split("\n").filter(Boolean)) { const t = JSON.parse(l); if (t.handoff) console.log(t.ts.slice(11,19), t.handoff.step, t.handoff.ref ?? "-", t.handoff.status ?? "", t.handoff.target_status ?? "", t.error ?? "") }'
```

Expected for I1, in order: `noted`, `approved`, `build_room_created`, `context_posted`, `handed_off`
(target status `live`), `announced`, `resumed` (only if a step was mid-send at the restart),
`nudged` (once: a card seen, or 2 min with no report), `progress` (any heard), `still_building` (only if
it took over 5 min), `signoff_requested`, `signoff_not_theirs` (Sam's first `looks right`),
`signoff_ignored` (his second), `signed_off`. Exactly **one**
`handed_off` line. People chatting in the build room show as `build_room_chat`.

The brief and the call summary:

```bash
node -e 'for (const l of require("fs").readFileSync("state/trace.jsonl","utf8").split("\n").filter(Boolean)) { const t = JSON.parse(l); if (t.items.some((i) => i.brief_for)) console.log(t.ts.slice(11,19), t.kind, t.items[0].brief_for, t.posts.map((p) => p.body.split("\n")[0].slice(0, 50)).join(" | "), t.error ?? "") }'
```

Expected: Rowan's brief line (`brief`) with two posts, the text ("Welcome back, Rowan…") and the clip
("[audio catch-up-rowan.mp3] …"), its error field naming the talk link; then, after the call, a
`reply` line for Rowan with the summary post and `talk_call conv_…` in its error field.

## 5. Not yet proven live (watch for these)

1. A room made by `create_room(agent_names: [context-keeper, claude-code])` should start a Claude
   Code session on the hand-off (PR11 showed this for a room it was invited to by `!invite-agent`).
   If nothing happens in 2 minutes, type `!invite-agent @claude-code` in the build room, wait for
   the 10-minute timeout line, then `approve I1 again` in the desk.
2. `handed_off` with a target status other than `live` (`awaiting_manual_poll`, `no_session`): the
   message went, but Claude Code may not have seen it yet. Check Console. `not_permitted`: Switch
   still sent it and Claude Code will say it can't act; the desk tells you. It needs Claude Code's
   addressing changed, then `approve I1 again`.
3. Adding Rowan by handle (`user_names`, from his Slack sender name) may fail for an account Switch
   hasn't seen. The code retries with you alone; the chain doesn't need Rowan in the build room.
4. Claude Code is asked to start its report "Done I1:". If it words it differently, the report is
   matched to the oldest open hand-off in that room, so one idea at a time is safest for a take.
5. The report is recognised as any `@switch-agent-` sender in the build room. Once its sender id
   shows in the log, pin it with `CK_CLAUDE_CODE_SENDER=<id>`.
6. The clip goes up through Switch's media route with the live listener's connection and session
   ids (the smoke test on 3 Nov posted without them, into a room nobody was listening in). If the
   upload fails, the brief's log line says `audio_failed: media upload: …`.
7. The call is matched by the caller name in the link and a start time after the link went out.
   Only the latest call is checked each minute, so test one call at a time.

For the demo take, the same run with `CK_BUILD_ROOM=ledgerly-build` and the real rooms added to
`CK_POST_ROOMS` is your call; nothing in code posts there by default.
