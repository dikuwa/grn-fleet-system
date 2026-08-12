#!/bin/bash
# List recent deployments + project record via the Vercel REST API.
cd "$(dirname "$0")/.." || exit 1

TOKEN=""
for f in "$HOME/Library/Application Support/com.vercel.cli/auth.json" "$HOME/.config/vercel/auth.json" "$HOME/.local/share/com.vercel.cli/auth.json" "$HOME/.vercel/auth.json"; do
  if [ -f "$f" ]; then
    TOKEN=$(python3 -c "import json; print(json.load(open('$f')).get('token',''))" 2>/dev/null)
    [ -n "$TOKEN" ] && break
  fi
done
echo "token len: ${#TOKEN}"

echo "--- recent deployments (v6) ---"
curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v6/deployments?projectId=grn-fleet-system&limit=8" | python3 -c "
import json, sys
d = json.load(sys.stdin)
xs = d.get('deployments', [])
print('total returned:', len(xs))
for x in xs:
    meta = x.get('meta', {}) or {}
    sha = meta.get('githubCommitSha', 'cli/other')[:8]
    print(x.get('id', '?'), '|', x.get('readyState'), '|', x.get('target'), '|', sha, '|', x.get('url', ''))
"

echo "--- newest deployment full record ---"
curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v6/deployments?projectId=grn-fleet-system&limit=1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
xs = d.get('deployments', [])
if not xs:
    print('none')
else:
    x = xs[0]
    for k in sorted(x.keys()):
        v = json.dumps(x[k])[:200]
        print(k + ':', v)
"

echo "--- project record ---"
curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/grn-fleet-system" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for k in ['id','name','accountId','updatedAt','link']:
        if k in d:
            print(k + ':', json.dumps(d[k])[:300])
except Exception as e:
    print('project parse error', e)
"
