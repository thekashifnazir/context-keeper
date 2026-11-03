# Demo content (invented)

Everything here is made up on purpose. The patterns come from two real situations Kash had, but no names, companies, dates or wording come from them.

Two rooms, so the score shows the agent isn't tied to one domain:

| Room | Story | Owner | The person without context |
|---|---|---|---|
| `#ledgerly-pilot` | A small invoicing startup is preparing a 2-week customer pilot. | Kash | **Rowan**, head of partnerships, back from 7 weeks' leave with lots of ideas, most of them already done or decided |
| `#riverside-build-night` | A first community build night, already planned, with a sponsor confirmed. | Kash | **Alex**, who joins the organisers' channel late and pushes for a weekend, a survey and a students-only event |

## Cast

| Name | Room | Role |
|---|---|---|
| Kash | both | Owner. Confirms decisions, gets clashes privately, approves ideas. |
| Priya | ledgerly | Engineer. Runs pilot support. |
| Sam | ledgerly | Designer. |
| Rowan | ledgerly | Head of partnerships. **The returner:** away 14 Sep to 3 Nov. |
| Dana | riverside | Venue host (co-working space). |
| Alex | riverside | **The late joiner:** joins 3 Nov. |

## Files

- `ledgerly/docs/`: the room's shared docs (product, pilot plan, roadmap, status, research). Sections are numbered so the agent can cite `product.md §2`.
- `ledgerly/chat-history.yaml`: the channel history before Rowan returns. Switch and Slack can't backdate messages, so it's loaded as a **"Channel archive" room document**. Message ids such as `led-007` are what the agent cites.
- `riverside/docs/event-plan.md` and `riverside/chat-history.yaml`: the same, for the event room.
- The test cases are in `../testset/cases.yaml`. They are the messages sent *after* the seeded history.

## Story clock

- The seeded history runs from 1 Sep to 3 Nov 2026.
- The demo "now" is Thu 5 Nov 2026.
- The Ledgerly pilot starts Tue 24 Nov. The Riverside build night is Thu 26 Nov.

None of these match any real event.
