#!/usr/bin/env bash
# server-up.sh: start Switch's own published self-host server (0.31.0, with the Gateway) in Docker,
# then register Context Keeper on it. Safe to run again: it never overwrites server/.env or .env.local.
#
# Why not Switch Console's built-in server? Console 0.40.1 runs it with no Gateway, so there's no way to
# mint a registration key for a custom agent. This is Switch's documented self-host route instead, and
# Console connects to it with "Connect to an existing server" -> http://127.0.0.1:18000.
#
# --with-mattermost also starts the Compose file's own Mattermost (profile `collab`) for the eval's
# personas, and connects it to Switch as a bridge (scripts/mattermost-bridge.py). On a server that's
# already running it only ADDS the mattermost container (`up --no-deps mattermost`): switch, gateway
# and postgres are never recreated or restarted. CK_ROOT picks whose server/ to use (default: this
# checkout), so a git worktree can drive the one live server.
set -euo pipefail
WITH_MM=0
for a in "$@"; do case "$a" in --with-mattermost) WITH_MM=1 ;; *) echo "usage: $0 [--with-mattermost]" >&2; exit 2 ;; esac; done
cd "${CK_ROOT:-$(dirname "$0")/..}"
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

VER=0.31.0
REPO=sandbox-quantum/standalone-compose
API=http://127.0.0.1:18000
DIR=server
COMPOSE="$DIR/standalone-docker-compose.yml"
mkdir -p "$DIR"

say() { printf '==> %s\n' "$*"; }
die() { printf 'server-up: %s\n' "$*" >&2; exit 1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
command -v docker >/dev/null || die "Docker isn't installed (Docker Desktop, or Colima on a Mac)"
docker info >/dev/null 2>&1 || die "Docker isn't running"

# 1. Fetch Switch's Compose file (an OCI artifact on ghcr.io) and check it against the manifest digest.
if [ ! -s "$COMPOSE" ]; then
  say "fetching Switch's Compose file ($VER)"
  tok=$(curl -fsS "https://ghcr.io/token?scope=repository:$REPO:pull" | json 'd["token"]')
  dig=$(curl -fsS -H "Authorization: Bearer $tok" -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
        "https://ghcr.io/v2/$REPO/manifests/$VER" | json '[l for l in d["layers"] if l["mediaType"]=="application/yaml"][0]["digest"]')
  curl -fsSL -H "Authorization: Bearer $tok" "https://ghcr.io/v2/$REPO/blobs/$dig" -o "$COMPOSE.tmp"
  [ "sha256:$(shasum -a 256 "$COMPOSE.tmp" | cut -d' ' -f1)" = "$dig" ] || { rm -f "$COMPOSE.tmp"; die "Compose file doesn't match its digest"; }
  mv "$COMPOSE.tmp" "$COMPOSE"
fi

# 2. The server's own settings, with fresh random secrets. Written once, never overwritten.
if [ ! -s "$DIR/.env" ]; then
  say "writing $DIR/.env (random secrets)"
  r() { openssl rand -hex "${1:-24}"; }
  ( umask 077; cat > "$DIR/.env" <<EOF
SWITCH_VERSION=$VER
COMPOSE_PROJECT_NAME=ckswitch
COMPOSE_PROFILES=gateway
API_HOST_PORT=18000
GATEWAY_HOST_PORT=13000
POSTGRES_HOST_PORT=15432
FRONTEND_BASE_URL=http://localhost:13000
DB_NAME=switch
DB_OWNER_USER=switch_owner
DB_USER=switch_app
GATEWAY_ADMIN_EMAIL=admin@switch.local
GATEWAY_ADMIN_PASSWORD=$(r 16)
DB_PASSWORD=$(r)
DB_OWNER_PASSWORD=$(r)
AGENT_REGISTRATION_TOKEN=$(r)
SECRET_KEYS=k1:$(r 24)
CONTROLLER_TOKEN_SECRET=$(r)
EOF
  )
fi

# 2b. Mattermost settings (--with-mattermost): appended to server/.env only if missing, never changed.
if [ "$WITH_MM" = 1 ]; then
  r() { openssl rand -hex "${1:-24}"; }
  add() { grep -q "^$1=" "$DIR/.env" || { printf '%s=%s\n' "$1" "$2" >> "$DIR/.env"; say "server/.env: added $1"; }; }
  add MATTERMOST_HOST_PORT 18065
  add MATTERMOST_ADMIN_USER sysadmin
  add MATTERMOST_ADMIN_PASSWORD "$(r 16)"
  add MATTERMOST_TEAM_NAME switch
  add MATTERMOST_USER user
  add MATTERMOST_USER_PASSWORD "$(r 16)"
fi

# 3. Start it and wait for health (about 10 s with cached images, 2-3 min for the first download).
#    With --with-mattermost and a server already healthy, the core stack is left exactly as it is.
if [ "$WITH_MM" = 1 ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$API/health")" = 200 ]; then
  say "server already running; leaving switch, gateway and postgres as they are"
else
  say "starting the server (docker compose)"
  ( cd "$DIR" && docker compose -f standalone-docker-compose.yml up -d --quiet-pull >/dev/null )
fi
for i in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$API/health")" = 200 ] && break
  [ "$i" = 90 ] && die "server not healthy after 3 min: try 'docker compose -f $COMPOSE logs switch'"
  sleep 2
