# Plan 004 — Verify550 Frontend Wiring

**Priority**: MEDIUM  
**Estimated effort**: 1 hour  
**Status**: ✅ Done  
**Prerequisites**: Backend verification service is complete (`refinery-backend/src/services/verification.ts`)

## Goal
Connect the existing Verification page UI to the backend API. The backend already has full Verify550 integration with retry logic, batch management, and cancellation support. The frontend just needs to call these endpoints.

## What Exists

### Backend (DONE)
- `POST /api/verification/start` — start a verification batch
- `GET /api/verification/batches` — list all batches
- `GET /api/verification/batches/:id` — get batch status
- `POST /api/verification/batches/:id/cancel` — cancel a batch
- `GET /api/verification/stats` — overall verification stats
- `GET /api/verification/config` — get Verify550 config
- `PUT /api/verification/config` — update Verify550 config

### Frontend (EXISTS but not wired)
- `axiom-data-hub/src/pages/Verification.tsx` — has UI structure but makes no API calls

## Implementation Steps

### Step 1: API Client Utility
**File**: `axiom-data-hub/src/lib/api.ts` (NEW)

- [ ] Create a typed fetch wrapper that automatically:
  - Prepends `VITE_API_URL`
  - Adds `Authorization: Bearer {jwt}` header
  - Adds optional `X-Server-Id` header (for multi-server support)
  - Handles errors uniformly
  - Returns typed JSON

```typescript
export async function apiCall<T>(
  path: string,
  options?: { method?: string; body?: any; serverId?: string }
): Promise<T> {
  const session = await supabase.auth.getSession();
  const res = await fetch(`${API_URL}${path}`, {
    method: options?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.data.session?.access_token}`,
      ...(options?.serverId ? { 'X-Server-Id': options.serverId } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
  return res.json();
}
```

### Step 2: Wire Verification Page
**File**: `axiom-data-hub/src/pages/Verification.tsx`

- [ ] Import `apiCall` utility
- [ ] On mount: fetch `GET /api/verification/batches` and `GET /api/verification/stats`
- [ ] "Start Verification" button → calls `POST /api/verification/start` with selected segment/source
- [ ] Batch list: shows status, progress, results count
- [ ] Poll active batches every 5s for progress updates
- [ ] Cancel button → `POST /api/verification/batches/:id/cancel`
- [ ] Config section: load from `GET /api/verification/config`, save to `PUT /api/verification/config`

### Step 3: Wire Config Section
The Verification page should have a config section (collapsible) where superadmins can set:
- [ ] Verify550 API endpoint URL
- [ ] Verify550 API key (masked input)
- [ ] Batch size
- [ ] Concurrency level
- [ ] Save button → `PUT /api/verification/config`
- [ ] Permission gate: only show if `user.permissions.canEditVerifyConfig`

### Step 4: Batch Results View
When clicking a completed batch:
- [ ] Show breakdown: valid, invalid, risky, unknown, catch-all, disposable counts
- [ ] Progress bar colored by result type
- [ ] Option to download results as CSV

## Notes
- The `apiCall` utility created in Step 1 will be reused by ALL other pages (Database, Ingestion, Segments, etc.)
- This plan only wires the UI to existing backend endpoints — no backend changes needed
- Requires ClickHouse to be running for actual batch operations
