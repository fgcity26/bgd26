# Deploying bgd26 to Vercel

Prepared 23 November 2026. Target: **Vercel Hobby first**, functions in
**Tokyo (`hnd1`)** next to Supabase `chqajgxkwpmpoxsjsxks`, deploy through the
**Vercel CLI** with a token the owner revokes afterwards.

> Hobby is for personal, non-commercial projects. bgd26.com is a business, so
> move to Pro before taking real orders. Nothing here is Hobby-only except the
> single-region default, and `vercel.json` already pins that region.

## 1. What the repository already does for Vercel

| Concern | Handling |
| --- | --- |
| Prisma client | `postinstall` and `build` both run `prisma generate`; `src/generated/prisma` stays untracked |
| Node version | `package.json` → `"engines": { "node": "24.x" }` (Vercel's default would be 26) |
| Region | `vercel.json` → `"regions": ["hnd1"]` |
| Large originals | Gallery uploads go **browser → Supabase Storage** through a signed URL, so the 4.5 MB function-body limit never applies |
| Object storage | `STORAGE_PROVIDER=supabase`; the local filesystem adapter is development-only |
| Database | Transaction pooler at runtime (`:6543`); migrations use the session pooler (`:5432`) |
| Secrets | Only in `.env.local` / the Vercel dashboard; `.gitignore` blocks `.env*` |

## 2. Environment variables

Add these under **Project → Settings → Environment Variables**. Paste values
**without quotes**. Scope the database and secrets to **Production**; see §6
for previews.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres.chqajgxkwpmpoxsjsxks:<db-password>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require` |
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

Never set on Vercel: `SEED_OWNER_PASSWORD`, `SEED_OWNER_PIN`,
`SEED_ALLOW_PROD`, `STORAGE_LOCAL_DIR`, `STORAGE_LOCAL_BUCKET`, or any URL with
`sslmode=no-verify` (that mode exists only for the local sandbox's TLS proxy).

`NEXT_PUBLIC_*` values are compiled into the build. Changing one requires a
redeploy.

## 3. Migrations (never run by Vercel)

Vercel builds must not migrate: parallel builds would race, and the direct host
is IPv6-only. Apply migrations from a machine that has `.env.local`:

```bash
npx prisma migrate deploy   # uses DIRECT_URL (session pooler, port 5432)
```

Order for each release: **migrate first, deploy second**. Migrations must stay
backward compatible with the running version (add columns/tables; drop in a
later release).

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
| `SELF_SIGNED_CERT_IN_CHAIN` | `sslmode=no-verify` leaked into production; use `sslmode=require` |
| Login loop after deploy | `AUTH_SECRET` changed between deployments, or cookies blocked on the apex domain |
