# 006 — Impersonation Fix + Merge Playground

**Created:** 2026-03-29 06:41 IST  
**Priority:** CRITICAL — Blocks daily operations  
**Scope:** Backend + Frontend (Refinery Nexus)  
**Status:** 🚧 In Progress

---

## Objective

Two deliverables:

1. **Fix superadmin impersonation** — eliminate localhost redirects and password prompts. Implement proper session-swap impersonation with role-based access control.
2. **Build Merge Playground** — a production-grade, first-class tab inside the Ingestion page for merging data from multiple ingested files into consolidated records. Dynamic, modular, unlimited file selection, column mapping, live preview, and materialization.

---

## Part A: Impersonation Fix

### Root Cause

The current system uses `supabaseAdmin.auth.admin.generateLink({ type: 'magiclink' })` which:
- Generates a link pointing to Supabase's auth domain
- Supabase redirects to `env.frontendOrigin` which defaults to `localhost:5173` if `FRONTEND_URL` is misconfigured
- Requires the user to "verify" the magic link — not true impersonation
- The "End Session" button just redirects to `/login` — no session restoration

### Architecture (Fixed)

```
Superadmin clicks "Impersonate" on Team page
        ↓
Frontend calls POST /api/admin/impersonate { userId }
        ↓
Backend validates:
  - Caller is superadmin
  - Target exists
  - If target is superadmin → set readOnly flag
  - If target is non-superadmin → full access
        ↓
Backend generates session tokens for target user:
  supabaseAdmin.auth.admin.generateLink({ type: 'magiclink' })
  → Extract token_hash + OTP from the returned link
  → Use supabase.auth.verifyOtp() server-side to get session
  → Return { access_token, refresh_token, readOnly } to frontend
        ↓
Frontend:
  1. Stores superadmin's current session in sessionStorage:
     { access_token, refresh_token, user_id }
  2. Calls supabase.auth.setSession({ access_token, refresh_token })
  3. Stores readOnly flag in sessionStorage
  4. AuthContext detects session change → re-fetches profile → renders as target user
  5. ImpersonationBanner shows with target user info and readOnly badge
        ↓
"End Session" button:
  1. Reads superadmin session from sessionStorage
  2. Calls supabase.auth.setSession() with superadmin tokens
  3. Clears impersonation state from sessionStorage
  4. AuthContext re-fetches profile → back to superadmin view
```

### Files to Modify

| File | Change |
|------|--------|
| `refinery-backend/src/services/admin.ts` | Replace `generateImpersonationLink()` with `generateImpersonationSession()` — returns tokens + readOnly flag instead of a URL |
| `refinery-backend/src/routes/admin.ts` | Update `/impersonate` endpoint to return session object instead of link |
| `axiom-data-hub/src/pages/Team.tsx` | `impersonateUser()` — use `supabase.auth.setSession()` instead of `window.location.href` |
| `axiom-data-hub/src/components/ImpersonationBanner.tsx` | Store/restore full session (access+refresh), show readOnly badge, proper "End Session" logic |
| `axiom-data-hub/src/auth/AuthContext.tsx` | Add impersonation awareness — expose `isImpersonating` and `isReadOnly` flags |

### Steps

- [ ] **A1.** Backend: Create `generateImpersonationSession(userId)` in `services/admin.ts`
  - Fetch target user's email via admin API
  - Generate magic link → extract token parameters
  - Verify OTP server-side to obtain session tokens
  - Determine readOnly flag based on target user's role
  - Return `{ access_token, refresh_token, user: { id, email, role }, readOnly }`

- [ ] **A2.** Backend: Update `POST /api/admin/impersonate` route in `routes/admin.ts`
  - Call new `generateImpersonationSession()` instead of `generateImpersonationLink()`
  - Return session object to frontend
  - Audit log the impersonation event

- [ ] **A3.** Frontend: Update `impersonateUser()` in `Team.tsx`
  - Store current superadmin session: `{ access_token: session.access_token, refresh_token: session.refresh_token }`
  - Store readOnly flag
  - Call `supabase.auth.setSession()` with impersonated user's tokens
  - No page redirect — session swap happens in-place

- [ ] **A4.** Frontend: Rebuild `ImpersonationBanner.tsx`
  - Read impersonation state from sessionStorage (not just return_token)
  - Show readOnly badge when impersonating another superadmin
  - "End Session" restores superadmin's session via `supabase.auth.setSession()`
  - Smooth transition — no page reload

