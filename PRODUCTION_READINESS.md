# Production readiness (needalab.com), 2026-11-01

Owner: Aayu. Status legend: ✅ done · 🟡 partial · ❌ missing. "Blocker" = fix before pushing real traffic.

## 1. Legal & trust (blockers: most users are minors, and money is involved)
- ❌ **Privacy policy + Terms of Service** pages. Required by Stripe, Google OAuth review, and app stores; must cover: data collected (resume text, saved list, drafts), processors (Supabase, Anthropic/Google AI, Resend, Stripe, OpenAlex/Serper), retention, deletion, ages 13+.
- ❌ **Self-serve account deletion + data export.** Currently only via admin API. Needed for COPPA/CCPA/GDPR requests.
- 🟡 **Minors.** Under-13 blocked ✅. 13–17 can buy with a card; Stripe ToS expects an adult account holder. Add "parent/guardian pays" flow or require 18+ for checkout.
- ❌ **AI disclosure + human-review nudge** on drafts is there ✅, but no anti-spam policy (limits per day, no bulk sends to the same professor).

## 2. Reliability
- 🟡 **Supabase free plan.** Pauses after inactivity (keep-alive cron ✅), no point-in-time backups, 500MB DB, shared compute (we already hit WORKER_RESOURCE_LIMIT once). Upgrade to Pro ($25/mo) before real traffic → daily backups, no pausing.
- 🟡 **Key expiry.** Anthropic key expires 2026-11-28; promo credit ends 2026-12-01 / 2027-01-21. Gemini fallback ✅. Need a non-expiring key + billing (adult account).
- ❌ **Error monitoring.** No Sentry/log alerts on edge functions or the frontend; failures are invisible unless a user complains.
- ❌ **Uptime alert** for needalab.com + the 4 edge functions.
- 🟡 **External rate limits.** OpenAlex free $1/day (shared), Serper 2,500 free then ~$1/1k, Gemini free tier. Per-user search caps ✅. No alert when a budget runs out.

## 3. Engineering process
- ❌ **CI.** Tests exist (rls, credits, age, outreach, tracker-ui, ui, profile-ui, find-email, rank) but only run by hand. Add a GitHub Action on PRs (needs SR/ANON as repo secrets, a test Supabase project ideally).
- ❌ **Staging environment.** Everything tests against the production DB and creates/deletes real auth users. Create a second Supabase project for tests.
- 🟡 **Deploys.** Site auto-deploys on push to main ✅; edge functions deploy by hand from a laptop. Add `supabase functions deploy` + `db push` to CI on main.
- 🟡 **Migrations.** SQL files exist ✅ but some were applied via the Management API by hand; `supabase migration list` drift is unknown.
- ❌ **Code quality pass.** thermo-nuclear / code-review / deslop review never completed. js/account.js is ~700 lines of template strings with inline handlers.

## 4. Product & analytics
- ❌ **Product analytics** (privacy-friendly, e.g. Plausible/PostHog): funnel signup → profile → search → save → draft → sent → paid. CRM view in DB ✅ covers accounts, not anonymous visitors.
- 🟡 **Onboarding.** Guided Get started built ✅ (on integration branch, not live).
- 🟡 **Professor emails.** Finder 26/30 correct ✅ (branch). Reply tracking ❌.
- ❌ **Pricing fit.** Monthly sub vs seasonal use; add one-time pack.
- ❌ **Favicon, OG image, 404 page, social preview.**

## 5. Performance & SEO
- ❌ **First load ~12MB** (rankings CSVs load on page open). Redesign branch lazy-loads them.
- 🟡 **SEO.** 43 topic pages + sitemap ✅ (branch). Submit sitemap to Google Search Console ❌.

## 6. Security
- ✅ RLS on all user tables, server-only credit writes, Stripe signature + replay check, age gate server-side, CRM view locked to service role.
- 🟡 Restricted Stripe key in use (OK). No secrets in git ✅.
- ❌ CSP / security headers (GitHub Pages can't set headers; consider Cloudflare in front, or move hosting to Cloudflare Pages).
- ❌ Abuse: magic-link signup has no CAPTCHA (Turnstile is free).

## Suggested order (2 weeks)
1. Privacy/Terms + account deletion + parent-pays/18+ checkout (blockers).
2. Supabase Pro + Sentry + uptime alert + non-expiring AI key.
3. Merge integration + redesign; lazy rankings; favicon/OG; submit sitemap.
4. Staging project + CI running the existing tests on every PR.
5. Analytics funnel, Turnstile, reply tracking, one-time credit pack.
