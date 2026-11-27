# Deploying bgd26 to Vercel

Prepared 23 November 2026. Target: **Vercel Hobby first**, functions in
**Tokyo (`hnd1`)** next to Supabase `chqajgxkwpmpoxsjsxks`, deployed through
Vercel's **Git integration** (every push to `main`), with the CLI kept as a
manual fallback.

> Hobby is for personal, non-commercial projects. bgd26.com is a business, so
> move to Pro before taking real orders. Nothing here is Hobby-only except the
> single-region default, and `vercel.json` already pins that region.

## Live deployment (23 November 2026)

| | |
| --- | --- |
| Project | `bgd26` — `prj_raQCofcuH8Mdkq91K7Vp6IyHoGgW`, account `fgcity-26` |
| Deployment | `dpl_EaMXyi2ds9GmRCyjohJcBwzYqhvi` (TLS-verified database) |
| Production URL | <https://bgd26.com> (alias ready) and <https://bgd26.vercel.app> |
| Region / Node | `hnd1` / `24.x` |
| Health | `{"status":"ok","database":"up"}`, warm database latency 5–6 ms |
| Environment | 16 variables, Production only; previews intentionally have none |
| Domain | `bgd26.com` and `www.bgd26.com` added, waiting for DNS |

DNS records to create at Intelwebhost (the domain currently uses
`ns1.intelwebhost.com` / `ns2.intelwebhost.com`, and its apex A record points at
`127.0.0.1`):

| Type | Name | Value |
| --- | --- | --- |
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Replace the existing `127.0.0.1` apex record; do not change nameservers unless
you also want Vercel to host DNS (that would move any mail records). Vercel
issues the TLS certificate once the records resolve.

## Git integration (connected 26 November 2026)

The project is connected to GitHub **`fgcity26/bgd26`** under the `fgcity-26`
team, production branch **`main`**. From now on a push to `main` builds and
deploys production by itself; no token needs to be passed around. Pull requests
get preview URLs, which fail at prerender until Preview environment variables
exist — see §6.

If the repository is ever renamed or transferred, reconnect it under **Project →
Settings → Git**; Vercel's GitHub App must keep access to the repository. The
CLI deploy below still works for an emergency rollback or before a push lands.

## 1. What the repository already does for Vercel

