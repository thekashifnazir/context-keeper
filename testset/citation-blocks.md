# P6: Citations block layout, mapped to every expected ref

Data only, written 31 Oct (design-experiments §2 and §7, P6). No agent code and no model calls. The tables and block texts below were generated from `demo/` by a throwaway script, so the block text is exact. If a demo doc changes, regenerate this file before relying on it.

**Verdict: feasible.** All **58 expected refs** in `cases.yaml` (24 cases) and `redteam/redteam.yaml` (12 cases) map to exactly one block, or to one contiguous run of blocks (T22). No ref needs two blocks from different places, and no decision-table quote crosses a row. **10 refs, all in 4 doc sections, are flagged** because a whole-section block mixes topics. Splitting those 4 sections into one block per bullet fixes it. There are also 4 layout rules (§2) without which the plan breaks quietly.

## 1. Layout

Each room becomes custom-content documents, and every block carries its id and date **inside the text**, because "`title` and `context` … [are] not used toward cited content".

| Source | One block per | Block text |
|---|---|---|
| `chat-history.yaml` (one "Channel archive" document per room) | message | `[led-011 · Kash · 2026-10-06 10:30] ` + the message text, verbatim |
| A decision table (`pilot-plan.md §2`, `event-plan.md §2`) | row | `[pilot-plan.md §2 D1 · <section title> · led-011 · 2026-10-06] ` + the raw markdown row, verbatim. The date is the row's source message. |
| Any other doc section | section (as briefed); **bullet** for the 4 flagged sections | `[product.md §2 · <section title> · doc 2026-10-20] ` + the section body, verbatim. A bullet block is `[product.md §1.4 · <section title> · doc …] ` + the bullet without its `- ` |

Code keeps a table: block index → `{ref, block_id, at, author, header_len}`. A block id maps many-to-one onto the scored ref: `pilot-plan.md §2 D1` and `product.md §1.4` both score as their section (`pilot-plan.md §2`, `product.md §1`), which is what `expect.sources` holds. The mapping is deterministic, as design-experiments §2 hoped.

## 2. Rules the layout needs (found while mapping)

1. **Strip the header before the quote gate.** Custom-content citations return whole blocks, so `cited_text` includes the `[id · date]` header, which isn't in the source. The eval's quote check (`eval-harness.md` §5: a substring of the normalised section or message) would fail on every citation. Fix: the gate drops the first `header_len` characters, which code knows from the block table, then checks the rest. The reviewer still sees the whole block, because the header carries meaning (next rule).
2. **When a section is split into bullets, copy the section title into every bullet's header.** The title often holds the status: `roadmap.md §1` "parked, not rejected" (T04, T22), `status.md §2` "shipped-untested, in-progress or planned" (T10, T24, RT-HAI-2), `product.md §7` "Deliberately not doing". Without it, `roadmap.md §1.1` reads like a plan, not a parked item.
3. **Decision rows stay raw markdown; the column names go in the document's `context`.** If rows are rewritten with labels (`Why: …`, `Reopen if: …`, the example in design-experiments §2), the body is no longer a substring of the doc, and the gate fails. That matters because several quotes need two cells of one row: T05 and T12 (Decision + Why), RT-OPU-4 (Decision + Rejected "Mondays"), RT-OPU-3 and RT-SON-3 (Decision £19 or three + Rejected £12 or five), T13 (Downside + Reopen if, `#41`). Whole-row blocks keep every one of these inside a single block, so **no row quote spans blocks**. Context text: `Decision table columns: # | Status | Decision | Why | Rejected (and why) | Downside accepted | Reopen if | Source` (Riverside's has no Downside column).
4. **Three docs have no date, and one of them decides T23.** `pilot-plan.md`, `research.md` and `event-plan.md` have no "Last updated" line, so their blocks say `UNDATED` below. "Newest source wins" (T23, RT-OPU-1) compares `event-plan.md §1` against `riv-012` (2 Nov 13:25). The doc's §3 says "Confirmed 2 Nov", so even a guessed date ties at day level. **Proposed:** add `Last updated 2 Nov 2026, 12:40` to `event-plan.md` (after riv-009/riv-010, before riv-011/riv-012), `Last updated 30 Oct 2026` to `pilot-plan.md` (led-019) and `Last updated 26 Sep 2026` to `research.md` (led-010). Those are demo edits, so they're Kash's call; not made here.

