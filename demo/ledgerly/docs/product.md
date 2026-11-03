# Ledgerly: product overview

Owner: Kash. Last updated 20 Oct 2026.

Ledgerly is invoicing and payment chasing for small agencies (2 to 30 people). It turns tracked time into invoices, chases late payers politely, and takes payment.

## §1 Invoices
- Create invoices from tracked time entries or line items.
- Recurring invoices: weekly, monthly or quarterly.
- Currencies: GBP, EUR and USD.
- **Editable templates:** every label on the invoice (such as "Invoice", "Due date" and "Total") can be renamed per client. There is no built-in translation.
- Each invoice is sent as a PDF and a secure link.

## §2 Payment reminders
- Automatic reminders at 3, 7 and 14 days overdue (each one can be switched off).
- Three tone presets: friendly, neutral and firm.
- Reminders can be paused per client (for example during a dispute).
- Shipped in v0.6 (12 Aug 2026).

## §3 Payments
- Card payments through Stripe.
- **Direct debit through GoCardless**, so agencies avoid card fees on large invoices.
- Partial payments, with the balance tracked on the invoice.

## §4 Integrations
- **Xero: CSV export only.** Live two-way sync is planned for phase 2 (see roadmap.md §1).
- Slack notification when an invoice is paid.

## §5 Client portal
- Each client gets a portal listing all their invoices.
- Clients can download PDFs and payment receipts, and update their billing contact.

## §6 Security
- Two-factor sign-in for all users.
- Data is stored in the UK (London region).
- SSO isn't available yet (see roadmap.md §1).

## §7 Deliberately not doing
- **A native mobile app.** The web app is fully responsive. Decided 9 Sep, because agencies invoice from a desk and two codebases would halve our speed (see `led-006`).
- **Crypto payments.** No customer has asked for them, and they add compliance work.
