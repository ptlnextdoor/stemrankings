#!/usr/bin/env bash
# Turn the Turnstile bot check on email sign-in on or off. Usage: scripts/captcha.sh on|off
# The site always sends a token (js/account.js); this only flips whether Supabase Auth requires it.
# Secret comes from the macOS keychain item "needalab-turnstile-secret" (Cloudflare widget "needalab signup").
set -euo pipefail
mode=${1:?usage: scripts/captcha.sh on|off}
T=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
if [ "$mode" = on ]; then
  S=$(security find-generic-password -s needalab-turnstile-secret -w)
  body=$(python3 -c 'import json,sys;print(json.dumps({"security_captcha_enabled":True,"security_captcha_provider":"turnstile","security_captcha_secret":sys.argv[1]}))' "$S")
else
  body='{"security_captcha_enabled":false}'
fi
curl -s -o /dev/null -w "captcha $mode: %{http_code}\n" -X PATCH "https://api.supabase.com/v1/projects/oxcnlommtnziwfbpxigd/config/auth" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "$body"
