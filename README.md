# Context Keeper

An agent in your team chat that answers "why don't we do X?" with the source.

Being built for the Flip the Switch hackathon.

## Try it

<!-- factual stub; Kash to reword -->
- A public Discord channel, bridged into the same Switch server as the team's Slack and seeded with the Ledgerly record, is set up by [docs/demo-channel.md](docs/demo-channel.md). Invite link: [NEED]
- There it answers, logs decisions and flags clashes, citing the record; Claude Code builds and voice are off in that channel.
- Each person gets up to 6 replies an hour, and model spend stops at a daily cap (`CK_DAILY_SPEND_CAP_USD`).

## Run it in the cloud

<!-- factual stub; Kash to reword -->
- Runs 24/7 on a small cloud VM (tested on GCP `e2-standard-2`, Ubuntu 24.04): Switch's server in Docker, the agent as a systemd service.
- Fresh install about 2.5 minutes; moving an existing server keeps its agent, bridges and rooms.
- Steps, costs and shutdown: [docs/deploy-cloud.md](docs/deploy-cloud.md).
