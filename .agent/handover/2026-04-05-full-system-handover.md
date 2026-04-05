# Refinery Nexus — Full System Handover
## Date: April 5, 2026

---

## 1. CORE ETHOS & NON-NEGOTIABLE RULES

This is a **$250 Million project in production**. The user (Anwesh) treats this as life/death. These rules are absolute:

- **NO MVPs, NO band-aids, NO shortcuts** — Everything must be production-grade, polished, fault-tolerant
- **NO hardcoding** — All config flows from UI → ClickHouse `system_config` → backend runtime
- **NO sloppy UI** — Every element must feel premium, modern, and tactile. Native checkboxes = unacceptable. Plain dropdowns = unacceptable
- **Superadmin controls everything** — roles, permissions, server connections, config
- **Think before you code** — Understand the full system before touching anything. Ask if unsure
- **Test thoroughly** — Type-check both frontend AND backend before committing
- **Deploy properly** — Always build + deploy both frontend and backend when changes span both

---

## 2. SERVER & DEPLOYMENT TOPOLOGY

| Component | Detail |
|-----------|--------|
| **Host** | Dedicated physical server `107.172.56.66` (NOT cloud/serverless) |
| **OS** | Ubuntu 24.04 LTS |
| **Runtime** | Node.js + PM2 (`refinery-api` process) |
| **ClickHouse** | Localhost `8123` (HTTP) / `9000` (TCP), data on `/mnt/ssd/clickhouse` |
| **Postgres** | Supabase Cloud — auth, profiles, servers, ingestion_rules, API keys |
| **MinIO** | Local S3-compatible storage on `/mnt/sata`, proxied at `https://iiiemail.email/minio/` |
| **Proxy/SSL** | Nginx + Let's Encrypt. `/api` → backend, `/play` → ClickHouse, `/minio` → MinIO |
| **Frontend** | Static files at `/home/anweshrath/htdocs/iiiemail.email/` |
| **Domain** | `https://iiiemail.email` |
| **Bandwidth** | 30TB/month (currently using ~2% = ~600GB/month). Internal ClickHouse processing = zero bandwidth cost |
| **SSH** | `ssh root@107.172.56.66` — password in `.agent/creds.md` |

### Deployment Commands
```bash
# On the server:
cd /root/refinery && git pull origin main

# Frontend:
cd axiom-data-hub && npm run build
cp -r dist/* /home/anweshrath/htdocs/iiiemail.email/

# Backend:
cd refinery-backend && npx tsc -b && pm2 restart refinery-api
```

### Nginx Cache Fix
Nginx forces `Cache-Control: no-cache` on `index.html` so browser always gets latest JS bundle on reload.

---

## 3. TECH STACK

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite, `axiom-data-hub/` |
| **Backend** | Express.js + TypeScript, `refinery-backend/` |
| **Analytics DB** | ClickHouse (MergeTree engine, 121M+ rows in `universal_person`) |
| **Auth DB** | Supabase (Postgres) — profiles, servers, teams, roles |
| **Object Storage** | MinIO (S3-compatible), AWS S3, Linode S3 |
| **Icons** | lucide-react |
| **Auth** | Supabase Auth → JWT → `requireAuth` / `requireSuperadmin` middleware |
| **Process Manager** | PM2 (`refinery-api`) |
| **CSS** | Vanilla CSS with CSS variables for theming |

### Project Structure
```
Refinery Nexus/
├── axiom-data-hub/          ← Frontend (React + Vite)
│   └── src/
│       ├── pages/           ← 30 page components
│       ├── components/      ← Shared UI components
│       ├── auth/            ← AuthContext, ProtectedRoute, permissions
│       └── lib/             ← api.ts, helpers
├── refinery-backend/        ← Backend (Express + TypeScript)
│   └── src/
│       ├── routes/          ← 32 route files
│       ├── services/        ← 34 service files (business logic)
│       ├── db/              ← clickhouse.ts, init.ts (schema)
│       ├── middleware/      ← auth.ts (requireAuth, requireSuperadmin)
│       ├── config/          ← env.ts
│       └── utils/           ← helpers.ts, sanitize.ts
└── .agent/                  ← Agent knowledge, handovers, workflows
```

