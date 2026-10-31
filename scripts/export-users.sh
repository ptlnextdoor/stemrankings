#!/usr/bin/env bash
# Export every user + funnel stage to users.csv (gitignored). Needs a logged-in Supabase CLI.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/oxcnlommtnziwfbpxigd/database/query" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"query":"select email, display_name, signed_up_at::date, last_sign_in_at::date, stage, docs, saved, drafts, sent, plan, credits_cents, contacted_at::date, channel, notes from public.crm_users order by signed_up_at"}' \
| python3 -c '
import sys, json, csv
rows = json.load(sys.stdin)
w = csv.DictWriter(open("users.csv", "w", newline=""), fieldnames=list(rows[0].keys()) if rows else ["email"])
w.writeheader(); w.writerows(rows)
print(f"users.csv: {len(rows)} users")'
