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

The text-to-speech samples are local files in `build/voice/` (gitignored), not account resources.

When this lane merges, copy `state/voice-ids.json` into the checkout that will run the agent, or `agent-setup` there makes a second agent.
