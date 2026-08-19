#!/bin/bash
# usage: q.sh "SQL"  |  q.sh -f file.sql
export $(grep SUPABASE_ACCESS_TOKEN /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.env.test | xargs)
if [ "$1" == "-f" ]; then
  SQL=$(cat "$2")
else
  SQL="$1"
fi
TMPJSON=$(mktemp)
python3 -c "
import json,sys
sys.stdout.write(json.dumps({'query':sys.stdin.read()}))
" <<<"$SQL" > "$TMPJSON"
curl -s -X POST "https://api.supabase.com/v1/projects/cvamwtpsuvxvjdnotbeg/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMPJSON"
echo
rm -f "$TMPJSON"
