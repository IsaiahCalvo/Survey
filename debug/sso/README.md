# Company sign-in (SAML) on the local stack

Proves the app's "Sign in with company SSO" works end to end before a real
customer is connected on production. Everything here is local; nothing touches
surveytool.app or the production Supabase project.

```sh
sudo dockerd &                                   # if Docker isn't running
E2E_EDGE_RUNTIME=off npm run e2e:stack:up
debug/sso/setup-local-saml.sh                    # SAML on + fake company for example.com
npx vite --mode e2e --port 5199 --strictPort --host 127.0.0.1 &
node debug/sso/company-sign-in-walk.cjs /tmp     # screenshots land in /tmp
```

Expected output:

```
unknown company: plain "not set up" message
signed in as jane@example.com via sso/saml | chip: JA jane@example.com Synced · Free
```

Connecting a real customer on production is the same two steps against the
real project: turn SAML on once (Auth providers page), then per company
`supabase sso add --type saml --project-ref <ref> --metadata-url <their url> --domains <their domain>`.
Full write-up: the single sign-on report in the project's security folder.
