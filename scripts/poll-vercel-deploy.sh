#!/bin/bash
# Poll a specific Vercel deployment by URL-suffix until READY or ERROR.
cd "$(dirname "$0")/.." || exit 1

SUFFIX="${1:-md2h4wc9n-martin-mukoyas-projects}"

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 30
  STATE=$(vercel inspect "grn-fleet-system-${SUFFIX}.vercel.app" --json 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('readyState') or d.get('status') or 'unknown')
except Exception:
    print('parse-error')
")
  echo "check $i: $STATE"
  if [ "$STATE" = "READY" ] || [ "$STATE" = "ERROR" ]; then
    vercel inspect "grn-fleet-system-${SUFFIX}.vercel.app" --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('FINAL STATE:', d.get('readyState'))
print('URL: https://' + d.get('url', ''))
print('ALIAS:', d.get('alias'))
print('TARGET:', d.get('target'))
print('ERROR:', json.dumps(d.get('error'))[:500])
"
    exit 0
  fi
done
echo '--- still not ready after 7.5 minutes ---'
vercel inspect "grn-fleet-system-${SUFFIX}.vercel.app" --json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('state:', d.get('readyState'), 'error:', json.dumps(d.get('error'))[:300])
"
