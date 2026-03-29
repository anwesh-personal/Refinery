# 02 — Tool Registry

## Purpose
Defines every tool available to agents. Each tool has:
- **name**: Unique identifier (snake_case)
- **description**: What the LLM sees — must be clear enough for the LLM to know when to use it
- **agent**: Which agent(s) can use this tool
- **parameters**: JSON Schema for inputs
- **returns**: What the tool returns
- **risk_level**: `read` (safe) | `write` (needs confirmation) | `destructive` (double confirmation)

---

## Tool Definitions

### 1. `start_verification`
- **Agent**: Bastion
- **Risk**: `write`
- **Description**: Start a new email verification pipeline job. Takes a list of emails and runs them through syntax check, typo fix, deduplication, disposable detection, role-based check, MX lookup, SMTP handshake, catch-all detection, and risk scoring.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "emails": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of email addresses to verify. Max 200,000 per job."
    },
    "checks": {
      "type": "object",
      "description": "Optional. Which checks to enable. Defaults to all enabled.",
      "properties": {
        "syntax": { "type": "boolean", "default": true },
        "typoFix": { "type": "boolean", "default": true },
        "deduplicate": { "type": "boolean", "default": true },
        "disposable": { "type": "boolean", "default": true },
        "roleBased": { "type": "boolean", "default": true },
        "freeProvider": { "type": "boolean", "default": true },
        "mxLookup": { "type": "boolean", "default": true },
        "smtpVerify": { "type": "boolean", "default": true },
        "catchAll": { "type": "boolean", "default": true }
      }
    }
  },
  "required": ["emails"]
}
```
- **Returns**: `{ jobId: string, totalEmails: number, status: "running" }`
- **Backend call**: `POST /api/verify/jobs`

### 2. `get_verification_status`
- **Agent**: Bastion, Overseer
- **Risk**: `read`
- **Description**: Check the progress of a verification job. Returns processed count, classification breakdown, and estimated time remaining.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "job_id": { "type": "string", "description": "The verification job ID" }
  },
  "required": ["job_id"]
}
```
- **Returns**: `{ status, totalEmails, processedCount, safeCount, riskyCount, rejectedCount, uncertainCount, percentComplete, startedAt, completedAt? }`
- **Backend call**: `GET /api/verify/jobs/:id`

### 3. `get_verification_results`
- **Agent**: Bastion, Cortex
- **Risk**: `read`
- **Description**: Get results from a completed verification job. Returns paginated email-level results with classification, risk score, and check details.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "job_id": { "type": "string" },
    "classification": { "type": "string", "enum": ["safe", "uncertain", "risky", "reject", "all"], "default": "all" },
    "limit": { "type": "number", "default": 100, "maximum": 500 },
    "offset": { "type": "number", "default": 0 }
  },
  "required": ["job_id"]
}
```
- **Returns**: `{ results: EmailCheckResult[], totalResults, pagination }`
- **Backend call**: `GET /api/verify/jobs/:id?include=results&limit=X&offset=Y&classification=Z`

### 4. `list_verification_jobs`
- **Agent**: Bastion, Overseer
- **Risk**: `read`
- **Description**: List all verification jobs with their status, email counts, and timestamps.
- **Parameters**: `{}` (no params)
- **Returns**: `{ jobs: Array<{ id, status, totalEmails, processedCount, safeCount, riskyCount, startedAt, completedAt }> }`
- **Backend call**: `GET /api/verify/jobs`

### 5. `query_database`
- **Agent**: Cortex
- **Risk**: `read` (SELECT only — executor MUST reject INSERT/UPDATE/DELETE/DROP/ALTER)
- **Description**: Run a read-only SQL query against the ClickHouse universal_person database. Use this to analyze lead data, count records, find patterns, or answer questions about the data.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "SQL SELECT query. Must start with SELECT. No mutations allowed."
    },
    "limit": {
      "type": "number",
      "default": 100,
      "maximum": 1000,
      "description": "Max rows to return. Appended as LIMIT if not in query."
    }
  },
  "required": ["query"]
}
```
- **Returns**: `{ data: any[], columns: string[], rowCount: number, elapsed: string }`
- **Backend call**: `POST /api/clickhouse/query`
- **GUARDRAIL**: Executor MUST regex-check query starts with SELECT. Reject everything else.

### 6. `get_table_schema`
- **Agent**: Cortex
- **Risk**: `read`
- **Description**: Get the column definitions for a ClickHouse table. Use this to understand what data is available before writing queries.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "table": { "type": "string", "default": "universal_person" }
  }
}
```
- **Returns**: `{ columns: Array<{ name, type, comment }> }`
- **Backend call**: `GET /api/clickhouse/schema/:table`

### 7. `list_segments`
- **Agent**: Cortex, Overseer
- **Risk**: `read`
- **Description**: List all defined segments with their names, descriptions, filter definitions, and row counts.
- **Parameters**: `{}`
- **Returns**: `{ segments: Array<{ id, name, description, filters, rowCount, createdAt }> }`
- **Backend call**: `GET /api/segments`

### 8. `create_segment`
- **Agent**: Cortex
- **Risk**: `write`
- **Description**: Create a new segment by defining filter rules. Segments are saved queries that can be re-executed to get matching leads.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Human-readable segment name" },
    "description": { "type": "string" },
    "filters": {
      "type": "object",
      "description": "FilterGroup object with logic (AND/OR) and conditions",
      "properties": {
        "logic": { "type": "string", "enum": ["AND", "OR"] },
        "conditions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "field": { "type": "string" },
              "operator": { "type": "string", "enum": ["=", "!=", "LIKE", "NOT LIKE", "IN", "NOT IN", ">", "<", ">=", "<=", "IS NULL", "IS NOT NULL"] },
              "value": {}
            }
          }
        }
      }
    }
  },
  "required": ["name", "filters"]
}
```
- **Returns**: `{ id, name, rowCount }`
- **Backend call**: `POST /api/segments`

