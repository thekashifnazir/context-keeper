#!/usr/bin/env bash
# cold-start.sh: what a judge's clean clone goes through, offline. Clones this checkout's committed
# HEAD into a temp dir (no .env, no node_modules, no state), then: npm ci, npm test, doctor --offline.
# Needs only git and Node >= 22; no Python libraries, no keys, no Switch server.
# Prints COLD START OK on success. The temp clone is removed afterwards (KEEP=1 keeps it).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ck-cold-start.XXXXXX")"
cleanup() { if [ "${KEEP:-0}" = 1 ]; then echo "kept $TMP"; else rm -rf "$TMP"; fi; }
trap cleanup EXIT
say() { printf '==> %s\n' "$*"; }
die() { printf 'cold-start: FAILED: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "node isn't installed (need >= 22)"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || die "node $major is too old (need >= 22)"
[ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ] || say "note: uncommitted changes in $SRC are not in the clone (HEAD only)"

say "cloning $(git -C "$SRC" rev-parse --short HEAD) into a temp dir"
git clone -q --no-hardlinks "$SRC" "$TMP/repo"
cd "$TMP/repo"
for f in .env .env.local node_modules state build; do [ ! -e "$f" ] || die "$f is in the clone; it must never be committed"; done

say "npm ci"
npm ci --no-audit --no-fund --loglevel=error >"$TMP/npm-ci.log" 2>&1 || { tail -20 "$TMP/npm-ci.log"; die "npm ci"; }

say "npm test"
npm test --silent 2>&1 | tail -6
[ "${PIPESTATUS[0]}" = 0 ] || die "npm test"

say "doctor --offline (no .env in a clean clone: the key and Switch checks are expected to FAIL; nothing else may)"
set +e
out=$(env -u ANTHROPIC_API_KEY npm run -s ck -- doctor --offline 2>&1)
set -e
echo "$out"
unexpected=$(echo "$out" | grep '^FAIL' | grep -v -E '^FAIL +(anthropic key|switch key|git email) ' || true)
[ -z "$unexpected" ] || die "doctor --offline: unexpected FAIL"
echo "$out" | grep -q '^SKIP' || die "doctor --offline skipped no network checks"

echo "COLD START OK"