---

## 4. CLICKHOUSE SCHEMA — CORE TABLE

```sql
CREATE TABLE universal_person (
    up_id                              String,
    first_name / last_name / ...       String columns (50+),
    _ingestion_job_id                  String,    -- internal: which job ingested this row
    _ingested_at                       DateTime,  -- internal: when ingested
    _search_text                       String,    -- internal: bloom-filtered search index
    _segment_ids                       String,    -- internal: segment membership
    _verification_status               String,    -- internal: email verification result
    _verified_at                       Nullable(DateTime),
    _v550_category                     String,    -- internal: Verify550 category
    _bounced                           UInt8 DEFAULT 0
) ENGINE = MergeTree()
    PARTITION BY personal_state
    ORDER BY (personal_state, primary_industry, up_id)
    SETTINGS index_granularity = 8192
```

**Key design decisions:**
- **Partitioned by `personal_state`** — US-centric data, most queries filter by state
- **ORDER BY (personal_state, primary_industry, up_id)** — `up_id` is the tiebreaker, used for keyset pagination
- **Internal columns** prefixed with `_` — hidden from users by default in Data Explorer
- **`_search_text`** — concatenated lowercase text with `ngrambf_v1` bloom filter index for fast LIKE searches

### Other ClickHouse Tables
- `system_config` — key/value config store (ReplacingMergeTree, use `FINAL`)
- `ingestion_jobs` — tracks all ingestion jobs with status, file info, retry_count
- `segments` — saved segment definitions
- `verification_batches` — email verification batch tracking
- `mta_providers` — SMTP relay configurations
- `smtp_servers` — outbound SMTP server pool

### Config Pattern (`system_config`)
```
CONFIG_DEFAULTS → getConfigInt(key, fallback) → runtime variable
```
All tuning parameters live in `system_config` and are editable from Server Config UI.


---

## 5. MODULE STATUS (as of April 5, 2026)

### A. Ingestion Engine (`/ingestion`) — ✅ PRODUCTION-READY
**Files:** `services/ingestion.ts` (1,153 lines), `routes/ingestion.ts` (38KB), `Ingestion.tsx` (107KB)

**Architecture:**
- Dynamic S3/MinIO/AWS bucket connections
- CSV + Parquet + Gzip parsing with binary data sanitization
- Concurrency-controlled queue (`acquirePipelineSlot`/`releasePipelineSlot`)
- Batch INSERT with configurable `BATCH_SIZE` (default 10,000 rows)
- `INSERT_TIMEOUT_MS` dynamically scales `max_execution_time` to match client timeout

**Self-Healing Recovery System (built April 5, 2026):**
- `recoverStaleIngestionJobs()` runs on PM2 startup
- Jobs stuck in `pending/downloading/uploading/ingesting` are detected
- `ingesting` jobs → partial rows deleted by `_ingestion_job_id` → re-enqueued
- `retry_count` column prevents infinite crash loops (max 3 retries)
- All recovery is idempotent and wrapped in try/catch

**Configurable Parameters (Server Config UI):**
| Key | Default | Description |
|-----|---------|-------------|
| `ingestion.max_concurrent` | 3 | Max parallel pipelines |
| `ingestion.batch_size` | 10,000 | Rows per INSERT batch |
| `ingestion.max_auto_retries` | 3 | Max auto-recovery retries |
| `ingestion.insert_timeout_sec` | 300 | Per-batch INSERT timeout |
| `ingestion.recovery_delay_sec` | 5 | Delay before recovery re-enqueue |

