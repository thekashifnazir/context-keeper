# Test set

24 messages with known answers (plus 5 held-out, see `holdout/`), scored against the agent. The score goes in the final README.

- `cases.yaml`: the cases. Each one is a message posted after the seeded history in `demo/<room>/chat-history.yaml`.
- `check_cases.py`: checks that every expected source actually exists in the demo content. Run `python3 testset/check_cases.py`.

## Fields

| Field | Meaning |
|---|---|
| `expect.job` | `A` (already covered?), `B` (decision capture), `D` (preference or constraint?), `none` (stay quiet) |
| `expect.verdict` | Job A: `covered` / `might-be-related` / `parked` / `new` / `contradicts-record` / `reopen` / `parked-recall`. Job B: `decision` |
| `expect.restriction` | Job D: `personal` / `project` / `not-a-restriction` |
| `expect.clashes_with` | Job D, for `project`: the decision it clashes with, which means it goes privately to the owner |
| `expect.sources` | What a correct reply cites: a doc section (`product.md §2`) or a seeded message id (`led-011`) |
| `burst` | Messages from one person within about 90 s. A burst gets **one** combined reply |
| `also_expect` | A side effect that isn't scored here, e.g. `returner_brief` (job C) |

## Mix

| Verdict | Cases |
|---|---|
| covered | 9 (T01, T02, T03, T05, T06, T07, T16, T17, T23) |
| parked | 2 (T04, T18) |
| new | 1 (T08) |
| might-be-related | 1 (T09) |
| contradicts-record | 2 (T10, T24) |
| decision (job B) | 1 (T14) |
| personal (job D) | 2 (T11, T19) |
| project (job D) | 2 (T12, T13) |
| stay quiet | 2 (T15, T20) |
| reopen (job A, routed to the owner) | 1 (T21) |
| parked-recall (job A) | 1 (T22) |

T23 tests a **stale source** (the plan doc says food at 20:00; the owner later moved it to 19:30 in riv-012). T24 tests **instructions hidden in chat** (it must be treated as a claim check, not obeyed). Five more **held-out** cases, H01–H05, are dictated blind by Kash and scored once at the end (`holdout/README.md`). Twelve **red-team** cases, written blind by 4 agents on 4 models, are scored the same way (`redteam/README.md`).

## Scoring (draft; fix it before the first run)

A case passes when all of these hold:
1. The agent picks the right job, including staying quiet for `none`.
2. The verdict or restriction matches.
3. For `covered`, `parked`, `contradicts-record`, `might-be-related`, `reopen` and `parked-recall`, **at least one** cited source is in `expect.sources`, its quote is in that source, and it's shown to people (in the public reply; for a case routed privately to the owner, the reply or the owner-desk post). `reopen` and `parked-recall` were added by Kash's scoring call of 3 Nov.
4. For `project` restrictions, the details go to the owner's private channel, not the public thread.

Reported numbers:
- **Job A accuracy** (T01–T10, T16–T18, T21–T24) and **job D accuracy** (T11–T13, T19).
- **Confident wrong** (must be **0**): the number of times the agent said `covered` when the expected verdict was `new` or `might-be-related`, or said `covered` without a citation. This is the trust rule in one number.
- **Quiet accuracy** (T15, T20).
- **Burst handling**: B1 and B2 each got one reply (yes/no).

## Why these cases

Each pattern from the problem has at least one case: asking for things that already exist (T01–T03, T07), the reason behind a decision (T05, T16), parked rather than rejected (T04, T18), bursts (B1, B2), claims against the record (T10), and a legitimate constraint from the right person (T13), so the agent can't just learn "the returner is always wrong".

## Headline number (for the video and README, creativity and impact)

From the cases, before any agent runs:
- **Rowan's 9 asks on his first day back** (T01–T08, T10): **8 already settled.** 6 were done or decided, 1 was parked for phase 2, and 1 was contradicted by the status doc. **1 was genuinely new** (T08, dark mode).
- **Alex's 3 suggestions** (T16–T18): all settled. 2 were decided, with reasons; 1 was parked.

The measured version comes from the eval run:
- **Owner replies saved:** the number of replies the agent posted that Kash would otherwise have typed.
- **Median time to a cited answer**, in seconds.
- Story line: "8 of Rowan's 9 ideas were already settled. Context Keeper answered all of them with sources in N seconds, and Kash typed nothing."

## Scoring calls settled (Kash, 31 Oct)
- (a) A `new` case passes only if the agent claims **nothing** as covered (logging and crediting it is checked separately via `must_mention`).
- (b) A `project` restriction passes only if it names the decision it clashes with (`clashes_with`) and goes privately to the owner (`routing`).
- (c) Saying "covered" on a quiet, B or D case **counts as confident wrong**.
- (d) (3 Nov) The citation rule (P3) also applies to `reopen` and `parked-recall`.
