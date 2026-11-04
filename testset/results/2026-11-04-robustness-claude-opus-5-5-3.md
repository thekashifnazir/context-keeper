### Robustness checks (eval-harness §10b): 1/1 pass

Run `r20261104-1959-990f`, claude-opus-5-5 (reviewer claude-opus-5-5), 2026-11-04 19:59 UTC. Full evidence: `testset/results/2026-11-04-robustness-claude-opus-5-5-3.json`.

| # | Check | Result | Evidence |
|---|---|---|---|
| R2 | Restart mid-burst | ✅ pass | agent log: "re-queued 1 message(s) from before the restart" |

Model spend: $0.3019 metered (6 calls); $0.1678 from trace lines (4 calls). Metered = the agent's own spend meter (every answered model call, priced by src/agent/model.ts); the trace figure misses calls that never reached a trace line (killed mid-flight, replaced prefetches, the cap-crossing call).