### B. Data Explorer (`/database`) — ✅ PRODUCTION-READY
**Files:** `services/database.ts` (538 lines), `routes/database.ts`, `Database.tsx` (118KB)

**Features:**
- Two tabs: **Data Explorer** (point-and-click) + **SQL Editor** (power users)
- Smart search: auto-detects email/domain/phone/LinkedIn/general text intent
- `_search_text` bloom filter index for O(1) text search on 121M+ rows
- Advanced filter builder: 10 operators (equals, contains, starts_with, between, is_null, etc.)
- Quick toggles: has_email, has_phone, has_linkedin (shortcut filters)
- Faceted drill-down: shows top values + counts for filtered results
- Completeness filter: high/medium/low data quality buckets
- Multi-source filter: filter by which ingestion job the data came from
- Column picker: grouped by category, with search, custom styled checkboxes
- Streaming CSV export: zero memory, all filtered rows, respects visible columns
- Row detail drawer: click any row to see full record

**Keyset Pagination (built April 5, 2026):**
- Sequential next/prev uses cursor: `WHERE (sort_col, up_id) > (val, id)` — O(1) at any depth
- Page jumps (typing a number) fall back to OFFSET
- Frontend tracks `cursorNext`/`cursorPrev` in state, passes via `pendingCursorRef`
- Backend returns cursor values in every browse response
- `up_id` always included in SELECT for cursor tracking

### C. Segmentation (`/segments`) — ✅ PRODUCTION-READY
**Files:** `services/segments.ts`, `routes/segments.ts`, `Segments.tsx`
- Visual query builder → ClickHouse SQL
- Real-time audience sizing
- Create, preview, execute, delete segments
- Export segment as CSV with streaming


### D. Email Verification — ✅ PRODUCTION-READY
**Two systems:**

1. **Verify550 API Integration** (`/verification`)
   - Wired to external V550 API: credits, single check, bulk CSV, job results, ZIP exports
   - Job Detail Modal: 27 suppression categories grouped into 4 color-coded groups (Safe, Risky, Dead, Threats)
   - Full results stored back in `_verification_status` and `_v550_category` columns

2. **Native SMTP Pipeline Studio** (`/email-verifier`)
   - Built-in MX lookup + HELO/RCPT TO verification
   - Port 25 confirmed open on dedicated server
   - Standalone tool: accepts raw text or CSV (up to 50K), instant results in browser
   - Multi-stage pipeline: syntax → MX → SMTP probe → catch-all detection
   - Configurable concurrency via `pipeline.smtp_concurrency`

### E. Server Config (`/config`) — ✅ PRODUCTION-READY
**Files:** `routes/config.ts`, `services/config.ts`, `Config.tsx`

- 11 configurable keys with hover tooltips explaining each setting
- Info icon on every setting with detailed guidance
- Superadmin-only PM2 restart button (red, danger variant)
  - Confirmation dialog warns about pipeline interruption
  - Response sent before restart (500ms delay)
  - Frontend polls `/api/config` every 1s to detect reboot, auto-reloads
- ClickHouse server management (add/test/delete)
- MinIO/S3 source configuration

### F. Dashboard (`/`) — ✅ PRODUCTION-READY
- Live stats: total rows, DB size, table count, segment count
- System health check

### G. Merge Playground (`/merge`) — ✅ PRODUCTION-READY
- Row-level deduplication across ingestion jobs
- `anyIf` merge logic for ClickHouse
- Preview, validate, and materialize merges

### H. AI Boardroom (`/boardroom`) — ✅ WIRED
- 5 AI agent personas: Sentinel, Cipher, Oracle, Crucible, Argus
- Multi-provider AI support (OpenAI, Anthropic, Google, etc.)
- AI-powered: lead scoring, ICP analysis, bounce analysis, campaign optimization, content generation, data enrichment, list segmentation

