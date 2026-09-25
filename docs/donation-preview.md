# Unified donation form (preview)

First build, 2026-09-25. Review route: `/donate` (the form is at `/donate#give`).

One form for every gift to CfA, replacing the four WordPress Gravity Forms:
GF 97 "Please make your donation now" (main), GF 114 "Support Kairos Institute",
GF 5 "Donate-Authorize" (legacy) and GF 96 "Donations - Alumni". Campaigns, the
Kairos pages and alumni mailings link to this one form with a deep link instead
of keeping separate forms.

## What runs today (preview)

The page is fully clickable with no backend. Unless the build sets
`PUBLIC_DONATIONS_LIVE=true`, the form script never contacts `cfa-donate`, never
loads Authorize.Net or Turnstile, and submitting only simulates the result. A
banner reads "Preview – no payment is taken". The confirmation screens for a
one-time card gift, a monthly gift and a check pledge each show the exact email
the donor would receive, rendered by the same code the edge function uses.
Nothing is charged, saved or sent. (The site-wide first-party page-view tracker
still runs as on every page; the form fires no conversion events in preview.)

What the form does:

- Suggested amounts $35, $50, $100, $250, $500, $1,000, or another amount
  (minimum $5).
- One time, or monthly for 3, 6 or 12 months. Monthly gifts are card only.
- One designation, grouped: General Support (default, "where it is needed most"),
  Programs, Kairos Institute, Scholarship funds. Optional "anything more about
  the purpose" note and an optional "in honor of / in memory of" name.
- Donor name, email, optional phone, and mailing address (needed for the
  acknowledgment letter). Options: keep my gift anonymous, newsletter,
  information about a bequest or planned gift.
- Card through Authorize.Net's hosted AcceptUI window (same as the registration
  checkouts; no card fields on our page), or a check pledge that shows the
  mailing address: payable to Center for Anthroposophy, PO Box 15,
  McMinnville, TN 37111.
- An optional "cover the 3% processing fee" checkbox, off by default, showing
  the added amount. No mandatory surcharge line.
- A running summary with the total today and, for monthly, the whole schedule.

### Deep links

`/donate?fund=<slug>&amount=<dollars>&frequency=once|monthly&months=3|6|12&method=card|check`

Examples: `/donate?fund=kairos-scholarships#give`,
`/donate?fund=alumni&amount=100#give`, `/donate?fund=general-support&frequency=monthly&months=12#give`.
`frequency=monthly-6` also works. Unknown values are dropped. A link to a fund
that is inactive or unknown falls back to General Support and says so on the
page, so an old mailing never dead-ends. Slugs and aliases live in the fund list.

## File map

| File | What it is |
| --- | --- |
| `src/pages/donate.astro` | The appeal page. The old "Continue to the secure donation form" hand-off to GF 97 is replaced by the native form; designations list is generated from the fund list. |
| `src/components/DonationForm.astro` | The form, summary, preview simulation and (dormant) live AcceptUI/Turnstile wiring. |
| `supabase/functions/_shared/donationFunds.js` | The one fund list (page, form and server). `active` / `confirm` flags. |
| `supabase/functions/_shared/donationMath.js` | Amount parsing, fee, schedule, validation, deep-link parsing. Server and browser share it. |
| `supabase/functions/_shared/donationEmail.js` | Donor receipt, check pledge email, check receipt, staff notice (plain text). |
| `supabase/functions/cfa-donate/` | Edge function. **Not deployed.** |
| `supabase/migrations/20260925200000_unified_donations.sql` | `donations` table + check-received RPC. **Not applied.** |
| `test/donation.test.mjs` | Amount math, validation, deep links, fund list, email content. |
| `test/donationDatabase.test.mjs` | Migration in isolated PGlite: constraints, RLS/grants, check-received path. |

## The fund list, and what CfA must confirm

Active (offered on the form):

