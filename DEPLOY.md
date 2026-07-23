# Deploy VFIC Box Operations

A step-by-step checklist to get this app onto GitHub and live on Vercel.
Nothing here requires pasting a token into a chat or a script — you authenticate
through your own browser.

---

## 1. Push to GitHub

The repo is already initialized and staged locally. From the project folder:

```bash
cd C:\Users\AMD\Desktop\BBLS
git config user.name  "Your Name"
git config user.email "you@example.com"
git commit -m "VFIC Box Operations — Vercel-ready"
```

Create an **empty** repo on <https://github.com/new> (no README/.gitignore/license),
then connect and push. On the first push, Git Credential Manager opens a browser
window to sign in to GitHub — there is **no token prompt**:

```bash
git remote add origin https://github.com/YOUR_USERNAME/vfic-box-operations.git
git push -u origin main
```

**Alternative — GitHub CLI** (one-time install `winget install GitHub.cli`):

```bash
gh auth login
gh repo create vfic-box-operations --private --source=. --push
```

> Security: never commit or paste a Personal Access Token. If you created one for
> this, delete it (GitHub → Settings → Developer settings → Personal access tokens).
> The `.gitignore` already excludes `node_modules/`, `data/` (local DB + uploads),
> and `.env`.

---

## 2. Import into Vercel

1. <https://vercel.com> → **Add New → Project → Import** your GitHub repo.
2. Framework preset: **Other** (it auto-detects `vercel.json`). Leave build/output empty.
3. Don't deploy yet — add storage + env vars first (below), or deploy once and redeploy after.

---

## 3. Add storage (Vercel dashboard → Storage)

The app auto-switches from local filesystem to these when their env vars exist —
no code changes needed.

| Add this | Injects automatically | Used for |
|---|---|---|
| **KV / Upstash Redis** | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | the DB document (`lib/store.js`) |
| **Blob** | `BLOB_READ_WRITE_TOKEN` | uploaded files — passports, POD photos (`lib/storage.js`) |

Create each store from the project's **Storage** tab and click **Connect** so the
tokens are added to this project's environment.

---

## 4. Environment variables (Settings → Environment Variables)

| Name | Value | Required |
|---|---|---|
| `SESSION_SECRET` | output of `openssl rand -base64 32` | **Yes** — signs the login cookie |
| `CRON_SECRET` | any long random string | **Yes** — protects the notification cron endpoint |
| `NODE_ENV` | `production` | **Yes** — marks the session cookie `Secure` |
| `PUBLIC_BASE_URL` | `https://your-app.vercel.app` | Recommended — makes QR/SMS links point at the live site (set after the first deploy when you know the URL) |
| `SMS_PROVIDER` | `semaphore` | Optional — real SMS instead of simulated |
| `SEMAPHORE_API_KEY` | your Semaphore key | Only if `SMS_PROVIDER=semaphore` |
| `SEMAPHORE_SENDER_NAME` | `VFIC` | Optional |

(See `.env.example` for the full list. `KV_*` and `BLOB_*` come from step 3 — don't set them by hand.)

---

## 5. Deploy & verify

1. **Deploy** (or redeploy after setting env vars). The DB seeds itself into KV on the first request.
2. Open the deployment URL:
   - `/` — public landing page
   - `/track.html` — public box tracking
   - `/intake-form.html` — online receiving form
   - `/app` — staff sign-in (demo: `admin@vfic.demo` / `demo1234`)
3. Set `PUBLIC_BASE_URL` to the real deployment URL and redeploy so printed QR codes
   and SMS links resolve to the live site.

---

## How it maps to serverless

| Concern | Local (`npm start`) | Vercel (production) |
|---|---|---|
| HTTP server | `app.listen` in `server.js` | `api/index.js` re-exports the Express app as one function |
| Database (one JSON doc) | `data/db.json` | Vercel KV / Upstash Redis |
| Uploads | `data/uploads/` | Vercel Blob, served only via the authed `/files/*` proxy |
| Sessions | signed cookie | signed cookie (stateless — no change) |
| SMS worker | in-process `setInterval` | Vercel Cron → `/api/cron/process-notifications` (see `vercel.json`) |

### Notes & limits

- **Cron cadence:** `vercel.json` runs the notification worker every 5 minutes.
  On Vercel's Hobby plan crons run at most **once per hour** — the schedule still
  deploys; upgrade to Pro for finer cadence.
- **PII files:** Vercel Blob objects are public-by-URL, so passports/packing lists
  are stored under opaque keys and **only ever served through the authenticated
  `/files/*` proxy** — the raw blob URL is never exposed. For strict isolation,
  swap `lib/storage.js` for S3 with signed URLs.
- **Concurrency:** the whole DB is a single JSON document (read-modify-write per
  request) — ideal for this demo's scale (~20 staff, ~5k boxes/month), but a true
  relational schema would be the next step for heavy concurrent writes.
- **Resetting prod data:** delete the `vfic:db` key in the KV store (or set
  `KV_DB_KEY` to a new value) and the app reseeds on the next request.