- [ ] **A5.** Frontend: Extend `AuthContext.tsx`
  - Add `isImpersonating: boolean` and `isReadOnly: boolean` to context
  - Derive from sessionStorage on mount
  - When `isReadOnly` is true, all write operations should be blocked at the UI level

- [ ] **A6.** Test the full flow:
  - SA impersonates member → full write access ✓
  - SA impersonates another SA → readOnly view ✓
  - "End Session" → returns to original SA account ✓
  - No localhost redirect ✓
  - No password prompt ✓

---

## Part B: Merge Playground

### Current State

**Backend:** Solid merge infrastructure exists in `routes/ingestion.ts` (lines 358-672):
- `GET /merge/keys` — discovers candidate merge columns
- `GET /merge/preview` — previews merged data via anyIf GROUP BY
- `POST /merge/execute` — materializes merge (tmp table → atomic swap)
- `GET /merge/export` — exports merged CSV without materializing

**Frontend:** Handler functions exist in `Ingestion.tsx` (lines 196-419) but the UI is a hidden collapsible panel — not a proper tab.

**Problem:** The current system merges ALL data in `universal_person` by a key. There's no way to:
- Select specific ingestion jobs (files) to include in the merge
- See which files contribute which columns
- Map/exclude columns per file
- Preview before committing

### Architecture (New)

