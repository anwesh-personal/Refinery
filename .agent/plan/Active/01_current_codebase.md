# 01 — Current Codebase Inventory

## Purpose
This document maps every existing API route, database table, and internal function that the tool handlers will call. Tool handlers MUST NOT duplicate logic — they call these existing functions directly.

---

## Backend API Routes (refinery-backend/src/routes/)

### verify.ts — Email Verification Pipeline
| Method | Path | Auth | What it does |
|--------|------|------|-------------|
| `GET` | `/api/verify/jobs` | superadmin | List all verification jobs (metadata only, no results_json) |
| `GET` | `/api/verify/jobs/:id` | superadmin | Get job status + progress. Add `?include=results` for full results. Supports `?limit=500&offset=0` pagination |
| `POST` | `/api/verify/jobs` | superadmin | Start a new verification job. Body: `{ emails: string[], checks, weights, thresholds, smtp }` |
| `DELETE` | `/api/verify/jobs/:id` | superadmin | Delete a job (only if failed/cancelled) |
| `POST` | `/api/verify/jobs/:id/cancel` | superadmin | Cancel a running job |
| `GET` | `/api/verify/jobs/:id/download` | superadmin | Download results as CSV. Query: `?classifications=safe,uncertain&maxRiskScore=50` |
| `POST` | `/api/verify/jobs/:id/ingest` | superadmin | Push verified results back to ClickHouse universal_person table |
| `GET` | `/api/verify/defaults` | superadmin | Get default check/weight/threshold/smtp config |

**Key internal function**: `startVerificationPipeline()` in verify.ts — the main pipeline orchestrator.

### clickhouse.ts — Database Queries
| Method | Path | Auth | What it does |
|--------|------|------|-------------|
| `POST` | `/api/clickhouse/query` | superadmin | Execute arbitrary SQL. Body: `{ query: string }`. Returns `{ data: any[], meta: { columns, rows, elapsed } }` |
| `GET` | `/api/clickhouse/tables` | superadmin | List all tables in the connected ClickHouse instance |
| `GET` | `/api/clickhouse/schema/:table` | superadmin | Get column definitions for a specific table |

**Key internal function**: `chQuery<T>(sql)` — executes ClickHouse query, returns typed array.

### segments.ts — Segment Management
| Method | Path | Auth | What it does |
|--------|------|------|-------------|
| `GET` | `/api/segments` | auth | List all segments (name, filter JSON, row count, created_at) |
| `POST` | `/api/segments` | auth | Create segment. Body: `{ name, description, filters: FilterGroup }` |
| `DELETE` | `/api/segments/:id` | auth | Delete a segment |
| `POST` | `/api/segments/:id/execute` | auth | Execute segment query, return matching rows |
| `GET` | `/api/segments/:id/count` | auth | Get row count without loading data |

### ingestion.ts — S3 Ingestion
| Method | Path | Auth | What it does |
|--------|------|------|-------------|
| `GET` | `/api/ingestion/sources` | superadmin | List configured S3 sources |
| `POST` | `/api/ingestion/preview` | superadmin | Preview files in an S3 bucket. Body: `{ sourceId, prefix }` |
| `POST` | `/api/ingestion/start` | superadmin | Start ingestion job. Body: `{ sourceId, files[], columnMapping }` |
| `GET` | `/api/ingestion/jobs` | superadmin | List ingestion jobs |
| `GET` | `/api/ingestion/jobs/:id` | superadmin | Get ingestion job status |

### targets.ts — Email Target Lists
| Method | Path | Auth | What it does |
|--------|------|------|-------------|
| `GET` | `/api/targets` | auth | List target lists |
| `POST` | `/api/targets` | auth | Create target list from segment or filter. Body: `{ name, segmentId?, filters?, limit? }` |
| `GET` | `/api/targets/:id/download` | auth | Download target list as CSV |
| `DELETE` | `/api/targets/:id` | auth | Delete target list |

### servers.ts — Server Configuration
| Method | Path | Auth | What it does |
|--------|------|------|-------------|
| `GET` | `/api/servers` | superadmin | List configured servers (ClickHouse, S3, SMTP connections) |
| `GET` | `/api/servers/health` | superadmin | Health check all servers — returns status per connection |

### ai.ts — AI Agent Routes (EXISTING — will be modified)
| Method | Path | Auth | What it does |
|--------|------|------|-------------|
| `GET` | `/api/ai/providers` | superadmin | List configured AI providers (OpenAI, Anthropic, Gemini, etc.) |
| `GET` | `/api/ai/agents` | auth | List all agents |
| `GET` | `/api/ai/agents/:slug` | auth | Get single agent details |
| `PUT` | `/api/ai/agents/:slug` | superadmin | Update agent config |
| `POST` | `/api/ai/agents/:slug/chat` | auth | **THE MAIN CHAT ENDPOINT** — sends message, gets response |
| `GET` | `/api/ai/agents/:slug/conversations` | auth | List conversations for an agent |
| `GET` | `/api/ai/usage` | superadmin | Token usage stats |

### teams.ts, custom-roles.ts, logs.ts, config.ts
Supporting routes for team management, RBAC, audit logs, and system configuration. Tool handlers generally won't need these except `system.ts` handler for health/overview.

---

## Database Tables

### ClickHouse (Analytics)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `universal_person` | Main lead database. Every person ever ingested. | `up_id`, `email`, `first_name`, `last_name`, `company`, `title`, `phone`, `linkedin_url`, `verification_status`, `risk_score`, + 50 more |
| `pipeline_jobs` | Verification job tracking | `id`, `status`, `total_emails`, `processed_count`, `safe_count`, `risky_count`, `rejected_count`, `results_json`, `started_at`, `completed_at` |
| `ingestion_jobs` | S3 ingestion job tracking | `id`, `source_id`, `status`, `rows_imported`, `errors` |

### Supabase (Config/Auth)
| Table | Purpose |
|-------|---------|
| `profiles` | User profiles, roles, permissions |
| `custom_roles` | Custom RBAC roles with permission overrides |
| `server_configs` | ClickHouse/S3/SMTP connection details (encrypted) |
| `ai_providers` | LLM provider configs (API keys in vault) |
| `ai_agents` | Agent definitions (slug, name, system_prompt, model, temperature, avatar_url) |
| `agent_knowledge_base` | Per-agent KB entries (title, content, priority, category) |
| `agent_conversations` | Chat conversation metadata |
| `agent_messages` | Individual messages (role, content, tokens_used) |
| `ai_usage_tracking` | Token usage per agent/provider/day |
| `audit_log` | System-wide audit trail |

---

## Key Internal Functions (importable)

### From `refinery-backend/src/lib/clickhouse.ts`
```typescript
chQuery<T>(sql: string): Promise<T[]>     // Execute query, return typed rows
chInsert(table: string, rows: any[]): void // Insert rows
```

### From `refinery-backend/src/routes/verify.ts`
```typescript
// The pipeline is triggered via the POST /api/verify/jobs route
// Internally it calls startVerificationPipeline() which is not exported
// Tool handler should call the API route internally via fetch or direct function call
```

### From `refinery-backend/src/lib/supabase.ts`
```typescript
supabase  // Supabase client instance — used for auth, config, agent data
```

### From `refinery-backend/src/middleware/auth.ts`
```typescript
requireAuth(req, res, next)       // Requires valid JWT
requireSuperadmin(req, res, next) // Requires superadmin role
```
