# Facts

Every number the README, blog and video use, with the command that produced it. Rows are appended by
the eval (`npm run eval`), one run at a time, failures included; nobody edits them by hand.

| Claim | Value | Command | Commit | Timestamp |
|---|---|---|---|---|
| Eval overall, main set, r20261103-2159-0d74 (testset/results/2026-11-03-claude-opus-5-5.json) | 1/1 | `npm run eval -- --fast --only T05` | 3254dbe | 2026-11-03T22:01:47.424Z |
| Eval job A, main set, r20261103-2159-0d74 (testset/results/2026-11-03-claude-opus-5-5.json) | 1/1 | `npm run eval -- --fast --only T05` | 3254dbe | 2026-11-03T22:01:47.424Z |
| Eval confident wrong, main set, r20261103-2159-0d74 (testset/results/2026-11-03-claude-opus-5-5.json) | 0 | `npm run eval -- --fast --only T05` | 3254dbe | 2026-11-03T22:01:47.424Z |
| Eval citations verified, main set, r20261103-2159-0d74 (testset/results/2026-11-03-claude-opus-5-5.json) | 2/2 | `npm run eval -- --fast --only T05` | 3254dbe | 2026-11-03T22:01:47.424Z |
| Eval median seconds to a reply, main set, r20261103-2159-0d74 (testset/results/2026-11-03-claude-opus-5-5.json) | 38.3 (n=1) | `npm run eval -- --fast --only T05` | 3254dbe | 2026-11-03T22:01:47.424Z |
| Eval model spend in USD (est., prices as of 2026-10-06), main set, r20261103-2159-0d74 (testset/results/2026-11-03-claude-opus-5-5.json) | unknown model price | `npm run eval -- --fast --only T05` | 3254dbe | 2026-11-03T22:01:47.424Z |
| Eval overall, main set, r20261103-2217-f718 (testset/results/2026-11-03-claude-opus-5-5-2.json) | 12/13 | `npm run eval -- --only T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T16,T17,T18` | 1167bde | 2026-11-03T22:26:01.791Z |
| Eval job A, main set, r20261103-2217-f718 (testset/results/2026-11-03-claude-opus-5-5-2.json) | 12/13 | `npm run eval -- --only T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T16,T17,T18` | 1167bde | 2026-11-03T22:26:01.791Z |
| Eval confident wrong, main set, r20261103-2217-f718 (testset/results/2026-11-03-claude-opus-5-5-2.json) | 0 | `npm run eval -- --only T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T16,T17,T18` | 1167bde | 2026-11-03T22:26:01.791Z |
| Eval citations verified, main set, r20261103-2217-f718 (testset/results/2026-11-03-claude-opus-5-5-2.json) | 37/37 | `npm run eval -- --only T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T16,T17,T18` | 1167bde | 2026-11-03T22:26:01.791Z |
| Eval median seconds to a reply, main set, r20261103-2217-f718 (testset/results/2026-11-03-claude-opus-5-5-2.json) | 34.7 (n=13) | `npm run eval -- --only T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T16,T17,T18` | 1167bde | 2026-11-03T22:26:01.791Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261103-2217-f718 (testset/results/2026-11-03-claude-opus-5-5-2.json) | 0.7321 | `npm run eval -- --only T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T16,T17,T18` | 1167bde | 2026-11-03T22:26:01.791Z |
