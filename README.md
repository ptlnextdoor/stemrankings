# needalab

Live at **[needalab.com](https://needalab.com)**

**The Amazon of research.** The home page is just a list of schools and professors. Sign in and you can search, build a profile and draft emails to as many labs as you want, fast.

needalab helps high school and college students get into research. You type what you want to work on ("soft robotics", "CRISPR in plants"), and it shows professors who are actively publishing on it right now. Save the ones you like, and it writes a short, personal cold email to each one based on their actual recent papers and your resume.

It started as a copy of [CSRankings](https://csrankings.org) stretched to cover all of STEM, which is why the home page still has the university rankings table.

## What works today

**Finding professors (free)**
- Search by research topic. One search scans the 200 most relevant recent papers and returns up to 100 labs, ranked by how recent and how senior their work is.
- Click any professor to see their recent papers, topics, h-index and frequent co-authors.
- University rankings table across 49 STEM areas, same math as CSRankings.
- 43 topic pages (like `/topics/soft-robotics/`) so people can find the site on Google.

**Accounts**
- Sign in with Google or an email link. You must be 13 or older.
- Short setup: your name, birth year, then a guided "get started" that turns your resume into a profile and picks your first 5 professors.

**Outreach**
- "My list": save professors and track each one (saved, drafted, sent, replied).
- AI email drafts ($0.25 each). The email quotes one real paper by the professor, describes you accurately (it never calls a high schooler an undergrad), and is signed with your name. If anything fails you aren't charged.
- Find a professor's email address (free, 30 lookups a day). It checks ORCID, their papers and their faculty page. Guesses are shown as guesses and never saved for you.
- Send from your own Gmail. Built, but hidden until Google approves it (preview with `?gmail=1`).

**Money**
- New accounts get $1 of free credit. The $10/month plan adds $10 of credit each month. Payments run through Stripe, and you can cancel anytime in the billing portal.

**Owner tools**
- `/admin/` (owner account only): users and where each one is in the funnel, a balance sheet (money in from Stripe, cost to serve free vs paid users), the last 14 days, and every roast.
- "Roast a feature" form in the site footer, open to anyone, 5 a day per person.

**Limits that keep costs near zero**
- Signed out: 10 new searches a day. Free account: 30. Paid: unlimited.
- Searches, professor pages and papers are cached so repeat lookups cost nothing.

## How it's built

Everything runs on free tiers except the domain ($10/year).

| Part | What it is |
|---|---|
| Website | Plain HTML, CSS and JavaScript, hosted free on GitHub Pages |
| Backend | [Supabase](https://supabase.com): database, sign-in, and small server functions |
| Research data | [OpenAlex](https://openalex.org), a free open database of every published paper |
| AI drafts | Claude Haiku, with Google Gemini as a backup |
| Payments | Stripe |
| Email sending | Resend (sign-in emails from noreply@needalab.com) |

### Where things live

```
index.html            the whole app (one page)
js/account.js         sign-in, search, My list, drafts, billing
js/stemrankings.js    the rankings table
css/                  styles (original CSRankings look, kept on purpose)
topics/               the 43 Google-friendly topic pages
privacy/  terms/      legal pages
data/                 rankings data (built by pipeline/build.py)
supabase/functions/   server code: draft, find, professor, find-email, gmail, billing, stripe-webhook, portal
supabase/migrations/  database tables and security rules
admin/                owner portal (users, balance sheet, roasts)
tests/                end-to-end tests that drive a real browser against the real backend
scripts/              owner tools (export the user list)
```

### Security in one paragraph

Every user table is locked so people can only read their own rows. Credits can only change on the server, and every charge is reserved before the AI runs and refunded if it fails. Stripe webhooks are signature checked and can't be replayed. The age check runs on the server, not just in the browser. Gmail access tokens are encrypted in the database. No secrets are in this repo.

## Running the tests

```bash
SR=<service key> ANON=<anon key> WHS=<stripe webhook test secret> PAGE=http://localhost:8765/ tests/run-all.sh
deno test supabase/functions/        # unit tests, no keys needed
```

The browser tests create throwaway users and delete them afterwards. Right now they run against the live backend, which is a known gap (see below).

## Branches and pull requests

| Branch | Status |
|---|---|
| `main` | What's live. Every push deploys the site. |

Every feature branch has been merged and deleted. A rejected redesign is saved as the tag `archive/ui-redesign`. New work goes on its own branch and ships through a pull request. The PR template lists what each one has to pass before merging.

## What's next

In rough priority order. Details in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

1. **Confirm the first real payment** adds credits end to end.
2. **Delete my account / download my data** buttons (needed for privacy laws).
3. **Under-18 payments**: have a parent pay, since Stripe expects an adult cardholder.
4. **A separate test database**, so tests stop touching the live one, and running tests automatically on every PR.
5. **Error alerts** so failures don't stay invisible until someone complains.
6. **Bot protection** on sign-up (Cloudflare Turnstile, free).
7. **Google approval for Gmail sending**, then turn it on for everyone.
8. **Replace the AI key** that expires Nov 28.
9. Simple, privacy-friendly analytics to see where people drop off.

## Our data

The rankings and professor data are our own, built from open sources we are allowed to use commercially.

- **Where it comes from:** [OpenAlex](https://openalex.org), a free open catalog of the world's research papers, released under CC0 (public domain). For each of our 49 STEM areas we pull recent papers (last 10 years), and we credit each author a share of every paper they are on (a paper with k authors gives each author 1/k, the CSRankings "adjusted count" idea). Last-author papers are tracked separately as a seniority signal. We may later add [DBLP](https://dblp.org) (also CC0) to fill in homepages and stable author ids for computer scientists.
- **What we store:** our own Supabase tables (`institutions`, `people`, `venues`, `person_area_year`, `areas`), keyed by OpenAlex ids. People are keyed by author id, not name, so two different people who share a name stay separate. `pipeline/ingest.py` writes these tables; `pipeline/export.py` regenerates the site CSVs in `data/` from them, so the home page keeps working unchanged.
- **Refresh:** a GitHub Action (`.github/workflows/data-refresh.yml`) runs weekly and on demand. It only commits new CSVs when the row counts stay within 20% of the last run, so a broken pull can never wipe the rankings.
- **What we do not use:** we do not import any files from the CSRankings repository. Their data is licensed CC BY-NC-ND (no commercial use), and we charge money. We use only CC0 sources. The ranking *method* (adjusted count) is credited to CSRankings by Emery Berger.

## Other docs

- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md): full launch checklist
- [PAID_PLAN.md](PAID_PLAN.md): how credits and the plan work
- [GMAIL_VERIFICATION.md](GMAIL_VERIFICATION.md), [GMAIL_DEMO_VIDEO.md](GMAIL_DEMO_VIDEO.md): Google approval for Gmail sending
- [VERIFICATION.md](VERIFICATION.md): how features were checked

Rankings data is from OpenAlex (CC0). Ranking method is from CSRankings by Emery Berger.
