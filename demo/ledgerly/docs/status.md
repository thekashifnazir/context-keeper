# Ledgerly: pilot readiness status

Owner: Priya. Last updated Mon 2 Nov 2026.

Labels: **shipped-tested**, **shipped-untested**, **in-progress**, **planned**, **not-planned**. Check the label before telling a partner something works.

## §1 shipped-tested (tested with real partner data)
- Invoices from time entries, and recurring invoices (product.md §1)
- Payment reminders, all three tones (product.md §2)
- Stripe card payments (product.md §3)
- The client portal (product.md §5)

## §2 shipped-untested, in-progress or planned
- **GoCardless direct debit** (shipped-untested): sandbox only. A live test is booked for 17 Nov.
- **USD invoices** (shipped-untested): a rounding issue on partial payments is open (issue #41).
- **Xero:** CSV export is shipped-tested. **Live sync is planned, and doesn't exist yet** (roadmap.md §1).

## §3 Known issues
- #41: a USD partial payment can be off by 1 cent on the remaining balance.
- #44: the PDF logo is blurry on some templates (Sam is on it).
