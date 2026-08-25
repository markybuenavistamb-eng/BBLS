# VFIC multi-node deployment runbook

Three deployments of this one repository, each with its own database, replicating to each
other. Manila is head office; Thailand and Cambodia are branch nodes.

| Node | Vercel project | Portal URL | `VFIC_NODE_ID` | Database | ID band | Number band |
|---|---|---|---|---|---|---|
| Manila HQ | `vfic-mnl` | `/mnl` (+ `/dev`) | `HQ_MANILA` | Supabase 1 | 0 – 999,999 | 000001 – 099999 |
| Thailand | `vfic-th` | `/th` | `TH_BANGKOK` | Supabase 2 | 1,000,000 – 1,999,999 | 100001 – 199999 |
| Cambodia | `vfic-kh` | `/kh` | `KH_PHNOMPENH` | Upstash Redis | 2,000,000 – 2,999,999 | 200001 – 299999 |

The **ID band** keeps record ids apart. The **number band** does the same for the numbers people
quote — shipment and box numbers, booking (`IR-`) and box-order (`BO-`) references — because
their prefix names the country the cargo ships *from*, not the office that keyed it: Manila
books Thailand shipments too, so `TH-2026-…` alone cannot say which node minted it. The digits
can, and `TH-2026-100007` reads as Bangkok's. Counters run per node **and per prefix**, so
Thailand's series and Cambodia's each count on their own instead of interleaving.

Numbers minted before the bands existed all sit in Manila's band; `node lib/fix-duplicate-numbers.js`
moves the duplicates among them into the right one. Because the mint is floored at the highest
number already in use in its band, a counter can no longer fall behind the data — which is what
`lib/fix-lagging-counters.js` was written to catch, and why that script is now a check rather
than a repair.

All three deploy from the **same GitHub repo** (`markybuenavistamb-eng/BBLS`, branch `main`).
Nothing needs to be forked or branched — only the environment variables differ.

**Why Cambodia is on Upstash:** Supabase's free plan allows two projects per account. The
storage layer supports Redis REST as an equal alternative, so the third node runs on Upstash's
free tier — still a genuinely separate database. Replication is backend-agnostic: a node does
not know or care what its peers store data in. (Verified: a shipment created on a Redis-backed
node replicated to a node on a different backend, and survived a restart.)

---

## Shared secret

Every node must present the **same** sync secret — it is what authorises one deployment to
pull data from another. Generate it yourself and keep it out of this file:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Treat the output like a password: paste it straight into each Vercel project's
`VFIC_SYNC_SECRET` variable and nowhere else. Anyone holding it can read or inject records
across the whole network, so it must never be committed — this repo is the one place it
should not live.

> An earlier draft of this file had a generated secret written into it in plain text, which
> put it in git history. If you already deployed with that value, mint a new one with the
> command above and update `VFIC_SYNC_SECRET` on all three projects.

---

## Step 1a — Create two Supabase databases (Manila, Thailand)

For **each** of the two projects (name them `vfic-mnl` and `vfic-th`; Region → Asia-Pacific →
**Singapore**):

