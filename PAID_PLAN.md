# Paid plan design: "Reach out to professors" ($10/month)

Status: **not built**. Accounts and the `profiles.plan` column are live; this is the plan for the paid tier.

## What it does

A student picks professors from their saved list, writes (or AI-drafts) a personalized email per professor,
and sends from **their own Gmail account**. The site tracks sent/replied status.

## Hard requirements (do not skip)

1. **Send from the student's own email, never from ours.** Mass email from a shared domain to professors gets
   the domain blacklisted within days, and it's what CAN-SPAM and Gmail's bulk-sender rules target.
   Use Google OAuth with the `gmail.send` scope. Google requires an app verification review for that scope
   (expect weeks); until verified, up to 100 test users can use it.
2. **Personalized, not mass.** Each email must reference the professor's actual work. Cap sends
   (e.g. 20/day per student). Professors who get templated blasts mark them spam, which hurts the
   student's own Gmail reputation and, by extension, our name.
3. **Minors.** Many target users are under 18. COPPA applies under 13 (block under-13 signups). For 13 to 17,
   Stripe requires the account holder to be an adult or have consent; plan for a parent-pays flow.
4. **No scraped email addresses at scale.** OpenAlex does not provide emails. Options, in order of safety:
   student pastes the address from the professor's faculty page (we show a link to it); later, an
   opt-in directory. Bulk-scraping university directories breaks many universities' terms.

## Build order

| Step | What | Where |
|---|---|---|
| 1 | Stripe Checkout + Customer Portal, $10/mo price | Stripe dashboard (test mode first) |
| 2 | Webhook sets `profiles.plan = 'pro'` / back to `'free'` | Supabase Edge Function using the service_role key (only role allowed to change `plan`) |
| 3 | `outreach` table: user_id, author_name, to_email, subject, body, status, sent_at | migration with owner-only RLS, same pattern as `saved_professors` |
| 4 | Google OAuth (gmail.send) and a send Edge Function that checks `plan = 'pro'` and the daily cap server-side | Supabase Auth Google provider + Edge Function |
| 5 | Draft helper (optional): pulls the professor's 3 most recent OpenAlex papers into the composer | client-side, OpenAlex API is free |

## Cost

Supabase stays free until there's real load; at ~3 paying users, upgrade to Pro ($25/mo) and remove the keep-alive.
Stripe takes 2.9% + 30c per charge, about $0.59 on $10.

## Email deliverability for sign-in (fix before launch)

Supabase's built-in email sender is for testing: it only sends a couple of emails per hour.
Before real users arrive, add a custom SMTP provider in Supabase Auth settings (Resend's free tier is enough to start).