### I. Team Management (`/team`) — ✅ PRODUCTION-READY
- Role-based access: superadmin, admin, member
- Custom roles with granular permissions
- Team invitations and management

### J. Targets (`/targets`) — ⚠️ PARTIALLY WIRED
- Backend routes exist, frontend needs more integration

### K. Mail Queue (`/queue`) — ⚠️ PARTIALLY WIRED
- Backend routes exist, frontend partially connected

### L. Daemon Logs (`/logs`) — ⚠️ NEEDS WORK
- Frontend is a placeholder, needs real-time log tailing

### M. Interactive Tutorials (`/tutorial`) — ⚠️ NEEDS OVERHAUL
- Currently abstract visual demos, needs concrete instructional content


---

## 6. AUTH & PERMISSIONS SYSTEM

**Provider:** Supabase Auth (JWT tokens)

**Backend Middleware:**
- `requireAuth` — validates JWT, attaches `req.user`
- `requireSuperadmin` — checks `user.role === 'superadmin'`, returns 403 otherwise
- Both in `refinery-backend/src/middleware/auth.ts`

**Frontend:**
- `AuthContext` (`auth/AuthContext.tsx`) — provides `user`, `login`, `logout`, `role`
- `<Can do="canEditConfig">` component — conditional rendering based on permission
- `<ProtectedRoute>` — route-level access control
- User roles: `superadmin`, `admin`, `member`
- Custom roles system with granular permissions for specific features

**Pattern for new admin-only features:**
```typescript
// Backend route:
router.post('/dangerous-action', requireSuperadmin, async (req, res) => { ... });

// Frontend:
const { user } = useAuth();
const isSuperadmin = user?.role === 'superadmin';
{isSuperadmin && <Button variant="danger">Dangerous Action</Button>}
```

---

## 7. KEY SYSTEM PATTERNS

### API Call Pattern (Frontend)
```typescript
import { apiCall } from '../lib/api';

// GET
const data = await apiCall<SomeType>('/api/endpoint');

// POST
const result = await apiCall<ResultType>('/api/endpoint', {
  method: 'POST',
  body: { key: value }
});
```

### Config Pattern (Backend)
```typescript
import { getConfigInt, getConfig } from '../services/config.js';

// Numeric with fallback
const maxConcurrent = await getConfigInt('ingestion.max_concurrent', 5);

// String
const apiKey = await getConfig('mailwizz_api_key');
```

### ClickHouse Query Pattern
```typescript
import { query, command, insertRows } from '../db/clickhouse.js';

// Read
const rows = await query<{ name: string }>('SELECT name FROM table');

// Write
await insertRows('table_name', [{ col1: 'val1', col2: 'val2' }]);

// DDL
await command('ALTER TABLE ...');
```

### Streaming Export Pattern
```typescript
import { streamCSV } from '../db/clickhouse.js';

const stream = await streamCSV(sql, { timeoutMs: 300_000 });
for await (const rows of stream) {
  const text = rows.map(r => r.text).join('\n');
  res.write(text + '\n');
}
res.end();
```


---

## 8. APRIL 5, 2026 SESSION LOG

### What was built/fixed (in order):

1. **ClickHouse INSERT timeout fix** — `insertRows` now dynamically scales `max_execution_time` to match client timeout. Was hardcoded to 30s globally, causing EPIPE errors on large batches.

2. **Auto-recovery for ingestion jobs** — `recoverStaleIngestionJobs()` runs on PM2 startup. Detects jobs stuck in downloading/uploading/ingesting states. Cleans partial data for `ingesting` jobs, then re-enqueues. 3-retry cap via `retry_count` column prevents crash loops.

3. **Schema migration** — Added `retry_count UInt8 DEFAULT 0` to `ingestion_jobs` table (idempotent: `ADD COLUMN IF NOT EXISTS`).

4. **3 new configurable ingestion settings** — `max_auto_retries`, `insert_timeout_sec`, `recovery_delay_sec` added to `CONFIG_DEFAULTS`, `CONFIG_KEYS`, Server Config UI.

