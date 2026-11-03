# Held-out cases (H01–H05)

Kash dictates these on **3 Nov, before 18:31 UK**, without reading the answers in `../cases.yaml`. Same fields as the main set (`../README.md`).

Rules:
- Write what a real teammate would say in either demo room, any job, including ones the agent should stay quiet on.
- Nobody tunes prompts against these. They're scored **once**, on day 5, after the last prompt change, and reported separately from the main 24.
- The README reports both numbers. If the held-out score is much lower, say so.

Template (copy into `holdout.yaml`):

```yaml
cases:
  - id: H01
    room: ledgerly-pilot        # or riverside-build-night
    at: 2026-11-05T10:00:00+00:00
    author: Priya
    message: "..."
    expect:
      job: A                    # A, B, D or none
      verdict: covered          # see ../check_cases.py VERDICTS
      sources: ["product.md §2"]
    note: "..."
```


