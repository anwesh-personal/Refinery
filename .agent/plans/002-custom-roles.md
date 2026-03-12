# Plan 002 — Custom Role CRUD UI

**Priority**: MEDIUM  
**Estimated effort**: 1.5 hours  
**Status**: 🔲 Not started  
**Prerequisites**: Migration 005 already applied (custom_roles table exists)

## Goal
Build a UI for superadmins to create, edit, and delete custom roles. Each custom role has a name, description, and a set of permissions. Users can then be assigned a custom role from the Team page.

## Existing Database Schema (from migration 005)

```sql
CREATE TABLE custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Implementation Steps

### Step 1: Backend — Custom Roles Service
**File**: `refinery-backend/src/services/customRoles.ts` (NEW)

- [ ] This is a thin Supabase proxy — uses `supabaseAdmin` client
- [ ] `listRoles()` — SELECT all from custom_roles
- [ ] `getRole(id)` — SELECT one
- [ ] `createRole(name, description, permissions)` — INSERT
- [ ] `updateRole(id, data)` — UPDATE
- [ ] `deleteRole(id)` — DELETE (check if any profiles reference it first)
- [ ] All operations write to audit_log

### Step 2: Backend — Custom Roles Routes
**File**: `refinery-backend/src/routes/customRoles.ts` (NEW)

- [ ] `GET /api/custom-roles` — list all (any authenticated user)
- [ ] `POST /api/custom-roles` — create (superadmin only)
- [ ] `PUT /api/custom-roles/:id` — update (superadmin only)
- [ ] `DELETE /api/custom-roles/:id` — delete (superadmin only, fail if in use)

### Step 3: Frontend — Roles Management UI
**Option A**: Add as a tab inside the Team page  
**Option B**: Add as a section in the Config page  
**Recommendation**: Tab inside Team page (it's about user management)

**File**: `axiom-data-hub/src/pages/Team.tsx` (add "Roles" tab)

- [ ] Tab bar at the top: "Members" | "Roles"
- [ ] Members tab = current team list + side panel
- [ ] Roles tab = new UI:
  - [ ] List of custom roles (name, description, permission count, users assigned)
  - [ ] "Create Role" button → modal/inline form
  - [ ] Click role → expand to show permission checkboxes (same grid as user permissions)
  - [ ] Edit name/description inline
  - [ ] Delete button (disabled if role is in use)

### Step 4: Frontend — Assign Custom Role to User
**File**: `axiom-data-hub/src/pages/Team.tsx` (modify side panel)

- [ ] In the user side panel, add a "Custom Role" dropdown below the base role selector
- [ ] Options: "None" + all custom roles from the DB
- [ ] When a custom role is selected, its permissions MERGE on top of the base role defaults
- [ ] Visual: show which permissions come from base role vs custom role vs per-user override

### Step 5: AuthContext — Resolve Custom Role Permissions
**File**: `axiom-data-hub/src/auth/AuthContext.tsx`

- [ ] Update `resolvePermissions()` to accept optional custom role permissions
- [ ] Resolution order: Base Role Defaults → Custom Role Overrides → Per-User Overrides
- [ ] Update `ProfileRow` to include `custom_role_id` and optionally fetched custom role data

## UI Mockup (Roles Tab)

```
┌─────────────────────────────────────────────────────────┐
│  Members  │  Roles                                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [+ Create Role]                                         │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │ 📋 Sales Manager                              │       │
│  │    Can view dashboard, segments, targets.     │       │
│  │    4 permissions · 2 users assigned           │       │
│  │    [Edit] [Delete]                            │       │
│  └──────────────────────────────────────────────┘       │
│  ┌──────────────────────────────────────────────┐       │
│  │ 📋 Data Analyst                               │       │
│  │    Can view database, execute queries.        │       │
│  │    3 permissions · 1 user assigned            │       │
│  │    [Edit] [Delete]                            │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Permissions Resolution Visual (User Side Panel)

```
Permission: Execute SQL Queries
  ├── Base Role (member):           ❌ (default off)
  ├── Custom Role (Data Analyst):   ✅ (override)
  └── Per-User Override:            — (not set)
  ═══ Effective:                    ✅
```
