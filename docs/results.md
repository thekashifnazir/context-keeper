# Results in full

The headline numbers are in the [README](../README.md#results). This page keeps the full run, the robustness checks and the history. Every number comes from [facts.md](../facts.md), which the eval appends to on every run, failures included.

<!-- drafted by Claude from the build log; Kash to check -->
The eval runs the **real agent** against the **real Switch server**, in real time. Personas post each test case as ordinary Mattermost users into fresh rooms seeded with the demo record, and a scorer reads back what the agent posted and what its trace says. Latest full run, `r20261104-1826-08e4` ([report](../testset/results/2026-11-04-claude-opus-5-5-12.md)):

| Measure | Result |
|---|---|
| **Overall, 24 cases** | **23/24** |
| Job A, already covered? (17 cases) | 16/17 |
| Job D, preference or constraint (4) | 4/4 |
| Job B, decision capture (1) | 1/1 |
| Stayed quiet on chatter (2) | 2/2 |
| Bursts (several messages from one person) answered once | 2 of 2 |
| **Confident wrong** ("covered" when it isn't, or without a citation) | **0**, and 0 in every one of the 19 runs in facts.md |
| Citations verified (the quote matches its source and is shown in the reply) | 54/73 |
| Median time from the post to the reply | 15.5 s (22 replies) |
| Estimated model spend for the whole run | $0.95 (an upper bound, from the eval's price table) |
| Held-out (5) and red-team (12) sets | Not scored yet. They're reported on their own lines, never mixed into the 24 ([testset/README.md](../testset/README.md)) |

**Every full run, in order:** 12, 14, 17, 21, 23, 22, 22, 23, 23, 17, 17, 23, 23, 23, 23 (out of 24). The first ones ran before jobs B to D were merged in. The two 17s on 4 Nov were an Anthropic overload window and a dropped event stream, which led to the reconnect fix and the stream watchdog ([build log](../blog/build-log.md)).

**The one miss, T18.** Alex offers to bring students from the uni society and make it a student hackathon. The record says the event is community-wide, and a students-only night is parked for later. The agent quoted both, and its reply says the students-only night is parked, but it labelled the verdict "covered" where the test expects "parked". It's the same record shape as T16, which expects "covered", so we left it rather than tune the prompt to the test.

**Citations, read carefully.** None of the quotes shown to people failed the check. The other 19 of the 73 stayed in the agent's trace and were never shown.

**Speed.** The median went from 34.9 s to 16.1 s on 4 Nov, and was 15.5 s in the latest run: the verdict call now starts while the quiet gap runs, a finished-looking message waits 12 s instead of 20, and the catch-up brief no longer blocks the event stream.

**Robustness.** A second runner (`npm run eval -- --robustness`) kills, restarts and starves the live agent on purpose, each check in its own fresh room. First full run `r20261104-1906-01f3`: 6/9 ([report](../testset/results/2026-11-04-robustness-claude-opus-5-5.md)); the two fails we could fix were re-run on their own after the fix.

| # | Check | Result |
|---|---|---|
| R1 | Quote gate: a quote that isn't in the source never posts as "covered" (offline test) | ✅ pass |
| R2 | Restart mid-burst: killed while a returner's first message waits in the queue | ❌ fail in the first run: one combined reply, but the catch-up brief was lost for good. Fixed (the brief is saved as pending and re-run once after a restart), then ✅ pass in `r20261104-1959-990f` ([report](../testset/results/2026-11-04-robustness-claude-opus-5-5-3.md)): one brief, one combined reply, no duplicates |
| R3 | Own posts ignored: none of the agent's posts is ever taken as input | ✅ pass |
| R4 | Fail quiet: a model error posts nothing public, one note to the owner, and the retry posts the right answer | ✅ pass |
| R5 | Retract: the owner says "wrong" under an answer | ❌ fail in the first run: **not built**. Built, then ✅ pass in `r20261104-2038-faa0` ([report](../testset/results/2026-11-04-robustness-claude-opus-5-5-4.md)): one "↩️ **Withdrawn**" line in the thread, a `retract` trace line, a new entry in [testset/misses.yaml](../testset/misses.yaml), and when Rowan asked the same question again, nothing was posted that cited the withdrawn sources. That fourth check is our own addition to the plan's three |
| R6 | A clash waiting for the owner survives a restart, and the ruling lands in the thread | ✅ pass |
| R7a | Per-person limit in a public demo room: the limit line once, then silence, nothing dropped unseen | ✅ pass |
| R7b | Daily spend cap: no model call after the cap | ❌ fail in the first run (the check also counted the call that crossed the cap); check corrected, then ✅ pass in `r20261104-1916-b591` ([report](../testset/results/2026-11-04-robustness-claude-opus-5-5-2.md)) |
| R8 | Missed while down: a message posted while the agent is stopped is answered once after it restarts | ✅ pass (there's no "late" marker; reported, not scored) |

Model spend for the four robustness runs: $0.46, $0.15, $0.30 and $0.13 (metered estimates, in [facts.md](../facts.md)).

**How it was tested honestly.** The 24 cases and the invented demo data (two teams, Ledgerly and Riverside) were prepared before the build window. One expectation (T14) changed in the window, openly, after a rule change; the build log says why. T24 hides instructions in chat; it has to be checked as a claim, not obeyed. `testset/` deliberately contains attack text aimed at the agent, not at you. These results describe Context Keeper's behaviour only; they're not a benchmark of Switch.