### 9. `get_segment_count`
- **Agent**: Cortex
- **Risk**: `read`
- **Description**: Get the current row count for a segment without loading all data.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "segment_id": { "type": "string" }
  },
  "required": ["segment_id"]
}
```
- **Returns**: `{ segmentId, name, rowCount }`
- **Backend call**: `GET /api/segments/:id/count`

### 10. `generate_email_copy`
- **Agent**: Muse
- **Risk**: `read` (generates text, no side effects)
- **Description**: Generate email copy (subject line, body, follow-up) for a campaign. Uses the configured LLM provider.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string", "enum": ["cold_outreach", "follow_up", "re_engagement", "announcement", "newsletter"] },
    "product": { "type": "string", "description": "What you're selling/promoting" },
    "audience": { "type": "string", "description": "Who the email is for" },
    "tone": { "type": "string", "enum": ["professional", "casual", "urgent", "friendly", "authoritative"], "default": "professional" },
    "variants": { "type": "number", "default": 3, "maximum": 5, "description": "Number of variants to generate" }
  },
  "required": ["type", "product", "audience"]
}
```
- **Returns**: `{ variants: Array<{ subject, body, cta }> }`
- **Backend call**: Internal LLM call (same provider as the agent's chat)

### 11. `get_server_health`
- **Agent**: Overseer
- **Risk**: `read`
- **Description**: Check the health status of all connected services — ClickHouse, Supabase, S3, SMTP servers.
- **Parameters**: `{}`
- **Returns**: `{ services: Array<{ name, status: "healthy"|"degraded"|"down", latencyMs, details }> }`
- **Backend call**: `GET /api/servers/health`

### 12. `get_dashboard_stats`
- **Agent**: Overseer, Cortex
- **Risk**: `read`
- **Description**: Get platform-wide statistics — total leads, verification breakdown, recent jobs, storage usage.
- **Parameters**: `{}`
- **Returns**: `{ totalLeads, verifiedCount, unverifiedCount, recentJobs: Array<{id, status, total}>, storageUsedGB }`
- **Backend call**: Composite — calls `chQuery` for ClickHouse stats + `GET /api/verify/jobs` for recent jobs

### 13. `score_leads`
- **Agent**: Cortex
- **Risk**: `read`
- **Description**: Run lead scoring analysis on a segment or set of filters. Returns tier distribution (platinum/gold/silver/bronze/dead) and top leads.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "segment_id": { "type": "string", "description": "Score leads in this segment" },
    "limit": { "type": "number", "default": 100, "description": "How many top leads to return" }
  },
  "required": ["segment_id"]
}
```
- **Returns**: `{ distribution: { platinum, gold, silver, bronze, dead }, topLeads: Array<{ email, score, company, title }> }`
- **Backend call**: `POST /api/segments/:id/execute` + scoring logic

### 14. `list_s3_sources`
- **Agent**: Overseer
- **Risk**: `read`
- **Description**: List configured S3/MinIO data sources.
- **Parameters**: `{}`
- **Returns**: `{ sources: Array<{ id, name, bucket, region, lastUsed }> }`
- **Backend call**: `GET /api/ingestion/sources`

### 15. `start_ingestion`
- **Agent**: Overseer
- **Risk**: `write`
- **Description**: Start an S3 ingestion job to load data from CSV/TSV/Parquet files into ClickHouse.
- **Parameters**:
```json
{
  "type": "object",
  "properties": {
    "source_id": { "type": "string" },
    "files": { "type": "array", "items": { "type": "string" }, "description": "File paths within the S3 bucket" },
    "column_mapping": { "type": "object", "description": "Map of source column → target column in universal_person" }
  },
  "required": ["source_id", "files"]
}
```
- **Returns**: `{ jobId, status: "running", filesCount }`
- **Backend call**: `POST /api/ingestion/start`

---

## Tool-to-Agent Assignment Matrix

| Tool | Cortex | Bastion | Muse | Overseer | Litmus |
|------|--------|---------|------|----------|--------|
| `start_verification` | | ✅ | | | |
| `get_verification_status` | | ✅ | | ✅ | |
| `get_verification_results` | ✅ | ✅ | | | ✅ |
| `list_verification_jobs` | | ✅ | | ✅ | |
| `query_database` | ✅ | | | | |
| `get_table_schema` | ✅ | | | | |
| `list_segments` | ✅ | | | ✅ | |
| `create_segment` | ✅ | | | | |
| `get_segment_count` | ✅ | | | | |
| `generate_email_copy` | | | ✅ | | |
| `get_server_health` | | | | ✅ | |
| `get_dashboard_stats` | ✅ | | | ✅ | |
| `score_leads` | ✅ | | | | |
| `list_s3_sources` | | | | ✅ | |
| `start_ingestion` | | | | ✅ | |
