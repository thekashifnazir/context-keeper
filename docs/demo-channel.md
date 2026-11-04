# Public demo channel: let judges try Context Keeper on Discord

The video shows the team using Context Keeper in Slack. This page sets up a public Discord channel,
`#try-context-keeper`, where anyone with the invite link can try the **same agent on the same Switch
server**, through Switch's Discord bridge. The channel is seeded with the Ledgerly demo record, so
answers cite the same documents and decisions the video shows.

Allow about 20 minutes. Discord steps are in the Discord app; Switch and agent steps run on the VM
(`~/ck`, see [deploy-cloud.md](deploy-cloud.md)), after this branch is merged and pulled there.

## What a judge can and can't do there

| In a demo room (`CK_DEMO_ROOMS`) | |
|---|---|
| Job A (cited answers), B (decisions, sent to your owner desk to confirm), C (catch-up brief on someone's first message), D (clash checks) | on, unchanged; chit-chat still gets no reply |
| Job E (idea → Claude Code build) | **off** in that room, whatever `CK_JOB_E` says |
| Voice (audio clip, "talk it through" link) | **off** unless `CK_DEMO_VOICE=1`; then it follows `CK_AUDIO_BRIEF` / `CK_TALK_LINK`, capped (below) |
| Voice caps (with `CK_DEMO_VOICE=1`) | at most 15 audio clips + talk links a UTC day across all demo rooms (`CK_DEMO_VOICE_PER_DAY`; a brief with both counts 2), and one voice brief per person a day |
| Over a voice cap | the text brief still posts, ending "Voice catch-ups have hit today's demo limit — back tomorrow." instead of the link |
| Replies per person | at most 6 an hour (`CK_DEMO_PER_PERSON_HOUR`) |
| Decisions per person, silent ones included | at most 20 an hour (`CK_DEMO_TRIES_PER_PERSON_HOUR`); each one is a model call |
| Replies in the room | at most 40 an hour, catch-up briefs included (`CK_DEMO_PER_ROOM_HOUR`) |
| Over a limit | one line, "You've hit the demo limit for now — try again in a bit.", once per person per hour, then silence |
| Daily spend cap reached (`CK_DAILY_SPEND_CAP_USD`) | one line per room, "The demo has paused for today — back tomorrow.", then silence until 00:00 UTC |

The owner (your Switch sender id from `state/owner.json`) and anyone in `CK_DEMO_EXEMPT` are never
limited (for voice: no one-a-day limit, but their clips and links still count towards the day's total). The spend cap counts **every** model call, Slack rooms included: at the cap Slack goes
quiet as well, and the owner desk gets one note (plus one at 80%). Counts and spend are saved in
`state/demo-limits.json` and `state/spend.json`, so a restart doesn't reset them.

What it costs, from the go-live test (Opus 5.5 with the reviewer, priced at the eval's table): a silent
decision $0.01 to $0.02, an answer $0.03 to $0.10, a catch-up brief $0.09 to $0.14. A judge who asks
three questions costs about $0.30 to $0.50, so a $6 cap covers roughly 12 to 20 judges a day, minus
whatever Slack uses.

## 1. Discord: the channel, a judge view, the invite

Use the Discord server the Switch Discord bridge is already connected to (its **Guild Id** is the one
in the bridge's settings). A different server would need a second bridge.

1. **Make the channel.** Two ways; pick one.
   - **A. Let the seed make it** (step 2 below creates `#try-context-keeper` through Switch). Needs
     channel creation on for the Discord connection: Switch Console → your server's **Home** → the
     Discord connection's menu → **Create channels on**. Then come back here for permissions.
   - **B. Make it yourself** in Discord (Create Channel → Text → `try-context-keeper`), then post any
     message in it: on Discord, the first message is what turns a channel into a Switch room. Then
     type `!invite-agent @context-keeper` there so the agent joins the room.
2. **Make a judge view.** An invite link can't hand out a role, so the simplest lock is to make
   `@everyone` the judge view:
   - Server Settings → Roles → create a role called **team**, with **View Channels** on, and give it
     to yourself and your persona accounts.
   - Server Settings → Roles → **@everyone** → turn **View Channels** off. Now a new member sees
     nothing yet.
   - Create a role called **judge** (no extra permissions). You can give it to judges you know by
     hand, or, if the server has Community on, have **Onboarding** grant it from a one-answer
     question ("I'm here to try Context Keeper").
   - `#try-context-keeper` → Edit Channel → Permissions → add **@everyone** (and **judge**) with
     **View Channel**, **Send Messages**, **Send Messages in Threads** and **Read Message History**
     allowed; **Create Public Threads**, **Mention @everyone**, **Attach Files** and **Manage
     Messages** denied. The agent replies in threads, so judges need to be able to post in them.
   - Check the Switch bot's own role (the one created when you invited it, e.g. "Agent Switch")
     still has View Channels and Manage Webhooks on that channel: agents post through a webhook.
   - Optional: Edit Channel → **Slowmode** 30 seconds, so nobody can flood the room.
3. **Tidy the server for strangers.** Server Settings → Safety Setup: verification level **Low**
   (verified email) or higher; explicit image filter on for everyone.
4. **Make the invite.** Right-click `#try-context-keeper` → **Invite People** → **Edit invite link**:
   - Expire After: **Never**
   - Max Number of Uses: **No limit**, or a cap such as **100** if you'd rather it ran out
   - Grant temporary membership: **off**

   The link lands people in `#try-context-keeper`. Copy it for the submission form and the README.

## 2. Switch: seed the room with the Ledgerly record

On the VM, in `~/ck`. The seed adds the room rules, join events, the six Ledgerly documents and the
"Channel archive"; it posts no chat message and is safe to re-run.

Look up your existing owner desk's room id first (`state/owner.json`, `owner_desk_room`), and pass it
so the seed doesn't make a second desk channel on Discord: the agent only reads one owner desk.

Route A (the seed creates the channel):

```bash
cd ~/ck
npm run seed -- --bridge discord --demo ledgerly --room-name try-context-keeper \
  --owner-desk-room <owner desk room id>
```

Route B (you made the channel and posted in it): find the room's id in Switch Console → **Your Rooms**,
then:

```bash
npm run seed -- --bridge discord --demo ledgerly --room <room id> --owner-desk-room <owner desk room id>
```

The seed prints `room: <name> (<id>)`. **Note the exact name**: Switch may show it as
`<Discord server name>: try-context-keeper`. `CK_DEMO_ROOMS=try-context-keeper` matches either form.
`npm run ck -- doctor` should list the room with join events on.

Switch Trust: if you turned Trust on (alert-only jailbreak policy, see the build log), open Switch
Console and check that monitoring is active for the new room too. Leave its action on **Alert**: the
flag shows in the channel and the message still reaches the agent, which treats chat as data anyway.

## 3. The agent: four lines in the systemd unit

`sudo systemctl edit --full ck-agent`, and add under `[Service]` next to the other `Environment=` lines:

```ini
Environment=CK_DEMO_ROOMS=try-context-keeper
# the audio clip upload still checks CK_POST_ROOMS: add the demo room there too (full Switch name), e.g.
# Environment="CK_POST_ROOMS=…,<Discord server name>: try-context-keeper"  (quoted: the name has a space)
Environment=CK_DAILY_SPEND_CAP_USD=6
# your own Discord handle (or sender id), so the limits never apply to you there
Environment=CK_DEMO_EXEMPT=<your Discord handle>
# optional, defaults shown
Environment=CK_DEMO_PER_PERSON_HOUR=6
# voice in the demo room (audio brief + talk link), capped per UTC day; leave out for text only
Environment=CK_DEMO_VOICE=1
Environment=CK_DEMO_VOICE_PER_DAY=15
```

Voice counts sit in `state/demo-limits.json` next to the hourly limits (`voice: { day, total,
people }`), so a restart doesn't reset them. A slot is taken when the brief is prepared, before any
ElevenLabs call, so a failed clip or a brief re-run after a restart still counts (it never
under-counts). The talk link carries the demo room's id (`var_room_id`), so the `whats_new` live tool
answers about the demo room, and the short `/talk/<id>` link works there as in Slack.

**One talk agent for every room.** There is a single ElevenLabs talk agent, and each brief's talk
link refreshes its prompt from that brief's room (then the minute tick keeps it on the newest open
link's room). So a demo-room brief **does** overwrite the prompt a Slack person's link would get: a
Slack caller who starts their call after a judge's brief hears the demo room's snapshot. A call
already in progress keeps the prompt it started with, and `whats_new` still reads the caller's own
room from their link. Both rooms carry the same Ledgerly record, so what the agent says is
equivalent; the difference is only room-specific chat (the room's label in the greeting, messages
posted in one room and not the other) until `whats_new` is called. Accepted for the demo rather
than one agent per room.

The demo room doesn't need adding to `CK_POST_ROOMS` or `CK_LISTEN_ROOMS`: `CK_DEMO_ROOMS` opts it
in. Keep `CK_POST_OWNER=1`, or the 80% and cap notes only reach the log. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ck-agent
tail -n 30 ~/ck/state/agent.log
```

Within a few seconds the log should show:

```
demo rooms: try-context-keeper (jobs A–D only; 6 replies and 20 decisions per person per hour, 40 replies per room per hour)
spend today: $0.00 of a $6.00 daily cap
listening in <Discord server name>: try-context-keeper (posting on)
```

The agent joins rooms when it connects, so restart it after seeding a new room.

## 4. Pin an intro message

Post this in `#try-context-keeper` from your own account and pin it (hover → ⋯ → Pin Message):

> 👋 **Try Context Keeper**
> This channel is a copy of the Ledgerly team's pilot room: their plan, product notes, roadmap and
> six weeks of chat are already in it. Context Keeper reads every message (no need to @ it) and
> replies only when the room has already settled what you're raising, quoting where.
>
> Try one of these, as if you were on the team:
> 1. *"Why don't we run the pilot with five agencies instead of three?"*
> 2. *"Could we add automatic payment reminders for overdue invoices?"*
> 3. *"Can we add a QuickBooks integration for the pilot?"*
>
> Your first message also gets a short catch-up on where things stand. Small talk gets no reply,
> on purpose. It's a demo: a few questions an hour each, and it pauses if the day's budget runs out.

What each one shows: (1) a settled decision (D2 in the pilot plan) quoted with who decided, when, and
what would reopen it; (2) a feature that already exists (product.md §2), quoted; (3) an idea that's
parked, not rejected (roadmap.md §1), with the reason.

## 5. Try it before you share the link

From a Discord account that isn't yours (a persona, or a friend), not your owner account (that one
is exempt from the limits):

1. "hi all" → no reply; the log shows `decision …: silence`.
2. Question 1 from the pinned message → a welcome brief, then a thread reply quoting D2.
3. To see the limit without seven questions, restart once with `CK_DEMO_PER_PERSON_HOUR=1`: after
   one answer, your next message gets "You've hit the demo limit for now — try again in a bit." and
   the one after that gets nothing. Put it back to 6, `rm ~/ck/state/demo-limits.json`, restart.
4. `cat ~/ck/state/spend.json` shows today's total going up.

## 6. Watch spend, and pause it

```bash
cat ~/ck/state/spend.json                               # {"day":…, "usd":…, "calls":…}
grep -E 'spend|demo_limit|spend_cap' ~/ck/state/agent.log | tail -n 20
```

The figure is an estimate from the price table in `src/agent/model.ts`, on the high side; the real
bill is on the Anthropic Console's usage page. ElevenLabs isn't counted (it's off in demo rooms).

| To | Do |
|---|---|
| Stop judges posting, right now, nothing else changes | Discord: `#try-context-keeper` → Permissions → @everyone → **Send Messages** off |
| Pause all model calls now, until 00:00 UTC | set `CK_DAILY_SPEND_CAP_USD=0.01`, `daemon-reload`, restart: it's over the cap at once, the demo room says it has paused |
| Resume after the cap, same day | raise `CK_DAILY_SPEND_CAP_USD`, `daemon-reload`, restart |
| Reset everyone's hourly limits | `rm ~/ck/state/demo-limits.json`, restart |
| Stop the agent entirely | `sudo systemctl stop ck-agent` (Slack goes quiet too) |

## 7. After judging

Remove the `CK_DEMO_*` lines (keep the cap if you like it), `daemon-reload`, restart. In Discord,
revoke the invite (Server Settings → Invites) and archive or delete the channel.

## Not yet checked live

- How Switch names a Discord room it creates (with or without the Discord server's name in front).
  The matcher accepts both.
- Whether Switch sets its own permission overrides on a channel it creates; check the channel's
  Permissions tab after the seed.
- Discord doesn't announce a member joining a channel, so a judge's catch-up brief comes from having
  no earlier message in the room's record (job C's "first message" rule), not from a `room_join` event.