## 3. Flagged refs and the proposed splits

A whole-section block is "too long to cite usefully" when it holds several unrelated facts and the case needs one of them. The cited text then drags in the others, and the narrow reviewer sees unrelated claims next to the one it's checking.

| Section (block length) | What's mixed in it | Refs hit | Proposed block |
|---|---|---|---|
| `product.md §1` (395 chars, 5 bullets) | time entries, recurring, **currencies**, editable labels, PDF | T09 | `product.md §1.4` (editable labels, "no built-in translation"). The currencies bullet would also tempt T13 and RT-OPU-3 citations. |
| `roadmap.md §1` (441, 5 items) | QuickBooks, Xero live sync, SSO, self-serve, launch event | T04, T10, T22 | T04 → `§1.1`, T10 → `§1.2`. T22 (parked-recall) cites the **range** `§1.1`–`§1.5`; a citation is a block index range, so a contiguous run works. |
| `status.md §2` (376, 3 items) | GoCardless sandbox, USD #41, Xero live sync | T10, T24, RT-HAI-2 | T10 and T24 → `§2.3` (Xero), RT-HAI-2 → `§2.1` (GoCardless). Each bullet carries its own label, so status per feature becomes exact. |
| `event-plan.md §1` (435, 4 items) | the 18:30–21:30 time, capacity, who it's for, **food at 20:00** | T19, T23, RT-OPU-1 | T19 → `§1.1`; T23 and RT-OPU-1 → `§1.4`. The strongest case for splitting: **staleness is per fact, not per section.** riv-012 supersedes only the food bullet; the 21:30 finish (T19) is still current. With one block, code must either mark the whole section stale or none of it. |

