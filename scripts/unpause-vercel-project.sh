#!/bin/bash
# Check + unpause the Vercel project, then poll the production deployment.
cd "$(dirname "$0")/.." || exit 1

TOKEN=""
for f in "$HOME/Library/Application Support/com.vercel.cli/auth.json" "$HOME/.config/vercel/auth.json" "$HOME/.local/share/com.vercel.cli/auth.json" "$HOME/.vercel/auth.json"; do
  if [ -f "$f" ]; then
    TOKEN=$(python3 -c "import json; print(json.load(open('$f')).get('token',''))" 2>/dev/null)
    [ -n "$TOKEN" ] && break
  fi
done
echo "token len: ${#TOKEN}"
if [ -z "$TOKEN" ]; then echo 'no token'; exit 1; fi

PROJ="prj_Tg9eRdHrAAu3TVYyFjlxiIQ3KPKr"
SUFFIX="${1:-md2h4wc9n-martin-mukoyas-projects}"

echo "--- project record (all keys) ---"
curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/$PROJ" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k in sorted(d.keys()):
    print(k + ':', json.dumps(d[k])[:200])
"

echo "--- unpause attempt ---"
curl -s -X POST -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/$PROJ/unpause" | head -c 500
echo
echo "--- re-query pause state after unpause ---"
curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/$PROJ" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k in ['id','name','pausedAt','updatedAt']:
    if k in d:
        print(k + ':', json.dumps(d[k])[:200])
"
