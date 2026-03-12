# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND                           │
│            axiom-data-hub (React/Vite)               │
│                                                      │
│  Auth ──→ Supabase Auth (JWT)                       │
│  Team/Settings ──→ Supabase PostgreSQL (RLS)        │
│  Data pages ──→ Express Backend API                 │
└────────────────────┬────────────────────────────────┘
                     │ HTTP (localhost:4000 / api.domain.com)
┌────────────────────▼────────────────────────────────┐
│                   BACKEND                            │
│          refinery-backend (Express/TS)               │
│                                                      │
│  /api/admin/*    ──→ Supabase Admin Client           │
│  /api/database/* ──→ ClickHouse                     │
│  /api/ingestion/*──→ S3/Linode → ClickHouse         │
│  /api/segments/* ──→ ClickHouse                     │
│  /api/queue/*    ──→ ClickHouse                     │
│  /api/config/*   ──→ ClickHouse system_config       │
│  /api/verification/* ──→ Verify550 API + ClickHouse │
└────────┬──────────────────────┬─────────────────────┘
         │                      │
┌────────▼────────┐   ┌────────▼────────────────────┐
│   Supabase      │   │      ClickHouse              │
│  (PostgreSQL)   │   │   (Analytics DB)             │
│                 │   │                              │
│  • profiles     │   │  • leads (billions of rows)  │
│  • team_invites │   │  • verification_batches      │
│  • audit_log    │   │  • verification_results      │
│  • custom_roles │   │  • segments                  │
│  • teams        │   │  • mail_queue                │
│  • team_members │   │  • system_config             │
│  • storage      │   │  • ingestion_jobs            │
└─────────────────┘   └──────────────────────────────┘
```

## Key Design Decisions

### Why Two Databases?
- **Supabase (PostgreSQL)**: Auth, user management, RBAC, audit logs. Has RLS, triggers, Auth integration. Low-volume, high-consistency data.
- **ClickHouse**: Email data pipeline. Handles billions of rows with sub-second queries. Column-oriented, optimized for analytics/aggregation. Not suited for RBAC or auth.

### Why a Backend Server?
1. **Secret key isolation** — `SUPABASE_SECRET_KEY` never touches the browser
2. **ClickHouse proxy** — ClickHouse has no public-facing auth layer
3. **S3/Linode operations** — AWS credentials stay server-side
4. **Verify550 integration** — API keys stay server-side
5. **Rate limiting** — enforced at the server, not bypassable

### Auth Flow
```
User Login → Supabase Auth (JWT) → Frontend parses metadata (instant render)
                                 → Frontend fetches profiles via REST (accurate permissions)
                                 → Backend validates JWT via supabaseAdmin.auth.getUser()
```

### Permission Resolution
```
Role Defaults (superadmin/admin/member)
    ↓ merge
Per-User Overrides (JSONB in profiles.permissions)
    ↓ produces
Effective Permissions (checked by ProtectedRoute + Can component)
```

## File Structure

```
Refinery Nexus/
├── .agent/                    ← Knowledge, plans, audits
├── axiom-data-hub/            ← Frontend (React/Vite/TypeScript)
│   ├── src/
│   │   ├── auth/              ← AuthContext, ProtectedRoute, Can
│   │   ├── components/        ← UI kit, ImpersonationBanner
│   │   ├── lib/               ← Supabase client, DB types
│   │   └── pages/             ← All page components
│   └── supabase/
│       └── migrations/        ← 001–006 SQL migrations
├── refinery-backend/          ← Backend (Express/TypeScript)
│   └── src/
│       ├── config/            ← env.ts
│       ├── db/                ← ClickHouse client
│       ├── routes/            ← Express routers
│       ├── services/          ← Business logic
│       └── utils/             ← Helpers
└── .gitignore
```

## Environment Variables

### Frontend (.env)
| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `VITE_API_URL` | Backend API URL (default: http://localhost:4000) |

### Backend (.env)
| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default: 4000) |
| `NODE_ENV` | development / production |
| `FRONTEND_URL` | CORS origins (comma-separated) |
| `VITE_SUPABASE_URL` | Supabase URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key |
| `SUPABASE_SECRET_KEY` | Supabase service role key (NEVER in frontend) |
| `CLICKHOUSE_HOST` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_USER` / `PASSWORD` | ClickHouse auth |
| `CLICKHOUSE_DATABASE` | ClickHouse DB name |
| `VERIFY550_*` | Verify550 API config |
| `S3_SOURCE_*` | AWS S3 source config |
| `LINODE_OBJ_*` | Linode Object Storage config |
| `SMTP_*` | SMTP relay config |