5. **Tooltips on ALL Server Config settings** — `Info` icon from lucide-react with pure CSS hover tooltips (`.config-tooltip-trigger`) on every config row. Professional, theme-aware.

6. **PM2 Restart button** (superadmin-only) — Red "Restart Server" button in System Settings. Confirmation dialog. Backend `POST /api/config/restart` sends response before `pm2 restart` (500ms delay). Frontend polls `/api/config` every 1s, auto-reloads when server responds.

7. **Premium Column Picker redesign** — Added search bar, custom styled checkboxes (accent-colored with checkmark icon), selection count badge on trigger button, group headers with active/total count, smooth fade-in animation, click-outside dismiss.

8. **Premium Sources Dropdown redesign** — Migrated from DOM `display:none` manipulation to React state. Added search bar, styled checkboxes, Layers icon, selection count badge, "Clear All" button, empty state message, click-outside dismiss.

9. **Keyset Pagination** — Hybrid cursor + offset. Sequential next/prev uses `WHERE (sort_col, up_id) > (val, id)` — O(1) at any depth. Page jumps fall back to OFFSET. Frontend tracks cursors in state, passes via `pendingCursorRef`. Backend always includes `up_id` in SELECT. COUNT query excludes cursor conditions for accuracy.


---

## 9. KEY FILES REFERENCE

### Backend — Critical Files
| File | Purpose |
|------|---------|
| `src/index.ts` | Express app setup, route mounting, startup recovery |
| `src/db/clickhouse.ts` | ClickHouse client, `query()`, `command()`, `insertRows()`, `streamCSV()` |
| `src/db/init.ts` | Schema definitions, `CREATE TABLE IF NOT EXISTS` statements |
| `src/services/ingestion.ts` | Ingestion pipeline, concurrency queue, recovery system |
| `src/services/database.ts` | Browse, search, filter, facets, export, keyset pagination |
| `src/services/config.ts` | `system_config` reader/writer, `getConfigInt()`, `CONFIG_DEFAULTS` |
| `src/services/verification.ts` | Email verification batch processing |
| `src/services/segments.ts` | Segment CRUD, ClickHouse SQL generation |
| `src/routes/config.ts` | Config CRUD + PM2 restart endpoint |
| `src/routes/database.ts` | Browse, query, facets, export, column stats, bulk delete |
| `src/routes/ingestion.ts` | File ingestion, job management, merge operations |
| `src/middleware/auth.ts` | `requireAuth`, `requireSuperadmin` |
| `src/utils/sanitize.ts` | `esc()`, `sanitizeValue()`, binary garbage removal |

### Frontend — Critical Files
| File | Purpose |
|------|---------|
| `src/pages/Database.tsx` | Data Explorer + SQL Editor (118KB, largest page) |
| `src/pages/Ingestion.tsx` | File browser, ingestion jobs, merge playground |
| `src/pages/Config.tsx` | Server management, system settings, PM2 restart |
| `src/pages/EmailVerifier.tsx` | Pipeline Studio (native SMTP verification) |
| `src/pages/Verification.tsx` | V550 batch verification |
| `src/pages/Segments.tsx` | Segment builder |
| `src/pages/Team.tsx` | Team management, roles, permissions |
| `src/auth/AuthContext.tsx` | Auth provider, user state, role checks |
| `src/components/UI.tsx` | PageHeader, Button, StatCard, Input, SectionHeader |
| `src/lib/api.ts` | `apiCall()` — typed fetch wrapper with JWT |
| `src/index.css` | Global styles, CSS variables, animations |

---

## 10. KNOWN ISSUES & REMAINING WORK

### Active Issues
- **Deep pagination with OFFSET fallback** — Page jumps to very high pages (e.g., page 100,000 typed manually) still use OFFSET. This is by design (rare, explicit user choice), but could be further optimized with approximate count + seek.