| Group | Fund | Slug | From |
| --- | --- | --- | --- |
| Where it is needed most | General Support | `general-support` (aliases `general`, `general-fund`, `alumni`) | GF 97, GF 5 "General Fund", GF 96 |
| Programs | Building Bridges | `building-bridges` | GF 97 |
| Programs | Explorations | `explorations` | GF 97 |
| Programs | Mentor Training | `mentor-training` | GF 97 |
| Programs | Renewal Courses | `renewal-courses` | GF 97 |
| Programs | Waldorf Leadership Development | `waldorf-leadership-development` | GF 97 |
| Kairos Institute | Kairos Institute (all the work we do: art therapy and traumatology training) | `kairos-institute` (alias `kairos`) | GF 97, GF 114 |
| Kairos Institute | Kairos Scholarships | `kairos-scholarships` | GF 114 |
| Scholarship funds | Diversity Scholarships | `diversity-scholarships` | GF 97 |
| Scholarship funds | Douglas Gerwin High School Teacher Education Scholarship Fund | `douglas-gerwin-scholarship` | GF 97 |
| Scholarship funds | Georg Locher Elementary Teacher Education Scholarship Fund | `georg-locher-scholarship` | GF 97 |

On record but **not offered until CfA confirms** (`active: false, confirm: true`),
all from the legacy GF 5 only:

- Creative Speech (`creative-speech`)
- Karine Munk Finser Renewal Scholarship Fund (`karine-munk-finser-renewal-scholarship`)
- Explorations International "Pay Forward" Fund (`explorations-pay-forward`)

Questions for CfA: is each GF 97/114 designation still current? Should any of
the three GF 5 funds come back? Are the groupings and the order right? GF 5 may
have had further purposes beyond those three; check the form before retiring it.

## Backend (staged, not live)

`cfa-donate` (deploy with `--no-verify-jwt`):

- **GET** returns active funds, amounts, limits and check instructions. Payment
  keys and the Turnstile site key are returned only when the live gate is open
  and the caller is the exact production origin.
- **POST** gift: exact-origin check (no wildcards; `DONATION_ORIGIN`, default
  `https://learn.centerforanthroposophy.org`), gate check, honeypot, idempotency
  key, server-side validation and amount math (browser totals are ignored),
  Turnstile (action `donation`, hostname pinned), rate limits (5 per email and 8
  per IP per 15 minutes). A card gift charges payment 1 with the opaque-data
  nonce (`createTransactionRequest`, 5-minute duplicate window); a monthly gift
  then builds a customer profile from that charge and an ARB subscription for
  the remaining N−1 months, starting one month out. Declines (response code 2)
  may retry; held or unknown results go to `needs_review` and the donor is told
  not to give again. A check pledge is recorded as `pledged` without charging.
  The donor gets a receipt (card) or a pledge thank-you (check, explicitly not a
  receipt); the office gets a staff notice.
- **POST with `X-Donation-Staff-Token`**: marks a check received (see below).

Live gate: nothing charges unless `DONATIONS_LIVE=true`, `AUTHORIZE_NET_ENVIRONMENT=production`,
the Authorize.Net credentials, `DONATION_RATE_LIMIT_SALT`, `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` are all set, and the request comes from `DONATION_ORIGIN`.

`donations` table: fund, note, frequency, months, method, `gift_cents`,
`fee_covered_cents`, `total_cents` (one charge), `schedule_total_cents`, status
(`processing` / `paid` / `pledged` / `check_received` / `failed` /
`needs_review`), donor fields and flags, tribute, Authorize.Net transaction,
profile and subscription ids, schedule status and dates, check number/date/amount,
and receipt, pledge-email and staff-notice timestamps. The database re-checks the
amount math (total = gift + fee; schedule = total × months; no fee on checks;
checks are one-time). RLS is on with no policies; anon and authenticated have no
access; only `service_role` reads and writes. No card data is stored.

### Donor acknowledgment

Card receipt and check receipt state the date, the amount, the fund, "No goods
or services were provided in exchange for this contribution.", CfA's 501(c)(3)
status and federal tax ID 04-3341510, and are signed "Center for Anthroposophy"
with the office email and phone. The check pledge email is a thank-you with
mailing instructions and says it is not a tax receipt.

