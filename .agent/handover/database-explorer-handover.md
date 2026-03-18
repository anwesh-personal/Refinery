# Database Explorer Handover — Fix & Complete

## What Was Requested

The user wants the **Database page** (`/database`) to have **two tabs**:

1. **Data Explorer** (default tab) — A fully graphical, point-and-click UI for a non-technical partner. No SQL knowledge required. Dropdowns, search bar, pagination, column picker, CSV export.
2. **SQL Editor** (second tab) — The existing raw SQL query editor for power users.

## What Was Done (Backend — COMPLETE)

### New Backend Endpoints (already deployed and working on server)

**File:** `refinery-backend/src/services/database.ts`
- Added `browseData(params)` — builds safe parameterized SELECT with WHERE, ORDER BY, LIMIT/OFFSET
- Added `getFilterOptions(column)` — returns `SELECT DISTINCT column FROM universal_person LIMIT 200`
- Added `getFilterableColumns()` — returns list of filterable column names
- Has a whitelist of `ALLOWED_COLUMNS` (35+ columns), `SEARCHABLE_COLUMNS` (7 columns for full-text search), and `FILTERABLE_COLUMNS` (10 columns for dropdown filters)

**File:** `refinery-backend/src/routes/database.ts`
- `POST /api/database/browse` — accepts `{ search, filters, page, pageSize, sortBy, sortDir, columns }`, returns `{ rows, total, page, pageSize, elapsed }`
- `GET /api/database/filter-options/:column` — returns string array of distinct values for that column
- `GET /api/database/filterable-columns` — returns array of filterable column names
- All existing endpoints still work: `GET /stats`, `GET /tables`, `POST /query`, `GET /health`

**These endpoints are already deployed on the server (107.172.56.66) and the PM2 process `refinery-api` has been restarted with them.**

### Browse API Contract

```
POST /api/database/browse
Content-Type: application/json

Request:
{
  "search": "john",                          // optional, searches across name/email/company
  "filters": {                               // optional, exact match filters
    "personal_state": "TX",
    "primary_industry": "Real Estate"
  },
  "page": 1,                                 // optional, default 1
  "pageSize": 50,                            // optional, default 50, max 200
  "sortBy": "last_name",                     // optional, must be in ALLOWED_COLUMNS
  "sortDir": "asc",                          // optional, "asc" or "desc"
  "columns": [                               // optional, defaults to 12 common columns
    "first_name", "last_name", "business_email", "company_name"
  ]
}

Response:
{
  "rows": [ { "first_name": "John", "last_name": "Doe", ... }, ... ],
  "total": 12345,
  "page": 1,
  "pageSize": 50,
  "elapsed": 42
}
```

### Filter Options API Contract

```
GET /api/database/filter-options/personal_state

Response: ["AL", "AK", "AZ", "AR", "CA", ...]
```

Filterable columns: `personal_state`, `primary_industry`, `seniority_level`, `department`, `gender`, `income_range`, `homeowner`, `company_state`, `business_email_validation_status`, `_verification_status`

---

## What Was Done (Frontend — BROKEN, NEEDS REWRITE)

**File:** `axiom-data-hub/src/pages/Database.tsx` (477 lines)

The current file was written but has these issues:

### Issues to Fix

1. **Unused imports** — `Check`, `SectionHeader`, `Input` are imported but never used. Remove them.

2. **Double-fire effect bug** — There are TWO useEffect hooks that both call `runBrowse()`:
   - Lines 131-136: Debounced search effect (fires 400ms after search changes)
   - Lines 139-144: Immediate effect (fires on filters, page, sortCol, sortDir, visibleCols, activeTab changes)
   
   **Problem:** `runBrowse` has `search` in its useCallback dependency array, so when search changes, `runBrowse` reference changes, which triggers BOTH effects. This causes duplicate API calls.
   
   **Fix:** Remove `search` from `runBrowse`'s dependency array and instead read it via a ref. Or consolidate into a single effect with debounce logic.

3. **Filter dropdown `appearance: 'none'`** — The select dropdowns have `appearance: 'none'` which removes the dropdown arrow, making them look like plain text inputs. Users won't know they're clickable. Either remove `appearance: 'none'` or add a custom chevron icon.

4. **Column picker doesn't close on outside click** — The column picker dropdown stays open until you click the button again. Add a click-outside handler.

5. **No loading skeleton** — When loading, the table just shows "Fetching data..." in a huge empty space. Should show a skeleton or at least a centered spinner.

### Current Structure (What to Keep)

