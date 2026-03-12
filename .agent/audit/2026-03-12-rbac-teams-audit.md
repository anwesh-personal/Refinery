# RBAC v2 & Teams Feature Audit Report — 2026-03-12

## 1. Executive Summary
This audit validates the implementation of the Role-Based Access Control (RBAC) v2 system and the "Teams" organizational feature. Both the `axiom-data-hub` frontend and the `refinery-backend` were reviewed.

**Overall Verdict:** The implementation successfully maps to the requirements. The code exhibits production-level quality, avoiding "band-aids" in favor of proper architectural patterns (e.g., explicit audit logging, resilient auth fetching, normalized joins). All Phase 1-4 goals from the RBAC v2 plan are now met.

## 2. Implemented Features Check

### A. Custom Roles (Plan 002)
- ✅ **Backend Services & Routes (`refinery-backend/src/services/customRoles.ts`, `routes/customRoles.ts`)**: Implemented explicit creation, modification, and deletion.
- ✅ **Data Normalization & Protection**: Correct mapping of the `label` field instead of `description`. `is_system` flag prevents deletion/modification of system roles. Explicit guards prevent deleting roles that are assigned to active users.
- ✅ **Frontend UI (`axiom-data-hub/src/pages/Team.tsx`)**: Created a dedicated "Custom Roles" tab for superadmins to define and manage custom permission profiles.

### B. Teams & Groups (Plan 003)
- ✅ **Backend Services & Routes (`refinery-backend/src/services/teams.ts`, `routes/teams.ts`)**: Built full CRUD for `teams` and `team_memberships`.
- ✅ **Supabase Join Normalization**: Addressed PostgREST's behavior where many-to-one foreign key joins return arrays. `TeamMembership` data is explicitly flattened (`NormalizedMembership`) so the API returns clean, predictable single-object associations for profile and role data.
- ✅ **Frontend UI (`axiom-data-hub/src/pages/Team.tsx`)**: Added a proper "Teams" tab. Superadmins can create teams, manage descriptions, and use a safe dropdown to add members (filtering out users who are already members).
- ✅ **Team-Scoped Roles**: A user can be assigned a specific team-scoped role (which leverages the `custom_roles` table) for their membership in a specific team.

### C. Authentication Fetch Resilience (Fix)
- ✅ **Issue**: Adding `custom_roles` to the profile fetch query (`select=*,custom_roles()`) caused the query to fail entirely if the PostgREST schema cache was stale, silently falling back to a JWT-metadata parser that defaulted everyone to `member`.
- ✅ **Resolution (`axiom-data-hub/src/auth/AuthContext.tsx`)**: The `fetchProfileFromDB` function now exhibits graceful degradation. It attempts the joined query first; if that fails (e.g., 400 Bad Request due to schema cache), it retries with a plain `select=*` to guarantee the user's base identity and DB `role` are always retrieved.

### D. Audit Logging
- ✅ **Explicit Attribution (`refinery-backend/src/services/auditLog.ts`)**: Replaced broken PostgreSQL triggers (which had `NULL` attribution because `auth.uid()` fails under service-role connections) with a dedicated Node.js service. The backend now writes to the `audit_log` explicitly, pulling the `actorId` securely from the JWT on every mutation route.

## 3. Discrepancies vs. Original Plans
There is one technical discrepancy between the original `003-team-groups.md` plan and the actual database migration that was handled successfully in the code:
- **Plan 003 stated:** `team_memberships.user_id (UUID)` and `team_memberships.role (TEXT)`.
- **Actual DB Migration (005):** The table uses `profile_id (UUID)` and `role_id (UUID)` referencing the `custom_roles` table. 
- **Handling:** The implemented TypeScript interfaces and API logic correctly use `profile_id` and `role_id`, seamlessly integrating team-scoped roles with the newly built Custom Roles system.

## 4. Pending Plans Status Check
Below is the status of the remaining planned work defined in the `.agent/plans/` directory:

| Plan ID | Title | Status |
|---|---|---|
| **001** | Multi-Server Support (Server Pool) | 🔲 **Not Started**. High priority. Involves creating a `servers` table and refactoring the ClickHouse client. |
| **002** | Custom Role CRUD UI | ✅ **Done** |
| **003** | Team Groups UI | ✅ **Done** |
| **004** | Verify550 Frontend Wiring | 🔲 **Not Started**. Med priority. API utility needs to be built to connect the Verification UI to existing backend endpoints. |
| **005** | In-Built Email Verification Engine | 🔲 **Not Started**. Low priority. Deferred until infrastructure costs justify replacing the Verify550 API. |

## 5. Next Steps Recommendation
Based on the audit, the RBAC and Team systems are structurally sound and complete. The logical next phase is to proceed to **Plan 001 — Multi-Server Support**. This will allow the application to dynamically switch between different ClickHouse and object storage backends, setting the stage for enterprise scalability.
