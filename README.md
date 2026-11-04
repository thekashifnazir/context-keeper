# Context Keeper

An agent in your team chat that answers "why don't we do X?" with the source.

Being built for the Flip the Switch hackathon.

## Run it in the cloud

<!-- factual stub; Kash to reword -->
- Runs 24/7 on a small cloud VM (tested on GCP `e2-standard-2`, Ubuntu 24.04): Switch's server in Docker, the agent as a systemd service.
- Fresh install about 2.5 minutes; moving an existing server keeps its agent, bridges and rooms.
- Steps, costs and shutdown: [docs/deploy-cloud.md](docs/deploy-cloud.md).
