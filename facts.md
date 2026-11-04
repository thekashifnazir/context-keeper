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
| Eval overall, main set, r20261103-2229-c929 (testset/results/2026-11-03-claude-opus-5-5-3.json) | 12/24 | `npm run eval --` | 25f648d | 2026-11-03T22:45:54.642Z |
| Eval job A, main set, r20261103-2229-c929 (testset/results/2026-11-03-claude-opus-5-5-3.json) | 10/17 | `npm run eval --` | 25f648d | 2026-11-03T22:45:54.642Z |
| Eval confident wrong, main set, r20261103-2229-c929 (testset/results/2026-11-03-claude-opus-5-5-3.json) | 0 | `npm run eval --` | 25f648d | 2026-11-03T22:45:54.642Z |
| Eval citations verified, main set, r20261103-2229-c929 (testset/results/2026-11-03-claude-opus-5-5-3.json) | 40/59 | `npm run eval --` | 25f648d | 2026-11-03T22:45:54.642Z |
| Eval median seconds to a reply, main set, r20261103-2229-c929 (testset/results/2026-11-03-claude-opus-5-5-3.json) | 33.3 (n=13) | `npm run eval --` | 25f648d | 2026-11-03T22:45:54.642Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261103-2229-c929 (testset/results/2026-11-03-claude-opus-5-5-3.json) | 1.5177 | `npm run eval --` | 25f648d | 2026-11-03T22:45:54.642Z |
| Eval overall, main set, r20261103-2250-ba41 (testset/results/2026-11-03-claude-opus-5-5-4.json) | 14/24 | `npm run eval --` | 019b2c9 | 2026-11-03T23:06:58.152Z |
| Eval job A, main set, r20261103-2250-ba41 (testset/results/2026-11-03-claude-opus-5-5-4.json) | 7/17 | `npm run eval --` | 019b2c9 | 2026-11-03T23:06:58.152Z |
| Eval confident wrong, main set, r20261103-2250-ba41 (testset/results/2026-11-03-claude-opus-5-5-4.json) | 0 | `npm run eval --` | 019b2c9 | 2026-11-03T23:06:58.152Z |
| Eval citations verified, main set, r20261103-2250-ba41 (testset/results/2026-11-03-claude-opus-5-5-4.json) | 48/66 | `npm run eval --` | 019b2c9 | 2026-11-03T23:06:58.152Z |
| Eval median seconds to a reply, main set, r20261103-2250-ba41 (testset/results/2026-11-03-claude-opus-5-5-4.json) | 34.2 (n=22) | `npm run eval --` | 019b2c9 | 2026-11-03T23:06:58.152Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261103-2250-ba41 (testset/results/2026-11-03-claude-opus-5-5-4.json) | 1.6587 | `npm run eval --` | 019b2c9 | 2026-11-03T23:06:58.152Z |
| Eval overall, main set, r20261103-2322-3342 (testset/results/2026-11-03-claude-opus-5-5-5.json) | 17/24 | `npm run eval --` | 092366f | 2026-11-03T23:39:12.943Z |
| Eval job A, main set, r20261103-2322-3342 (testset/results/2026-11-03-claude-opus-5-5-5.json) | 12/17 | `npm run eval --` | 092366f | 2026-11-03T23:39:12.943Z |
| Eval confident wrong, main set, r20261103-2322-3342 (testset/results/2026-11-03-claude-opus-5-5-5.json) | 0 | `npm run eval --` | 092366f | 2026-11-03T23:39:12.943Z |
| Eval citations verified, main set, r20261103-2322-3342 (testset/results/2026-11-03-claude-opus-5-5-5.json) | 59/79 | `npm run eval --` | 092366f | 2026-11-03T23:39:12.943Z |
| Eval median seconds to a reply, main set, r20261103-2322-3342 (testset/results/2026-11-03-claude-opus-5-5-5.json) | 34.1 (n=22) | `npm run eval --` | 092366f | 2026-11-03T23:39:12.943Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261103-2322-3342 (testset/results/2026-11-03-claude-opus-5-5-5.json) | 2.2575 | `npm run eval --` | 092366f | 2026-11-03T23:39:12.943Z |
| Eval overall, main set, r20261104-0022-ec96 (testset/results/2026-11-04-claude-opus-5-5-judge-coldstart.json; judge cold-start server) | 1/1 | `npm run eval -- --fast --only T05` | 6bfda53 | 2026-11-04T00:25:26.124Z |
| Eval job A, main set, r20261104-0022-ec96 (testset/results/2026-11-04-claude-opus-5-5-judge-coldstart.json; judge cold-start server) | 1/1 | `npm run eval -- --fast --only T05` | 6bfda53 | 2026-11-04T00:25:26.124Z |
| Eval confident wrong, main set, r20261104-0022-ec96 (testset/results/2026-11-04-claude-opus-5-5-judge-coldstart.json; judge cold-start server) | 0 | `npm run eval -- --fast --only T05` | 6bfda53 | 2026-11-04T00:25:26.124Z |
| Eval citations verified, main set, r20261104-0022-ec96 (testset/results/2026-11-04-claude-opus-5-5-judge-coldstart.json; judge cold-start server) | 2/2 | `npm run eval -- --fast --only T05` | 6bfda53 | 2026-11-04T00:25:26.124Z |
| Eval median seconds to a reply, main set, r20261104-0022-ec96 (testset/results/2026-11-04-claude-opus-5-5-judge-coldstart.json; judge cold-start server) | 51.5 (n=1) | `npm run eval -- --fast --only T05` | 6bfda53 | 2026-11-04T00:25:26.124Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-0022-ec96 (testset/results/2026-11-04-claude-opus-5-5-judge-coldstart.json; judge cold-start server) | 0.2116 | `npm run eval -- --fast --only T05` | 6bfda53 | 2026-11-04T00:25:26.124Z |
| Eval overall, main set, r20261104-0001-f83b (testset/results/2026-11-04-claude-opus-5-5.json) | 21/24 | `npm run eval --` | fe182f9 | 2026-11-04T00:18:16.655Z |
| Eval job A, main set, r20261104-0001-f83b (testset/results/2026-11-04-claude-opus-5-5.json) | 14/17 | `npm run eval --` | fe182f9 | 2026-11-04T00:18:16.655Z |
| Eval confident wrong, main set, r20261104-0001-f83b (testset/results/2026-11-04-claude-opus-5-5.json) | 0 | `npm run eval --` | fe182f9 | 2026-11-04T00:18:16.655Z |
| Eval citations verified, main set, r20261104-0001-f83b (testset/results/2026-11-04-claude-opus-5-5.json) | 55/75 | `npm run eval --` | fe182f9 | 2026-11-04T00:18:16.655Z |
| Eval median seconds to a reply, main set, r20261104-0001-f83b (testset/results/2026-11-04-claude-opus-5-5.json) | 34.4 (n=22) | `npm run eval --` | fe182f9 | 2026-11-04T00:18:16.655Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-0001-f83b (testset/results/2026-11-04-claude-opus-5-5.json) | 1.0794 | `npm run eval --` | fe182f9 | 2026-11-04T00:18:16.655Z |
| Eval overall, main set, r20261104-0025-a60f (testset/results/2026-11-04-claude-opus-5-5-2.json) | 23/24 | `npm run eval --` | 04e04d2 | 2026-11-04T00:40:09.613Z |
| Eval job A, main set, r20261104-0025-a60f (testset/results/2026-11-04-claude-opus-5-5-2.json) | 16/17 | `npm run eval --` | 04e04d2 | 2026-11-04T00:40:09.613Z |
| Eval confident wrong, main set, r20261104-0025-a60f (testset/results/2026-11-04-claude-opus-5-5-2.json) | 0 | `npm run eval --` | 04e04d2 | 2026-11-04T00:40:09.613Z |
| Eval citations verified, main set, r20261104-0025-a60f (testset/results/2026-11-04-claude-opus-5-5-2.json) | 59/77 | `npm run eval --` | 04e04d2 | 2026-11-04T00:40:09.613Z |
| Eval median seconds to a reply, main set, r20261104-0025-a60f (testset/results/2026-11-04-claude-opus-5-5-2.json) | 33.3 (n=22) | `npm run eval --` | 04e04d2 | 2026-11-04T00:40:09.613Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-0025-a60f (testset/results/2026-11-04-claude-opus-5-5-2.json) | 1.0910 | `npm run eval --` | 04e04d2 | 2026-11-04T00:40:09.613Z |
| Eval overall, main set, r20261104-0136-6a17 (testset/results/2026-11-04-claude-opus-5-5-3.json) | 22/24 | `npm run eval --` | 6a7f87c | 2026-11-04T01:53:30.429Z |
| Eval job A, main set, r20261104-0136-6a17 (testset/results/2026-11-04-claude-opus-5-5-3.json) | 15/17 | `npm run eval --` | 6a7f87c | 2026-11-04T01:53:30.429Z |
| Eval confident wrong, main set, r20261104-0136-6a17 (testset/results/2026-11-04-claude-opus-5-5-3.json) | 0 | `npm run eval --` | 6a7f87c | 2026-11-04T01:53:30.429Z |
| Eval citations verified, main set, r20261104-0136-6a17 (testset/results/2026-11-04-claude-opus-5-5-3.json) | 52/73 | `npm run eval --` | 6a7f87c | 2026-11-04T01:53:30.429Z |
| Eval median seconds to a reply, main set, r20261104-0136-6a17 (testset/results/2026-11-04-claude-opus-5-5-3.json) | 33.9 (n=21) | `npm run eval --` | 6a7f87c | 2026-11-04T01:53:30.429Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-0136-6a17 (testset/results/2026-11-04-claude-opus-5-5-3.json) | 1.0492 | `npm run eval --` | 6a7f87c | 2026-11-04T01:53:30.429Z |
| Eval overall, main set, r20261104-0057-2ee9 (testset/results/2026-11-04-claude-opus-5-5-memory-smoke.json) | 2/2 | `npm run eval -- --fast --only T05,T14` | 1ae171e | 2026-11-04T01:00:43.277Z |
| Eval job A, main set, r20261104-0057-2ee9 (testset/results/2026-11-04-claude-opus-5-5-memory-smoke.json) | 1/1 | `npm run eval -- --fast --only T05,T14` | 1ae171e | 2026-11-04T01:00:43.277Z |
| Eval confident wrong, main set, r20261104-0057-2ee9 (testset/results/2026-11-04-claude-opus-5-5-memory-smoke.json) | 0 | `npm run eval -- --fast --only T05,T14` | 1ae171e | 2026-11-04T01:00:43.277Z |
| Eval citations verified, main set, r20261104-0057-2ee9 (testset/results/2026-11-04-claude-opus-5-5-memory-smoke.json) | 2/7 | `npm run eval -- --fast --only T05,T14` | 1ae171e | 2026-11-04T01:00:43.277Z |
| Eval median seconds to a reply, main set, r20261104-0057-2ee9 (testset/results/2026-11-04-claude-opus-5-5-memory-smoke.json) | 30.2 (n=2) | `npm run eval -- --fast --only T05,T14` | 1ae171e | 2026-11-04T01:00:43.277Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-0057-2ee9 (testset/results/2026-11-04-claude-opus-5-5-memory-smoke.json) | 0.2374 | `npm run eval -- --fast --only T05,T14` | 1ae171e | 2026-11-04T01:00:43.277Z |
| Eval overall, main set, r20261104-0958-1bc7 (testset/results/2026-11-04-claude-opus-5-5-4.json) | 22/24 | `npm run eval --` | e0db9ec | 2026-11-04T10:15:40.867Z |
| Eval job A, main set, r20261104-0958-1bc7 (testset/results/2026-11-04-claude-opus-5-5-4.json) | 16/17 | `npm run eval --` | e0db9ec | 2026-11-04T10:15:40.867Z |
| Eval confident wrong, main set, r20261104-0958-1bc7 (testset/results/2026-11-04-claude-opus-5-5-4.json) | 0 | `npm run eval --` | e0db9ec | 2026-11-04T10:15:40.867Z |
| Eval citations verified, main set, r20261104-0958-1bc7 (testset/results/2026-11-04-claude-opus-5-5-4.json) | 55/71 | `npm run eval --` | e0db9ec | 2026-11-04T10:15:40.867Z |
| Eval median seconds to a reply, main set, r20261104-0958-1bc7 (testset/results/2026-11-04-claude-opus-5-5-4.json) | 33.8 (n=21) | `npm run eval --` | e0db9ec | 2026-11-04T10:15:40.867Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-0958-1bc7 (testset/results/2026-11-04-claude-opus-5-5-4.json) | 1.0623 | `npm run eval --` | e0db9ec | 2026-11-04T10:15:40.867Z |
| Eval overall, main set, r20261104-1119-1cbf (testset/results/2026-11-04-claude-opus-5-5-5.json) | 23/24 | `npm run eval --` | 79cb5de | 2026-11-04T11:34:39.640Z |
| Eval job A, main set, r20261104-1119-1cbf (testset/results/2026-11-04-claude-opus-5-5-5.json) | 16/17 | `npm run eval --` | 79cb5de | 2026-11-04T11:34:39.640Z |
| Eval confident wrong, main set, r20261104-1119-1cbf (testset/results/2026-11-04-claude-opus-5-5-5.json) | 0 | `npm run eval --` | 79cb5de | 2026-11-04T11:34:39.640Z |
| Eval citations verified, main set, r20261104-1119-1cbf (testset/results/2026-11-04-claude-opus-5-5-5.json) | 57/76 | `npm run eval --` | 79cb5de | 2026-11-04T11:34:39.640Z |
| Eval median seconds to a reply, main set, r20261104-1119-1cbf (testset/results/2026-11-04-claude-opus-5-5-5.json) | 35.9 (n=22) | `npm run eval --` | 79cb5de | 2026-11-04T11:34:39.640Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1119-1cbf (testset/results/2026-11-04-claude-opus-5-5-5.json) | 1.0599 | `npm run eval --` | 79cb5de | 2026-11-04T11:34:39.640Z |
| Eval overall, main set, r20261104-1300-3d3d (testset/results/2026-11-04-claude-opus-5-5-6.json) | 23/24 | `npm run eval --` | 15a6d66 | 2026-11-04T13:14:52.801Z |
| Eval job A, main set, r20261104-1300-3d3d (testset/results/2026-11-04-claude-opus-5-5-6.json) | 16/17 | `npm run eval --` | 15a6d66 | 2026-11-04T13:14:52.801Z |
| Eval confident wrong, main set, r20261104-1300-3d3d (testset/results/2026-11-04-claude-opus-5-5-6.json) | 0 | `npm run eval --` | 15a6d66 | 2026-11-04T13:14:52.801Z |
| Eval citations verified, main set, r20261104-1300-3d3d (testset/results/2026-11-04-claude-opus-5-5-6.json) | 55/74 | `npm run eval --` | 15a6d66 | 2026-11-04T13:14:52.801Z |
| Eval median seconds to a reply, main set, r20261104-1300-3d3d (testset/results/2026-11-04-claude-opus-5-5-6.json) | 33.2 (n=22) | `npm run eval --` | 15a6d66 | 2026-11-04T13:14:52.801Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1300-3d3d (testset/results/2026-11-04-claude-opus-5-5-6.json) | 0.9981 | `npm run eval --` | 15a6d66 | 2026-11-04T13:14:52.801Z |
| Eval overall, main set, r20261104-1358-797a (testset/results/2026-11-04-claude-opus-5-5-7.json) | 17/24 | `npm run eval --` | 96be554 | 2026-11-04T14:13:26.126Z |
| Eval job A, main set, r20261104-1358-797a (testset/results/2026-11-04-claude-opus-5-5-7.json) | 12/17 | `npm run eval --` | 96be554 | 2026-11-04T14:13:26.126Z |
| Eval confident wrong, main set, r20261104-1358-797a (testset/results/2026-11-04-claude-opus-5-5-7.json) | 0 | `npm run eval --` | 96be554 | 2026-11-04T14:13:26.126Z |
| Eval citations verified, main set, r20261104-1358-797a (testset/results/2026-11-04-claude-opus-5-5-7.json) | 44/58 | `npm run eval --` | 96be554 | 2026-11-04T14:13:26.126Z |
| Eval median seconds to a reply, main set, r20261104-1358-797a (testset/results/2026-11-04-claude-opus-5-5-7.json) | 34.7 (n=19) | `npm run eval --` | 96be554 | 2026-11-04T14:13:26.126Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1358-797a (testset/results/2026-11-04-claude-opus-5-5-7.json) | 1.0413 | `npm run eval --` | 96be554 | 2026-11-04T14:13:26.126Z |
| Eval overall, main set, r20261104-1414-d558 (testset/results/2026-11-04-claude-opus-5-5-8.json) | 17/24 | `npm run eval --` | d77599d | 2026-11-04T14:40:12.980Z |
| Eval job A, main set, r20261104-1414-d558 (testset/results/2026-11-04-claude-opus-5-5-8.json) | 13/17 | `npm run eval --` | d77599d | 2026-11-04T14:40:12.980Z |
| Eval confident wrong, main set, r20261104-1414-d558 (testset/results/2026-11-04-claude-opus-5-5-8.json) | 0 | `npm run eval --` | d77599d | 2026-11-04T14:40:12.980Z |
| Eval citations verified, main set, r20261104-1414-d558 (testset/results/2026-11-04-claude-opus-5-5-8.json) | 37/43 | `npm run eval --` | d77599d | 2026-11-04T14:40:12.980Z |
| Eval median seconds to a reply, main set, r20261104-1414-d558 (testset/results/2026-11-04-claude-opus-5-5-8.json) | 32.2 (n=16) | `npm run eval --` | d77599d | 2026-11-04T14:40:12.980Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1414-d558 (testset/results/2026-11-04-claude-opus-5-5-8.json) | 0.7304 | `npm run eval --` | d77599d | 2026-11-04T14:40:12.980Z |
| Eval overall, main set, r20261104-1441-8a40 (testset/results/2026-11-04-claude-opus-5-5-9.json) | 23/24 | `npm run eval --` | d63c6d3 | 2026-11-04T14:56:31.917Z |
| Eval job A, main set, r20261104-1441-8a40 (testset/results/2026-11-04-claude-opus-5-5-9.json) | 16/17 | `npm run eval --` | d63c6d3 | 2026-11-04T14:56:31.917Z |
| Eval confident wrong, main set, r20261104-1441-8a40 (testset/results/2026-11-04-claude-opus-5-5-9.json) | 0 | `npm run eval --` | d63c6d3 | 2026-11-04T14:56:31.917Z |
| Eval citations verified, main set, r20261104-1441-8a40 (testset/results/2026-11-04-claude-opus-5-5-9.json) | 55/71 | `npm run eval --` | d63c6d3 | 2026-11-04T14:56:31.917Z |
| Eval median seconds to a reply, main set, r20261104-1441-8a40 (testset/results/2026-11-04-claude-opus-5-5-9.json) | 34.1 (n=22) | `npm run eval --` | d63c6d3 | 2026-11-04T14:56:31.917Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1441-8a40 (testset/results/2026-11-04-claude-opus-5-5-9.json) | 1.0609 | `npm run eval --` | d63c6d3 | 2026-11-04T14:56:31.917Z |
| Eval overall, main set, r20261104-1534-eade (testset/results/2026-11-04-claude-opus-5-5-10.json) | 23/24 | `npm run eval --` | acc6222 | 2026-11-04T15:49:30.188Z |
| Eval job A, main set, r20261104-1534-eade (testset/results/2026-11-04-claude-opus-5-5-10.json) | 16/17 | `npm run eval --` | acc6222 | 2026-11-04T15:49:30.188Z |
| Eval confident wrong, main set, r20261104-1534-eade (testset/results/2026-11-04-claude-opus-5-5-10.json) | 0 | `npm run eval --` | acc6222 | 2026-11-04T15:49:30.188Z |
| Eval citations verified, main set, r20261104-1534-eade (testset/results/2026-11-04-claude-opus-5-5-10.json) | 56/72 | `npm run eval --` | acc6222 | 2026-11-04T15:49:30.188Z |
| Eval median seconds to a reply, main set, r20261104-1534-eade (testset/results/2026-11-04-claude-opus-5-5-10.json) | 34.9 (n=22) | `npm run eval --` | acc6222 | 2026-11-04T15:49:30.188Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1534-eade (testset/results/2026-11-04-claude-opus-5-5-10.json) | 1.0457 | `npm run eval --` | acc6222 | 2026-11-04T15:49:30.188Z |
| Eval overall, main set, r20261104-1706-f5ea (testset/results/2026-11-04-claude-opus-5-5-11.json) | 23/24 | `npm run eval --` | 5eb09e9 | 2026-11-04T17:16:58.161Z |
| Eval job A, main set, r20261104-1706-f5ea (testset/results/2026-11-04-claude-opus-5-5-11.json) | 16/17 | `npm run eval --` | 5eb09e9 | 2026-11-04T17:16:58.161Z |
| Eval confident wrong, main set, r20261104-1706-f5ea (testset/results/2026-11-04-claude-opus-5-5-11.json) | 0 | `npm run eval --` | 5eb09e9 | 2026-11-04T17:16:58.161Z |
| Eval citations verified, main set, r20261104-1706-f5ea (testset/results/2026-11-04-claude-opus-5-5-11.json) | 54/70 | `npm run eval --` | 5eb09e9 | 2026-11-04T17:16:58.161Z |
| Eval median seconds to a reply, main set, r20261104-1706-f5ea (testset/results/2026-11-04-claude-opus-5-5-11.json) | 16.1 (n=22) | `npm run eval --` | 5eb09e9 | 2026-11-04T17:16:58.161Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1706-f5ea (testset/results/2026-11-04-claude-opus-5-5-11.json) | 0.9561 | `npm run eval --` | 5eb09e9 | 2026-11-04T17:16:58.161Z |
| Eval overall, main set, r20261104-1826-08e4 (testset/results/2026-11-04-claude-opus-5-5-12.json) | 23/24 | `npm run eval --` | 6a673d5 | 2026-11-04T18:37:10.238Z |
| Eval job A, main set, r20261104-1826-08e4 (testset/results/2026-11-04-claude-opus-5-5-12.json) | 16/17 | `npm run eval --` | 6a673d5 | 2026-11-04T18:37:10.238Z |
| Eval confident wrong, main set, r20261104-1826-08e4 (testset/results/2026-11-04-claude-opus-5-5-12.json) | 0 | `npm run eval --` | 6a673d5 | 2026-11-04T18:37:10.238Z |
| Eval citations verified, main set, r20261104-1826-08e4 (testset/results/2026-11-04-claude-opus-5-5-12.json) | 54/73 | `npm run eval --` | 6a673d5 | 2026-11-04T18:37:10.238Z |
| Eval median seconds to a reply, main set, r20261104-1826-08e4 (testset/results/2026-11-04-claude-opus-5-5-12.json) | 15.5 (n=22) | `npm run eval --` | 6a673d5 | 2026-11-04T18:37:10.238Z |
| Eval model spend in USD (est. upper bound, prices as of 2026-10-06), main set, r20261104-1826-08e4 (testset/results/2026-11-04-claude-opus-5-5-12.json) | 0.9520 | `npm run eval --` | 6a673d5 | 2026-11-04T18:37:10.238Z |
| Robustness checks passed, r20261104-1906-01f3 (testset/results/2026-11-04-robustness-claude-opus-5-5.json) | 6/9 | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R1 Quote gate, r20261104-1906-01f3 | pass | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R2 Restart mid-burst, r20261104-1906-01f3 | fail | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R3 Own posts ignored, r20261104-1906-01f3 | pass | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R4 Fail quiet, r20261104-1906-01f3 | pass | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R5 Retract, r20261104-1906-01f3 | fail | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R6 Pending items survive, r20261104-1906-01f3 | pass | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R7a Caps → per-person demo limit, r20261104-1906-01f3 | pass | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R7b Caps → daily spend cap, r20261104-1906-01f3 | fail | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness R8 Missed while down, r20261104-1906-01f3 | pass | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
| Robustness model spend in USD (est., metered), r20261104-1906-01f3 | 0.4620 | `npm run eval -- --robustness` | a6c7820 | 2026-11-04T19:14:41.095Z |