### Remaining Roadmap
| Priority | Task | Effort |
|----------|------|--------|
| 1 | **500-file bulk ingestion test** — validate recovery system end-to-end on production | Low |
| 2 | **Targets page wiring** — connect `/targets` frontend to backend routes | Medium |
| 3 | **Queue page wiring** — connect `/queue` frontend to backend routes | Medium |
| 4 | **Real-time logs** — implement log tailing via WebSocket or polling for `/logs` | Medium |
| 5 | **Tutorial overhaul** — replace abstract visual demos with concrete instructional content | High |
| 6 | **Code splitting** — Vite warns about 2.2MB bundle, consider dynamic `import()` | Medium |


---

## 11. GOTCHAS & LEARNINGS

### Things that WILL bite you if you don't know:

1. **ClickHouse `FINAL`** — `system_config` uses ReplacingMergeTree. ALWAYS use `FINAL` in SELECT or you'll get stale/duplicate rows: `SELECT * FROM system_config FINAL`

2. **Schema migrations must be idempotent** — Always use `ADD COLUMN IF NOT EXISTS`. The init script runs on every startup.

3. **Binary data in Parquet files** — Some source files contain binary garbage (null bytes, control characters) that corrupt ClickHouse INSERTs. The `sanitizeValue()` function in `utils/sanitize.ts` strips these. Never remove it.

4. **EPIPE errors on large INSERTs** — ClickHouse kills the connection if `max_execution_time` expires before the INSERT completes. The `insertRows` function now dynamically sets `max_execution_time` to match the client timeout. Don't hardcode it.

5. **PM2 restart kills background workers** — Any in-flight ingestion jobs get killed silently. That's why `recoverStaleIngestionJobs` exists. NEVER remove it from the startup sequence.

6. **Count query must NOT include cursor conditions** — If you include the keyset cursor in the WHERE for COUNT, you'll get a wrong total. The backend builds `countConditions` separately from `conditions`.

7. **`up_id` must always be in SELECT** — Even if the user doesn't select it, the backend adds it for cursor tracking. Without it, keyset pagination breaks.

8. **Supabase Auth tokens** — The frontend sends JWT in every request via `apiCall`. If auth fails, check the Supabase project URL and anon key in env.

9. **MinIO path** — Data is on `/mnt/sata` (SATA drives), ClickHouse data is on `/mnt/ssd` (SSD). Don't move ClickHouse to SATA or performance dies.

10. **Nginx caching** — If frontend changes aren't showing after deploy, it's the browser cache, not nginx (we already force `no-cache` on `index.html`). Hard reload (Cmd+Shift+R) fixes it.

11. **`loadIngestionConfig` must be called on config save** — When the user saves ingestion settings in the UI, the backend route must call `loadIngestionConfig()` to reload the runtime variables. Without this, changes don't take effect until PM2 restart.

---

## 12. CREDENTIALS

All credentials are in `.agent/creds.md` (gitignored). Key ones:
- **SSH:** `root@107.172.56.66`
- **CloudPanel:** `https://107.172.56.66:8443`
- **ClickHouse:** `localhost:8123`, default user
- **MinIO:** `localhost:9000/9001`
- **PM2 process:** `refinery-api` on port 3001
- **Supabase:** project URL and keys in frontend `.env` and backend `config/env.ts`
- **Verify550 API:** configured via Server Config UI

---

## 13. UI DESIGN STANDARDS

