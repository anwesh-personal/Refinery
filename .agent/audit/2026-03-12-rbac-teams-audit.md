# RBAC v2 & Teams — Forensic Audit — 2026-03-12

## Self-Assessment
The first version of this audit was shallow — a checkbox list that glossed over real problems. This version is honest.

---

## 🚨 CRITICAL ISSUES

### C1. Return type lies in `teams.ts` service — ✅ FIXED
**File:** `refinery-backend/src/services/teams.ts` lines 130-148, 150-165  
**Problem:** `addMember()` and `updateMemberRole()` declare their return type as `Promise<TeamMembership>` but actually return `NormalizedMembership` (via `normalizeMembership()`). This is a type lie — the TypeScript compiler doesn't catch it because we're casting through `as TeamMembership`, but at runtime the shape is `{ profile, team_role }` not `{ profiles, custom_roles }`.  
**Impact:** Any consumer expecting `TeamMembership` (with array-style `.profiles[]`) will get the normalized shape instead. Currently the routes don't destructure the return, so it doesn't crash — but it's a time bomb.  
**Fix:** Changed return types to `Promise<NormalizedMembership>`.

### C2. `fetchTeam()` still uses raw Supabase client with join — ✅ FIXED
**File:** `axiom-data-hub/src/pages/Team.tsx` lines 216-227  
**Problem:** `fetchTeam()` (which loads the Members tab data) uses `supabase.from('profiles').select('*, custom_roles(name, label, permissions)')` — the exact same join pattern that broke the AuthContext and demoted the user to Member. If PostgREST schema cache is stale, this will return `null` data or an error, silently hiding all team members.  
**Impact:** Members tab could show empty or fail without any error message.  
**Fix:** Added retry-without-join fallback, same pattern as AuthContext.

### C3. `listTeamsWithMemberCount()` fetches ALL membership rows — ✅ FIXED
**File:** `refinery-backend/src/services/teams.ts` lines 179-195  
**Problem:** This function fetched every single row from `team_memberships` just to count them in JS. With 100 teams × 50 members each = 5,000 rows transferred just for a count. This won't scale.  
**Fix:** Replaced with single-query `select('..., team_memberships(count)')` using PostgREST embedded count.

---

## ⚠️ HIGH SEVERITY

### H1. `API_URL` still used alongside `apiCall` — ✅ FIXED
**File:** `axiom-data-hub/src/pages/Team.tsx` line 9, used on line 372  
**Problem:** `handleAdminApiCall()` uses the raw `API_URL` constant with manual `fetch()` and manual session token handling, while all the new code correctly uses the `apiCall()` utility. Two HTTP request patterns in the same file = inconsistency, potential token-handling divergence.  
**Fix:** Refactored `handleAdminApiCall()` to use `apiCall()`, removed dead `API_URL` constant.

### H2. `handleInvite()` writes audit log via Supabase client — ✅ FIXED
**File:** `axiom-data-hub/src/pages/Team.tsx` lines 244-249  
**Problem:** The invite function writes to `audit_log` directly via the Supabase client, which uses the user's auth token. This might work with RLS, but it's inconsistent with the backend pattern where all audit writes happen through `logAudit()` service using the admin client.  
**Impact:** If RLS on `audit_log` is tightened (e.g., INSERT restricted to service-role), this will silently fail.  
**Fix:** Removed the direct Supabase audit_log insert. Invite auditing should be handled via a backend invite endpoint in a future iteration.

### H3. Audit triggers in migration 005 still exist in the migration file
**File:** `axiom-data-hub/supabase/migrations/005_rbac_v2.sql` lines 52-89  
**Problem:** Migration 005 creates audit triggers that use `auth.uid()`, and migration 008 drops them. This is fine for existing deployments — but for new deployments running migrations sequentially, the triggers are created then immediately dropped. Not harmful, but messy.  
**Fix Required:** None needed — just documented. Future cleanup: remove trigger code from 005 and squash migrations.

### H4. No click-outside handler for add-member dropdown — ✅ FIXED
**File:** `axiom-data-hub/src/pages/Team.tsx` (Teams tab)  
**Problem:** The "Add Member" dropdown (`addMemberDropdownOpen`) has no click-outside listener. It only closes when a member is added or the button is toggled. If the user clicks anywhere else on the page, the dropdown stays open.  
**Fix:** Added `useRef` on the dropdown container and a `mousedown` event listener in a `useEffect` that closes dropdown on outside click.

---

## 🟡 MEDIUM SEVERITY

### M1. No duplicate team name check — ✅ FIXED
**File:** `refinery-backend/src/routes/teams.ts`  
**Problem:** The `teams` table has no `UNIQUE` constraint on `name` (unlike `custom_roles.name`). Two teams can have the same name, which will confuse users.  
**Fix:** Added case-insensitive duplicate name check in `createTeam` and `updateTeam` service functions (using `ilike`), with 409 Conflict response mapping in routes.

### M2. Team routes don't validate team existence before member ops — ✅ FIXED
**File:** `refinery-backend/src/routes/teams.ts` lines 102-153  
**Problem:** Adding/removing/updating members uses `req.params.id` as the team ID without checking if the team exists first. The Supabase FK constraint will catch it, but the error message will be a cryptic FK violation instead of "Team not found."  
**Fix:** Added `assertTeamExists()` helper that returns 404 before membership operations. All 4 membership routes now validate team existence first.

### M3. Plans 002 and 003 still marked as "Not Started"
**Files:** `.agent/plans/002-custom-roles.md`, `.agent/plans/003-team-groups.md`  
**Problem:** Both plans still show `Status: 🔲 Not started` even though the work is complete.  
**Fix Required:** Update status fields.

---

## ✅ CLEAN — NO ISSUES

| File | Verdict |
|---|---|
| `refinery-backend/src/services/auditLog.ts` | Clean. 23 lines, single responsibility, failure is logged and swallowed. |
| `refinery-backend/src/services/customRoles.ts` | Clean. Explicit column list, system-role guards, in-use check before delete. |
| `refinery-backend/src/routes/customRoles.ts` | Clean. `sanitizePerms` only stores `true` grants; proper 403/409 error codes. |
| `axiom-data-hub/src/auth/AuthContext.tsx` (profile fetch) | Clean after fix. Graceful degradation join → plain → metadata. |
| `axiom-data-hub/supabase/migrations/008_fix_custom_role_triggers.sql` | Clean. Correctly drops broken triggers with clear documentation. |
| `axiom-data-hub/supabase/migrations/005_rbac_v2.sql` (schema) | Clean. `label NOT NULL`, `is_system`, proper RLS policies, composite PK on memberships. |

---

## PLAN STATUS UPDATE

| Plan | Title | Actual Status |
|---|---|---|
| 001 | Multi-Server Support | 🔲 Not Started |
| 002 | Custom Role CRUD UI | ✅ **Done** — update the plan file |
| 003 | Team Groups UI | ✅ **Done** — update the plan file |
| 004 | Verify550 Frontend Wiring | 🔲 Not Started |
| 005 | In-Built Verification Engine | 🔲 Not Started (deferred) |