### Marking a check received

When a pledged check (or any mailed check) arrives, staff call the function with
the staff token. The RPC `cfa_mark_donation_check_received` (service role only)
sets `check_received`, and the function sends the receipt and stamps
`receipt_sent_at`. Marking the same pledge again with the same number is a
no-op; a different number is refused.

```sh
# pledge made online
curl -X POST "$SUPABASE_FUNCTIONS_URL/cfa-donate" \
  -H "X-Donation-Staff-Token: $DONATION_STAFF_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"check_received","donation_id":"<uuid>","check_number":"1042","received_on":"2026-10-02","amount":"250"}'

# check that simply arrived in the mail (replaces GF 114's staff "check received" field)
curl -X POST "$SUPABASE_FUNCTIONS_URL/cfa-donate" \
  -H "X-Donation-Staff-Token: $DONATION_STAFF_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"check_received","check_number":"77","received_on":"2026-10-02","amount":"100",
       "donor":{"first_name":"…","last_name":"…","email":"…","fund":"kairos-scholarships",
                "address":{"address":"…","city":"…","state":"…","zip":"…","country":"US"}}}'
```

Add `"send_receipt": false` to record without emailing. A staff screen can
replace the curl later.

## Validation

```sh
export PATH=/home/sage/.nvm/versions/node/v22.23.1/bin:$PATH   # Node 22
node --test test/donation.test.mjs
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node --test test/donationDatabase.test.mjs
npx astro build
cd supabase/functions/cfa-donate && npx deno@2 check index.ts
```

The database test never contacts Supabase and skips without `PGLITE_MODULE`.

## Open decisions

1. **Fund list** (above): CfA confirms active funds, the three GF 5 funds, grouping.
2. **Receipt amount when the donor covers the fee.** Currently the receipt
   acknowledges the full amount paid and names the fee portion
   (`RECEIPT_INCLUDES_COVERED_FEE` in `donationEmail.js`). Confirm with CfA's
   accountant, or flip it to acknowledge the gift alone.
3. **Receipts for later monthly payments.** Payment 1 gets a receipt that lists
   the schedule. Later ARB charges do not email yet: choose a per-payment receipt
   (a sync job like `cfa-plan-sync`) or a year-end giving statement.
4. **Newsletter opt-in** is recorded and shown to the office; it is not yet
   pushed to Constant Contact.
5. **Where the form lives.** `DONATION_ORIGIN` defaults to
   `https://learn.centerforanthroposophy.org`; set it to the final domain.

## Activation checklist

1. Milan confirms the fund list and the open decisions above.
2. Apply `20260925200000_unified_donations.sql`; check RLS/grants in the dashboard.
3. Deploy: `supabase functions deploy cfa-donate --no-verify-jwt`.
4. Set secrets: `DONATION_ORIGIN`, `DONATION_RATE_LIMIT_SALT`, `DONATION_STAFF_TOKEN`
   (32+ random characters), `DONATION_NOTIFY_EMAILS` (default
   office@centerforanthroposophy.org), optionally `DONATION_FROM`. The
   Authorize.Net, SendGrid and Turnstile secrets are already project-wide.
5. Add the donate hostname to the Turnstile widget's allowed hostnames.
6. Add a `/donate` block to `public/_headers` with the `/register/*` CSP
   (Authorize.Net, Turnstile, analytics hosts).
7. Build with `PUBLIC_DONATIONS_LIVE=true` (Cloudflare Pages env, production only)
   and set `DONATIONS_LIVE=true`.
8. One controlled live test: set `DONATION_MIN_CENTS=100`, give $1 by card
   (and a 3-month $1 monthly gift), confirm the rows, emails and ARB schedule,
   void or refund in Authorize.Net, cancel the test subscription, then remove
   `DONATION_MIN_CENTS`. Also record and mark a test check pledge.
9. Repoint WordPress donate links (make-a-donation, Kairos, alumni) to the new
   form with deep links.
10. Retire GF 97, 114, 5 and 96 once the new form has taken real gifts.
