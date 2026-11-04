# Run it: from a clean clone to a working Context Keeper

This is the path from a fresh `git clone` to Context Keeper answering in a chat room on your own
machine, with no Slack workspace. It uses Switch's self-hosted server and the Mattermost that ships
in Switch's own Compose file. Every command below was run on 4 Nov 2026 from a clean checkout (no
`.env`, no `node_modules`, no `server/`), twice:

- **Mac:** Apple Silicon with Colima, Docker images already pulled.
- **Linux, as a judge would:** a brand-new GCP `e2-standard-2` (2 vCPU, 8 GB, Ubuntu 24.04) with
  nothing on it but what "What you need" lists, an anonymous `git clone`, and only this page.
  From an empty machine to a cited answer in the chat room: **about 4.5 minutes** (1 min 36 s
  installing Docker and Node, then 2 min 52 s of command time for steps 0 to 8, including every image download).

Where the two differ, the table gives both.

## What you need

- Node 22 or later (tested on 22.23 and 26.12), npm, git
- Docker with Compose v2 (Docker Desktop, or Colima on a Mac), running
- python3 (stdlib only; 3.9 works), curl, openssl
- An Anthropic API key
- About 3 GB free for the images (2.3 GB on the Linux run)

**On a fresh Ubuntu machine** (24.04 already has git, python3, curl and openssl). Ubuntu's own
`nodejs` package is Node 18, too old, so take Node 22 from NodeSource. Docker's install script
doesn't let your user reach Docker, so add yourself to the `docker` group and log in again
(otherwise step 4 stops with `server-up: Docker is running, but this user can't reach it`):

```bash
curl -fsSL https://get.docker.com | sudo sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo usermod -aG docker "$USER"   # then log out and back in (or open a new SSH session)
```

That took 1 min 36 s on the GCP machine.

## The path

Run every command from the repo's root folder.

