# How Context Keeper's posts read

Kash, 4 Nov, after I9: the quote blocks "just don't really help … there must be a better way to
organize the text", and "what did those squiggles mean … product.md §5 … could you have links out to
some of those as well?". These are the rules every post follows now, and where they come from.

## What we can post

An agent posts one plain text body through Switch (`post_message`, `send_targeted_message`); there is
no way to pass Slack Block Kit blocks (checked in switch-core 0.31.0: both ops take `body: str`, and
the Slack adapter sends it as `text`). The Slack adapter converts Markdown: `**bold**` to `*bold*`,
`[label](url)` to `<url|label>`, `@handle` to a mention, `* ` bullets to `•`; `_italic_` and `> `
quotes pass through as Slack's own. Mattermost reads the same Markdown as it is. Switch gives agents
no permalink to a chat message (`read_context` entries carry id, sender, body and time only), so a
chat message can be named but not linked.

## The rules

1. **Lead with the answer, on one short line.** A bold label for what the post is (`📌 **In the
   record**`, `✅ **Approved by Kash**`) and the point after a ` · `. Job A's answer is one or two short
   sentences, no greeting.
2. **One idea per line.** Each further line carries one thing, led by a short bold label when it isn't
   obvious: `**Reopen if:**`, `**New part:**`, `**Builds on:**`, `**Also:**`, `**Next:**`, `**To do:**`.
3. **Quote only when the quote is the evidence, and keep it to one line.** Job A's cited quote (the
   quote gate is the product) is one italic line with its source after it, cut at a word with "…" when
   long. No multi-line `> ` blocks for people. The hand-off to Claude Code keeps `> ` quoting: there it
   marks chat text as data, not instructions.
4. **Name sources the way people know them, and link them.** A document section is its document's
   title and heading, not its file and § number: `Product overview › Client portal (20 Oct)`, a link to
   that heading when `CK_DOCS_BASE_URL` is set (the seeded docs are public in this repo, under
   `demo/<room>/docs/`). A decision row adds who decided: `Ledgerly pilot plan › Decisions (Kash, 6 Oct)`.
   A chat message is who said it and when: `Rowan, 4 Nov`. Never a message id or `led-015`. The trace
   keeps the raw refs (`product.md §5`, `led-015`) for scoring; the scorer counts the people-facing
   name as shown.
5. **No internal jargon.** No `§`, file names, ids, "owner desk" in public, "job A". The idea's
   number (`I9`) appears only where the owner uses it as a command.
6. **What needs someone to act comes first.** The call summary opens with a count ("1 to confirm, 1
   to follow up"), then "Needs confirming", "To follow up", and the topics asked about on one line,
   without "Rowan asked…" on each; empty sections are left out.
7. **A list item is a headline, not a paragraph.** Each catch-up brief line is a marker for its kind
   (✅ decided, 🔄 changed, ❓ open, 💬 who to talk to), a bold headline of a few words, at most one
   short follow-on sentence, and its source last. No greeting inside the list: the first line already
   says "Welcome back".
8. **Always say something back, briefly.** Someone else's chat in a sign-off thread gets one "noted"
   line; a second unclear sign-off reply gets "When you're happy with it, just say so and I'll close
   it." instead of silence. At most one extra line per person per idea.

## Before and after (job A, the I9 reply)

Before:

> 🔎 **Related** · Thanks, Rowan. Clients already have their own portal. It lists all their invoices and lets them download PDFs and payment receipts and update their billing contact, and it has been tested with real partner data.
> \> Each client gets a portal listing all their invoices. — product.md §5, 20 Oct · also status.md §1
> 💡 **Logged as a new idea** · a dark/light theme toggle for clients

After:

```
🔎 **Related** · Clients have their own portal: it lists their invoices, with PDF and receipt downloads.
_“Each client gets a portal listing all their invoices.”_ — [Product overview › Client portal](…/product.md#5-client-portal) (20 Oct)
**Also:** [Pilot readiness status › Shipped-tested](…/status.md#1-shipped-tested-tested-with-real-partner-data) (20 Oct)
💡 **Logged as a new idea** · a dark/light theme toggle for clients
```

## Sources

- Slack, [Designing with Block Kit](https://docs.slack.dev/block-kit/designing-with-block-kit/):
  "Use short, clear sentences and paragraphs"; avoid jargon; explain abbreviations; condense a message
  once the interaction is over.
- Slack, [Designing and formatting messages in Slack](https://slack.com/intl/en-ca/blog/collaboration/designing-and-formatting-messages-in-slack):
  "a combination of emoji and bolded titles can help break up the wall of text into digestible chunks";
  simple bullet points make "a clean, scannable list".
- Slack, [Formatting text for app surfaces](https://docs.slack.dev/messaging/formatting-message-text/):
  `<url|text>` links with your own text; `_italic_`; `>` quotes only the lines that start with it.
- Nielsen Norman Group, [F-Shaped Pattern of Reading on the Web](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/):
  readers scan the start of lines; "if users see only the first 2 words, they should still get the
  gist"; put the most important point first.
