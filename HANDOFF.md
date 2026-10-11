# STEMRankings launch handoff (for the browser agent)

**Goal:** switch on AI email drafting and the $10/month credits plan for STEMRankings, then prove a real test payment adds $10 of credits.

**Site:** https://ptlnextdoor.github.io/stemrankings/
**Supabase project:** `stemrankings`, ref `oxcnlommtnziwfbpxigd`, org "Aayushya"
**GitHub repo:** github.com/ptlnextdoor/stemrankings

Everything is already built and deployed. This handoff is dashboard work only: create accounts or keys, paste them into Supabase, and click through one test purchase. No code changes.

---

## Ground rules

1. **Use Stripe TEST mode for everything** (the "Test mode" toggle at the top of the Stripe dashboard must be on; keys start with `sk_test_` / `pk_test_`). Do **not** activate live mode or enter real bank details. Going live is a separate decision for Aayu.
2. **Never paste secret keys into chat, notes, GitHub, or the website.** Secrets go only into the Supabase "Edge Function Secrets" page (Part 4). Record only the *names* of what you set.
3. **Don't change anything not listed here** (no deleting projects, no changing Supabase auth settings beyond Part 5, no editing GitHub).
4. If a step's screen doesn't match these instructions, stop and report what you see rather than guessing.

---

## Part 1. AI key (enables email drafting)

Pick **one**. Option A is preferred.

**Option A: Anthropic**
1. Go to https://console.anthropic.com and sign in.
2. Billing: make sure there's a payment method or at least $5 of credit (drafting costs about 1 cent per email).
3. API Keys → Create Key. Name it `stemrankings-drafts`.
4. Copy the key (starts with `sk-ant-`). You'll paste it in Part 4 as `ANTHROPIC_API_KEY`.
5. Optional: under Limits, set a monthly spend limit of $20 so a bug can't run up a bill.

**Option B: Google Gemini (free tier)**
1. Go to https://aistudio.google.com/apikey and sign in.
2. Create API key. Copy it (starts with `AIza`). You'll paste it in Part 4 as `GEMINI_API_KEY`.

---

## Part 2. Stripe product and price (TEST mode)

1. Go to https://dashboard.stripe.com and sign in. **Turn on Test mode.**
2. Product catalog → **Add product**:
   - Name: `STEMRankings Plan`
   - Description: `$10 of credits every month for AI-drafted professor outreach emails. Unused credits roll over.`
   - Pricing: **Recurring**, **$10.00 USD**, billing period **Monthly**.
   - Save.
3. Open the product, find the price, and copy the **Price ID** (starts with `price_`). Save it for Part 4 as `STRIPE_PRICE_ID`. This is not secret, but treat it carefully.
4. Developers → API keys: copy the **Secret key** (`sk_test_...`). Save it for Part 4 as `STRIPE_SECRET_KEY`.

## Part 3. Stripe webhook and customer portal (TEST mode)

**Webhook** (this is how Stripe tells the site a payment happened):
1. Developers → Webhooks (or Workbench → Webhooks) → **Add endpoint** / **Add destination**.
2. Endpoint URL, exactly:
   `https://oxcnlommtnziwfbpxigd.supabase.co/functions/v1/stripe-webhook`
3. Events to send, select exactly these two:
   - `invoice.paid`
   - `customer.subscription.deleted`
4. API version: leave the default (the site reads both old and new invoice formats).
5. Create it, then reveal and copy the **Signing secret** (`whsec_...`). Save it for Part 4 as `STRIPE_WEBHOOK_SECRET`.

**Customer portal** (lets students cancel or change their card):
1. Settings → Billing → **Customer portal** (in test mode).
2. Turn on: cancel subscriptions, update payment methods, view invoice history.
3. Business information: set a privacy policy and terms URL if required (use `https://ptlnextdoor.github.io/stemrankings/` for now). Save.

**Account name** (shown on the checkout page): Settings → Business details → set the public business name to `STEMRankings`.

## Part 4. Put the secrets into Supabase

1. Go to https://supabase.com/dashboard/project/oxcnlommtnziwfbpxigd/settings/functions
   (Project Settings → Edge Functions → Secrets).