| Concern | Handling |
| --- | --- |
| Prisma client | `postinstall` and `build` both run `prisma generate`; `src/generated/prisma` stays untracked |
| Node version | `package.json` → `"engines": { "node": "24.x" }` (Vercel's default would be 26) |
| Region | `vercel.json` → `"regions": ["hnd1"]` |
| Large originals | Gallery uploads go **browser → Supabase Storage** through a signed URL, so the 4.5 MB function-body limit never applies |
| Object storage | `STORAGE_PROVIDER=supabase`; the local filesystem adapter is development-only |
| Database | Transaction pooler at runtime (`:6543`); migrations use the session pooler (`:5432`) |
| TLS | `DATABASE_SSL_CA` pins Supabase's own CA, so chain and hostname are verified (`prisma/certs/supabase-prod-ca-2021.crt`) |
| Secrets | Only in `.env.local` / the Vercel dashboard; `.gitignore` blocks `.env*` |

## 2. Environment variables

Add these under **Project → Settings → Environment Variables**. Paste values
**without quotes**. Scope the database and secrets to **Production**; see §6
for previews.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres.chqajgxkwpmpoxsjsxks:<db-password>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require` |
| `DATABASE_SSL_CA` | PEM of `prisma/certs/supabase-prod-ca-2021.crt`. Supabase's pooler is signed by Supabase's own CA, so `sslmode=require` fails with `SELF_SIGNED_CERT_IN_CHAIN` unless this is set. With it, node-postgres verifies chain **and** hostname. |
| `NEXT_PUBLIC_APP_URL` | `https://bgd26.com` |
| `AUTH_PROVIDER` | `local` |
| `AUTH_SECRET` | 32+ random bytes (generate a fresh one for production) |
| `MANAGER_PIN_PEPPER` | the current value — changing it invalidates every manager PIN |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://chqajgxkwpmpoxsjsxks.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | project anon key (rotate the exposed one first) |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key — server-only, never `NEXT_PUBLIC_*` |
| `STORAGE_PROVIDER` | `supabase` |
| `SUPABASE_STORAGE_BUCKET` | `bgd26-media` |
| `MEDIA_MAX_UPLOAD_BYTES` | `20971520` (the bucket enforces the same cap) |
| `TZ` | `Asia/Dhaka` |
| `AI_PROVIDER` | `local` |
| `DATABASE_POOL_MAX` | `3` (each warm function instance keeps its own pool) |

Optional now, required when the module is switched on: `AI_API_KEY`,
`AI_MODEL`, `SSLCOMMERZ_*`, `WHATSAPP_*`, courier keys, `DIRECT_URL` (CLI only).

### WhatsApp (module 4c)

The local simulator is the default and needs nothing. To send through Meta,
add these to **Production** (never as `NEXT_PUBLIC_*`):

| Variable | Value |
| --- | --- |
| `WHATSAPP_PROVIDER` | `cloud` (omit to auto-detect from the phone id + token) |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta phone number id |
| `WHATSAPP_ACCESS_TOKEN` | system-user access token |
| `WHATSAPP_APP_SECRET` | Meta app secret — verifies every webhook HMAC |
| `WHATSAPP_VERIFY_TOKEN` | a random string, also entered in Meta's webhook setup |
| `WHATSAPP_BUSINESS_NUMBER` | display number, e.g. `+1859180732` |
| `WHATSAPP_WORKER_SECRET` | random secret for `/api/whatsapp/worker`; `CRON_SECRET` also works |
| `WHATSAPP_MAX_ATTEMPTS` | `5` |
| `WHATSAPP_RETRY_BASE_SECONDS` | `60` |
| `WHATSAPP_RETRY_MAX_SECONDS` | `3600` |
| `WHATSAPP_SEND_TIMEOUT_MS` | `15000` |

Register the webhook URL `https://bgd26.com/api/whatsapp/webhook` in Meta with
the same verify token and subscribe to the `messages` field. Templates ship
`PENDING`; copy Meta's approved wording and mark each one `APPROVED` in
`/whatsapp/templates` before a live send is allowed.

`vercel.json` adds one cron, `0 4 * * *` (10:00 Dhaka), to
`/api/whatsapp/worker?limit=20`. Vercel automatically sends `CRON_SECRET` as a
bearer token; setting `WHATSAPP_WORKER_SECRET` as well lets you drain the queue
from the console or `curl`. Each event also attempts one inline send, so the
cron is a safety net rather than the primary path.

Never set on Vercel: `SEED_OWNER_PASSWORD`, `SEED_OWNER_PIN`,
`SEED_ALLOW_PROD`, `STORAGE_LOCAL_DIR`, `STORAGE_LOCAL_BUCKET`, or any URL with
`sslmode=no-verify` (that mode exists only for the local sandbox's TLS proxy).

`NEXT_PUBLIC_*` values are compiled into the build. Changing one requires a
redeploy.

## 3. Migrations (never run by Vercel)

Vercel builds must not migrate: parallel builds would race, and the direct host
is IPv6-only. Apply migrations from a machine that has `.env.local`:

```bash
NODE_EXTRA_CA_CERTS=prisma/certs/supabase-prod-ca-2021.crt \
  npx prisma migrate deploy   # uses DIRECT_URL (session pooler, port 5432)
```

`NODE_EXTRA_CA_CERTS` makes the Prisma CLI verify Supabase's private CA. Keep
`DIRECT_URL` at `sslmode=require`; if your shell has no CA file to hand, the
CLI also accepts the local `sslmode=no-verify` convention used in
`.env.local` — but never ship that URL to Vercel.

Order for each release: **migrate first, deploy second**. Migrations must stay
backward compatible with the running version (add columns/tables; drop in a
later release). Module 4c is split into two folders because PostgreSQL cannot
use a newly added enum value in the same transaction: `whatsapp_notifications`
adds the schema, `whatsapp_defaults` inserts the settings row and templates.

Reference data is already seeded on the current project. Never run
`npm run db:seed` in Vercel.

## 4. First deploy with the CLI

```bash
npx vercel@latest login                  # or: vercel login --token "$VERCEL_TOKEN"
npx vercel@latest link                   # select the bgd26 project, root directory = repo root
npx vercel@latest --prod
```

Build settings stay at their defaults: framework **Next.js**, install as
detected from `package-lock.json`, build `npm run build`, output `.next`.
`npm run build` already includes `prisma generate`.

Non-interactive variant, if the owner supplies a token:

```bash
VERCEL_TOKEN=… npx vercel@latest --prod --yes --token "$VERCEL_TOKEN"
```

Revoke the token at <https://vercel.com/account/tokens> immediately afterwards.

## 5. Domain

1. **Project → Domains → Add** `bgd26.com` (and `www.bgd26.com`).
2. Vercel shows the exact DNS records to create. Use those values; do not copy
   stale IPs from documentation.
3. Choose `www` → apex (or the reverse) in the same screen; do not add a
   redirect in application code.
4. Wait for **Valid Configuration**, then confirm HTTPS and that
   `NEXT_PUBLIC_APP_URL` is `https://bgd26.com`, and redeploy.

## 6. Preview deployments and the database

A preview branch can write to whatever `DATABASE_URL` it receives. Until a
second Supabase project exists for previews:

- scope `DATABASE_URL` (and the other secrets) to **Production only**, and
- accept that preview builds fail at prerender (`/` is ISR and reads the
  database at build time) — CI on GitHub already covers typecheck, lint, tests
  and build against a disposable Postgres.

When previews matter: create `bgd26-staging`, run migrations, seed it, add its
own pooler URL for the Preview environment, and never share the production
service-role key with it.

## 7. Post-deploy smoke test

```bash
curl -s https://bgd26.com/api/health          # {"status":"ok","database":"up",…}
```

Then in the browser:

1. Sign in as the owner, change the bootstrap password, set a manager PIN.
2. Open a product, upload a **10–20 MB** JPEG — it must succeed (proves the
   signed-upload path), then confirm the image renders and
   `/media/<storage-key>` returns the same bytes with an immutable cache header.
3. `/shop` and a product page render; `/pos` search returns quickly.
4. `/assistant` answers a price question and creates a draft order.
5. Create and cancel a draft order; confirm no stock or journal moved.

## 8. Rollback

Vercel keeps every deployment: **Deployments → … → Promote** (or Instant
Rollback) returns to the previous build in seconds. The database is forward
only — never reverse a migration in production; ship a corrective migration.

## 9. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build fails: `Can't reach database server` | `DATABASE_URL` missing at build time, or scoped to Preview only |
| `413 FUNCTION_PAYLOAD_TOO_LARGE` | A request body above 4.5 MB. Gallery uploads are fixed; check any new upload/import endpoint |
| `too many connections` | Raise `DATABASE_POOL_MAX` only slightly, or lower it; the Supavisor pool has a plan limit |
| Pages slow (~200 ms per query) | Functions not in `hnd1`, or a preview region override |
| `SELF_SIGNED_CERT_IN_CHAIN` | `DATABASE_SSL_CA` missing. Supabase's pooler uses its own CA; set the PEM (the repo bundles it) — do not fall back to `sslmode=no-verify` in production |
| Login loop after deploy | `AUTH_SECRET` changed between deployments, or cookies blocked on the apex domain |
