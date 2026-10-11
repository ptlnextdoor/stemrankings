#!/usr/bin/env bash
# Runs every live-system suite and fails if any check FAILs, a suite exits non-zero, OR a suite
# runs fewer checks than expected (catches a suite that crashes or stops early without printing FAIL).
# Works on macOS bash 3.2.
# Usage: SR=<service_role> ANON=<anon> WHS=<webhook test secret> PAGE=<site url> PDF=<resume.pdf> tests/run-all.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
bad=0; total=0
for spec in rls:11 outreach:13 credits:23 age:13 ui:12 profile-ui:11 tracker-ui:18 age-ui:9; do
  t=${spec%%:*}; want=${spec##*:}
  out=$(timeout 300 node "$here/$t.test.mjs" 2>&1); code=$?
  ok=$(printf '%s\n' "$out" | grep -c '^ok'); fail=$(printf '%s\n' "$out" | grep -c '^FAIL')
  total=$((total+ok)); status=pass
  if [ "$fail" -gt 0 ] || [ "$ok" -lt "$want" ] || [ "$code" -ne 0 ]; then status=FAIL; bad=1; fi
  printf '%-11s %2s/%-2s ok  exit=%s  %s\n' "$t" "$ok" "$want" "$code" "$status"
  if [ "$status" = FAIL ]; then printf '%s\n' "$out" | grep -E '^FAIL' | head -5; printf '%s\n' "$out" | tail -3; fi
done
for d in find professor; do
  if deno test "$here/../supabase/functions/$d/" 2>&1 | grep -qE '\| 0 failed'; then echo "unit $d     pass"; else echo "unit $d     FAIL"; bad=1; fi
done
echo "total live checks: $total; result: $([ $bad = 0 ] && echo PASS || echo FAIL)"
exit $bad
