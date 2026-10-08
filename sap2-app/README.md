# SAP2 (Simba TECHub): frontend + backend in one app

> **Version 2** adds the Administrative Staff Performance & Accountability system. See `docs/PERFORMANCE.md` (how scores, payment and approval work, and every database change) and `docs/API.md`. Nothing about instructors or instructor payroll changed.

One Node app serves the SAP2 screen and its API. All data lives in your Neon project `sap2`
(branch `production`, database `neondb`). The tables already exist and the 21 staff are loaded.

## Run it
Easiest: read `HOW-TO-RUN.txt` and double-click `start.bat` (Windows) or run `./start.sh` (Mac/Linux). It sets everything up for you.

Manual steps:
1. In the Neon console open project `sap2`, click **Connect**, copy the **pooled** connection string.
2. `cp .env.example .env` then set `DATABASE_URL` to the string from step 1
3. `npm install` then `npm start`
4. Open http://localhost:3000 and sign in on the login page: **Administrator** (private admin code) or **Staff** (your office's code, then your name). The first codes were given to you separately; change them under Administrative Performance → Settings → Access codes.

(`npm run setup` re-creates missing tables and re-loads staff. It is safe to re-run.)

The new performance tables are created automatically the first time the server starts against your existing Neon database (additive only, repeatable). `npm run migrate` does the same by hand. Check the black window for "Administrative performance tables are ready."

Tests: `npm test` (28 backend tests, no database needed) and `npm run test:ui` (browser test with Playwright, needs `npx playwright install chromium` once).

## Look and feel
The Simba Tech logo is in the sidebar, login screen and browser tab. A faint event photo sits behind every page. The Day / Night button (sidebar, or top of the page on phones) switches theme. First visit picks Day between 6am and 6pm, and your choice is remembered. Images are in `public/` (`logo.png`, `bg.jpg`, `favicon.png`); replace them to change branding.

## What is stored in Neon
Staff, appearances (rate frozen when recorded), monthly bonuses and payments with reference codes.
Refreshing or opening the app on another device shows the same data.

## Project layout
- `public/`: the SAP2 screen (`index.html`, talks to `/api`) and its images
- `src/server.js`: API + serves `public/`
- `src/admin/`: performance module (`engine.js` pure calculation, `performance.js` service + audit, `api.js` routes, `schema.js` + `migrate.js` safe migrations, `payroll.js` payroll hook, `store.js` data access)
- `public/perf.js`, `public/perf.css`: the new screens (loaded by `index.html`)
- `tests/`: engine + workflow tests, `tests/ui/` browser test with a mock server
- `schema.sql`, `src/migrate.js`, `src/seed.js`, `data/seed.json`: database setup

## API
Performance routes are documented in `docs/API.md` (`/api/admin/*`).

GET /api/health · GET /api/dashboard · GET/POST /api/staff · GET/PATCH /api/staff/:id (`?reveal=true` shows full account number)
GET/POST /api/appearances · DELETE /api/appearances/:id · GET /api/payroll?month=YYYY-MM · PUT /api/bonuses
POST /api/payroll/pay · GET /api/payments

## Security and hosting
- The app always requires a sign-in, locally and online: an administrator access code, or a staff office code. Codes are stored only as hashes and 10 wrong tries lock a connection for 15 minutes.
- An `API_KEY` environment variable, if you set one, is also accepted as an administrator code. See `NETLIFY.md`.
- Staff bank details are stored here, so use a long API_KEY online and never share `.env`.

## Notes on your data
- One instructor's email is stored as "Peter", so the app flags it under "Data check".
- Some phone numbers have 10 digits (leading 0 dropped) and some account numbers are under 10 digits. Kept as given.
- Two people (Chidozie Collins Achusiogu, Harrison Okon David) are both admin and instructor, so they get a salary row and an appearance row.
- Changing an instructor's rate affects new appearances only. Past ones keep the rate they were recorded with.
- Keep `.env` private. The database holds bank details.
