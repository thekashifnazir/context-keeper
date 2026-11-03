# Security

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → "Report a
vulnerability") rather than opening a public issue.

## Secrets

This repository contains **no secrets**. API keys live only in the hosting platform's
server-side secret store and are read by server code; nothing secret is shipped to the
browser or committed here.

Any values committed in `.env` are **publishable by design** (for example a Supabase
project URL and publishable key). Their safety depends on row-level security, not on
being hidden.

If you believe a real secret has been committed, report it privately as above and it
will be revoked and rotated.
