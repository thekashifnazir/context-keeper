#!/usr/bin/env bash
# pre-commit guard: scan staged changes for secrets with gitleaks.
# Runs locally, before the secret ever enters history — strictly earlier than CI
# can catch it. This does NOT replace the gitleaks CI job: this guard is fail-open
# (a machine without gitleaks skips the scan), so CI stays the backstop for the
# machine that lacks the binary and for anyone who bypasses with SKIP.
# One-off bypass:    SKIP=secrets git commit ...
# Permanent opt-out: git config hooks.secretsGuard false
set -u

case ",${SKIP:-}," in *,secrets,*) exit 0 ;; esac
[ "$(git config --get hooks.secretsGuard 2>/dev/null)" = "false" ] && exit 0

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "check-secrets: gitleaks not installed (brew install gitleaks) — skipping scan" >&2
  exit 0
fi

# `gitleaks git --staged` is the v8.18+ spelling; `gitleaks protect --staged` is the
# older one. Prefer the modern form so the hook survives the removal of `protect`,
# and fall back so it also works on an older binary.
if gitleaks git --help >/dev/null 2>&1; then
  scan() { gitleaks git --staged --no-banner --redact; }
else
  scan() { gitleaks protect --staged --no-banner --redact; }
fi

scan || {
  echo "check-secrets: staged changes look like they contain a secret." >&2
  echo "  bypass (sure it's a false positive): SKIP=secrets git commit ..." >&2
  exit 1
}
exit 0
