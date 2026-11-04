### Robustness checks (eval-harness §10b): 2/2 pass

Run `r20261104-1916-b591`, claude-opus-5-5 (reviewer claude-opus-5-5), 2026-11-04 19:16 UTC. Full evidence: `testset/results/2026-11-04-robustness-claude-opus-5-5-2.json`.

| # | Check | Result | Evidence |
|---|---|---|---|
| R7a | Caps → per-person demo limit (adapted) | ✅ pass | ok: agent log: 1 "told once" and 1 "silent" demo_limit line(s): every gated message was seen and kept in the room's record, none dropped unseen |
| R7b | Caps → daily spend cap (adapted) | ✅ pass | Q1 (its call crossed the cap): not decided, 0 public post(s) |

Model spend: $0.1513 metered (7 calls); $0.1118 from trace lines (6 calls). Metered = the agent's own spend meter (every answered model call, priced by src/agent/model.ts); the trace figure misses calls that never reached a trace line (killed mid-flight, replaced prefetches, the cap-crossing call).

- **R7a adapted:** CK_CAPS (3 posts per room, a batched owner-desk note for the rest) no longer exists. The current design caps per person in public demo rooms (src/agent/demo.ts): one limit line, then silence, no owner note; so this checks that instead.
- **R7b adapted:** CK_CAPS no longer exists; the spend cap (src/agent/spend.ts) is the current global limit, so this checks it alongside R7a.
