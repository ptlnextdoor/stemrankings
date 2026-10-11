# Put STEMRankings on a kahlus.com subdomain (for the browser agent)

**Goal:** serve the site at `research.kahlus.com` without touching anything on `kahlus.com` or `www.kahlus.com`.

**Facts (checked 2026-10-11):** kahlus.com DNS is on **Cloudflare** (nameservers anton/jewel.ns.cloudflare.com).
The root and `www` point to Vercel (76.76.21.21). Email uses **Purelymail** (MX + SPF). **Do not edit or delete any existing record.**
Only **add** the records below.

## Step 1. Cloudflare DNS (add one record)

dash.cloudflare.com → kahlus.com → DNS → Records → **Add record**:

| Type | Name | Target | Proxy status | TTL |
|---|---|---|---|---|
| CNAME | `research` | `ptlnextdoor.github.io` | **DNS only (grey cloud)** | Auto |

The cloud must be **grey (DNS only)**. With an orange cloud, GitHub can't issue the HTTPS certificate.

## Step 2. GitHub Pages custom domain

github.com/ptlnextdoor/stemrankings → Settings → Pages → Custom domain → enter `research.kahlus.com` → Save.
Wait until the DNS check passes (a few minutes), then tick **Enforce HTTPS** (it can take up to ~30 minutes to become clickable).

## Step 3. Tell Aayu's coding agent "domain is live"

The agent will update the sign-in redirect URLs in Supabase and the Stripe checkout return URLs to the new address,
then rerun the end-to-end tests. Don't change those by hand.

## Step 4 (optional, enables sign-in emails to everyone). Resend domain

resend.com → Domains → Add domain → `research.kahlus.com` (a subdomain keeps Purelymail on the root untouched).
Resend shows 3 to 4 records (MX, TXT/SPF, TXT/DKIM, maybe DMARC). Add each one in Cloudflare exactly as shown,
**all DNS only (grey)**. They're on `send.research` / `resend._domainkey.research` style names, so they won't collide
with the root's Purelymail MX/SPF. Click Verify in Resend. Report the sending address (e.g. `noreply@research.kahlus.com`).

## Report back
- [ ] CNAME added (screenshot of the record row)
- [ ] GitHub Pages shows "DNS check successful" and HTTPS enforced
- [ ] https://research.kahlus.com loads the rankings page
- [ ] https://kahlus.com and https://www.kahlus.com still load exactly as before
- [ ] Resend domain verified, or skipped
