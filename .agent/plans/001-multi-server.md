# Plan 001 — Multi-Server Support (Server Pool)

**Priority**: HIGH  
**Estimated effort**: 2–3 hours  
**Status**: ✅ Done

## Goal
Allow connecting multiple ClickHouse and S3/Linode servers. Users can select which server to use for each operation. Superadmins can add, edit, and remove server connections from the UI.

## Architecture

```
servers table (Supabase PostgreSQL)
├── id (uuid)
├── name ("Production US", "Staging EU")
├── type ("clickhouse" | "s3" | "linode")
├── host (encrypted or plaintext URL)
├── port (number)
├── username (string)
├── password (encrypted — stored in Supabase Vault if available)
├── database (string, for ClickHouse)
├── bucket (string, for S3/Linode)
├── region (string, for S3/Linode)
├── access_key (encrypted, for S3/Linode)
├── secret_key (encrypted, for S3/Linode)
├── is_default (boolean — only one per type)
├── is_active (boolean)
├── created_by (uuid → profiles.id)
├── created_at (timestamp)
└── updated_at (timestamp)
```

## Implementation Steps

### Step 1: Database Migration (Supabase)
**File**: `axiom-data-hub/supabase/migrations/007_servers.sql`

- [ ] Create `servers` table with columns above
- [ ] Add RLS policies: superadmins can CRUD, all authenticated users can SELECT
- [ ] Add unique constraint: only one `is_default = true` per type
- [ ] Add trigger to enforce single-default (unset others when setting one)

### Step 2: Backend — Server Registry Service
**File**: `refinery-backend/src/services/servers.ts`

- [ ] `listServers()` — fetch all from Supabase
- [ ] `getServer(id)` — fetch one
- [ ] `getDefaultServer(type)` — fetch default for a type
- [ ] `createServer(data)` — insert new connection
- [ ] `updateServer(id, data)` — update connection
- [ ] `deleteServer(id)` — soft delete (set is_active = false)
- [ ] `testConnection(id)` — ping the server and return status

### Step 3: Backend — Dynamic ClickHouse Client
**File**: `refinery-backend/src/db/clickhouse.ts` (modify existing)

- [ ] Replace singleton client with a factory: `getClickHouseClient(serverId?: string)`
- [ ] Cache clients by server ID (avoid creating new connections per request)
- [ ] Fall back to default server if no serverId provided
- [ ] Add connection pooling / cleanup for stale connections

### Step 4: Backend — Server Routes
**File**: `refinery-backend/src/routes/servers.ts`

- [ ] `GET /api/servers` — list all
- [ ] `POST /api/servers` — create (superadmin only)
- [ ] `PUT /api/servers/:id` — update (superadmin only)
- [ ] `DELETE /api/servers/:id` — deactivate (superadmin only)
- [ ] `POST /api/servers/:id/test` — test connection
- [ ] `POST /api/servers/:id/set-default` — make default

### Step 5: Backend — Plumb Server Selection into Data Routes
**Files**: All backend routes (ingestion, database, segments, etc.)

- [ ] Accept optional `serverId` query param or header (`X-Server-Id`)
- [ ] Pass to `getClickHouseClient(serverId)` instead of using global client
- [ ] Audit log which server was used for each operation

### Step 6: Frontend — Server Config UI
**File**: `axiom-data-hub/src/pages/Config.tsx` (add "Servers" tab/section)

- [ ] Server list table (name, type, host, status, default badge)
- [ ] "Add Server" modal/form with all fields
- [ ] "Test Connection" button with live status indicator
- [ ] "Set as Default" toggle
- [ ] Edit/Delete actions (superadmin only via `<Can do="canEditConfig">`)

### Step 7: Frontend — Server Selector Widget
**File**: `axiom-data-hub/src/components/ServerSelector.tsx`

- [ ] Dropdown component showing available servers for the current page type
- [ ] Persists selection to localStorage per page
- [ ] Fires `onServerChange(serverId)` callback
- [ ] Shows connection status dot (green/red)

### Step 8: Frontend — Plumb Selector into Data Pages
**Files**: Dashboard, Ingestion, Database, Segments, Verification, Targets, Queue

- [ ] Add `<ServerSelector />` to page header
- [ ] Pass selected `serverId` to all API calls
- [ ] Show which server is active in the header

## Security Considerations
- Server credentials (passwords, API keys) must be encrypted at rest
- Only superadmins can create/edit/delete server connections
- All authenticated users can view server names (not credentials)
- Connection testing should timeout after 5 seconds
- Audit log every server CRUD operation

## Dependencies
- Supabase Vault (optional, for credential encryption)
- Backend needs to restart ClickHouse connections when config changes (or use dynamic factory)
