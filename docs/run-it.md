# Run it: from a clean clone to a working Context Keeper

This is the path from a fresh `git clone` to Context Keeper answering in a chat room on your own
machine, with no Slack workspace. It uses Switch's self-hosted server and the Mattermost that ships
in Switch's own Compose file. Every command and time below was run and measured on 4 Nov 2026 from
a clean checkout (no `.env`, no `node_modules`, no `server/`). The machine was an Apple Silicon
Mac with Colima and the Docker images already pulled.

## What you need

- Node 22 or later (tested on 26.12), npm, git
- Docker with Compose v2 (Docker Desktop, or Colima on a Mac), running
- python3 (stdlib only; 3.9 works), curl, openssl
- An Anthropic API key
- About 3 GB free for the images

## The path

| # | Step | Command | Measured |
|---|---|---|---|
| 1 | Settings | `cp .env.example .env`, then set `ANTHROPIC_API_KEY=` in `.env` (don't `export` it) | under 1 min |
| 2 | Install | `npm ci` | 10 s |
| 3 | Tests (offline) | `npm test` (134 tests) | 2 s |
| 4 | Switch server and Mattermost, register the agent | `scripts/server-up.sh --with-mattermost` | 31 s (8 s server and registration, 23 s Mattermost and bridge); add 2–3 min for the first image download |
| 5 | Check | `npm run ck -- doctor` | 1 s |
| 6 | Seed a room | `npm run seed -- --bridge mattermost --demo ledgerly --room-name ck-smoke-trial --owner-username user` | under 2 s |
| 7 | Start the agent | `npm run agent` (leave it running) | connects in about 5 s |
| 8 | Ask it something | see below | first reply 20 s, threaded answer within about a minute |

Optional: `npm run eval -- --fast --only T05` replays one test case into a fresh room, with its own
eval agent identity, and scores it (148 s; 1/1 on this run). Leave out `--only` to run the whole
main set (24 cases).

### Step 4 in detail

`scripts/server-up.sh` fetches Switch's published Compose file (0.31.0) and checks it against its
digest. It writes `server/.env` with fresh random secrets and starts Postgres, Switch and the
Gateway. Then it signs in to the Gateway as the admin, mints a registration key and registers the
`context-keeper` agent. The agent's id and key go to `.env.local` (mode 600), and nothing secret is
printed. It also points `SWITCH_API_URL` and `SWITCH_GATEWAY_URL` in `.env` at the server.

`--with-mattermost` adds the Compose file's Mattermost and creates its admin, a team called
`switch` and one human account called `user`. It then connects Mattermost to Switch as a bridge.

Running it again is safe: it never overwrites `server/.env` or `.env.local`.

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

With Mattermost connected and before any room is seeded:

```
ok    health        http://127.0.0.1:28000/health
ok    ports         api 28000 up, gateway 23000 up
ok    stream        opened a fresh connection (closed again at the end)
ok    bridge        mattermost "Mattermost (eval)" (default)
SKIP  rooms         0 room(s) on the server; none seeded yet (npm run seed)
doctor: OK
```

Without `--with-mattermost`, `bridge` FAILs ("no active messaging-app bridge"). That's expected:
the agent has nowhere to listen yet.

### Step 8: talk to it

Open Mattermost at `http://127.0.0.1:18065` (or your `CK_MM_PORT`). Sign in as `user`. Copy the
password with:

```bash
grep '^MATTERMOST_USER_PASSWORD=' server/.env | cut -d= -f2- | tr -d '\n' | pbcopy
```

Open the `ck-smoke-trial` channel and post a question the demo history already answers:

> Why don't we run onboarding on Saturdays? Agency owners have more time at weekends.

What happened on the measured run:

1. After 20 s, a welcome brief for `user`, because they're new to the room. It already mentions
   the Saturday decision, with its source (led-011).
2. About a minute later, the job A reply in the thread. It says the question was covered by
   decision D1 ("Calls are Tue to Thu because partner finance staff only work weekdays and we have
   no support cover at weekends"). It quotes `pilot-plan.md §2 D1` with who decided and when, and
   says what would reopen it.

The agent only posts in rooms whose names start with `ck-smoke-` or `ck-eval-` (`CK_POST_ROOMS`).
In any other room it decides, traces to `state/trace.jsonl` and logs what it would have said, but
sends nothing. So name your room `ck-smoke-…`, or set `CK_POST_ROOMS`.

### Stop and clean up

`Ctrl-C` the agent. Then remove the stack and its data (use your `CK_COMPOSE_PROJECT` if you set
one):

```bash
docker compose -p ckswitch down -v
```

## Slack, Discord and Switch Console

The Slack and Discord routes need a Switch Slack app or Discord bot connected to the server as a
bridge, plus a workspace to install it in. The demo video uses that route. Mattermost needs neither.

Switch Console 0.40.1 can connect to this server with "Connect to an existing server", using the
`SWITCH_API_URL` from `.env`. Sign in as `admin@switch.local`. The password is
`GATEWAY_ADMIN_PASSWORD` in `server/.env`. You don't need Console to run the agent or the eval.

## Fixed on the way (this run)

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

## Still open for the README's "Run it" section

1. **README.md has no "Run it" section yet** (it's three lines). The table above is ready to lift.
2. **The first image download wasn't measured.** The images were cached. `server-up.sh` estimates
   2–3 min. Mattermost's image is amd64 only, so on Apple Silicon it runs under emulation. Under
   eval load it sometimes stops (the eval restarts it and records an incident).
3. **The first `server-up.sh` without `--with-mattermost` prints five Compose warnings** about
   unset `MATTERMOST_*` variables. They're harmless but look like errors.
4. **npm 11 warns that esbuild's install script didn't run** ("not yet covered by allowScripts").
   Tests, tsx and the agent all work regardless.
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