1. [supabase.com](https://supabase.com) → **New project**.
2. **SQL Editor → New query**, paste and **Run**:

```sql
create table if not exists kv (
  k text primary key,
  v jsonb
);
alter table kv enable row level security;
-- No policy on purpose: with RLS on and no policy, the anon key is blocked and only the
-- service_role key (used server-side) can read/write. The row holds all app data,
-- including staff password hashes.
```

3. **Project Settings → API** — copy the **Project URL** and the **`service_role`** key
   (not `anon`). You'll paste these into the matching Vercel project in step 2.

On the create-project screen, leave the Security defaults as they come: **Enable Data API**
must stay ticked (the app reads and writes over `/rest/v1/kv`); *Automatically expose new
tables* is safe to leave ticked because the SQL above locks `kv` behind RLS with no policy —
the anon key gets nothing and only `service_role` can read it. The **database password** is
for direct Postgres connections; it is never pasted into Vercel.

### Check it before going further

Prove the credentials work from your own machine first — it is much easier to debug here
than after a deploy. Keep one env file per node so you are never editing a shared file
between checks:

```bash
cp .env.example .env.mnl     # fill in the vfic-mnl URL + service_role key
cp .env.example .env.th      # fill in the vfic-th URL + service_role key

npm run check-store -- --env .env.mnl
npm run check-store -- --env .env.th
```

Each run reports the backend it selected, reads the stored document, and round-trips a
scratch row to prove writes work before deleting it. It never prints a key — only whether
one is set, its length and last four characters — so the output is safe to paste anywhere.
Common failures come back with the fix attached (missing `kv` table, `anon` key used instead
of `service_role`, paused project, wrong URL).

Set `VFIC_NODE_ID` in each file too (`HQ_MANILA`, `TH_BANGKOK`), so the check confirms the
node identity and id band alongside the connection.

> **Handling the keys.** A `service_role` key bypasses row-level security completely — with
> the schema above it *is* the database, and that database holds staff password hashes,
> customer addresses and uploaded ID scans. Treat one like a root password: paste it only
> into your own `.env.*` file and the matching Vercel project. Every `.env*` file is
> gitignored (only `.env.example` is tracked). If a key is ever pasted somewhere it should
> not be — a chat, an issue, a screenshot — rotate it in Supabase → Project Settings → API
> Keys rather than hoping it went unread.

## Step 1b — Create the Upstash database (Cambodia)

1. [upstash.com](https://upstash.com) → **Create Database** (Redis) → free tier, region
   **Singapore** (or nearest to Phnom Penh).
2. On the database page open the **REST API** section and copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. No table to create — the app stores its document under a single key
   (`vfic:db:KH_PHNOMPENH`), created automatically on first write.

---

## Step 2 — Create three Vercel projects

For each: **Add New → Project → import `BBLS`**. Set **Environment Variables** (Production),
then deploy.

### `vfic-mnl` — Manila head office

```
VFIC_NODE_ID=HQ_MANILA
VFIC_SYNC_SECRET=<the secret you generated above — the SAME value on all three>
VFIC_PEERS=[{"id":"TH_BANGKOK","url":"https://vfic-th.vercel.app"},{"id":"KH_PHNOMPENH","url":"https://vfic-kh.vercel.app"}]
SUPABASE_URL=<the vfic-mnl project URL>
SUPABASE_SERVICE_ROLE_KEY=<the vfic-mnl service_role key>
```

### `vfic-th` — Thailand branch

```
VFIC_NODE_ID=TH_BANGKOK
VFIC_SYNC_SECRET=<the secret you generated above — the SAME value on all three>
VFIC_PEERS=[{"id":"HQ_MANILA","url":"https://vfic-mnl.vercel.app"}]
SUPABASE_URL=<the vfic-th project URL>
SUPABASE_SERVICE_ROLE_KEY=<the vfic-th service_role key>
```

### `vfic-kh` — Cambodia branch (Upstash instead of Supabase)

```
VFIC_NODE_ID=KH_PHNOMPENH
VFIC_SYNC_SECRET=<the secret you generated above — the SAME value on all three>
VFIC_PEERS=[{"id":"HQ_MANILA","url":"https://vfic-mnl.vercel.app"}]
KV_REST_API_URL=<the Upstash REST URL>
KV_REST_API_TOKEN=<the Upstash REST token>
```

> This node has **no** `SUPABASE_*` variables — the Redis pair replaces them. `/api/health`
> will report `"backend": "kv"` here and `"backend": "supabase"` on the other two; both are
> persistent and both replicate identically.

> `VFIC_PEERS` must be valid JSON on one line. Substitute your real Vercel URLs — if you use
> custom domains, use those instead. You can deploy first with placeholder URLs and correct
> them once Vercel assigns the real ones; peers are read at request time, so a redeploy after
> editing is enough.

---

## Step 2b — One Vercel Blob store, shared by all three

Uploads (passport/ID scans, POD photos) are stored outside the database. Create **one** Blob
store and connect **all three** projects to it — not one store per project.

The reason is that a file is addressed by an opaque key (`TH_BANGKOK/intake/<ts>-<name>`)
which is saved inside the shipment or intake record. Those records replicate, so an ID
uploaded at a branch arrives at head office as a key — and head office resolves that key
against whatever store *its* token points at. With separate stores, Manila cannot open any
document uploaded at a branch, which is exactly when it needs to.

1. **Storage → Create Database → Blob**, name it `vfic-files`.
2. **Projects → Connect Project** for each of `vfic-mnl`, `vfic-th`, `vfic-kh`, with
   **Production** ticked.
3. Connecting the store may supply only `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY`. The
   app needs the read/write token, so check each project for **`BLOB_READ_WRITE_TOKEN`** and
   add it by hand if it is absent: open the store → **Tokens** (or *Read-Write Token* /
   *Connect* panel) → copy the token, then add it to each project's environment variables as
   `BLOB_READ_WRITE_TOKEN`.
4. Redeploy all three — a token added after a build does not reach that build.

`npm run check-nodes` reports `Uploads: blob` once this is right, and names which BLOB
variables a deployment can actually see when it is not.

> Until this is done the app falls back to `/tmp`, where an upload **appears to succeed and
> then disappears** when the instance recycles. Do not take real customer intake before
> `check-nodes` shows `Uploads: blob` on all three.

## Step 3 — Verify each node

Check all three at once from your machine:

```bash
npm run check-nodes -- https://vfic-mnl.vercel.app https://vfic-th.vercel.app https://vfic-kh.vercel.app
```

It reads each deployment's `/api/health` and reports what is wrong and how to fix it, then
cross-checks the network for the faults no single node can see — most importantly **two
projects sharing a `VFIC_NODE_ID`**, which would make them mint colliding record ids and
mis-assign ownership during replication. It sends no credentials; `/api/health` is
unauthenticated and returns only booleans about what is configured.

Or check one deployment by hand:

```bash
curl https://vfic-th.vercel.app/api/health
```

A correctly configured node returns `"ready": true` with all four checks green:

```json
{
  "node": { "id": "TH_BANGKOK", "label": "VFIC Thailand (Bangkok)", "id_band": "1000000–1999999" },
  "backend": "supabase",
  "persistent": true,
  "replication": { "enabled": true, "peers": ["HQ_MANILA"] },
  "checks": {
    "database_connected": true,
    "node_id_set": true,
    "sync_secret_set": true,
    "peers_configured": true
  },
  "ready": true
}
```

If `backend` says `ephemeral-tmp`, the Supabase variables aren't set on that project.
If `replication.enabled` is `false`, the secret or peers are missing.

---

## Step 4 — Confirm replication

1. Sign in to the Developer Console: `https://vfic-mnl.vercel.app/dev`
   (`developer@vfic.demo` / `demo1234` — **change this password immediately** in Admin → Users).
2. Each peer card should read **ONLINE** with a round-trip time.
3. Press **⟳ Sync now**. The console reports how many records were applied and updates each
   peer's cursor.
4. End-to-end proof: create a shipment on `/th`, then press **Sync now** at Manila — the
   shipment and its boxes appear at head office, still owned by `TH_BANGKOK`.

Replication is pull-based: Manila pulls from the branches, and each branch pulls from Manila.
A node only ever writes records it owns, so there is nothing to reconcile by hand.

---

## After go-live

- **Change every demo password.** The seeded accounts (`developer@`, `admin@`, `admin.th@`,
  `admin.kh@`, `shipper@`, `cambodia@`, `consignee@`, `warehouse@`, `accounting@`) all ship
  with `demo1234`. Each node has its **own** staff accounts — users do not replicate.
- **Set the rate cards** in the Developer Console portal (`/dev` → Accounting → Rate Cards).
  Rate cards are per branch and only the Developer portal can change them.
- **Fill in the partner details** for Thailand and Cambodia at Manila under
  Branches & Partners (registered name, TIN, commission %, settlement terms).
- **Sync cadence**: today sync runs when someone presses *Sync now* in the Developer Console.
  Vercel's Hobby plan allows one cron per day; if you want automatic replication on a schedule,
  move to a paid plan and add a cron hitting `/api/sync/run`, or call it from an external
  scheduler.
