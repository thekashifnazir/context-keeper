"""mattermost-bridge.py: seed the compose stack's Mattermost and connect it to Switch as a bridge.

Called by scripts/server-up.sh --with-mattermost. It does what Switch's own `setup` service
(compose profile `collab`, image setup:0.31.0, /setup.py) does, with two differences:
  - the bridge is registered with set_as_default False when another bridge is already the default
    (setup.py always sets Mattermost as the default, which would take it from the Slack bridge);
  - it doesn't link the Gateway admin to the Mattermost account (the eval names the owner itself).
Reads the server's settings from the environment (server/.env). Prints no passwords or tokens.
Stdlib only, so it runs on a stock python3.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

SWITCH = os.environ.get("SWITCH_API_URL", "http://127.0.0.1:18000")
MM = f"http://127.0.0.1:{os.environ.get('MATTERMOST_HOST_PORT', '8065')}"
E = os.environ


def call(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return r.status, dict(r.headers), (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, dict(e.headers), json.loads(raw)
        except ValueError:
            return e.code, dict(e.headers), raw.decode(errors="replace")


def wait(url, name, tries=90):
    for _ in range(tries):
        try:
            if call("GET", url)[0] == 200:
                return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(2)
    sys.exit(f"mattermost-bridge: {name} not ready after {tries * 2} s")


def seed_mattermost():
    """Admin (first user = system admin), the open team, and the deployment's one human account."""
    admin, pw, team = E["MATTERMOST_ADMIN_USER"], E["MATTERMOST_ADMIN_PASSWORD"], E["MATTERMOST_TEAM_NAME"]
    s, _, _ = call("POST", f"{MM}/api/v4/users", {"username": admin, "password": pw, "email": f"{admin}@localhost.local"})
    print("==> Mattermost admin", "created" if s == 201 else "already exists")
    s, h, _ = call("POST", f"{MM}/api/v4/users/login", {"login_id": admin, "password": pw})
    if s != 200:
        sys.exit(f"mattermost-bridge: Mattermost admin sign-in failed ({s})")
    auth = {"Authorization": f"Bearer {h.get('Token') or h.get('token')}"}
    s, _, _ = call("POST", f"{MM}/api/v4/teams", {"name": team, "display_name": team.capitalize(), "type": "O", "allow_open_invite": True}, auth)
    s, _, t = call("GET", f"{MM}/api/v4/teams/name/{team}", headers=auth)
    if s != 200:
        sys.exit(f"mattermost-bridge: team {team} not found ({s})")
    call("PUT", f"{MM}/api/v4/teams/{t['id']}/patch", {"allow_open_invite": True}, auth)
    me = call("GET", f"{MM}/api/v4/users/me", headers=auth)[2]
    call("POST", f"{MM}/api/v4/teams/{t['id']}/members", {"team_id": t["id"], "user_id": me["id"]}, auth)
    user = E["MATTERMOST_USER"]
    s, _, u = call("POST", f"{MM}/api/v4/users", {"username": user, "password": E["MATTERMOST_USER_PASSWORD"], "email": f"{user}@localhost.local"}, auth)
    if s != 201:
        u = call("GET", "/".join([MM, "api", "v4", "users", "username", user]), headers=auth)[2]
    call("POST", f"{MM}/api/v4/teams/{t['id']}/members", {"team_id": t["id"], "user_id": u["id"]}, auth)
    print(f"==> Mattermost team '{team}' (open) with users {admin}, {user}")


def gateway():
    s, h, _ = call("POST", f"{SWITCH}/gateway/auth/login", {"email": E["GATEWAY_ADMIN_EMAIL"], "password": E["GATEWAY_ADMIN_PASSWORD"]})
    if s != 200:
        sys.exit(f"mattermost-bridge: Gateway sign-in failed ({s})")
    cookie = next((c.split(";")[0] for k, c in h.items() if k.lower() == "set-cookie" and c.startswith("switch_auth=")), None)
    if not cookie:
        sys.exit("mattermost-bridge: Gateway gave no switch_auth cookie")
    return {"Cookie": cookie}


def register_bridge(auth):
    s, _, bridges = call("GET", f"{SWITCH}/gateway/collaborations", headers=auth)
    if s != 200:
        sys.exit(f"mattermost-bridge: can't list bridges ({s}); refusing to register a possible duplicate")
    for b in bridges:
        if b.get("bridge_type") == "mattermost":
            print(f"==> Mattermost bridge already registered: {b['bridge_id']}")
            return b["bridge_id"]
    has_default = any(b.get("is_default") for b in bridges)
    s, _, d = call("POST", f"{SWITCH}/gateway/collaborations", {
        "bridge_type": "mattermost",
        "display_name": "Mattermost (eval)",
        "connection_config": {
            "url": "http://mattermost:8065",  # switch-core reaches it on the compose network
            "public_url": MM,
            "admin_user": E["MATTERMOST_ADMIN_USER"],
            "admin_password": E["MATTERMOST_ADMIN_PASSWORD"],
            "team_name": E["MATTERMOST_TEAM_NAME"],
            "default_member": E["MATTERMOST_USER"],
            "callback_base_url": "http://switch:8081",
        },
        "set_as_default": not has_default,
        "preconfigured": True,
    }, auth)
    if s not in (200, 201):
        sys.exit(f"mattermost-bridge: registering the bridge failed ({s}): {d}")
    print(f"==> Mattermost bridge registered: {d['bridge_id']} (default: {not has_default})")
    return d["bridge_id"]


if __name__ == "__main__":
    for k in ("MATTERMOST_ADMIN_USER", "MATTERMOST_ADMIN_PASSWORD", "MATTERMOST_TEAM_NAME", "MATTERMOST_USER", "MATTERMOST_USER_PASSWORD", "GATEWAY_ADMIN_EMAIL", "GATEWAY_ADMIN_PASSWORD"):
        if not E.get(k):
            sys.exit(f"mattermost-bridge: {k} isn't set (server/.env)")
    wait(f"{MM}/api/v4/system/ping", "Mattermost")
    seed_mattermost()
    wait(f"{SWITCH}/health", "Switch")
    register_bridge(gateway())
