# Process Ownership Waitlist

Astro static landing page + Cloudflare Worker API for Doug Bruce’s process-ownership course waitlist (audience: production supervisors and quality engineers).

## Stack (MVP)

| Piece | Role |
| --- | --- |
| **Astro** (`output: 'static'`) on **Cloudflare Pages** | Landing page + client form |
| **Cloudflare Worker** | `POST /signup` — validate email, verify Turnstile, write to D1 |
| **Cloudflare D1** | Structured waitlist rows (`email`, `created_at`, …) |
| **Cloudflare Turnstile** | Bot protection on the form |

**Skipped for MVP:** confirmation / welcome email (Resend, Mailchannels, API keys, and deliverability are overkill until the pilot list is real). Add later if needed.

No `@astrojs/cloudflare` adapter — static HTML/CSS/JS is enough for Pages.

## Project layout

```
process-ownership-waitlist/
├── astro.config.mjs          # output: 'static'
├── package.json
├── wrangler.toml             # Worker + D1 binding
├── migrations/0001_init.sql  # D1 schema
├── worker/src/index.ts       # Signup API
├── public/favicon.svg
├── src/
│   ├── layouts/BaseLayout.astro
│   ├── components/WaitlistForm.astro
│   └── pages/index.astro
└── .env.example
```

## Local development

```bash
cd process-ownership-waitlist
npm install
cp .env.example .env          # optional — see env vars below
npm run dev                   # http://localhost:4321
```

Without `PUBLIC_WAITLIST_API_URL`, the form runs in **demo mode** (stores emails in `localStorage` and shows the thank-you state). Useful before the Worker is deployed.

Worker locally (needs D1 local migrate first):

```bash
npm run db:migrate:local
npm run worker:dev
```

Point `.env` at the local Worker URL wrangler prints.

## Environment variables

### Astro / Pages (build-time `PUBLIC_*`)

| Variable | Purpose |
| --- | --- |
| `PUBLIC_WAITLIST_API_URL` | Worker base URL: `https://process-ownership-waitlist-api.bruce-data.workers.dev` |
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile **site** key (public): `0x4AAAAAAFm2g59R0uIiSOKG` |

Set these in Cloudflare Pages → Settings → Environment variables (Production), then rebuild.

### Worker (runtime)

| Binding / secret | How to set |
| --- | --- |
| `DB` | D1 binding in `wrangler.toml` (`database_id`) |
| `TURNSTILE_SECRET_KEY` | `wrangler secret put TURNSTILE_SECRET_KEY` |
| `ALLOWED_ORIGINS` | Comma-separated origins in `wrangler.toml` `[vars]` (tighten after you know the Pages URL) |

## Deploy: D1 + Worker + Pages

### Current production resources

| Resource | Value |
| --- | --- |
| D1 database | `process-ownership-waitlist` (`f72913c8-d956-4a38-8d02-851457cbfdc2`), migration `0001_init.sql` applied |
| Turnstile widget | `process-ownership-waitlist` (managed), site key `0x4AAAAAAFm2g59R0uIiSOKG`, domains `process-ownership-waitlist.pages.dev`, `localhost` |
| Worker | `process-ownership-waitlist-api` at `https://process-ownership-waitlist-api.bruce-data.workers.dev` (secret `TURNSTILE_SECRET_KEY` set) |
| Pages project | `process-ownership-waitlist` (to be created) → `https://process-ownership-waitlist.pages.dev` |

The steps below document how these were set up and how to redo them.

### 1. Create D1 and apply migration

```bash
npx wrangler login
npx wrangler d1 create process-ownership-waitlist
```

Copy the returned `database_id` into `wrangler.toml` (`[[d1_databases]].database_id`).

```bash
npm run db:migrate:remote
# same as: wrangler d1 execute process-ownership-waitlist --remote --file=./migrations/0001_init.sql
```

### 2. Turnstile

1. Cloudflare Dashboard → **Turnstile** → Add site (domain = your Pages custom domain or `*.pages.dev`).
2. Copy **site key** → Pages env `PUBLIC_TURNSTILE_SITE_KEY`.
3. Copy **secret key** → Worker:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

### 3. Deploy Worker

Update `ALLOWED_ORIGINS` in `wrangler.toml` to include your Pages URL (and `http://localhost:4321` for local testing).

```bash
npm run worker:deploy
# or: wrangler deploy
```

Note the Worker URL. Set Pages `PUBLIC_WAITLIST_API_URL` to that origin (no trailing path).

### 4. Deploy Astro to Cloudflare Pages

**Build settings**

| Setting | Value |
| --- | --- |
| Framework preset | Astro (or None) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `18` or `20` (engines: `>=18.17.1`) |

**Via Dashboard:** connect the repo → set build settings + `PUBLIC_*` env vars → Deploy.

**Via Wrangler (direct upload):**

```bash
npm run build
npx wrangler pages deploy dist --project-name=process-ownership-waitlist
```

After first Pages deploy, add the production origin to Worker `ALLOWED_ORIGINS` and redeploy the Worker if needed.

## API contract

`POST /signup`

```json
{ "email": "you@plant.example", "turnstileToken": "…", "source": "landing" }
```

Success: `201` `{ "ok": true, "alreadyJoined": false, "message": "…" }`  
Already signed up: `200` `{ "ok": true, "alreadyJoined": true, "message": "…" }`  
Errors: `400` / `403` / `500` with `{ "ok": false, "error": "…" }`

CORS: `OPTIONS` preflight; allowlist via `ALLOWED_ORIGINS` (empty → `*`).

## Query signups (ops)

```bash
npx wrangler d1 execute process-ownership-waitlist --remote \
  --command="SELECT id, email, created_at, source FROM waitlist ORDER BY created_at DESC LIMIT 50;"
```

## Why not email yet?

Confirmation mail needs a provider (Resend / Mailchannels / SES), DNS auth (SPF/DKIM), templates, and bounce handling. For a pilot waitlist, D1 + Turnstile is enough: you export emails when you open the cohort. Revisit after the first cohort list is locked.

## License

Private — © Doug Bruce / Process Ownership
