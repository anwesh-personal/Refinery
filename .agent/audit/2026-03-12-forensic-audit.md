# Forensic Audit — 2026-03-12

## Scope
Full codebase audit of `axiom-data-hub/` and `refinery-backend/`

## Findings & Status

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | 🚨 CRITICAL | Admin middleware queried ClickHouse instead of PostgreSQL | ✅ FIXED |
| 2 | 🚨 CRITICAL | SQL injection via string interpolation in admin middleware | ✅ FIXED |
| 3 | 🚨 CRITICAL | Single-origin CORS (only one frontend URL allowed) | ✅ FIXED |
| 4 | ⚠️ HIGH | No rate limiting on admin API | ✅ FIXED |
| 5 | ⚠️ HIGH | No audit logging for backend admin actions | ✅ FIXED |
| 6 | ⚠️ HIGH | Impersonation has no return path | ✅ FIXED |
| 7 | ⚠️ HIGH | console.log leaks role info to DevTools | ✅ FIXED |
| 8 | 🟡 MEDIUM | Missing Supabase DB types (all queries use `as any`) | ✅ FIXED |
| 9 | 🟡 MEDIUM | Settings uses raw fetch() for profile update | ✅ FIXED |
| 10 | 🟡 MEDIUM | Avatar compression leaks object URLs | ✅ FIXED |
| 11 | 🟡 MEDIUM | Placeholder secret key fallback | ✅ FIXED |

## Clean Files (No Issues)
- AuthContext.tsx, ProtectedRoute.tsx, supabase.ts, App.tsx
- Layout.tsx, clickhouse.ts, verification.ts service, env.ts
- All 6 SQL migrations