The overall architecture is correct:
- Two-tab design with `activeTab` state (`'browse'` | `'sql'`)
- Data Explorer tab has: search input, filter dropdowns, column picker, results table, pagination
- SQL Editor tab has: table browser accordion, textarea with ⌘+Enter, copy SQL button
- Shared results grid with sortable columns, CSV export
- Stats cards at top showing total rows, tables, DB size, queries today

### Key State Variables

```typescript
activeTab: 'browse' | 'sql'          // which tab is active
search: string                        // search input for browse
page: number                          // current page for browse
filters: Record<string, string>       // active filter values
visibleCols: Record<string, boolean>  // which columns to show
filterOptions: Record<string, string[]> // dropdown options from API
query: string                         // SQL editor content
sortCol: string | null                // current sort column
sortDir: 'asc' | 'desc'              // sort direction
```

### API Helper

All API calls use `apiCall` from `src/lib/api.ts`:

```typescript
import { apiCall } from '../lib/api';

// GET
const stats = await apiCall<DbStats>('/api/database/stats');

// POST
const result = await apiCall<QueryResult>('/api/database/browse', {
  method: 'POST',
  body: { search, filters, page, pageSize: 50 }
});
```

### UI Components Available

From `src/components/UI.tsx`:
- `PageHeader({ title, sub, action })` — page title with optional action slot
- `StatCard({ label, value, sub, icon, color, colorMuted, delay })` — stat card
- `Button({ children, variant, icon, onClick, disabled, style })` — variants: 'primary', 'secondary', 'danger', 'ghost'
- `Input({ placeholder, value, onChange, type })` — Note: `onChange` takes `(v: string)` NOT `(e: ChangeEvent)`
- `SectionHeader({ title, action, onAction })` — section title with optional action link
- `ServerSelector` from `src/components/ServerSelector` — server type badge

### Available Lucide Icons Already Imported

`Database`, `Table2`, `Rows3`, `HardDrive`, `Play`, `Copy`, `Download`, `RefreshCw`, `Loader2`, `AlertCircle`, `CheckCircle2`, `ChevronDown`, `ChevronUp`, `Search`, `Filter`, `Columns`, `ChevronLeft`, `ChevronRight`

---

## Files Involved

| File | Status | Location |
|------|--------|----------|
| `refinery-backend/src/services/database.ts` | ✅ Complete | Backend service with browseData, getFilterOptions |
| `refinery-backend/src/routes/database.ts` | ✅ Complete | Routes for /browse, /filter-options, /filterable-columns |
| `axiom-data-hub/src/pages/Database.tsx` | ❌ Needs fix | Frontend page, has bugs listed above |
| `axiom-data-hub/src/lib/api.ts` | ✅ No changes needed | API helper utility |
| `axiom-data-hub/src/components/UI.tsx` | ✅ No changes needed | Shared UI components |

---

## Deployment Process

1. Commit and push to `main` branch
2. SSH into server: `ssh root@107.172.56.66` (password in `.agent/creds.md`)
3. On server:
   ```bash
   cd /root/refinery && git pull origin main
   # If backend changed:
   cd refinery-backend && npm run build && pm2 restart refinery-api
   # If frontend changed:
   cd axiom-data-hub && npm run build
   cp -r dist/* /home/anweshrath/htdocs/iiiemail.email/
   chmod -R 755 /home/anweshrath/htdocs/iiiemail.email/
   ```

4. Site is live at `https://iiiemail.email`

---

## Server Credentials

All credentials are in `.agent/creds.md` (gitignored). Key ones:
- **Server:** 107.172.56.66, root, password in creds file
- **CloudPanel:** https://107.172.56.66:8443
- **ClickHouse:** localhost:8123, default user
- **MinIO:** localhost:9000/9001
- **PM2 process:** `refinery-api` (backend on port 3001)

---

## Other Pages Status

| Page | Status |
|------|--------|
| Dashboard | ✅ Wired to live APIs |
| Database | ❌ Frontend bugs (this handover) |
| Ingestion | ✅ Wired — S3 browser, one-click ingest, connection testing |
| Segments | ✅ Wired — create/preview/execute/delete |
| Verification | ❌ Not wired yet (static mockup) |
| Targets | ❌ Not wired yet (static mockup) |

---

## TL;DR for Next Agent

1. Fix the unused imports in `Database.tsx` (remove `Check`, `SectionHeader`, `Input`)
2. Fix the double-fire useEffect bug (consolidate browse effects or use a ref for search)
3. Fix the filter dropdown appearance (add back the native dropdown arrow or custom chevron)
4. Add click-outside handler for column picker
5. Test locally with `npm run dev` then deploy
6. The backend is 100% done — all endpoints are live on the server
