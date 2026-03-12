# Tech Stack & Conventions

## Frontend
- **React 19** + **TypeScript 5.7** + **Vite 6**
- **Styling**: Vanilla CSS with CSS variables (no Tailwind)
- **Icons**: lucide-react
- **Font**: Inter (Google Fonts)
- **Auth**: @supabase/supabase-js v2
- **Routing**: react-router-dom v7
- **State**: React Context (AuthContext, ThemeContext) — no Redux/Zustand

## Backend
- **Express 5** + **TypeScript 5.7** + **tsx (dev)** / **tsc (build)**
- **ClickHouse**: @clickhouse/client v1.8
- **Supabase Admin**: @supabase/supabase-js v2 (service role)
- **Rate Limiting**: express-rate-limit
- **Security**: helmet, cors
- **AWS**: @aws-sdk/client-s3, @aws-sdk/lib-storage
- **Logging**: morgan

## Database
- **Supabase (PostgreSQL 15)**: Auth, profiles, RBAC, audit
- **ClickHouse**: Email data, segments, verification, queue, config

## Code Conventions

### File Naming
- Pages: `PascalCase.tsx` (e.g., `Dashboard.tsx`, `Team.tsx`)
- Components: `PascalCase.tsx`
- Services: `camelCase.ts` (e.g., `admin.ts`, `verification.ts`)
- Routes: `camelCase.ts`

### Supabase Queries
- Use typed client `supabase.from('table')` — types from `database.types.ts`
- For columns not in generated types (e.g., JSONB overrides), use `as any` on the update payload only
- Never cast the entire `.from()` call

### Auth Pattern
- `useAuth()` hook provides `user`, `session`, `signIn`, `signOut`, `refreshProfile`
- `<ProtectedRoute requires="permissionKey">` for page-level guards
- `<Can do="permissionKey">` for inline permission gates
- Backend uses `requireSuperadmin` middleware on admin routes

### Error Handling
- Frontend: `setMessage({ text, type: 'error' | 'success' })` pattern
- Backend: try/catch with `res.status(N).json({ error: message })`
- Never swallow errors silently

### Styling
- All colors via CSS variables (--bg-app, --text-primary, --accent, etc.)
- Dark/light theme via `data-theme` attribute on `:root`
- Inline styles for components (no CSS modules)
- Animation classes: `.animate-fadeIn`, `.animate-slideInRight`

### API Pattern
- Frontend calls backend at `API_URL/api/{module}/{action}`
- All admin endpoints require `Authorization: Bearer {jwt}` header
- Backend validates JWT via `supabaseAdmin.auth.getUser(token)`

## Supabase Migrations (Applied)
1. `001_profiles.sql` — profiles table, trigger to create on auth.user insert
2. `002_rls_policies.sql` — RLS on profiles
3. `003_team_invites.sql` — team_invites table
4. `004_audit_log.sql` — audit_log table
5. `005_rbac_v2.sql` — custom_roles, teams, team_memberships tables
6. `006_storage_avatars.sql` — storage RLS for avatars bucket
