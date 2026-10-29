# Verification (STEMRankings)

Last full run: 2026-10-11, against the **live** site https://ptlnextdoor.github.io/stemrankings/ and the live Supabase project.

## Does the new work make the product better? (outcome eval)

`python3 tests/finder-eval.py`: for 6 real research topics, the professor finder's top 10 US results are
checked against OpenAlex directly ("relevant" = the professor has 2 or more of their own papers since 2023 on the topic).

| Topic | Relevant in top 10 | Findable in the original site at all |
|---|---|---|
| EEG brain computer interface | 10/10 | 4/10 |
| cold plasma wound healing | 9/10 | 0/10 |
| phage therapy antibiotic resistance | 10/10 | 2/10 |
| soft robotics actuators | 10/10 | 6/10 |
| CRISPR base editing | 10/10 | 1/10 |
| perovskite solar cells | 10/10 | 5/10 |
| **Total** | **59/60 (0.98)** | **18/60** |

So for a student who knows their interest, the finder returns verified-relevant, currently active labs, and 70% of
them were not reachable through the original institution-ranking view at all. The script fails if precision drops below 0.85.

## Requirements → checks (all live)

Run everything: `SR=... ANON=... WHS=... PAGE=https://ptlnextdoor.github.io/stemrankings/ PDF=resume.pdf tests/run-all.sh`.
The runner fails on any FAIL line, a non-zero exit, or a suite running fewer checks than expected (verified with a
deliberately truncated suite).

| Requirement | Suite | Checks |
|---|---|---|
| Accounts; users isolated; plan not self-upgradable | `rls` | 11/11 |
| Documents/drafts private; server-only writes; refund-safe | `outreach` | 13/13 |
| Credits: grant/spend server-only, no overdraft under concurrency, Stripe webhook signature/replay/idempotency, both invoice API shapes | `credits` | 23/23 |
| COPPA: birth year once, under-13 blocked in DB and functions | `age` | 13/13 |
| Save professors in browser, persist, remove | `ui` | 12/12 |
| Profile panel, real PDF upload and extraction, credits bar, plan button | `profile-ui` | 11/11 |
| Finder (signed out and in), professor panel, collaborator navigation, tracker statuses, auto follow-up, reminders, email/notes | `tracker-ui` | 18/18 |
| Age prompt UX, under-13 block persists, adults get full bar | `age-ui` | 9/9 |
| Finder ranking logic, professor summarizer, duplicate-paper collapse | Deno unit | 10/10 |
| Free project never pauses | keep-alive Action | daily runs: success (Oct 9, Oct 10) |

**Total: 110 live checks + 10 unit tests, all passing.**

## Not verified (blocked on Aayu)

| Item | Why |
|---|---|
| AI draft quality (profile + email text) | No valid AI key; all 5 keys on disk return 401. A real-path test with an invalid key confirmed charge → real Anthropic rejection → refund. |
| Real Stripe checkout and webhook | No Stripe keys. Webhook verified only with locally signed events (both API shapes). |
| research.kahlus.com | DNS record not added yet (`HANDOFF-DOMAIN.md`). |
| Sign-in email at scale | Built-in sender is ~2/hour until SMTP is set up (`HANDOFF.md` Part 5). |

## 2026-10-28: payments + AI switched on (test mode)
- Separate Stripe account "STEMRankings" (acct_1UVjdfALjjejnsSk), test mode. Product $10/mo, webhook, portal.
- Gemini 2.5 Flash key set; thinking disabled so drafts aren't truncated. outreach.test.mjs passes.
- End to end: signup ($1.00) → checkout → test card 4242 → redirect ?billing=success → webhook set plan=pro, credits 1100 (ledger: signup_bonus 100, subscription 1000).
- Going live: activate the STEMRankings Stripe account (adult owner, bank, SSN), then swap in live sk_/price_/whsec_ secrets.

## 2026-10-28: Stripe switched to LIVE
- Account acct_1UVjdfALjjejnsSk, charges enabled. Live price price_1UVk4AALjjejnsSkvvswyaJJ ($10/mo), webhook we_1UVk6sALjjejnsSkSdBEt6Rr, portal on.
- Key is a restricted rk_live_ key. Probe (no payment): billing checkout returned a cs_live_ session, portal returned a live session, customer created. Probe user deleted.
- Not yet proven live: webhook granting credits on a real invoice. First real $10 payment (or a refunded self-purchase) should be checked in credit_ledger.
- Gemini still on the shared free-tier key; paid key blocked (Google requires 18+ to create API keys).

## 2026-10-29: launch-ready pass
- Fixed: rankings faculty clicks open the in-site professor panel; email drafts no longer vanish on the list re-render; Gemini Flash overload falls back to Flash-Lite.
- AI: Claude Haiku 5.5 (thinking disabled, exact paper titles required), Gemini fallback. Anthropic key expires 2026-11-28.
- OpenAlex free key set ($1/day budget).
- Sign-in email: Supabase Auth SMTP via Resend from noreply@research.kahlus.com (domain verified, DKIM/SPF in Cloudflare). Real magic link delivered to Gmail inbox.
- Tests: rls 11/11, credits 8/8, age 13/13, outreach 17/17, tracker-ui 18/18, ui 12/12, profile-ui all ok (PDF upload, live Stripe checkout opens). Live-site Playwright flow: sign-in, panel, save, doc, build profile, draft all pass.

## 2026-10-29: needalab.com
- Bought needalab.com on Cloudflare Registrar ($10.46, expires 2027-10-29, auto-renew on, WHOIS privacy on).
- DNS: GitHub Pages A/AAAA on apex, www CNAME, all DNS-only. GitHub cert approved, HTTPS enforced; github.io and www redirect to https://needalab.com/.
- Supabase auth site_url + redirect allow-list moved to needalab.com; Stripe return URLs use needalab.com.
- Resend: needalab.com verified (DKIM, SPF, DMARC p=none). Sign-in email from "needalab" <noreply@needalab.com>, SPF/DKIM/DMARC pass, link redirects to needalab.com.
- Live flow on needalab.com: onboarding, panel buttons, profile gate, draft from panel signed with real name; search 98 labs; live Stripe checkout opens.
