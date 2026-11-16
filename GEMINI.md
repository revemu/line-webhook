# Workspace Rules & Guidelines

## Production Environment & Database
- **Production Host**: Runs on `hydromet.rid.go.th` under `/sites/line-webhook` (PM2 process `line-webhook`, port `4000`). Do not treat local Windows `.env` or legacy `boxch2` settings as production.
- **Database Engine**: Uses PostgreSQL directly on `127.0.0.1:5432` (database `soccerbot` via `pg` in `db/pool.js`). Do not route this app through `pgbouncer` (`6432`) or reintroduce MySQL-only SQL (`ON DUPLICATE KEY UPDATE`, `DATE_FORMAT`, `YEAR()`, `SHOW COLUMNS`, unquoted `rank`, or `VALUES (null, ...)`).
- **Schema Conventions**: `week_tbl.year` is `INTEGER`; `table_week_tbl` columns `g`/`a` are lowercase in PostgreSQL with `"G"`/`"A"` aliases preserved in `queryTableWeek`.

## Domain & Performance Invariants
- **Schedule Before Manual Matches**: Never allow creating manual matches (`public/update.shtml` or `POST /webhook/add_match`) when `match_stat_tbl` has `0` matches for that week—matches must originate from `/schedule`.
- **Zero-Idle Background Workers**: `scheduler/worker.js` must not poll `scheduled_task_tbl` on an interval (use boot load + `/reloadtasks` or task CRUD commands) and must not poll `slip_log`/`app_settings_tbl` at boot or while idle (wake only on `SLIP_NOTICED` IPC or `/verifyslips`, and stop immediately when `hasPending` becomes `false`).
- **Image Rendering & UI**: Keep `loadSystemFonts: false` with bundled `fonts/` and `utils/ramImageCache.js` RAM-first write-behind caching in `team_img.js`/`qr_gen.js`, keep `/dev/shm` ephemeral temp storage for `zbarimg` on Linux, and preserve `<link rel="icon" ... href="/webhook/favicon.svg">` across `public/*.shtml` views.

## Versioning
- **Auto Version Bump**: Whenever code changes or feature updates are completed, always bump the version in `package.json`, `package-lock.json`, and add a matching top entry in `CHANGELOG.md` (which `utils/version.js` reads dynamically) before committing.

## Git Workflow
- **Auto Commit & Push**: Whenever code changes or feature updates are completed, always stage (`git add`), commit with a descriptive message (`git commit`), and push immediately (`git push origin <branch>`) to remote repository without waiting for user prompting.
