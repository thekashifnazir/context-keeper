# ElevenLabs resources made by the voice lane

Everything the voice code creates in ElevenLabs is named `ck-…`, and its id is recorded in `state/voice-ids.json` (gitignored, so it stays with the checkout that made it). Wipe all of it with:

```sh
npx tsx src/voice/cli.ts wipe
```

`wipe` deletes only the ids in that file, and checks the agent's name starts with `ck-` before deleting it. It never lists or touches anything else in the account.

## Created 3 Nov 2026 (voice lane, overnight)

| Kind | Name | Id |
|---|---|---|
| Conversational agent | `ck-talk-it-through` | `agent_2801m6hq5jgwewqtb7dd1hwgcm4j` |
| Agent test | `ck-talk: catch-up gives a few headlines, spoken, then asks` | `test_3801m6hq7795eaasy3yqyqbh9kzy` |
| Agent test | `ck-talk: personal to the caller` | `test_2301m6hq77f5fzdt0byefekh0mwb` |
| Agent test | `ck-talk: admits a gap instead of guessing` | `test_9701m6hq77krfyssrn41tvrvv7hd` |
| Agent test | `ck-talk: a delegation is noted, never claimed as done` | `test_2901m6hq77rtengs1efxn7ddqkhj` |
| Agent test | `ck-talk: own view is labelled, the decision is credited` | `test_8801m6hq77x4erxrg5zzctrqynxt` |
| Agent test | `ck-talk: untested things aren't called working` | `test_3901m6hq789de2wa0ntrx3we025h` |
| Agent test | `ck-talk: warns about a minute left near the cap` | `test_4501m6hq78ejfnmrt12esh6wefxd` |
| Agent test | `ck-talk: no time warning early in the call (control)` | `test_5101m6hq7zegeac974mrdbx1ft4x` |

Not resources, but made by the same code: test invocations (`suite_…`, one per `agent-test` run) and call transcripts (one per call to the agent). Deleting the agent removes neither; they hold invented demo data only.

## Made by the live tool (on the first run with a tunnel up)

The first time the live agent finds a cloudflared tunnel answering (docs/handoff-live-test.md §3, step 0), it makes two more resources and records their ids in `state/voice-ids.json`; later runs, with a new tunnel URL, update the tool in place:

| Kind | Name | Recorded as |
|---|---|---|
| Workspace secret | `ck-talk-tool-secret-<6 hex>` (the header value the tool sends; the value itself is in `CK_TALK_TOOL_SECRET` or `state/talk-tool-secret`, never in the repo) | `tool_secret_id` (+ `tool_secret_fp`, a short hash to spot a changed value) |
| Webhook tool | `whats_new` | `whats_new_tool_id` |

`wipe` deletes both. A provisioning check on 4 Nov made one of each against a placeholder URL and deleted them straight away.

## Settings the live agent keeps on itself

Every prompt refresh (before a talk link is posted, and while one is open) also PATCHes the agent's delivery settings from `VOICE` in `src/voice/talk-agent.ts`: `stability` 0.8 (0.6 until 4 Nov, when a call "went from normal to really loud in places"), `similarity_boost` 0.75, `expressive_mode` on, and four gentle `suggested_audio_tags` (warm, calm, soft laugh, thoughtful). The voice and the model are never in that PATCH, so a voice picked in the dashboard stays. A check on 4 Nov PATCHed these onto the agent, read them back, and put the old values back.

## Not in ElevenLabs: the short talk links

The brief's `https://ck.<domain>/talk/<id>` links live in `state/voice-calls.json` (`links`: a random 12-character id, the full ElevenLabs talk URL, the time), next to the call watches. The tool server answers `GET /talk/<id>` with a 302 to that URL for 3 hours, then 404, and old entries are pruned on the next tick. The same file keeps `ended` (calls that got the "just finished a call" line) and `done` (calls that got a summary).

The text-to-speech samples are local files in `build/voice/` (gitignored), not account resources.

When this lane merges, copy `state/voice-ids.json` into the checkout that will run the agent, or `agent-setup` there makes a second agent. Copy `state/talk-tool-secret` with it once it exists (or set `CK_TALK_TOOL_SECRET` in `.env`), or the next run makes a second workspace secret.
