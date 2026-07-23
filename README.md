# VFIC Balikbayan Box Operations — MVP Demo

A runnable demo of the VICTORS FREIGHT INTERNATIONAL CORPORATION origin-to-last-mile operations system. It implements the full spec workflow — intake → container consolidation → arrival → warehouse stripping → segregation → dispatch → delivery → proof of delivery — with a lightweight stack (Node + Express + JSON file storage) so it runs anywhere with zero setup: no database server, no cloud accounts.

## Run it (local)

```
npm install
npm start
```

Then open <http://localhost:3000> (set `PORT` to change). Locally it needs **no configuration** — data is stored in `data/db.json`, uploads in `data/uploads/`, and SMS is simulated to the console.

## Deploy to Vercel (serverless)

The app runs on Vercel as a single serverless function (`api/index.js` re-exports the Express app; `app.listen` only runs locally). It uses adapters that switch from local filesystem to cloud services when the env vars are present — no code changes needed to deploy.

| Concern | Local | Vercel (production) |
|---|---|---|
| Database (one JSON document) | `data/db.json` | **Vercel KV / Upstash Redis** (`lib/store.js`) |
| Uploads (passports, POD photos) | `data/uploads/` | **Vercel Blob** (`lib/storage.js`), served only via the authed `/files/*` proxy |
| Sessions | signed cookie | signed cookie (`lib/session.js`, stateless — no server store) |
| SMS worker | in-process `setInterval` | sent **in-request** when a status change queues one (no cron needed on Hobby; `/api/cron/process-notifications` remains for optional Pro-plan scheduled retries) |

**Steps:**

