#!/usr/bin/env bash
# Turns on SAML company sign-in in the LOCAL e2e Supabase stack and connects a
# fake company login (BoxyHQ mock-saml) for the domain example.com.
# Run after `E2E_EDGE_RUNTIME=off npm run e2e:stack:up`. Local only: keys are
# made fresh in a temp folder and never leave this machine.
set -euo pipefail
cd "$(dirname "$0")/../.."
AUTH=supabase_auth_survey-e2e
WORK=$(mktemp -d)
SR=$(grep -o '^SUPABASE_SERVICE_ROLE_KEY=.*' .env.e2e | cut -d= -f2)

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/idp.key" -out "$WORK/idp.crt" -days 30 -subj "/CN=mock-idp" 2>/dev/null
openssl genpkey -algorithm RSA -out "$WORK/sp.pem" -quiet
openssl rsa -in "$WORK/sp.pem" -outform DER -traditional -out "$WORK/sp.der" 2>/dev/null

docker rm -f mock-saml >/dev/null 2>&1 || true
docker run -d --name mock-saml -p 4000:4000 \
  -e APP_URL=http://localhost:4000 -e ENTITY_ID=https://saml.example.com/entityid \
  -e PUBLIC_KEY="$(base64 -w0 "$WORK/idp.crt")" -e PRIVATE_KEY="$(base64 -w0 "$WORK/idp.key")" \
  boxyhq/mock-saml:latest >/dev/null

# Recreate the auth container with the same settings plus SAML.
IMG=$(docker inspect "$AUTH" --format '{{.Config.Image}}')
docker inspect "$AUTH" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -v '^$' | grep -v '^GOTRUE_SAML_' > "$WORK/auth.env"
echo "GOTRUE_SAML_ENABLED=true" >> "$WORK/auth.env"
echo "GOTRUE_SAML_PRIVATE_KEY=$(base64 -w0 "$WORK/sp.der")" >> "$WORK/auth.env"
docker rm -f "$AUTH" >/dev/null
docker run -d --name "$AUTH" --network supabase_network_survey-e2e --network-alias auth \
  --env-file "$WORK/auth.env" --restart unless-stopped "$IMG" auth >/dev/null

until curl -sf http://localhost:4000/api/saml/metadata -o "$WORK/idp.xml"; do sleep 1; done
until curl -sf http://127.0.0.1:54421/auth/v1/health -H "apikey: $SR" >/dev/null; do sleep 1; done

# Drop any provider from an earlier run: its metadata holds the old fake cert.
curl -sS http://127.0.0.1:54421/auth/v1/admin/sso/providers -H "apikey: $SR" -H "Authorization: Bearer $SR" \
  | python3 -c "import json,sys; [print(p['id']) for p in json.load(sys.stdin).get('items', [])]" \
  | while read -r id; do
      curl -sS -o /dev/null -X DELETE "http://127.0.0.1:54421/auth/v1/admin/sso/providers/$id" -H "apikey: $SR" -H "Authorization: Bearer $SR"
    done

# The auth container can't reach localhost:4000, so register by metadata XML.
python3 -c "import json,sys; print(json.dumps({'type':'saml','metadata_xml':open(sys.argv[1]).read(),'domains':['example.com']}))" "$WORK/idp.xml" > "$WORK/provider.json"
curl -sS -X POST http://127.0.0.1:54421/auth/v1/admin/sso/providers \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
  -d @"$WORK/provider.json" | python3 -c "import json,sys; d=json.load(sys.stdin); print('provider', d.get('id') or d)"
rm -rf "$WORK"