```
┌──────────────────────────────────────────────────────┐
│  MERGE PLAYGROUND TAB (inside Ingestion page)         │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ STEP 1: SELECT FILES                             │ │
│  │                                                   │ │
│  │ Completed ingestion jobs listed with:              │ │
│  │ - File name, date, row count, column count        │ │
│  │ - Checkbox selection (unlimited)                  │ │
│  │ - Column preview on hover/expand                  │ │
│  │ - Search/filter by file name                      │ │
│  │                                                   │ │
│  │ Selected: 3 files | 142,500 total rows            │ │
│  └─────────────────────────────────────────────────┘ │
│                        ↓                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ STEP 2: DETECT & SELECT MERGE KEY                │ │
│  │                                                   │ │
│  │ Common columns across selected files:             │ │
│  │                                                   │ │
│  │ ★ up_id                                           │ │
│  │   ├── contacts.csv:  42,000 unique (100% fill)   │ │
│  │   ├── intent.csv:    38,200 unique (99% fill)    │ │
│  │   └── behavior.csv:  35,800 unique (97% fill)    │ │
│  │   Match overlap: 34,900 shared keys (90.8%)       │ │
│  │   [SELECT AS MERGE KEY]                           │ │
│  │                                                   │ │
│  │ ○ business_email                                  │ │
│  │   ├── contacts.csv: 41,500 unique                │ │
│  │   └── intent.csv: 0 unique (not present)         │ │
│  │   ⚠ Only in 1/3 files — poor merge candidate     │ │
│  └─────────────────────────────────────────────────┘ │
│                        ↓                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ STEP 3: COLUMN MAPPING                            │ │
│  │                                                   │ │
│  │ For each selected file, which columns to include: │ │
│  │                                                   │ │
│  │ ┌─ contacts.csv ──────────────────────────────┐  │ │
│  │ │ ☑ up_id (merge key — always included)        │  │ │
│  │ │ ☑ first_name         ☑ last_name             │  │ │
│  │ │ ☑ business_email     ☑ mobile_phone          │  │ │
│  │ │ ☐ dpv_code (exclude) ☑ linkedin_url          │  │ │
│  │ │ [Select All] [Deselect All]                  │  │ │
│  │ └──────────────────────────────────────────────┘  │ │
│  │                                                   │ │
│  │ ┌─ intent.csv ────────────────────────────────┐  │ │
│  │ │ ☑ up_id (merge key — always included)        │  │ │
│  │ │ ☑ belief             ☑ intent_url            │  │ │
│  │ │ ☑ page_visits        ☑ interest_score        │  │ │
│  │ │ [Select All] [Deselect All]                  │  │ │
│  │ └──────────────────────────────────────────────┘  │ │
│  │                                                   │ │
│  │ Total unique columns after merge: 28              │ │
│  │ Excluded: 1 (dpv_code)                            │ │
│  └─────────────────────────────────────────────────┘ │
│                        ↓                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ STEP 4: PREVIEW & EXECUTE                        │ │
│  │                                                   │ │
│  │ ┌─ Summary ──────────────────────────────────┐   │ │
│  │ │ Before: 142,500 rows (across 3 files)       │   │ │
│  │ │ After:  ~34,900 consolidated records        │   │ │
│  │ │ Reduction: 75.5%                            │   │ │
│  │ │ Orphan rows (no key match): 2,300           │   │ │
│  │ └────────────────────────────────────────────┘   │ │
│  │                                                   │ │
│  │ [Preview Merged Data ▾]                           │ │
│  │ ┌────────────────────────────────────────────┐   │ │
│  │ │ Paginated table with search, sort, filter   │   │ │
│  │ │ Color-coded: green = merged, yellow = solo  │   │ │
│  │ └────────────────────────────────────────────┘   │ │
│  │                                                   │ │
│  │ [Export as CSV]  [⚡ MATERIALIZE MERGE]            │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### New Backend Routes

| Route | Purpose |
|-------|---------|
| `GET /merge/sources` | List completed ingestion jobs with their column schemas (which columns each file contributed) |
| `GET /merge/common-keys` | Given selected job IDs, find columns present in 2+ jobs with match rates and overlap stats |
| `GET /merge/preview-selective` | Preview merged data using ONLY rows from selected jobs, with column include/exclude |
| `POST /merge/execute-selective` | Materialize merge for selected jobs only (not entire table) |

### Backend Route Details

#### `GET /merge/sources`
```
Response: {
  sources: [{
    jobId: string,
    fileName: string,
    rowCount: number,
    completedAt: string,
    columns: string[],         // columns this file contributed (non-empty)
    columnCount: number,
  }]
}
```
**Logic:** Query `ingestion_jobs` for completed jobs. For each job, query `system.columns` for `universal_person` and then check which columns have non-empty values WHERE `_ingestion_job_id = jobId`. Only return columns that actually have data for that job.

#### `GET /merge/common-keys?jobIds=id1,id2,id3`
```
Response: {
  candidates: [{
    column: string,
    type: string,
    filesPresent: number,      // how many of the selected files have this column populated
    totalFiles: number,        // total selected files
    perFile: [{
      jobId: string,
      fileName: string,
      uniqueValues: number,
      fillRate: number,        // percentage of rows with non-empty value
    }],
    overlapCount: number,      // distinct values appearing in 2+ files
    overlapRate: number,       // overlap / max(uniqueValues) * 100
    recommendation: 'excellent' | 'good' | 'poor',
  }]
}
```
**Logic:** For each column in the union of selected jobs' columns, run a ClickHouse query that:
1. Counts distinct non-empty values per job
2. Counts how many distinct values appear in 2+ of the selected jobs (overlap)
3. Calculates overlap rate

#### `GET /merge/preview-selective?jobIds=...&key=...&excludeCols=...&page=&pageSize=&search=&sortBy=&sortDir=`
Same as current `/merge/preview` but:
- Filters by `_ingestion_job_id IN (selected jobs)` instead of entire table
- Supports `excludeCols` parameter to omit specific columns from result
- Returns which source file each merged value came from (provenance tracking)

#### `POST /merge/execute-selective`
```
Body: {
  jobIds: string[],
  key: string,
  excludeColumns: string[],
}
```
Same atomic swap logic as current `/merge/execute` but scoped to selected jobs only. Rows from non-selected jobs remain untouched.

### Files to Modify

| File | Change |
|------|--------|
| `refinery-backend/src/routes/ingestion.ts` | Add 4 new routes, remove old `/merge/*` routes |
| `axiom-data-hub/src/pages/Ingestion.tsx` | Rip out old merge panel. Add "Merge Playground" tab with 4-step wizard UI |

### Steps

- [ ] **B1.** Backend: Add `GET /merge/sources` route
  - Query completed ingestion jobs from ClickHouse
  - For each job, discover which columns have actual data
  - Return structured list with column schemas

- [ ] **B2.** Backend: Add `GET /merge/common-keys` route
  - Accept `jobIds` query parameter (comma-separated)
  - For each column in union of selected jobs, compute:
    - Distinct values per job
    - Cross-job overlap count
    - Fill rates
  - Sort by overlap rate descending
  - Return with recommendation labels

- [ ] **B3.** Backend: Add `GET /merge/preview-selective` route
  - Accept `jobIds`, `key`, `excludeCols`, pagination params
  - Build anyIf GROUP BY query scoped to selected job IDs only
  - Return paginated preview with before/after counts

- [ ] **B4.** Backend: Add `POST /merge/execute-selective` route
  - Accept `jobIds`, `key`, `excludeColumns`
  - Create tmp table → insert merged rows (scoped to selected jobs) → insert non-selected rows as-is → atomic swap
  - Return before/after stats

- [ ] **B5.** Frontend: Rip out old merge panel state and handlers from `Ingestion.tsx`
  - Remove: `showMergePanel`, `mergeKeyCandidates`, `selectedMergeKey`, `mergePreview`, etc.
  - Remove: `loadMergeKeys`, `fetchMergePreview`, `executeMerge`, `exportMergedData`
  - Keep: the utility functions (`formatBytes`, `formatNumber`, etc.)

- [ ] **B6.** Frontend: Build Step 1 UI — File Selection
  - Add "Merge Playground" tab alongside existing tabs (Sources, Files, Jobs, Rules)
  - List completed ingestion jobs as selectable cards
  - Show file name, date, row count, column count
  - Checkbox selection with "Select All" option
  - Search/filter by file name
  - Bottom summary bar: "N files selected | X total rows"

- [ ] **B7.** Frontend: Build Step 2 UI — Key Detection
  - Once 2+ files selected, call `/merge/common-keys`
  - Display candidate columns with:
    - Per-file stats (unique values, fill rate)
    - Cross-file overlap rate with visual progress bar
    - Color-coded recommendation badge (green/yellow/red)
  - Radio buttons to select the merge key
  - Auto-select the best candidate

- [ ] **B8.** Frontend: Build Step 3 UI — Column Mapping
  - For each selected file, show expandable card listing its columns
  - Checkboxes to include/exclude each column
  - Merge key column always checked and disabled
  - "Select All" / "Deselect All" per file
  - Bottom summary: "N unique columns after merge | M excluded"

- [ ] **B9.** Frontend: Build Step 4 UI — Preview & Execute
  - Summary stats card: before rows → after rows, reduction %, orphan count
  - "Preview Merged Data" button → loads paginated table
  - Table with search, column sort, page navigation
  - Color-coding: cells with merged values = green, single-source = neutral
  - "Export as CSV" button
  - "⚡ MATERIALIZE MERGE" button with confirmation dialog
  - Success/error feedback with stats

- [ ] **B10.** Frontend: Polish — UX for Tommy-proof operation
  - Step indicator breadcrumb at top (Step 1 → 2 → 3 → 4)
  - "Back" buttons between steps
  - Inline help text on every section explaining what it does
  - Loading skeletons on all async operations
  - Smooth transitions between steps using CSS animations
  - Empty states with clear CTAs for each step

---

## Part C: Future — AI-Powered Lead Insights (Phase 2)

> **NOT in current scope.** Built only after Merge Playground is production-stable.

### Vision

After a merge is previewed or materialized, offer an "Analyze Leads" button that sends a representative sample to an AI endpoint for:

1. **Lead Quality Scoring** — Rate each lead 1-100 based on completeness, title seniority, company size, intent signals
2. **Segment Recommendations** — "You have 4,200 C-suite leads in tech companies with high intent — create a segment?"
3. **Data Completeness Report** — "78% of leads have email, 45% have phone, only 12% have LinkedIn"
4. **Value Indicators** — Cross-reference job titles, company revenue, intent scores to rank leads
5. **Anomaly Detection** — Flag suspicious patterns (all same domain, fake names, bot traffic)

### Architecture Sketch
```
Merged Data → Sample N rows → AI Provider (OpenAI/Anthropic)
                                    ↓
                              Structured JSON response
                                    ↓
                              Dashboard cards with insights
```

This will be a separate plan (`007-ai-lead-insights.md`) when the time comes.

---

## Execution Order

1. ~~Read and understand plan~~ ✅
2. [ ] **A1–A6:** Impersonation fix (backend → frontend → test)
3. [ ] **B1–B4:** Merge Playground backend routes
4. [ ] **B5–B10:** Merge Playground frontend (rip old → build new)
5. [ ] End-to-end testing
6. [ ] Deploy to VPS
7. [ ] Session log

---

*This plan must be followed exactly. No shortcuts. No "we'll add that later." Every step is production-grade or it doesn't ship.*
