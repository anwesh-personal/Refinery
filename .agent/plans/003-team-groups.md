# Plan 003 — Team Groups UI

**Priority**: MEDIUM  
**Estimated effort**: 1.5 hours  
**Status**: 🔲 Not started  
**Prerequisites**: Migration 005 already applied (teams, team_memberships tables exist)

## Goal
Build a UI for superadmins to create named teams (groups), assign members to teams, and view team composition. Teams are organizational groupings — they don't affect permissions (custom roles handle that).

## Existing Database Schema (from migration 005)

```sql
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member', -- role within the team (team lead, member, etc.)
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id, user_id)
);
```

## Implementation Steps

### Step 1: Backend — Teams Service
**File**: `refinery-backend/src/services/teams.ts` (NEW)

- [ ] Uses `supabaseAdmin` client (same pattern as admin service)
- [ ] `listTeams()` — SELECT teams with member count
- [ ] `getTeam(id)` — SELECT team with full member list (joined with profiles)
- [ ] `createTeam(name, description)` — INSERT
- [ ] `updateTeam(id, data)` — UPDATE
- [ ] `deleteTeam(id)` — DELETE (cascades to memberships)
- [ ] `addMember(teamId, userId, role)` — INSERT into team_memberships
- [ ] `removeMember(teamId, userId)` — DELETE from team_memberships
- [ ] `updateMemberRole(teamId, userId, role)` — UPDATE membership role
- [ ] All operations audit logged

### Step 2: Backend — Teams Routes
**File**: `refinery-backend/src/routes/teams.ts` (NEW)

- [ ] `GET /api/teams` — list all (authenticated users)
- [ ] `GET /api/teams/:id` — get one with members (authenticated)
- [ ] `POST /api/teams` — create (superadmin/admin only)
- [ ] `PUT /api/teams/:id` — update (superadmin/admin only)
- [ ] `DELETE /api/teams/:id` — delete (superadmin only)
- [ ] `POST /api/teams/:id/members` — add member (superadmin/admin)
- [ ] `DELETE /api/teams/:id/members/:userId` — remove member (superadmin/admin)

### Step 3: Frontend — Teams Tab in Team Page
**File**: `axiom-data-hub/src/pages/Team.tsx`

- [ ] Extend tab bar: "Members" | "Roles" | "Teams"
- [ ] Teams tab shows:
  - [ ] Grid of team cards (name, description, member count, avatars)
  - [ ] "Create Team" button → modal
  - [ ] Click team card → expand/navigate to team detail view

### Step 4: Frontend — Team Detail View
**File**: `axiom-data-hub/src/pages/Team.tsx` (or child component)

- [ ] Shows team name, description (editable by superadmin)
- [ ] Member list with avatars, names, team roles
- [ ] "Add Member" button → search/select from all users not in this team
- [ ] Remove member button (X icon)
- [ ] Change team role dropdown (team lead, member, viewer)

### Step 5: Frontend — Show Team Badge on Member List
**File**: `axiom-data-hub/src/pages/Team.tsx`

- [ ] In the main Members tab, show which team(s) each user belongs to
- [ ] Small colored badges next to the user's name

## UI Mockup (Teams Tab)

```
┌─────────────────────────────────────────────────────────┐
│  Members  │  Roles  │  Teams                             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [+ Create Team]                                         │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────┐     │
│  │ 🏢 Engineering       │  │ 🏢 Sales              │     │
│  │ Data pipeline team   │  │ Client outreach team  │     │
│  │ 👤👤👤 5 members      │  │ 👤👤 3 members        │     │
│  │ [View] [Edit]        │  │ [View] [Edit]         │     │
│  └──────────────────────┘  └──────────────────────┘     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Future: Team-Scoped Permissions
Not in this plan, but in the future teams could have:
- Team-level permissions (all members inherit)
- Team-scoped data access (team can only see their segments/targets)
- Team quotas (max emails/day per team)
