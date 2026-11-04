### Robustness checks (eval-harness §10b): 6/9 pass

Run `r20261104-1906-01f3`, claude-opus-5-5 (reviewer claude-opus-5-5), 2026-11-04 19:06 UTC. Full evidence: `testset/results/2026-11-04-robustness-claude-opus-5-5.json`.

| # | Check | Result | Evidence |
|---|---|---|---|
| R1 | Quote gate | ✅ pass | vitest: 3 passed \| 17 skipped (20) |
| R2 | Restart mid-burst | ❌ fail | FAIL: returner brief: 0 post(s) in the channel, 0 brief trace line(s) |
| R3 | Own posts ignored | ✅ pass | ok: no trace input is an agent post |
| R4 | Fail quiet | ✅ pass | ok: retry: reply, verdict covered (expected covered), sources pilot-plan.md §2, led-011 |
| R5 | Retract (adapted) | ❌ fail | FAIL: no agent post in the thread after "wrong"; FAIL: no trace line records a retraction (the owner's message: silence none/-) |
| R6 | Pending items survive | ✅ pass | ok: after the answer (19:10:49): "Update from Kash: The plan stands." |
| R7a | Caps → per-person demo limit (adapted) | ✅ pass | ok: agent log: 1 "told once" and 1 "silent" demo_limit line(s): every gated message was seen and kept in the room's record, none dropped unseen |
| R7b | Caps → daily spend cap (adapted) | ❌ fail | FAIL: Q1: 1 public post(s); FAIL: 1 trace line(s) with a model call after the cap note |
| R8 | Missed while down (adapted) | ✅ pass | marked late: no (not built) |

Model spend: $0.4620 metered (16 calls); $0.3290 from trace lines (14 calls). Metered = the agent's own spend meter (every answered model call, priced by src/agent/model.ts); the trace figure misses calls that never reached a trace line (killed mid-flight, replaced prefetches, the cap-crossing call).

- **R5 adapted:** Not built: no code in src/agent reads a "wrong" reply, writes a retraction or appends to testset/misses.yaml. Run as written, to record what the agent does today.
- **R7a adapted:** CK_CAPS (3 posts per room, a batched owner-desk note for the rest) no longer exists. The current design caps per person in public demo rooms (src/agent/demo.ts): one limit line, then silence, no owner note; so this checks that instead.
- **R7b adapted:** CK_CAPS no longer exists; the spend cap (src/agent/spend.ts) is the current global limit, so this checks it alongside R7a.
- **R8 adapted:** The plan also says "marked late". The agent has no late marker (nothing in src/agent labels a resumed reply), so that part is reported, not scored.
