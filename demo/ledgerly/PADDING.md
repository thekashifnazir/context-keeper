# Padding archive (experiment W5)

`padding.yaml` is about 2,000 off-topic chat messages, about 100k tokens, used once to test whether the agent stays accurate when the room's record is large (design-experiments §1, P9 and W5). It's **generated, not committed** (it's in `.gitignore`, at about 400 KB).

Make it:

```sh
python3 testset/make_padding.py
```

The generator uses a fixed seed, so every run writes the same file: 2,000 messages, `pad-0001` to `pad-2000`, 415,683 bytes, about 104k tokens at 4 characters per token. It prints the size each time. **Measured 1 Nov (PR16): sent as one cited block per message, the docs plus the padded archive come to about 178k input tokens**, because each block adds overhead.

What's in it:
- Small-team chatter between Kash, Priya and Sam (and Rowan, only before his leave starts on 14 Sep): lunch, the kettle, a broken build, the printer, holidays, the commute, design nitpicks, client and neighbour gossip, quiz night, pets and hobbies.
- Weekday office hours, 1 Sep to 3 Nov 2026, the same period as `chat-history.yaml`. About 60% are thread replies (`thread: pad-…`).
- Nothing a test case depends on. The generator's `BANNED` list (reminders, direct debit, Stripe, the portal, Xero, QuickBooks, apps, weekends and weekday names, onboarding, agencies, currencies, pricing, surveys, the launch, PDFs and logos, #41 and #44, Rowan's leave, and more) is checked against every template, every slot value and every generated message. One hit fails the run, so new templates can't slip a case topic in.

How W5 uses it: merge `messages` from `padding.yaml` into `chat-history.yaml`'s messages, sorted by `at`, and load the result as the Channel archive. The case ids (`led-…`) and the expected answers don't change. `testset/check_cases.py` doesn't read this file.