done
say "server healthy at $API"

# 3b. Mattermost (--with-mattermost): add only its container, then seed it and register the bridge.
#     Switch's own `setup` service isn't used: it makes Mattermost the default bridge, which would
#     take the default from a Slack or Discord bridge you already connected.
if [ "$WITH_MM" = 1 ]; then
  before=$(cd "$DIR" && docker compose -f standalone-docker-compose.yml ps -q switch)
  say "starting Mattermost (amd64 image, emulated on Apple Silicon; first boot ~30 s)"
  ( cd "$DIR" && docker compose -f standalone-docker-compose.yml --profile collab up -d --no-deps --quiet-pull mattermost >/dev/null )
  after=$(cd "$DIR" && docker compose -f standalone-docker-compose.yml ps -q switch)
  [ "$before" = "$after" ] || die "switch container changed while adding Mattermost; check 'docker compose ps'"
  ( set -a; . "$DIR/.env"; set +a; SWITCH_API_URL="$API" python3 "$SCRIPTS/mattermost-bridge.py" ) || die "Mattermost bridge setup failed"
  say "Mattermost at http://127.0.0.1:$(grep '^MATTERMOST_HOST_PORT=' "$DIR/.env" | cut -d= -f2)"
fi

# 4. Register Context Keeper, owned by the admin user: sign in to the Gateway, mint a registration key,
#    register the agent. Its id and keys go to .env.local (mode 600); nothing secret is printed.
if grep -q '^SWITCH_AGENT_ID=.' .env.local 2>/dev/null; then
  say "agent already registered (.env.local)"
else
  say "registering the context-keeper agent"
  jar=$(mktemp); trap 'rm -f "$jar"' EXIT
  set -a; . "$DIR/.env"; set +a
  python3 -c 'import json,os; print(json.dumps({"email": os.environ["GATEWAY_ADMIN_EMAIL"], "password": os.environ["GATEWAY_ADMIN_PASSWORD"]}))' \
    | curl -fsS -c "$jar" -o /dev/null -H 'Content-Type: application/json' --data @- "$API/gateway/auth/login" \
    || die "Gateway sign-in failed"
  key=$(curl -fsS -b "$jar" -H 'Content-Type: application/json' -d '{"label":"context-keeper"}' "$API/gateway/api-keys" | json 'd["key"]')
  # connector_type and integration_profile are required, or it's a 422
  agent=$(curl -fsS -H "Authorization: Bearer $key" -H 'Content-Type: application/json' "$API/agents" -d '{
    "name": "context-keeper",
    "description": "Answers \"why dont we do X?\" in the team chat with the source: the doc, message or decision that already covered it.",
    "connector_type": "context-keeper",
    "integration_profile": {"connection_model": "always_on", "message_exchange": true,
      "pre_invocation_mediation": [], "post_invocation_mediation": [], "event_reporting": []}}')
  ( umask 077
    { echo "# Written by scripts/server-up.sh. Never committed."
      echo "SWITCH_REGISTRATION_KEY=$key"
      printf '%s' "$agent" | json '"SWITCH_AGENT_ID=" + d["id"] + "\nSWITCH_AGENT_API_KEY=" + d["api_key"]'
    } > .env.local )
  say "agent registered; id and keys saved to .env.local"
fi

cat <<'EOF2'

Next, in Switch Console: server name (top left) -> Add server -> Connect to an existing server
  -> http://127.0.0.1:18000, then sign in as admin@switch.local. Copy the password with:
  grep '^GATEWAY_ADMIN_PASSWORD=' server/.env | cut -d= -f2- | tr -d '\n' | pbcopy
EOF2