- **No native HTML checkboxes** — Use custom styled divs with accent-colored borders + CheckCircle2 icon
- **No plain dropdowns** — Every dropdown needs: search bar, styled items, smooth animation, click-outside dismiss
- **Hover effects on everything** — Buttons, rows, cards all need subtle hover transitions
- **CSS variables** — Use `var(--accent)`, `var(--bg-card)`, `var(--border)`, `var(--text-primary)`, etc. Never hardcode colors
- **Animations** — Use `animate-fadeIn` class, `transition: all 0.15s`
- **Icons** — Always use lucide-react. Import specifically, never import `*`
- **Tooltips** — Pure CSS hover (`.config-tooltip-trigger` pattern), not complex React state
- **Danger actions** — Red buttons with `variant="danger"`, confirmation dialogs
- **Loading states** — Skeleton loaders, not blank spaces. Spinner for actions in progress.

---

*This document supersedes `system_handover.md` (March 18, 2026) and `database-explorer-handover.md`. All issues documented in those files have been resolved.*

*Last updated: April 5, 2026, 7:30 PM IST*

---

## 14. APRIL 5 PM SESSION — INGESTION STABILIZATION & UX OVERHAUL

### Root Cause Fix: EPIPE & Socket Hang-up
- **Root cause identified:** The ClickHouse client's `request_timeout` was hardcoded at 30 seconds in `clickhouse.ts`. This is a *connection-level* ceiling that kills the socket BEFORE the per-query `AbortController` timeout can fire. Long batch INSERTs (5+ min for 20M rows) were being killed mid-stream → `EPIPE` / `socket hang up`.
- **Fix:** `request_timeout` set to 600 seconds (10 min ceiling). Individual operations still enforce stricter timeouts via AbortController.
- **Additional fix:** Disabled `async_insert` (set to `0`). ClickHouse was buffering writes and ACKing before data was committed, causing conflicts with retry logic and misleading success signals.
- **File:** `refinery-backend/src/db/clickhouse.ts` lines 8-24

### Real-Time Ingestion Progress & ETA
- **Backend:** New `getActiveProgress()` function in `services/ingestion.ts`
  - Queries active jobs + their current `rows_ingested`, `started_at`, `file_size_bytes`
  - Computes per-job throughput: `rows_ingested / elapsed_seconds`
  - Estimates total rows via `avg(file_size_bytes / rows_ingested)` from last 20 completed jobs
  - Per-job ETA: `(estimated_total - rows_ingested) / throughput`
  - Overall queue ETA: accounts for active + pending jobs, concurrency slots
- **Route:** `GET /api/ingestion/active-progress`
- **Frontend polling:** Every 3 seconds while jobs are active (separate from the 5s full data refresh)

### Premium Active Ingestion Banner (Redesigned)
- **Overall summary bar:** Pulsing icon, title, queue info, overall avg throughput (large green monospace), total ETA (accent-bordered box with large monospace)
- **Per-job rows:** Full-width with 4 prominent stat columns:
  | Column | Color | Description |
  |--------|-------|-------------|
  | ROWS | primary | Current rows ingested (monospace) |
  | ROWS/S | green | Real-time throughput |
  | ELAPSED | secondary | Time since job started |
  | ETA | accent (highlighted bg when active) | Estimated remaining time |
- **Step pipeline** with Download → Upload → Ingest progress indicators
- **Shimmer progress bar** during ingesting phase

### Ingestion Jobs Table — Month Grouping
- Jobs are grouped by month (e.g., "April 2026") with collapsible header rows
- Each month header shows: Calendar icon, month label, job count, total rows, total size, complete/total ratio
- Sort direction inherited from active sort order

### S3 File Browser — Ingestion Status Filter
- New dropdown filter in the toolbar: **All Status / ✓ Ingested / ○ Uningested / ⟳ In Progress**
- Counts shown in dropdown options
- Stacks with existing type filter (CSV/Parquet/GZ)
- Files also grouped by month with section headers (Calendar icon, file count, total size, ingested badge)

### Pending: Cred Management Page
- User requested a new Credential Management page (superadmin-only)
- Columns: Client Name, Email Server, Login Email, Login Password, Server IP, etc.
- Share mechanism with granular permissions (read, write, download) — similar to verification page
- **NOT YET BUILT** — parked for next session