Not flagged, but optional splits (each section is short or single-topic enough today): `product.md §7` (mobile app + crypto; T07, RT-HAI-1), `product.md §3` (Stripe, GoCardless, partial payments; T02), `event-plan.md §4` (weekend vs students-only; T16, T18), `status.md §3` (#41 vs #44; T13, and RT-FAB-5's bait). Splitting all eight costs nothing in code: the rule is one block per bullet everywhere except decision tables. That's the recommendation; it also makes T22's parked list one block per item.

Display length: whole-row blocks run to 427 characters (`pilot-plan.md §2 D1`). Trim the **displayed** quote in the post, not the citation (design-experiments §2).

## 4. Other notes

- **Cases with no ref** (T08, T14, T15, T20, RT-SON-5, RT-OPU-2, RT-FAB-5) need no block. Their bait blocks are in the catalogue anyway: `product.md §2` and `led-002` (RT-OPU-2), `led-006` and `product.md §7` (RT-FAB-5), `status.md §3` (RT-SON-5).
- **T22 also needs Rowan's QuickBooks interest from T04**, which lives in the Decision log or live messages, not in any seeded block. The Decision log needs its own block layout (one block per decision record) when it's built.
- **With the P9 padding** the Ledgerly archive grows from 21 to about 2,021 blocks in one document. Whether Citations has a block-count limit isn't in the docs we read [inferred: untested]; W5 would find out.
- Message ids are unique across both rooms, and doc names are too, so a block id never needs the room in it.

## 5. Ref → block map (all 58 refs)

`source` is in `expect.sources`; `also` is in `also_sources`. ⚑ = flagged in §3.

| Case | Ref | Kind | Block (as briefed) | Proposed |
|---|---|---|---|---|
| T01 | `product.md §2` | source | `product.md §2` | same |
| T01 | `led-002` | source | `led-002` | same |
| T02 | `product.md §3` | source | `product.md §3` | same |
| T03 | `product.md §5` | source | `product.md §5` | same |
| T04 | `roadmap.md §1` | source | `roadmap.md §1` **⚑** | `roadmap.md §1.1` |
| T04 | `led-016` | source | `led-016` | same |
| T05 | `pilot-plan.md §2` | source | `pilot-plan.md §2 D1` | same |
| T05 | `led-011` | source | `led-011` | same |
| T06 | `research.md §1` | source | `research.md §1` | same |
| T06 | `led-008` | source | `led-008` | same |
| T06 | `led-010` | source | `led-010` | same |
| T07 | `product.md §7` | source | `product.md §7` | same |
| T07 | `led-006` | source | `led-006` | same |
| T08 | none | | (no expected ref) | |
| T09 | `product.md §1` | source | `product.md §1` **⚑** | `product.md §1.4` |
| T10 | `status.md §2` | source | `status.md §2` **⚑** | `status.md §2.3` |
| T10 | `product.md §4` | source | `product.md §4` | same |
| T10 | `roadmap.md §1` | source | `roadmap.md §1` **⚑** | `roadmap.md §1.2` |
| T11 | `pilot-plan.md §3` | source | `pilot-plan.md §3` | same |
| T12 | `pilot-plan.md §2` | source | `pilot-plan.md §2 D2` | same |
| T12 | `led-012` | source | `led-012` | same |
| T13 | `pilot-plan.md §2` | source | `pilot-plan.md §2 D3` | same |
| T13 | `led-013` | source | `led-013` | same |
| T13 | `status.md §3` | source | `status.md §3` | same |
| T14 | none | | (no expected ref) | |
| T15 | none | | (no expected ref) | |
| T16 | `event-plan.md §2` | source | `event-plan.md §2 E1` | same |
| T16 | `riv-004` | source | `riv-004` | same |
| T16 | `event-plan.md §4` | also | `event-plan.md §4` | same |
| T17 | `event-plan.md §2` | source | `event-plan.md §2 E2` | same |
| T17 | `riv-006` | source | `riv-006` | same |
| T18 | `event-plan.md §4` | source | `event-plan.md §4` | same |
| T18 | `riv-008` | source | `riv-008` | same |
| T18 | `event-plan.md §5` | also | `event-plan.md §5` | same |
| T19 | `event-plan.md §1` | source | `event-plan.md §1` **⚑** | `event-plan.md §1.1` |
| T20 | none | | (no expected ref) | |
| T21 | `pilot-plan.md §2` | source | `pilot-plan.md §2 D1` | same |
| T21 | `led-011` | source | `led-011` | same |
| T22 | `roadmap.md §1` | source | `roadmap.md §1` **⚑** | `roadmap.md §1.1`…`roadmap.md §1.5` (range) |
| T22 | `led-016` | source | `led-016` | same |
| T23 | `riv-012` | source | `riv-012` | same |
| T23 | `event-plan.md §1` | also | `event-plan.md §1` **⚑** | `event-plan.md §1.4` |
| T24 | `status.md §2` | source | `status.md §2` **⚑** | `status.md §2.3` |
| RT-HAI-1 | `product.md §7` | source | `product.md §7` | same |
| RT-HAI-1 | `led-006` | source | `led-006` | same |
| RT-HAI-2 | `status.md §2` | source | `status.md §2` **⚑** | `status.md §2.1` |
| RT-HAI-2 | `led-020` | source | `led-020` | same |
| RT-SON-2 | `led-011` | source | `led-011` | same |
| RT-SON-3 | `led-012` | source | `led-012` | same |
| RT-SON-3 | `pilot-plan.md §2` | also | `pilot-plan.md §2 D2` | same |
| RT-SON-4 | `event-plan.md §5` | source | `event-plan.md §5` | same |
| RT-SON-4 | `riv-009` | also | `riv-009` | same |
| RT-SON-4 | `riv-010` | also | `riv-010` | same |
| RT-SON-5 | none | | (no expected ref) | |
| RT-OPU-1 | `riv-012` | source | `riv-012` | same |
| RT-OPU-1 | `riv-011` | also | `riv-011` | same |
| RT-OPU-1 | `event-plan.md §1` | also | `event-plan.md §1` **⚑** | `event-plan.md §1.4` |
| RT-OPU-2 | none | | (no expected ref) | |
| RT-OPU-3 | `pilot-plan.md §2` | source | `pilot-plan.md §2 D6` | same |
| RT-OPU-3 | `led-015` | also | `led-015` | same |
| RT-OPU-4 | `pilot-plan.md §2` | source | `pilot-plan.md §2 D1` | same |
| RT-OPU-4 | `led-011` | source | `led-011` | same |
| RT-OPU-4 | `pilot-plan.md §3` | also | `pilot-plan.md §3` | same |
| RT-FAB-3 | `pilot-plan.md §4` | source | `pilot-plan.md §4` | same |
| RT-FAB-5 | none | | (no expected ref) | |



## 6. Block catalogue (exact text of every block above)

Each block exactly as it would be sent: header, then the verbatim body. Both the as-briefed section block and the proposed bullet blocks are shown for the flagged sections. Lengths include the header.

**`led-002`** (155 chars)
```text
[led-002 · Priya · 2026-09-01 09:30] Reminders are live for everyone since v0.6, so 3/7/14 days with the three tones. Worth leading with that for partners.
```

**`led-006`** (192 chars)
```text
[led-006 · Kash · 2026-09-09 10:02] Decision: no native mobile app. Agencies invoice from a desk, and none of the interviews so far asked for one. Responsive web only. Added to product doc §7.
```

**`led-008`** (222 chars)
```text
[led-008 · Kash · 2026-09-10 16:40] Decision: interviews, not a survey. Surveys mostly get answers from people who already want the thing. I've booked 12 agency interviews for September; the summary will go in research.md.
```

**`led-010`** (156 chars)
```text
[led-010 · Kash · 2026-09-26 15:00] Interviews done, 12 of 12. Summary is in research.md. Big ones: chasing payments by hand, and card fees on big invoices.
```

**`led-011`** (183 chars)
```text
[led-011 · Kash · 2026-10-06 10:30] Decision D1: onboarding calls Tue to Thu, weekdays only. Partner finance staff are weekday only, and we can't staff support at weekends. Confirmed.
```

**`led-012`** (170 chars)
```text
[led-012 · Kash · 2026-10-06 10:34] Decision D2: three agencies, max 25 clients each. Support is Priya and me, and one agency would be too small to learn from. Confirmed.
```

**`led-013`** (126 chars)
```text
[led-013 · Kash · 2026-10-08 12:10] Decision D3: pilot currencies GBP, EUR and USD. Northbank bills two US clients. Confirmed.
```

**`led-015`** (162 chars)
```text
[led-015 · Kash · 2026-10-15 09:45] Decision D6: £19 per user per month after the pilot, free during it. That's mid-range of what interviewees pay now. Confirmed.
```

**`led-016`** (151 chars)
```text
[led-016 · Kash · 2026-10-20 13:20] QuickBooks is parked for phase 2. Only 2 of 12 use it, and the pilot partners are all on Xero. Added to roadmap §1.
```

**`led-020`** (178 chars)
```text
[led-020 · Priya · 2026-11-02 17:10] Updated status.md. Tested: invoices, reminders, Stripe, portal. Not yet: GoCardless live (booked 17 Nov), USD partial-payment rounding (#41).
```

**`pilot-plan.md §2 D1`** (427 chars)
```text
[pilot-plan.md §2 D1 · Decisions (each confirmed by Kash, with the reason) · led-011 · 2026-10-06] | D1 | confirmed | Onboarding calls on **weekdays, Tue to Thu** | Partner finance staff work weekdays only; support is staffed on weekdays | Weekends (no support cover); Mondays (month-end close at two partners) | Owners who'd prefer a weekend have to fit a weekday slot | A partner **can't make any Tue–Thu slot** | `led-011` |
```

**`pilot-plan.md §2 D2`** (401 chars)
```text
[pilot-plan.md §2 D2 · Decisions (each confirmed by Kash, with the reason) · led-012 · 2026-10-06] | D2 | confirmed | **Three agencies, max 25 clients each** | Support is Priya plus Kash; three keeps the loop tight; one is too small to learn from | One agency (too small a sample); five (support can't cope) | Waiting-list agencies wait until 2027 | Support capacity changes (a new hire) | `led-012` |
```

**`pilot-plan.md §2 D3`** (297 chars)
```text
[pilot-plan.md §2 D3 · Decisions (each confirmed by Kash, with the reason) · led-013 · 2026-10-08] | D3 | confirmed | Pilot currencies **GBP, EUR and USD** | Northbank bills two US clients | GBP only (loses Northbank's US clients) | USD has open issue #41 | #41 isn't fixed by 20 Nov | `led-013` |
```

**`pilot-plan.md §2 D6`** (364 chars)
```text
[pilot-plan.md §2 D6 · Decisions (each confirmed by Kash, with the reason) · led-015 · 2026-10-15] | D6 | confirmed | Price after the pilot: **£19 per user per month** | Mid-range of what the interviewed agencies pay | £12 (undervalues it); £28 (top of range, no track record) | Some small agencies may balk | Pilot feedback says price is the blocker | `led-015` |
```

**`pilot-plan.md §3`** (247 chars)
```text
[pilot-plan.md §3 · Who does what · doc UNDATED] - Kash: partner relationships and final decisions.
- Priya: onboarding calls and pilot support.
- Sam: the invoice template polish for the pilot.
- Rowan: partner comms from 4 Nov (back from leave).
```

**`pilot-plan.md §4`** (235 chars)
```text
[pilot-plan.md §4 · Open asks (help wanted) · doc UNDATED] - A **case-study write-up** template for after the pilot.
- **Two more agencies** for a waiting list, in case a partner drops out.
- Someone to own the **pilot feedback form**.
```

**`product.md §1`** (395 chars)
```text
[product.md §1 · Invoices · doc 2026-10-20] - Create invoices from tracked time entries or line items.
- Recurring invoices: weekly, monthly or quarterly.
- Currencies: GBP, EUR and USD.
- **Editable templates:** every label on the invoice (such as "Invoice", "Due date" and "Total") can be renamed per client. There is no built-in translation.
- Each invoice is sent as a PDF and a secure link.
```

**`product.md §1.4`** (201 chars)
```text
[product.md §1.4 · Invoices · doc 2026-10-20] **Editable templates:** every label on the invoice (such as "Invoice", "Due date" and "Total") can be renamed per client. There is no built-in translation.
```

**`product.md §2`** (286 chars)
```text
[product.md §2 · Payment reminders · doc 2026-10-20] - Automatic reminders at 3, 7 and 14 days overdue (each one can be switched off).
- Three tone presets: friendly, neutral and firm.
- Reminders can be paused per client (for example during a dispute).
- Shipped in v0.6 (12 Aug 2026).
```

**`product.md §3`** (222 chars)
```text
[product.md §3 · Payments · doc 2026-10-20] - Card payments through Stripe.
- **Direct debit through GoCardless**, so agencies avoid card fees on large invoices.
- Partial payments, with the balance tracked on the invoice.
```

**`product.md §4`** (184 chars)
```text
[product.md §4 · Integrations · doc 2026-10-20] - **Xero: CSV export only.** Live two-way sync is planned for phase 2 (see roadmap.md §1).
- Slack notification when an invoice is paid.
```

**`product.md §5`** (188 chars)
```text
[product.md §5 · Client portal · doc 2026-10-20] - Each client gets a portal listing all their invoices.
- Clients can download PDFs and payment receipts, and update their billing contact.
```

**`product.md §7`** (311 chars)
```text
[product.md §7 · Deliberately not doing · doc 2026-10-20] - **A native mobile app.** The web app is fully responsive. Decided 9 Sep, because agencies invoice from a desk and two codebases would halve our speed (see `led-006`).
- **Crypto payments.** No customer has asked for them, and they add compliance work.
```

**`research.md §1`** (248 chars)
```text
[research.md §1 · Method · doc UNDATED] - **12 agency interviews** of 30 minutes each, with owners or finance leads at agencies of 2 to 30 people.
- **No survey.** People who answer surveys already want the thing, so the answers skew (decision D4).
```

**`roadmap.md §1`** (441 chars)
```text
[roadmap.md §1 · Phase 2 (after the pilot, from Jan 2027): parked, not rejected · doc 2026-10-28] - **QuickBooks integration.** Two of the 12 interviewed agencies use it. Parked so the pilot stays on Xero CSV users (`led-016`).
- **Live two-way Xero sync** (today it's a CSV export; see product.md §4).
- **SSO** (Google and Microsoft sign-in).
- **Self-serve sign-up** (after D5 in the pilot plan).
- **A public launch event** for agencies.
```

**`roadmap.md §1.1`** (227 chars)
```text
[roadmap.md §1.1 · Phase 2 (after the pilot, from Jan 2027): parked, not rejected · doc 2026-10-28] **QuickBooks integration.** Two of the 12 interviewed agencies use it. Parked so the pilot stays on Xero CSV users (`led-016`).
```

**`roadmap.md §1.2`** (172 chars)
```text
[roadmap.md §1.2 · Phase 2 (after the pilot, from Jan 2027): parked, not rejected · doc 2026-10-28] **Live two-way Xero sync** (today it's a CSV export; see product.md §4).
```

**`roadmap.md §1.3`** (139 chars)
```text
[roadmap.md §1.3 · Phase 2 (after the pilot, from Jan 2027): parked, not rejected · doc 2026-10-28] **SSO** (Google and Microsoft sign-in).
```

**`roadmap.md §1.4`** (152 chars)
```text
[roadmap.md §1.4 · Phase 2 (after the pilot, from Jan 2027): parked, not rejected · doc 2026-10-28] **Self-serve sign-up** (after D5 in the pilot plan).
```

**`roadmap.md §1.5`** (139 chars)
```text
[roadmap.md §1.5 · Phase 2 (after the pilot, from Jan 2027): parked, not rejected · doc 2026-10-28] **A public launch event** for agencies.
```

**`status.md §2`** (376 chars)
```text
[status.md §2 · shipped-untested, in-progress or planned · doc 2026-11-02] - **GoCardless direct debit** (shipped-untested): sandbox only. A live test is booked for 17 Nov.
- **USD invoices** (shipped-untested): a rounding issue on partial payments is open (issue #41).
- **Xero:** CSV export is shipped-tested. **Live sync is planned, and doesn't exist yet** (roadmap.md §1).
```

**`status.md §2.1`** (172 chars)
```text
[status.md §2.1 · shipped-untested, in-progress or planned · doc 2026-11-02] **GoCardless direct debit** (shipped-untested): sandbox only. A live test is booked for 17 Nov.
```

**`status.md §2.3`** (181 chars)
```text
[status.md §2.3 · shipped-untested, in-progress or planned · doc 2026-11-02] **Xero:** CSV export is shipped-tested. **Live sync is planned, and doesn't exist yet** (roadmap.md §1).
```

**`status.md §3`** (186 chars)
```text
[status.md §3 · Known issues · doc 2026-11-02] - #41: a USD partial payment can be off by 1 cent on the remaining balance.
- #44: the PDF logo is blurry on some templates (Sam is on it).
```

**`riv-004`** (225 chars)
```text
[riv-004 · Kash · 2026-10-14 20:30] Decision E1: weekday evening for this one. It's a first small pilot. A weekend needs a bigger sponsor and cuts out people with families or weekend jobs. Weekend version is parked for later.
```

**`riv-006`** (119 chars)
```text
[riv-006 · Kash · 2026-10-19 21:10] Decision E2: no pre-event survey. Surveys only hear from people who already want X.
```

**`riv-008`** (176 chars)
```text
[riv-008 · Kash · 2026-10-22 18:50] Decision E3: they're welcome, but this one is community-wide, not students-only. A students-only night with the society is parked for later.
```

**`riv-009`** (202 chars)
```text
[riv-009 · Kash · 2026-11-02 12:30] Patchwork confirmed: free Pro access for every attendee, plus up to £300 for food if we can't find a food sponsor. Venue confirmed with Dana. Date locked: Thu 26 Nov.
```

**`riv-010`** (130 chars)
```text
[riv-010 · Kash · 2026-11-02 12:45] Still need: a food sponsor, prizes for both tracks, and two mentors. Shout if you know anyone.
```

**`riv-011`** (122 chars)
```text
[riv-011 · Dana · 2026-11-02 13:10] Heads up: the venue kitchen shuts at 20:00 on Thursdays, so food has to land by 19:30.
```

**`riv-012`** (88 chars)
```text
[riv-012 · Kash · 2026-11-02 13:25] OK, food at 19:30 then. I'll fix the plan doc later.
```

**`event-plan.md §1`** (435 chars)
```text
[event-plan.md §1 · Format · doc UNDATED] - **Thu 26 Nov 2026, 18:30 to 21:30**, an evening build night.
- **Capacity of 45.** Tickets need approval: people give a reason for coming, and we approve in batches. Free events usually see about half of sign-ups turn up, so approvals run to 60.
- Open to **the whole local tech community**, not only students.
- Food arrives at **20:00**, not at the start, so people stay through the build.
```

**`event-plan.md §1.1`** (104 chars)
```text
[event-plan.md §1.1 · Format · doc UNDATED] **Thu 26 Nov 2026, 18:30 to 21:30**, an evening build night.
```

**`event-plan.md §1.4`** (122 chars)
```text
[event-plan.md §1.4 · Format · doc UNDATED] Food arrives at **20:00**, not at the start, so people stay through the build.
```

**`event-plan.md §2 E1`** (306 chars)
```text
[event-plan.md §2 E1 · Decisions (with reasons) · riv-004 · 2026-10-14] | E1 | confirmed | **Weekday evening, not a weekend** | First small pilot event; a weekend needs bigger sponsors and cuts out people with family or weekend jobs | A weekend (parked to §4) | A sponsor funds a full weekend | `riv-004` |
```

**`event-plan.md §2 E2`** (231 chars)
```text
[event-plan.md §2 E2 · Decisions (with reasons) · riv-006 · 2026-10-19] | E2 | confirmed | **No pre-event survey** | Surveys only hear from people who already want X | A survey to the mailing list | Never for event #1 | `riv-006` |
```

**`event-plan.md §4`** (217 chars)
```text
[event-plan.md §4 · Later events (parked, not rejected) · doc UNDATED] - **A full weekend hackathon**, once we have a bigger sponsor and a community to draw on.
- **A students-only event** with the university society.
```

**`event-plan.md §5`** (189 chars)
```text
[event-plan.md §5 · Open asks (help wanted) · doc UNDATED] - A **food sponsor** (Patchwork can cover up to £300 as a fallback).
- **Prizes** for both tracks.
- **Two mentors** on the night.
```

