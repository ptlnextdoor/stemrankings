# Paid plan: credits for AI-drafted outreach emails ($10/month)

Status: **built and tested; switched off until keys are set.** Accounts, documents, profiles, credits, Stripe
checkout and the webhook are all deployed. Drafting needs an AI key; payments need Stripe keys.

## How it works

1. **My profile.** The student adds a resume (PDF or text), past projects, and a short bio. PDFs are read
   in the browser; only the extracted text is stored, in `user_docs`, readable only by its owner.
2. **Build profile.** The `draft` Edge Function condenses all documents into a 180-word factual profile
   (`profiles.profile_summary`). It is told never to invent facts or use "passionate"-style adjectives.
   Users can't edit this column directly, so the profile always comes from their actual documents.
3. **Draft email.** On "My list", each saved professor has "draft email". The function pulls the professor's
   4 most recent articles from OpenAlex (with abstracts), then writes a 90 to 140 word email that:
   names one specific paper and a concrete connection to the student's work, gives one piece of evidence,
   and makes one small ask. Subject under 9 words. A banned-phrase list (no "groundbreaking", "esteemed",
   "I hope this email finds you well", ...) is enforced; drafts that slip are regenerated once.
4. **Copy and send yourself.** Subject and body each have a copy button. Nothing is ever sent by the site,
   which avoids spam reputation, Gmail API review, and CAN-SPAM exposure.

## Credits

Students buy credits for themselves. The **$10/month plan grants $10.00 of credits** on every paid invoice
(first month and each renewal). Unused credits roll over and are kept if they cancel.
New accounts get **$1.00 free** to try it (a profile build plus 3 drafts).

| Action | Price | $10 buys |
|---|---|---|
| Build / rebuild profile | $0.10 | |
| Draft one email | $0.25 | ~40 drafts |

Raw model cost with Claude Haiku is about 1 cent per draft; the rest covers Stripe's fee (~$0.59 per $10),
OpenAlex lookups and free signup credit. Change prices in `supabase/functions/draft/index.ts` (`PRICE`) and
the monthly grant in `supabase/functions/stripe-webhook/index.ts` (`CREDITS_PER_PERIOD`).

How it's enforced (all server-side; users can't touch balances):
- Balance lives in `profiles.credits_cents`; every change is a row in `credit_ledger` that users can read but not write.
- `spend_credits` / `grant_credits` are database functions only the server can call.
- The draft function reserves credits **before** calling the model (so parallel clicks can't overspend) and
  refunds automatically if anything fails. Requests that can't run (no docs, no profile) are never charged.
- The Stripe webhook verifies Stripe's signature, rejects replays older than 5 minutes, and uses the invoice id
  as a unique key so Stripe's retries can't grant twice.

## To switch it all on

1. **AI drafting:** set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` (commands below).
2. **Payments:** in Stripe (test mode first), create a Product "STEMRankings Plan" with a $10/month recurring
   price, then:
   ```sh
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_ID=price_... --project-ref oxcnlommtnziwfbpxigd
   ```
   Add a webhook endpoint `https://oxcnlommtnziwfbpxigd.supabase.co/functions/v1/stripe-webhook` listening to
   `invoice.paid` and `customer.subscription.deleted`, and set its signing secret:
   ```sh
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref oxcnlommtnziwfbpxigd
   ```
   (A test secret is set now so the webhook could be verified; replace it with Stripe's.)
   Turn on the Customer Portal in Stripe settings so "Manage plan" works.

## Limits (enforced server-side)

Spending is limited only by credits. There is no separate daily cap.

## AI key commands

Either works; Anthropic is used if both are set:

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref oxcnlommtnziwfbpxigd
# or, free tier available:
supabase secrets set GEMINI_API_KEY=AIza... --project-ref oxcnlommtnziwfbpxigd
```

Cost estimate with Claude Haiku: roughly a fraction of a cent per draft, so 40/day for a pro user is
well under the $10 price.

## Still to build

| Step | What |
|---|---|
| 1 | Custom SMTP (e.g. Resend) for sign-in emails; Supabase's built-in sender allows ~2/hour |
| 2 | Optional one-time credit top-ups ($5 packs) for students who run out mid-month |

## Still true from the earlier plan

- **Minors.** Block under-13 signups (COPPA). For 13 to 17, Stripe expects an adult account holder: plan a
  parent-pays flow.
- **Professor emails** are not in OpenAlex. Students get the address from the faculty page.
- **Accuracy.** The UI tells students to check every claim before sending. The model only sees the
  student's documents and the professor's real paper list, but it can still misread an abstract.

## Tests

```sh
SR=<service_role> ANON=<anon> node tests/rls.test.mjs        # accounts security (11 checks)
SR=... ANON=... node tests/outreach.test.mjs                  # docs/drafts security, function auth (13; more with a key)
SR=... ANON=... WHS=<webhook secret> node tests/credits.test.mjs  # credits, Stripe webhook signatures, no overdraft (21)
SR=... ANON=... PAGE=http://localhost:8000/ node tests/ui.test.mjs           # save-professor flow in Chrome (12)
SR=... ANON=... PAGE=... PDF=resume.pdf node tests/profile-ui.test.mjs       # credits bar, plan button, profile panel + real PDF upload (11)
```
