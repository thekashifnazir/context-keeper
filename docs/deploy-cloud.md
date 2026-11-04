# Run it in the cloud: Switch server and agent on a VM

How we run Context Keeper 24/7 on a small cloud VM: Switch's self-hosted server (Postgres, Switch,
Gateway, the test Mattermost) in Docker, and the agent as a systemd service. It's written from what
we did on 4 Nov 2026 on Google Cloud (Compute Engine). Times marked **measured** come from that
day. The rest is the command we ran or the setting we read back from the running VM.

The local path, which this builds on, is [docs/run-it.md](run-it.md).

| | |
|---|---|
| Machine | GCP `e2-standard-2` (2 vCPU, 8 GB), Ubuntu 24.04 LTS (amd64), 40 GB `pd-balanced` boot disk, `europe-west2-a` (London) |
| Software | Docker from get.docker.com (Engine 29, Compose v5), Node 22 from NodeSource |
| Checkout | `~/ck` on the VM, owned by your login user |
| Open ports | SSH only. Every container binds `127.0.0.1` (see [Security](#6-security-notes)) |
| You reach it | through an SSH port-forward, so the Mac keeps `127.0.0.1:18000` (see [§3](#3-reach-it-from-your-mac)) |

Pick one path:

- **A. Fresh install on a new VM**: a new, empty Switch server, about 2.5 minutes of commands.
- **B. Move an existing local server to the VM**: same server, same agent identity, same bridges
  and rooms. Slack had no agent for about 3.5 minutes.

Placeholders: `<project>` is your GCP project id, `<user>` your login on the VM, `<ip>` the VM's
address.

---

## 1A. Fresh install on a new VM

### Create the VM

```bash
gcloud config set project <project>
gcloud services enable compute.googleapis.com

gcloud compute instances create ck-switch \
  --zone europe-west2-a --machine-type e2-standard-2 \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 40GB

# Keep the address across stop/start: promote the VM's current IP to a static one
IP=$(gcloud compute instances describe ck-switch --zone europe-west2-a \
     --format='value(networkInterfaces[0].accessConfigs[0].natIP)')
gcloud compute addresses create ck-switch-ip --region europe-west2 --addresses "$IP"
```

A new project's default network allows SSH (22), RDP (3389) and ICMP from anywhere. Nothing on
the VM listens on 3389; delete that rule if you like (`gcloud compute firewall-rules delete
default-allow-rdp`). Don't add any rule for the Switch ports.

### Install Docker and Node

```bash
gcloud compute ssh ck-switch --zone europe-west2-a

# on the VM
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"            # log out and back in (or use: sg docker -c '…')
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Ubuntu 24.04 already has git, python3, curl and openssl, which `scripts/server-up.sh` needs.

### Follow docs/run-it.md

```bash
git clone https://github.com/thekashifnazir/context-keeper ~/ck && cd ~/ck
cp .env.example .env                       # then fill in the existing ANTHROPIC_API_KEY= line
npm ci
npm test
scripts/server-up.sh --with-mattermost
npm run ck -- doctor
npm run seed -- --bridge mattermost --demo ledgerly --room-name ck-smoke-trial --owner-username user
```

| Step | Measured on the VM (4 Nov, ~14:35) |
|---|---|
| `git clone` (public) | 1 s |
| `npm ci` | 8 s |
| `npm test` | 12 s |
| `scripts/server-up.sh --with-mattermost` | **117 s, including every image download** |
| `npm run ck -- doctor` | all green except the Anthropic key (deliberately not copied for this test) |
| `npm run seed …` | 3 s |
| **Total** | **about 2.5 min from nothing to a Switch server with a seeded room** |

The test Mattermost runs natively here (amd64), with no emulation, unlike on Apple Silicon.

Differences from the Mac:

- `pbcopy` is Mac-only. run-it.md prints the Mattermost password, so on the VM read it from your
  own terminal, or keep a copy on the Mac.
- Mattermost and Console are on the VM's `127.0.0.1`. Reach them with [§3](#3-reach-it-from-your-mac).

Then set a restart policy on the containers (step 11 in 1B) and run the agent as a service:
[§2](#2-run-the-agent-as-a-systemd-service).

---

## 1B. Move an existing local server to the VM

This keeps the Switch database (agent identity and keys, bridges, rooms, room documents), the
Mattermost database, and the agent's own `state/`. Do 1A's "Create the VM" and "Install Docker and
Node" first, and clone the repo to `~/ck`. You don't need `server-up.sh` on the VM: the server's
settings come from the Mac.

### What has to move

| Item | Why it must be the **same** copy |
|---|---|
| `switch` database (`pg_dump -Fc`, 5.3 MB here) | Everything Switch knows: the agent and its keys, bridges, rooms, documents |
| `mattermost` database (0.4 MB here) | Only for the Mattermost route |
| `server/.env` | `DB_OWNER_PASSWORD` is baked into the Postgres volume when it's first created; `SECRET_KEYS`, `GATEWAY_ADMIN_PASSWORD`, `AGENT_REGISTRATION_TOKEN`, `CONTROLLER_TOKEN_SECRET` must match what's in the database. Treat every line as must-keep |
| `server/standalone-docker-compose.yml` | The same Switch version (0.31.0) the dump came from |
| `.env.local` | `SWITCH_AGENT_ID` / `SWITCH_AGENT_API_KEY`: rows in the `switch` database, valid only if it's restored |
| `.env` | App keys and `SWITCH_API_URL` / `SWITCH_GATEWAY_URL` (unchanged if the ports stay the same) |
| `state/` | Stream positions per room, owner desk, hand-offs, voice ids. The agent resumes from these |
| `build/voice/` | Voice catch-up clips (only if you use voice) |

Only these two Docker volumes matter: `<project>_pgdata` (all of Switch) and `<project>_mmdata`
(Mattermost uploads). `pg_dump` carries the first. We didn't carry `mmdata`.

### Order of the move (measured 4 Nov, from 15:30)

On the Mac, in the checkout:

| # | Step | Command |
|---|---|---|
| 1 | Stop the agent | Ctrl-C (or stop its process) |
| 2 | Stop Switch, Gateway and Mattermost. **Leave Postgres running** as the rollback copy | `(cd server && docker compose -f standalone-docker-compose.yml --profile gateway --profile collab stop switch gateway mattermost)` |
| 3 | Make sure a Docker restart can't bring a second Switch up on the same Slack app | `docker update --restart no ckswitch-switch-1 ckswitch-gateway-1 ckswitch-mattermost-1` |
| 4 | Dump both databases (the password stays inside the container) | `docker exec ckswitch-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc switch' > switch.dump`, and the same for `mattermost`. Check both are non-empty |
| 5 | Pack the files (`COPYFILE_DISABLE=1` keeps macOS `._*` files out) | `COPYFILE_DISABLE=1 tar czf files.tgz server/.env server/standalone-docker-compose.yml .env .env.local state build/voice` |
| 6 | Copy to the VM | `gcloud compute scp files.tgz switch.dump mattermost.dump ck-switch:/tmp/ --zone europe-west2-a` |

Use your own Compose project name in place of `ckswitch` if you set `CK_COMPOSE_PROJECT`. Keep
`files.tgz` and the dumps somewhere private, outside every repo, and delete `/tmp` copies on the VM
when you're done: they hold every secret.

On the VM, in `~/ck/server` (after `tar xzf /tmp/files.tgz -C ~/ck && chmod 600 server/.env .env .env.local`):

| # | Step | Command |
|---|---|---|
| 7 | If a test stack from 1A is running, tear it down **and read the output** | `docker compose -f standalone-docker-compose.yml --profile gateway --profile collab down -v --remove-orphans` |
| 8 | Postgres and init-db only, with the copied `server/.env` | `docker compose -f standalone-docker-compose.yml up -d postgres init-db`, wait for `healthy` in `docker compose ps` |
| 9 | Restore, `switch` then `mattermost` | `docker exec -i ckswitch-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d switch --clean --if-exists --no-owner' < /tmp/switch.dump` (same for `mattermost`) |
| 10 | Start the rest | `docker compose -f standalone-docker-compose.yml up -d --force-recreate switch gateway`, then `docker compose -f standalone-docker-compose.yml --profile collab up -d --no-deps mattermost` |
| 11 | Restart policy, so a VM reboot brings it back | `for c in $(docker ps -q); do docker update --restart unless-stopped "$c"; done` |
| 12 | Start the agent | the systemd service in [§2](#2-run-the-agent-as-a-systemd-service) |

**Order matters:** restore before `switch` ever starts. If Switch starts on an empty database it
migrates it, and the restore then collides with that schema.

### Verify

- `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18000/health` prints `200`.
- `npm run ck -- doctor` on the VM: health, ports, stream and bridge should all be `ok`.
- Through the port-forward ([§3](#3-reach-it-from-your-mac)): Console signs in to
  `http://127.0.0.1:18000` with the same admin login, and lists the same bridges.
- `docker ps` shows each container's start time from the move, not from earlier (see the
  gotcha below).
- `tail ~/ck/state/agent.log` shows `listening in <room> (posting on)` for your `ck-smoke-` rooms.
- One question in a `ck-smoke-` room gets a cited reply.

### Measured

| | |
|---|---|
| Restore: 0 errors (`switch` and `mattermost`) | |
| Switch healthy | **60 s** after the VM-side script started |
| Came across intact | admin login, all three bridges (Slack, Discord, Mattermost), the agent's identity |
| Slack with no agent | **about 3.5 min**: local agent stopped 15:30, VM agent service started 15:33 |

### Gotchas we hit

- **The teardown that silently failed.** The scripted `compose down -v` of the 1A test stack
  failed and its output had been sent to `/dev/null`, so the old Gateway kept the test install's
  secrets ("Up 56 minutes" in the first check). `up -d --force-recreate switch gateway` fixed it.
  Never `>/dev/null` the teardown step of a migration, and name both profiles
  (`--profile gateway --profile collab`) or the Gateway is left running.
- **A recreate drops the restart policy.** `docker update --restart …` is set on the container,
  not in Compose, so any later `up --force-recreate` puts it back to `no`. After the move, Postgres
  and Mattermost read `unless-stopped`, Switch and Gateway `no`. Re-run step 11 after every
  recreate, and check with
  `docker inspect -f '{{.Name}} {{.HostConfig.RestartPolicy.Name}}' $(docker ps -aq)`.

### Rollback

The Mac's Postgres is still running with the old data, and Switch/Gateway are stopped with no
restart policy. To go back: stop the VM agent and stack, then `docker compose … start switch gateway
mattermost` on the Mac and start the local agent. **Never run both at once** (see
[Security](#6-security-notes)).

---

## 2. Run the agent as a systemd service

`/etc/systemd/system/ck-agent.service`, as it runs on our VM (replace `<user>`). Secrets are
not in the unit: the agent reads `.env` and `.env.local` from its working directory.

```ini
[Unit]
Description=Context Keeper agent
After=docker.service network-online.target
Wants=network-online.target

[Service]
User=<user>
WorkingDirectory=/home/<user>/ck
Environment=CK_POST_ROOMS=ck-smoke-
Environment=CK_POST_OWNER=1
Environment=CK_BUILD_ROOM=ck-smoke-build-1104
Environment=CK_HANDOFF_TIMEOUT_MIN=10
Environment=CK_REVIEWER_MODEL=claude-opus-5-5
# Voice (section 4): the live tool's URL, and the short talk links on the same host
Environment=CK_TALK_TOOL_URL=https://ck.<your-domain>
Environment=CK_PUBLIC_BASE_URL=https://ck.<your-domain>
# Sources in posts link to the seeded docs' public copies (docs/message-style.md)
Environment=CK_DOCS_BASE_URL=https://github.com/thekashifnazir/context-keeper/blob/main
ExecStart=/usr/bin/npm run agent
Restart=always
RestartSec=5
StandardOutput=append:/home/<user>/ck/state/agent.log
StandardError=append:/home/<user>/ck/state/agent.log

[Install]
WantedBy=multi-user.target
```

| Setting | What it does |
|---|---|
| `CK_POST_ROOMS=ck-smoke-` | Posts only in rooms whose names start with this; everywhere else is a dry run |
| `CK_POST_OWNER=1` | Owner-desk notes are really posted (dry run otherwise) |
| `CK_BUILD_ROOM` | Job E's build room; must match `CK_POST_ROOMS` to be created and posted in |
| `CK_HANDOFF_TIMEOUT_MIN` | Minutes before a hand-off with no report times out |
| `CK_REVIEWER_MODEL` | The checker model |
| `CK_TALK_TOOL_URL` | The voice tool's public URL (section 4) |
| `CK_PUBLIC_BASE_URL` | The same host, for the brief's short `/talk/<id>` links (section 4, step 7) |
| `CK_DOCS_BASE_URL` | Where the seeded docs' public copies live: a cited source links to its section; unset, sources are named without links |
| `Restart=always` | A crash, or the stream watchdog's exit 4, starts a new process after 5 s |

Any other setting goes in `.env` or as another `Environment=` line (see `.env.example`).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ck-agent
systemctl status ck-agent --no-pager
tail -f ~/ck/state/agent.log           # the agent's own output
journalctl -u ck-agent --no-pager      # starts, stops and restarts only
```

**Recovering on its own.** The stream watchdog (`CK_STREAM_WATCHDOG_SEC`, default 120) counts
every frame, ping and heartbeat as a sign of life. After a silent window it reopens the stream from
the saved position. After three dead restarts in a row it exits with code 4, and `Restart=always`
starts a fresh process. A reboot starts the service again (`enable`).

`state/agent.log` only grows; nothing rotates it yet.

### Deploy an update

```bash
cd ~/ck
git pull
npm ci                                  # only needed when package-lock.json changed
sudo systemctl restart ck-agent
tail -n 20 state/agent.log              # check it's listening again
```

The agent keeps its queue and positions in `state/`, so a restart picks up where it stopped.
Messages that arrive while it's down are read on reconnect.

---

## 3. Reach it from your Mac

Keep one SSH port-forward open. Switch Console and Claude Code on the Mac then keep using
`127.0.0.1:18000`, with no reconfiguration:

```bash
gcloud compute ssh ck-switch --zone europe-west2-a -- -N \
  -L 18000:127.0.0.1:18000 \
  -L 13000:127.0.0.1:13000 \
  -L 18065:127.0.0.1:18065
```

| Mac address | On the VM |
|---|---|
| `http://127.0.0.1:18000` | Switch API (Console's "Connect to an existing server", Claude Code) |
| `http://127.0.0.1:13000` | Gateway |
| `http://127.0.0.1:18065` | Test Mattermost |

The local stack must be stopped first, or those Mac ports are already taken. If the forward
drops, Console shows the server as unreachable: run the command again. The agent on the VM doesn't
need the forward.

---

## 4. Exposing HTTPS for the voice tool

The voice agent's live `whats_new` tool needs a public HTTPS URL that reaches the agent's small
webhook server on the VM (`127.0.0.1:8790`, `CK_TALK_TOOL_PORT`). The agent reads the tunnel URL
from `tunnel.log` (`CK_TALK_TUNNEL_LOG`), or from `CK_TALK_TOOL_URL` if set.

**Chosen route: a Cloudflare Tunnel.** `cloudflared` runs on the VM and connects out to
Cloudflare, so no inbound port is opened; SSH stays the only one.

Done on 4 Nov (about 10 minutes, most of it clicks):

1. **Install the connector on the VM** (a named tunnel, not a quick one): the `.deb` from
   cloudflared's GitHub releases, `sudo dpkg -i cloudflared-linux-amd64.deb` (2026.10.7 here).
2. **Create the tunnel** in the Cloudflare dashboard: Networking → Tunnels → Create Tunnel, name it
   (ours: `ck-switch`), pick Debian. The page shows `sudo cloudflared service install <token>`.
3. **Run that one line on the VM.** It installs a systemd service (`cloudflared`), so the tunnel
   comes back after a reboot on its own. Run it yourself rather than through a helper: the token
   lets anyone run your tunnel. If it ever leaks, use **Rotate token** on the tunnel's page.
4. **Add a route:** Routes → Add route → Published application → subdomain `ck` on your domain,
   service URL `http://localhost:8790` (the agent's voice tool server). Cloudflare adds the DNS
   record and the HTTPS certificate itself.
5. **Tell the agent the URL:** add `Environment=CK_TALK_TOOL_URL=https://ck.<your-domain>` to the
   systemd unit, then `daemon-reload` and restart. Within a minute the agent logs
   `[voice] live tool on: whats_new → https://ck.<your-domain>` and attaches the tool to the
   ElevenLabs agent.
6. **Check it from anywhere:** `curl https://ck.<your-domain>/health` → 200; a POST to
   `/voice/whats_new` without the secret header → 401; any other path → 404.
7. **Short talk links in the brief:** add `Environment=CK_PUBLIC_BASE_URL=https://ck.<your-domain>`
   too. The brief's "🎧 Talk it through" line then links `https://ck.<your-domain>/talk/<id>`
   instead of the long ElevenLabs URL. The route goes through the same tunnel and the same server
   (the whole host already points at it, so there's nothing to add in Cloudflare): `GET /talk/<id>`
   is a 302 to the person's ElevenLabs talk page while the link is open (3 hours), then a 404. The id
   is random and unguessable, nothing secret is in it or in the redirect, and the agent logs
   `[voice] short talk links: https://ck.<your-domain>/talk/<id>` at start. Without the setting (or
   while the tool server isn't up) the brief carries the long link, still behind a "Start a voice
   catch-up" label. `CK_TALK_LINK_STYLE=bare` posts the short URL itself instead of a named link.

On a VM reboot both services start by themselves: `cloudflared` (the tunnel) and `ck-agent`. If
the tunnel is down, the agent detaches the tool and falls back to refreshing the voice agent's
notes on each change, so a call never waits on a dead URL.

---

## 5. Costs and shutting it down

**Approximate** list prices for London (`europe-west2`) at the time of writing. They change and
vary by region, so check the [GCP pricing calculator](https://cloud.google.com/products/calculator)
before you rely on them. We ran on the free-trial credits.

| Item | Approx. per week | Approx. per month |
|---|---|---|
| `e2-standard-2`, running all the time (E2 gets no sustained-use discount) | ~$15 | ~$63 |
| 40 GB `pd-balanced` disk | ~$1 | ~$5 |
| Static external IPv4, attached to a running VM | ~$0.85 | ~$3.65 |
| **Total, running** | **~$17** | **~$72** |
| VM stopped: disk plus the static IP, now unused (charged at a higher rate, ~$0.01/h) | ~$2.80 | ~$12 |

Egress for chat traffic is small and not counted here.

### Shut it down

| To | Command | You keep |
|---|---|---|
| Pause (stop paying for the VM) | `gcloud compute instances stop ck-switch --zone europe-west2-a` | Disk, data, static IP (still billed) |
| Start again | `gcloud compute instances start ck-switch --zone europe-west2-a` | Same IP. Check `docker ps`: only containers with a restart policy come back (see [1B gotchas](#gotchas-we-hit)) |
| Release the IP | `gcloud compute addresses delete ck-switch-ip --region europe-west2` (after the VM is deleted, or it's still in use) | Nothing at that address |
| Delete the VM and its disk | `gcloud compute instances delete ck-switch --zone europe-west2-a` | Nothing on the VM: dump the databases and copy the files in 1B's table off first |
| Delete everything | `gcloud projects delete <project>` | Nothing (GCP keeps a deleted project restorable for 30 days) |

---

## 6. Security notes

- **Only SSH is reachable from outside.** Every container publishes on `127.0.0.1` only
  (`127.0.0.1:18000`, `:13000`, `:15432`, `:18065`), and no firewall rule opens them. You reach
  them through the SSH port-forward. The voice tool uses an outbound Cloudflare Tunnel, not an
  open port.
- **Secrets never go in git.** `server/.env`, `.env.local`, `.env`'s keys, `state/` and `build/`
  are all ignored. On the VM, keep `server/.env`, `.env` and `.env.local` at mode 600, and don't
  print them. The move archive and the dumps hold every secret: keep them private and delete the
  copies when you're done.
- **One Slack app, one server.** A Slack app can only be connected to one Switch server at a time.
  Two servers on one Slack app fight over its events, and two agents with one key take each other's
  stream. That's why 1B stops the local Switch and turns its restart policy off before the VM's
  comes up. To run a second server, give it its own Slack app.
- The VM is a single machine: no backups run on their own. For a copy, use 1B's `pg_dump` step
  and keep `server/.env` with it.
