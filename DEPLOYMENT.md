# VFIC multi-node deployment runbook

Three deployments of this one repository, each with its own database, replicating to each
other. Manila is head office; Thailand and Cambodia are branch nodes.

| Node | Vercel project | Portal URL | `VFIC_NODE_ID` | ID band |
|---|---|---|---|---|
| Manila HQ | `vfic-mnl` | `/mnl` (+ `/dev`) | `HQ_MANILA` | 0 – 999,999 |
| Thailand | `vfic-th` | `/th` | `TH_BANGKOK` | 1,000,000 – 1,999,999 |
| Cambodia | `vfic-kh` | `/kh` | `KH_PHNOMPENH` | 2,000,000 – 2,999,999 |

All three deploy from the **same GitHub repo** (`markybuenavistamb-eng/BBLS`, branch `main`).
Nothing needs to be forked or branched — only the environment variables differ.

---

## Shared secret

Every node must present the **same** sync secret. One has been generated for you:

```
61moge1_rZ9v4bBSGpfbQlkjJy0pRpn13kfOzSp8U2g
```

Treat it like a password. If you'd rather mint your own:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Step 1 — Create three Supabase databases

For **each** of the three projects (name them e.g. `vfic-mnl`, `vfic-th`, `vfic-kh`; pick a
region near the branch — Singapore works well for all three):

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

---

## Step 2 — Create three Vercel projects

For each: **Add New → Project → import `BBLS`**. Set **Environment Variables** (Production),
then deploy.

### `vfic-mnl` — Manila head office

```
VFIC_NODE_ID=HQ_MANILA
VFIC_SYNC_SECRET=61moge1_rZ9v4bBSGpfbQlkjJy0pRpn13kfOzSp8U2g
VFIC_PEERS=[{"id":"TH_BANGKOK","url":"https://vfic-th.vercel.app"},{"id":"KH_PHNOMPENH","url":"https://vfic-kh.vercel.app"}]
SUPABASE_URL=<the vfic-mnl project URL>
SUPABASE_SERVICE_ROLE_KEY=<the vfic-mnl service_role key>
```

### `vfic-th` — Thailand branch

```
VFIC_NODE_ID=TH_BANGKOK
VFIC_SYNC_SECRET=61moge1_rZ9v4bBSGpfbQlkjJy0pRpn13kfOzSp8U2g
VFIC_PEERS=[{"id":"HQ_MANILA","url":"https://vfic-mnl.vercel.app"}]
SUPABASE_URL=<the vfic-th project URL>
SUPABASE_SERVICE_ROLE_KEY=<the vfic-th service_role key>
```

### `vfic-kh` — Cambodia branch

```
VFIC_NODE_ID=KH_PHNOMPENH
VFIC_SYNC_SECRET=61moge1_rZ9v4bBSGpfbQlkjJy0pRpn13kfOzSp8U2g
VFIC_PEERS=[{"id":"HQ_MANILA","url":"https://vfic-mnl.vercel.app"}]
SUPABASE_URL=<the vfic-kh project URL>
SUPABASE_SERVICE_ROLE_KEY=<the vfic-kh service_role key>
```

> `VFIC_PEERS` must be valid JSON on one line. Substitute your real Vercel URLs — if you use
> custom domains, use those instead. You can deploy first with placeholder URLs and correct
> them once Vercel assigns the real ones; peers are read at request time, so a redeploy after
> editing is enough.

---

## Step 3 — Verify each node

Every deployment self-checks. Open (or `curl`) on each:

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
