# Changed files (compared with the previous SAP2)

New: `src/admin/auth.js` (login rules), `data/access-seed.json` (hashed first codes), `tests/auth.test.js`, `src/admin/{api,defaults,engine,migrate,payroll,performance,schema,store}.js`, `public/perf.js`, `public/perf.css`, `tests/engine.test.js`, `tests/admin.api.test.js`, `tests/ui/{mock-server.js,ui.test.js,run.sh}`, `docs/{API,PERFORMANCE,CHANGED-FILES}.md`.

Edited (small, additive):
- `src/server.js`: loads the admin module, actor/staff-portal middleware, administrative payroll rows use review data, `/api/payroll/pay` skips unapproved administrative rows and records the new payment columns, mounts `/api/admin`.
- `src/db.js`: Postgres DATE returned as text, NUMERIC as number.
- `src/migrate.js`: also runs the admin migration (`npm run migrate`).
- `public/index.html`: loads `perf.css` / `perf.js`, new nav items, mobile "More" menu, payroll rows carry the new fields, staff-portal headers, render hook.
- `package.json`: version 2.0.0, `test` and `test:ui` scripts. `README.md`: v2 notes.

Unchanged: instructor appearances, bonuses, payments tables and routes, seed data, Netlify wrapper, start scripts, schema.sql.
