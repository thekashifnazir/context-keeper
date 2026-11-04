# Go live: swap the listen check for the real agent

The Slack room `#ledgerly-pilot` is held today by `src/listen-check.ts`, which answers every untagged
message with "Heard you, <name>". This page swaps it for the real agent (`src/agent/main.ts`, jobs A
to D, with job C's audio clip), and says how to roll back. Run everything from the main checkout,
after `lane/live` is merged. Allow about 10 minutes.

## What was tested first

On 4 Nov the same code ran on the local Switch 0.31.0 server in a fresh Mattermost room
(`ck-live-1005-ledgerly`, seeded with the Ledgerly demo), under its own test identity
(`context-keeper-live-test`), so the listen check was never disturbed. Personas posted:

| # | What was posted | What the agent did | Result |
|---|---|---|---|
| 1 | Two lines of chit-chat (Sam, Priya) | Nothing posted (two `silence` decisions) | pass |
| 2 | Rowan: five agencies instead of three | Thread reply citing D2, quote verified ("Three agencies, max 25 clients each", Kash, 6 Oct), with what would reopen it | pass |
| 3 | Priya: a weekly PDF of clients behind on reconciliation | Short reply: related feature quoted (overdue reminders), "that part would be new. I've logged it." Verdict `might-be-related`, not `new` | pass, see note 2 |
| 4 | Dana added to the room, then says hello | `room_join` seen; a four-line joiner brief with sources, then a 53 s audio clip (mp3 attached) in the same thread | pass |
| 5 | Agent killed (`kill -9`) 4 s after Sam posted, Rowan posted while it was down, agent restarted | "re-queued 1 message(s)"; Sam's (D3) and Rowan's (D1) messages answered once each; no earlier message answered twice | pass after a fix, see note 1 |

Model cost for the whole test: 18 calls, about $0.57 (Opus 5.5 with the Haiku reviewer, priced at the
eval's table; an upper bound). As a guide: a silent decision $0.01 to $0.02, an answered one $0.03 to
$0.10 (the dearer end when the prompt cache is cold), a catch-up brief $0.09 to $0.14.

Notes:

1. The first restart test lost Sam's message: it was waiting out the 20 s quiet gap when the agent
   was killed, and the stream position had already moved past it. The agent now saves that queue
   (`state/agent-buffer.json`) and re-queues it on start; the retest passed.
2. "I've logged it" on a `might-be-related` idea doesn't add it to the idea list (only `new` does).
3. Rowan's first message got a **"Welcome back" brief** before the answer: his last message in the
   room record (the October demo history) was more than 7 days old. On go-live this will happen to
   anyone whose last message in the record is older than `CK_RETURN_GAP_DAYS` (default 7). Messages
   from the listen-check days are not in the record. Set `CK_RETURN_GAP_DAYS=60` if you don't want
   that on day one.

## Before you start

- The listen check and the agent both run as `context-keeper` and both call `connect_to_room`, which
  takes the room from any other session. **Never run both at once.**
- Know the two room names as Switch has them: `Ledgerly: ledgerly-pilot` (the Slack room) and
  `ck-owner-desk` (the owner desk; `state/owner.json` already holds its id and your Slack sender id).
- The agent only posts in rooms whose names start with a `CK_POST_ROOMS` prefix and only connects to
  rooms matching `CK_LISTEN_ROOMS`. Everywhere else it hears nothing and sends nothing. The Discord
  room (`Riverside Events: event-planning`) and the Mattermost rooms will have no agent after the swap;
  add their names to both lists if you want them covered.

## Swap

1. Stop the listen check (SIGTERM saves its stream position):

   ```bash
   pkill -TERM -f 'src/listen-check.ts'
   pgrep -fl 'src/listen-check.ts' || echo stopped
   ```

2. Hand its place in the stream to the agent, so anything said during the swap is still answered.
   First, `ls state/agent-position.json` must say "No such file". If the file exists (an old agent
   run), move it aside (`mv state/agent-position.json state/agent-position.old.json`): a stale
   position would replay everything said since. Then:

   ```bash
   cp state/position.json state/agent-position.json
   cp state/rooms.json state/agent-rooms.json
   node -e 'const fs=require("fs");fs.writeFileSync("state/agent-connection.json",JSON.stringify({id:fs.readFileSync("state/connection-id","utf8").trim()}))'
   mv state/trace.jsonl state/listen-trace.jsonl   # the listen check's own log format; the agent's trace starts clean
   ```

3. Start the agent:

   ```bash
   CK_LISTEN_ROOMS='Ledgerly: ledgerly-pilot,ck-owner-desk' \
   CK_POST_ROOMS='Ledgerly: ledgerly-pilot,ck-owner-desk' \
   CK_POST_OWNER=1 CK_JOB_E=0 CK_AUDIO_BRIEF=1 CK_TALK_LINK=0 \
   nohup npm run agent >> state/agent.log 2>&1 &
   ```

   - `ck-owner-desk` must be in `CK_POST_ROOMS` too: with `CK_LISTEN_ROOMS` set, owner-desk notes
     go only to a desk the post list allows.
   - Job E (`CK_JOB_E=1`) and the talk link (`CK_TALK_LINK=1`) were not part of this test. Turn them
     on separately once `docs/handoff-live-test.md` has passed; job E also needs its build room's
     name (`CK_BUILD_ROOM`) in `CK_POST_ROOMS`.

## Check (2 minutes)

1. `tail -f state/agent.log` shows, within about 5 s:

   ```
   features: job E off, audio brief on, talk link off
   connected
   listening in Ledgerly: ledgerly-pilot (posting on)
   listening in ck-owner-desk (posting on)
   ```

   No `join events in …` warning. A `join events on in …` line just means it turned them on. Any
   `no record for room …; skipping` lines at the start are harmless: the stream replays the gap for
   every room the listen check held, and the agent ignores the ones it isn't listening in.
2. In Slack, as a persona (not your owner account): a line of chit-chat gets nothing; after about
   20 s the log shows `decision …: silence`.
3. As a persona, re-propose a settled decision ("Could we do onboarding on Saturdays?"). Within about
   a minute: a thread reply that quotes D1 with who and when. Possibly a "Welcome back" brief first
   (note 3 above).
4. Nothing in the thread says "Heard you". If it does, the listen check is still running: stop both,
   then start only the agent.
5. `grep -c ck.trace/1 state/trace.jsonl` goes up by one per decision.

## Roll back

Stopping the agent is always safe: the room just goes quiet.

```bash
pkill -TERM -f 'src/agent/main.ts'
```

To bring the listen check back, give it the agent's position first, or it resumes from where it
stopped before the swap and answers "Heard you" to every message said since:

```bash
cp state/agent-position.json state/position.json
nohup npx tsx src/listen-check.ts >> state/listen.log 2>&1 &
```

To go live again later, repeat the swap from step 1. Step 2 will find the old
`state/agent-position.json`: move it aside as it says, so the agent starts from the listen check's
position.
