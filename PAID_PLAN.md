# Paid plan: AI-drafted outreach emails ($10/month)

Status: **built except the AI key and payments.** Users can upload documents and build a profile; drafting
returns "not switched on yet" until an LLM key is set.

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

## Limits (enforced server-side)

| Plan | Generations per 24h |
|---|---|
| free | 3 |
| pro ($10/mo) | 40 |

Change in `supabase/functions/draft/index.ts` (`DAILY_LIMIT`). Profile builds count toward the limit.

## To switch drafting on

Set one secret (either works; Anthropic is used if both are set):

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
| 1 | Stripe Checkout + Customer Portal for the $10/mo price (test mode first) |
| 2 | Stripe webhook Edge Function that sets `profiles.plan` to `pro` / `free` (service role is the only writer) |
| 3 | Custom SMTP (e.g. Resend) for sign-in emails; Supabase's built-in sender allows ~2/hour |

## Still true from the earlier plan

- **Minors.** Block under-13 signups (COPPA). For 13 to 17, Stripe expects an adult account holder: plan a
  parent-pays flow.
- **Professor emails** are not in OpenAlex. Students get the address from the faculty page.
- **Accuracy.** The UI tells students to check every claim before sending. The model only sees the
  student's documents and the professor's real paper list, but it can still misread an abstract.

## Tests

```sh
SR=<service_role> ANON=<anon> node tests/rls.test.mjs        # accounts security (11 checks)
SR=... ANON=... node tests/outreach.test.mjs                  # docs/drafts security, function auth, cap (13; more with a key)
SR=... ANON=... PAGE=http://localhost:8000/ node tests/ui.test.mjs           # save-professor flow in Chrome (12)
SR=... ANON=... PAGE=... PDF=resume.pdf node tests/profile-ui.test.mjs       # profile panel + real PDF upload (9)
```