1. Push this repo to GitHub and **Import** it in Vercel (framework preset: *Other*; it auto-detects `vercel.json`).
2. In the project, add two storage integrations from the **Storage** tab: **KV (Upstash Redis)** and **Blob**. Vercel injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` and `BLOB_READ_WRITE_TOKEN` automatically.
3. Add these **Environment Variables** (see `.env.example`):
   - `SESSION_SECRET` — run `openssl rand -base64 32`
   - `CRON_SECRET` — any random string (protects the cron endpoint)
   - `NODE_ENV=production` (marks the session cookie `Secure`)
   - *(optional)* `SMS_PROVIDER=semaphore` + `SEMAPHORE_API_KEY` for real SMS
4. **Deploy.** The DB seeds itself into KV on first request. Demo logins still work (`admin@vfic.demo` / `demo1234`).

Notes: The cron runs hourly on Vercel's Hobby plan (change the schedule in `vercel.json` on Pro). Vercel Blob objects are technically public-by-URL, so PII files (passports/packing lists) are addressed by opaque keys and **only ever served through the authenticated `/files/*` proxy** — the raw blob URL is never exposed. For stricter isolation, swap `lib/storage.js` for S3 with signed URLs.

## Local details

- **Public website** (landing): `http://localhost:3000/` — marketing homepage with hero imagery, services, "how it works", tracking/send CTAs, and VFIC branding (logo lockup, head office, contact details, Facebook link).
- **Staff app**: `http://localhost:3000/index.html` (or `/app`) — log in with a demo account. Sidebar navigation grouped by Operations / People & Comms / System.
- **Public customer tracking**: `http://localhost:3000/track.html` — no login; opened by scanning a box QR label, or by entering box number + last 4 digits of the receiver's phone (anti-enumeration).
- **Online receiving form**: `http://localhost:3000/intake-form.html` — sender self-service intake (QR-linked from the printed blank form).

### Bilingual UI (English + Tagalog)

Every page has an **EN / TL toggle**. English is the default; the choice is remembered (localStorage) and applies across the public site, tracking, online form, login, sidebar navigation, dashboard, and all box/container/trip status labels. Translations live in a single dictionary (`public/i18n.js`, 185 keys per language). Internal CRUD field labels remain English.

### Branding & imagery

The **official VFIC logo** (`public/vfic-logo.png`, transparent PNG, 2686×645) is used throughout: landing nav + footer, staff sidebar, login (both panels), public tracking / online-form headers, and the printed Receiving Form. Because the logo's green *"Chosen to Deliver"* tagline would lose contrast on dark chrome, it sits on a white rounded plate (`.vf-logo-plate`) over navy surfaces and is used directly on light ones. To update the artwork, just replace `public/vfic-logo.png` — no code changes needed. Brand colours are taken from the logo: orange `#F0531C`, green `#1B7A35`, on a maritime navy chrome. Landing/public headers use freight stock photos (container vessel, cargo plane, parcel at a doorstep, port) with a navy-gradient fallback if a viewer is offline.

**Company details used site-wide:** Rm. 205 Sitio Grande Bldg., 409 A. Soriano Ave., Intramuros, Manila 1002 Philippines · +63 2 84255264 · info@victorsfreight.ph · Mon–Fri, 8:30 AM – 5:30 PM.

### Demo accounts (password: `demo1234`)

| Email | Role | Can do |
|---|---|---|
| `admin@vfic.demo` | Admin | Everything, incl. users, SMS templates, cancel boxes |
| `shipper@vfic.demo` | Shipper Agent (origin) | Shipment intake, customers, labels, container booking/loading/depart |
| `consignee@vfic.demo` | Consignee Agent (PH) | Container arrival, stripping, segregation, trips, dispatch, POD, returns |
| `warehouse@vfic.demo` | Warehouse Staff | Scan screens: strip receive + region sorting |

### Seeded demo data (spec §11)

4 users, 10 customers across regions, 2 containers (one IN_TRANSIT, one STRIPPED), ~38 boxes across every status **including 3 RETURNED boxes in the returns queue**, 2 trucking trips (one dispatched, one planned), sample SMS log entries (one SENT, one FAILED to demo the retry button).

`npm run reset` deletes `data/db.json`; the server re-seeds fresh demo data on next start.

## Demo walkthrough (suggested script)

1. **Dashboard** (admin) — pipeline counts, returns queue, container ETAs, today's trips.
2. **Shipments → 🖨 Blank receiving form** — one printable form per box (add a rider sheet for extra boxes), with a QR code the sender can scan to fill it up online instead at `/intake-form.html`. Try submitting one — it lands in **📥 Online intake requests** for an agent to review.
3. **Online intake requests → Review & encode** — opens New Shipment Intake pre-filled from the sender's submission (sender/receiver auto-created or matched by phone, boxes/items pre-filled, passport scan already on file); agent verifies weight/size and saves — the request is marked CONVERTED.
4. **Shipments → New shipment intake** (manual path) — pick sender, add boxes with receivers, itemize each box's contents (description + qty rows) for the packing list. A scanned/soft copy of the sender's passport or government ID is **required** before saving. Save → box numbers + QR tokens generated → **Print labels**, **Print receiving form** (signed intake receipt), **Print packing list** (itemized contents per box).
5. **Confirm origin receipt** on the shipment → sender gets "We received your box" SMS (see SMS page).
6. **Containers** — book, load boxes by scan or pick list (live count vs. typical capacity), **Mark departed** (all boxes → In transit), **Mark arrived** (receivers get arrival SMS), then customs → released.
7. **Warehouse** — strip scan each box off the container (discrepancy list shows what's still missing), then segregate: scan a box and it sorts into its receiver's region lane.
8. **Trips** — create a trip for a region, assign sorted boxes, load-out scan, **Dispatch** → receivers get "out for delivery" SMS with driver name/number. Print the **trip manifest** (addresses, landmarks, instructions, signature column). Print **Delivery Receipts** (blank, signable) to send with the driver — one per box, for the receiver to sign.
9. **Box detail → Record delivery outcome** — DELIVERED requires both POD photos (signed receipt + receiver with box) and received-by name; on success staff are taken straight to the printable **Proof of Delivery** (internal record, embeds both photos). FAILED requires a reason and sends the "we couldn't reach you" SMS.
10. **Returns queue** — failed boxes, oldest first, with one-click "add to next planned trip for the region" re-dispatch.
11. **Public tracking** — open the tracking link from any box detail: friendly timeline, first name + city only.
12. **Admin** — edit SMS templates (placeholders), manage users; **Reports** — CSV exports for containers, delivery performance, failure reasons, unpaid shipments.

## What's implemented (vs. the spec)

- Full box state machine (spec §7) with server-side transition validation, container/trip cascades, immutable StatusEvent audit log
- Shipments (`VF-YYYY-NNNNNN`) with per-box numbers (`…-01`) and unguessable 128-bit QR tokens
- Printable **Balikbayan Box Receiving Form** (one box per form, plus a rider sheet for extra boxes) with a QR code linking to the public **online intake form** (`/intake-form.html`) — sender fills it up on their phone instead of by hand, uploads their passport/ID, and gets a reference code; staff review submissions under **📥 Online intake requests** and encode them with one click (sender/receiver auto-matched by phone, all fields pre-filled)
- A scanned/soft copy of the sender's passport or government ID is **required** to create a shipment (client + server enforced) — satisfied automatically when converting an online submission
- Itemized **Packing List** (description + qty per box), generated from data entered at intake — no separate paperwork step
- Printable **Delivery Receipt** (blank, travels with the truck for the receiver to sign) — distinct from the internal **Proof of Delivery** record (embeds the two mandatory POD photos: signed receipt + receiver with box) generated automatically after a DELIVERED outcome is recorded
- Customers: shared sender/receiver table, region enum, landmark field, phone-change history, dedupe-by-phone suggestion on create
- Containers: booking, load scan, depart/arrive cascades, stripping scan with discrepancy report, arrival-notice document bundle
- Trucking: trips, region-filtered assignment (SORTED + RETURNED), load-out scan, dispatch, printable manifest
- Delivery attempts with dual POD photo requirement; returns queue with one-click re-dispatch
- Notifications: template-driven (admin-editable), DB queue + polling worker with 3 retries, `SmsProvider` abstraction (`SMS_PROVIDER=semaphore` + `SEMAPHORE_API_KEY` for real sends; defaults to console/simulated)
- Public tracking: QR-token URL or box#+phone-last-4, rate-limited, PII-minimized (first name + city), Asia/Manila display times
- Role-based access (4 spec roles); passports/packing lists served to agents+admin only, never public
- Dashboard + 4 CSV reports
- Browser camera QR scanning (html5-qrcode) with manual-entry fallback on every scan screen

## Demo shortcuts (what production would change)

| Demo | Production (per spec §5) |
|---|---|
| JSON file (`data/db.json`) | PostgreSQL + Prisma |
| Express + vanilla JS SPA | Next.js + TypeScript + Tailwind/shadcn |
| Console SMS provider default | Semaphore adapter (included) / Twilio for intl |
| Local `data/uploads/` folder | S3-compatible storage behind the same abstraction |
| In-memory sessions, demo secret | NextAuth.js, proper session store, env secrets |

The data model, API shape, status machine, role rules, and workflows match the spec, so this demo doubles as a working prototype of the production design.