2. Add or update these secrets. Names must match exactly:

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` **or** `GEMINI_API_KEY` | from Part 1 |
   | `STRIPE_SECRET_KEY` | `sk_test_...` from Part 2 |
   | `STRIPE_PRICE_ID` | `price_...` from Part 2 |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Part 3. **Replace** the existing value; the current one is a placeholder used for testing. |

3. Save. No redeploy is needed; functions pick up secrets on the next request (allow about a minute).

## Part 5. Sign-in emails (Resend, free tier)

Supabase's built-in email only sends about 2 sign-in emails per hour, which locks out real users.

1. Go to https://resend.com, sign up or sign in.
2. API Keys → Create API key, name `stemrankings-auth`, permission "Sending access". Copy it (`re_...`).
3. Without a custom domain, Resend can only send to the account owner's own email address. That's fine for testing. For real users, add a domain under Domains (requires DNS access; if Aayu doesn't own a domain, **skip and report**, don't buy one).
4. In Supabase: https://supabase.com/dashboard/project/oxcnlommtnziwfbpxigd/auth/smtp
   (Authentication → Emails → SMTP Settings) → Enable custom SMTP:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the `re_...` key
   - Sender email: `onboarding@resend.dev` (or `noreply@<verified domain>` if you verified one)
   - Sender name: `STEMRankings`
   - Save.
5. Authentication → Rate Limits: raise "emails sent per hour" to `30`.

## Part 6. End-to-end test (the actual acceptance check)

Do this in a normal browser window.

1. Open https://ptlnextdoor.github.io/stemrankings/
2. Enter Aayu's email in the sign-in box → **Sign in / Sign up**. Open the email and click the link. You land back on the site, signed in.
   - ✅ Top bar shows `$1.00 credits`.
3. **My profile** → choose "Resume" → upload a PDF resume (or paste a few lines of real experience) → **Add document** → **Build profile ($0.10)**.
   - ✅ A short factual profile appears. Balance shows `$0.90`.
   - Check: does it invent anything that isn't in the resume? Note it if so.
4. In the rankings table, expand any university (click ▶), click ☆ next to a professor to save them. Open **My list** → **draft email ($0.25)** on that professor.
   - ✅ A subject plus a 90 to 140 word body appears that names one of their real papers. Balance shows `$0.65`.
   - Copy the full draft into your report (quality check). Flag any flattery ("groundbreaking", "esteemed", "I hope this finds you well") or made-up facts.
   - Draft emails for 2 more professors in different fields and copy those too.
5. Click **Get $10/mo plan** → you're sent to Stripe Checkout (test mode banner visible).
   - Pay with test card `4242 4242 4242 4242`, any future expiry (e.g. 12/34), any CVC (123), any ZIP (12345).
   - ✅ You return to the site. Within about 30 seconds (refresh if needed) the balance rises by **$10.00** and the button changes to **Manage plan**.
6. In Stripe → Webhooks → your endpoint → **Event deliveries**: the `invoice.paid` delivery shows **200 OK**.
7. Click **Manage plan** → the Stripe portal opens. **Cancel** the subscription (cancel immediately if offered).
   - ✅ The webhook shows `customer.subscription.deleted` with 200. On the site, after refresh, the button returns to **Get $10/mo plan** and the **remaining credits are still there**.

## Part 7. Report back

Return a short report with:

- [ ] Which AI provider was set (Anthropic or Gemini), and the spend limit if any
- [ ] Names of the secrets set in Supabase (names only, never values)
- [ ] Stripe Product ID and Price ID (`prod_...`, `price_...`); these aren't secret
- [ ] Webhook endpoint ID (`we_...`) and the two events selected
- [ ] SMTP: done or skipped, plus whether a domain was verified
- [ ] Part 6 results: each ✅ passed or failed, with the balance seen at each step
- [ ] The 3 drafted emails, pasted in full, plus the generated profile text
- [ ] Any screen that didn't match these instructions, or any error message, verbatim

## If something goes wrong

| Symptom | Likely cause / fix |
|---|---|
| "Email drafting isn't switched on yet" | AI secret missing or misnamed in Part 4. Names are case-sensitive. |
| "LLM error: invalid x-api-key" | The Anthropic key was mistyped or revoked. Create a new one. The user is **not** charged when this happens. |
| "Payments aren't switched on yet" | `STRIPE_SECRET_KEY` or `STRIPE_PRICE_ID` missing. |
| Checkout works but credits don't arrive | Check the webhook's Event deliveries. **400 "bad signature"** means `STRIPE_WEBHOOK_SECRET` doesn't match this endpoint's signing secret (it must be the one from *this* endpoint, test mode). **503** means the secret isn't set. |
| "No such price" | `STRIPE_PRICE_ID` is from live mode or a different account. Use the test-mode price. |
| Sign-in email never arrives | Built-in sender hit its limit (Part 5 fixes it), or check spam. Without a verified domain, Resend only delivers to the Resend account owner's email. |
| "Couldn't find recent papers for this professor" | Normal for some names; try another professor. Not charged. |

## Not in scope (decide later with Aayu)

- Switching Stripe to **live** mode (needs business verification and bank details).
- Buying a domain.
- Age gating: block under-13 signups; for 13 to 17, Stripe expects an adult account holder, so plan a parent-pays flow before charging real users.