| # | Step | Command | Mac (images cached) | Linux (from nothing) |
|---|---|---|---|---|
| 0 | Get the code | `git clone https://github.com/thekashifnazir/context-keeper.git && cd context-keeper` | – | 3 s |
| 1 | Settings | `cp .env.example .env`, then fill in the existing `ANTHROPIC_API_KEY=` line in `.env` (see below; don't `export` it) | under 1 min | under 1 min |
| 2 | Install | `npm ci` | 10 s | 9 s |
| 3 | Tests (offline) | `npm test` | 2 s (134 tests then) | 20 s (313 tests) |
| 4 | Switch server and Mattermost, register the agent | `scripts/server-up.sh --with-mattermost` | 31 s (8 s server and registration, 23 s Mattermost and bridge) | 107 s, including the 2.3 GB first image download; 47 s on a re-run |
| 5 | Check | `npm run ck -- doctor` | 1 s | 1 s |
| 6 | Seed a room | `npm run seed -- --bridge mattermost --demo ledgerly --room-name ck-smoke-trial --owner-username user` | under 2 s | 3 s |
| 7 | Start the agent | `npm run agent` in a second terminal, and leave it running | connects in about 5 s | connects in 3 s |
| 8 | Ask it something | see below | first reply 20 s, threaded answer within about a minute | welcome brief 19 s, cited answer 21 s |

**Step 1: fill in the line, don't add one.** `.env.example` already has an empty
`ANTHROPIC_API_KEY=` line. Put your key after the `=` on that line. If you add a second
`ANTHROPIC_API_KEY=…` line below it instead, the first (empty) one wins, and doctor says
`FAIL  anthropic key missing from .env` although your key is in the file.

Optional: `npm run eval -- --fast --only T05` replays one test case into a fresh room, with its own
eval agent identity (registered on its first run), and scores it (148 s on the Mac, 161 s on the
Linux machine; 1/1 on both). It leaves `facts.md` changed and two new files in `testset/results/`.
Leave out `--only` to run the whole main set (24 cases).

### Step 4 in detail

`scripts/server-up.sh` fetches Switch's published Compose file (0.31.0) and checks it against its
digest. It writes `server/.env` with fresh random secrets and starts Postgres, Switch and the
Gateway. Then it signs in to the Gateway as the admin, mints a registration key and registers the
`context-keeper` agent. The agent's id and key go to `.env.local` (mode 600), and nothing secret is
printed. It also points `SWITCH_API_URL` and `SWITCH_GATEWAY_URL` in `.env` at the server.

`--with-mattermost` adds the Compose file's Mattermost and creates its admin, a team called
`switch` and one human account called `user`. It then connects Mattermost to Switch as a bridge.

Running it again is safe: it never overwrites `server/.env` or `.env.local`. After you've removed
the stack's data, clear `.env.local` first (see "Stop and clean up").

**If something else on the machine already uses the default ports** (18000, 13000, 15432, 18065),
or you already run a Switch stack, give this one its own Compose project and ports. Set these the
first time you run it:

```bash
CK_COMPOSE_PROJECT=ckjudge CK_API_PORT=28000 CK_GATEWAY_PORT=23000 \
CK_POSTGRES_PORT=25432 CK_MM_PORT=28065 scripts/server-up.sh --with-mattermost
```

After that, `server/.env` remembers them. The script won't write fresh secrets for a Compose
project that already has containers. It stops and asks for `CK_COMPOSE_PROJECT` instead.

### Step 5: what doctor should say

With Mattermost connected and before any room is seeded, on the default ports (this is the Linux
run, word for word):

```
ok    anthropic env ANTHROPIC_API_KEY not exported
ok    anthropic key present in .env
ok    switch key    SWITCH_API_URL, SWITCH_AGENT_ID and SWITCH_AGENT_API_KEY present
WARN  git email     git user.email is unset (only matters if you commit here)
SKIP  model params  max_tokens and thinking: checked once the agent loop exists (core lane)
SKIP  budget        no spend check wired yet
ok    health        http://127.0.0.1:18000/health
ok    ports         api 18000 up, gateway 13000 up
ok    stream        opened a fresh connection (closed again at the end)
ok    bridge        mattermost "Mattermost (eval)" (default)
SKIP  rooms         2 room(s) on the server; none seeded yet (npm run seed)
SKIP  join events   no seeded room
SKIP  owner desk    none yet (npm run seed makes one)
doctor: OK (0.4 s)
```

The WARN and SKIP lines are fine. The two rooms are Mattermost's own Town Square and Off-Topic.
The agent listens there but never posts (see step 8).

Without `--with-mattermost`, `bridge` FAILs ("no active messaging-app bridge"). That's expected:
the agent has nowhere to listen yet.

If `stream` FAILs with `Switch rejected the agent credentials (HTTP 401)`, `.env.local` holds an
agent from a server you've since removed. See "Stop and clean up" below.

### Step 7: what the agent should say

Within a few seconds, among other lines:

```
connected
listening in ck-smoke-trial-desk (posting on)
listening in ck-smoke-trial (posting on)
```

Town Square and Off-Topic show `(dry-run)`: it listens there but doesn't post.

### Step 8: talk to it

Open Mattermost at `http://127.0.0.1:18065` (or your `CK_MM_PORT`). Sign in as `user`. The
password is `MATTERMOST_USER_PASSWORD` in `server/.env`. Print it with:

```bash
grep '^MATTERMOST_USER_PASSWORD=' server/.env | cut -d= -f2-
```

(On a Mac, add `| tr -d '\n' | pbcopy` to copy it instead.)

**On a remote machine** (a cloud VM over SSH), `127.0.0.1` is the remote machine, not yours.
Forward the port from your own computer, then open `http://127.0.0.1:18065` in your browser as
usual:

```bash
ssh -N -L 18065:127.0.0.1:18065 you@your-vm
# on GCP: gcloud compute ssh your-vm --zone your-zone -- -N -L 18065:127.0.0.1:18065
```

Open the `ck-smoke-trial` channel and post a question the demo history already answers:

> Why don't we run onboarding on Saturdays? Agency owners have more time at weekends.

**No browser?** Post the same question through Mattermost's API and read the thread back. Run this
from the repo root on the machine with the stack, changing `18065` if you set `CK_MM_PORT`
(it's how the Linux run was checked):

```bash
MM=http://127.0.0.1:18065/api/v4
PW=$(grep '^MATTERMOST_USER_PASSWORD=' server/.env | cut -d= -f2-)
TOKEN=$(curl -si -H 'Content-Type: application/json' -X POST "$MM/users/login" \
  -d "{\"login_id\":\"user\",\"password\":\"$PW\"}" | tr -d '\r' | awk -F': ' 'tolower($1)=="token"{print $2}')
CH=$(curl -s -H "Authorization: Bearer $TOKEN" "$MM/teams/name/switch/channels/name/ck-smoke-trial" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
POST=$(curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X POST "$MM/posts" \
  -d "{\"channel_id\":\"$CH\",\"message\":\"Why don't we run onboarding on Saturdays? Agency owners have more time at weekends.\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
sleep 45
curl -s -H "Authorization: Bearer $TOKEN" "$MM/posts/$POST/thread" | python3 -c '
import json, sys
for p in sorted(json.load(sys.stdin)["posts"].values(), key=lambda p: p["create_at"]):
    print(p["message"], "\n---")'
```

What happened on the Linux run (both posts land in the question's thread):

1. After 19 s, a welcome brief for `user`, because they're new to the room: "👋 **Welcome,
   user** · a quick catch-up on where things stand". On the first run it already mentioned the
   weekday-only decision, with who made it and when; a second run picked other lines.
2. Two seconds later, the job A answer:

   > 📌 **In the record** · Onboarding calls run Tue to Thu, weekdays only. Kash confirmed this as
   > D1 on 6 Oct because partner finance staff work weekdays only and support isn't staffed at
   > weekends. …\
   > **Reopen if:** a partner can't make any Tue–Thu slot.\
   > _"Onboarding calls on weekdays, Tue to Thu: Partner finance staff work weekdays only; support
   > is staffed on weekdays"_ — Ledgerly pilot plan › Decisions (Kash, 6 Oct)

   The quote is checked against the seeded pilot plan before it's posted. The wording
   changes from run to run; the decision, the source and the "Reopen if" don't.

On the Mac run the answer took about a minute. The agent now starts its decision while it waits for
the asker to finish typing, so it's faster.

The agent only posts in rooms whose names start with `ck-smoke-` or `ck-eval-` (`CK_POST_ROOMS`).
In any other room it decides, traces to `state/trace.jsonl` and logs what it would have said, but
sends nothing. So name your room `ck-smoke-…`, or set `CK_POST_ROOMS`.

### Stop and clean up

`Ctrl-C` the agent. Then remove the stack and its data. `server/.env` names the project, so this
works with or without `CK_COMPOSE_PROJECT`. Name both profiles: with only `--profile collab`, the
Gateway container is left running.

```bash
(cd server && docker compose -f standalone-docker-compose.yml --profile gateway --profile collab down -v)
rm -f .env.local && rm -rf state
```

The second line matters if you'll run step 4 again. `down -v` deletes the server's database, and
with it the agents that `.env.local` names. `server-up.sh` sees `.env.local` and says
`agent already registered (.env.local)`, then doctor fails with
`stream refused: Switch rejected the agent credentials (HTTP 401)`. `state/` holds the old rooms'
seed records and the agent's position in the old stream. With both gone, step 4 registers a fresh
agent (47 s with the images cached) and steps 5 to 8 work as before. This was checked on the Linux
machine.

## Slack, Discord and Switch Console

The Slack and Discord routes need a Switch Slack app or Discord bot connected to the server as a
bridge, plus a workspace to install it in. The demo video uses that route. Mattermost needs neither.

Switch Console 0.40.1 can connect to this server with "Connect to an existing server", using the
`SWITCH_API_URL` from `.env`. Sign in as `admin@switch.local`. The password is
`GATEWAY_ADMIN_PASSWORD` in `server/.env`. You don't need Console to run the agent or the eval.

## Fixed on the way (the Mac run)

- `scripts/server-up.sh` had its Compose project and ports hard-coded. On a machine that already
  ran a stack, a second checkout would have written new secrets for that same project. It now
  takes `CK_COMPOSE_PROJECT` and `CK_*_PORT`, refuses to write fresh secrets for a project that
  already has containers, and updates `.env` to point at the server it started.
- When Mattermost stalled, the eval restarted the container `ckswitch-mattermost-1` whatever stack
  it was running against. It now restarts `<project>-mattermost-1`, using the project from
  `server/.env`.
- The agent picked a room's demo content from the room's name only ("ledgerly" or "riverside").
  So a room seeded under any other name was skipped, with nothing but a log line. It now falls back
  to the `--demo` that `npm run seed` recorded for that room.
- `ck doctor` failed after any eval run. It tried to inspect the eval's rooms, which belong to the
  separate `context-keeper-eval` agent, and got 403s. It now skips them. The git-email check is now
  a WARN: it only matters for commits, not for running the agent.

## Fixed on the way (the Linux judge run)

- On a fresh Linux machine, `scripts/server-up.sh` said `Docker isn't running` when Docker was
  running and only the user couldn't reach it (`permission denied while trying to connect to the
  docker API at unix:///var/run/docker.sock`). It now says so, with the `usermod` fix.
- This page was Mac-only in places: no clone command, `pbcopy`, no word on Node 18 in Ubuntu, the
  `docker` group, a remote machine's `127.0.0.1`, or a way to ask without a browser. Doctor's
  sample used non-default ports and had half its lines. The test count and times were out of
  date, and the answer's source is now shown as "Ledgerly pilot plan › Decisions", not
  `pilot-plan.md §2 D1`.
- "Stop and clean up" left `.env.local` behind, so running step 4 again gave an agent the new
  server didn't know (doctor: `Switch rejected the agent credentials (HTTP 401)`). It now removes
  `.env.local` and `state/` too.

## Still open for the README's "Run it" section

1. **README.md has no "Run it" section yet**, and nothing in it links to this page. The table above
   is ready to lift.
2. **The first image download on a Mac wasn't measured.** On the Linux machine the whole of step 4,
   downloads included, took 107 s. Mattermost's image is amd64 only, so on Apple Silicon it runs
   under emulation. Under eval load it sometimes stops (the eval restarts it and records an
   incident). On Linux, `server-up.sh` still prints "emulated on Apple Silicon" for it. That line
   is only about Macs.
3. **The first `server-up.sh` without `--with-mattermost` prints five Compose warnings** about
   unset `MATTERMOST_*` variables. They're harmless but look like errors.
4. **npm 11 warns that esbuild's install script didn't run** ("not yet covered by allowScripts").
   Tests, tsx and the agent all work regardless. npm 10 (Node 22's) doesn't warn.
5. **The owner name defaults to "Kash"** (`CK_OWNER_NAME`), and the eval always names its owner
   persona `kash`. Owner-desk posts are dry-run unless `CK_POST_OWNER=1`.
6. **`npm run eval` writes to tracked files.** It adds `testset/results/<date>-<model>.json/.md`
   and appends rows to `facts.md`, so a trial run leaves the working tree dirty.
7. **Doctor prints two SKIP lines in internal jargon** ("checked once the agent loop exists (core
   lane)", "no spend check wired yet").
8. **`package.json`'s `description` holds the README skeleton's HTML comment** rather than a
   one-line description.
9. **Voice (job C) is untested here.** The welcome brief says "A short voice catch-up will be
   offered here soon". This run had no `ELEVENLABS_API_KEY`, and nothing checked what happens
   without one.
