# 03 — Tool Handlers Implementation

## Purpose
Each handler file wraps existing API functionality into a clean function that the executor calls. **No new business logic** — handlers are thin wrappers around existing routes/functions.

---

## File: `agents/tools/types.ts`

```typescript
/** Definition of a tool that an agent can use */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;  // JSON Schema
  riskLevel: 'read' | 'write' | 'destructive';
  agents: string[];                  // Agent slugs that can use this tool
  handler: (args: any, context: ToolContext) => Promise<ToolResult>;
}

/** Context passed to every tool handler */
export interface ToolContext {
  userId: string;
  agentSlug: string;
  conversationId: string;
  accessToken: string;             // For internal API calls
}

/** What a tool handler returns */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/** What the LLM sends when it wants to use a tool */
export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

/** Logged for every tool execution */
export interface ToolExecutionLog {
  id: string;
  agentSlug: string;
  userId: string;
  conversationId: string;
  toolName: string;
  arguments: Record<string, any>;
  result: ToolResult;
  durationMs: number;
  timestamp: string;
}
```

---

## File: `agents/tools/handlers/verify.ts`

```typescript
import { ToolResult, ToolContext } from '../types';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';

/** Internal fetch helper — calls our own API routes with auth */
async function internalApi(path: string, ctx: ToolContext, options: RequestInit = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API ${path} failed (${resp.status}): ${err}`);
  }
  return resp.json();
}

/** Start a new verification job */
export async function startVerification(args: {
  emails: string[];
  checks?: Record<string, boolean>;
}, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!args.emails || args.emails.length === 0) {
      return { success: false, error: 'No emails provided' };
    }
    if (args.emails.length > 200000) {
      return { success: false, error: 'Maximum 200,000 emails per job' };
    }

    const body: any = { emails: args.emails };
    if (args.checks) body.checks = args.checks;
    // Use default weights/thresholds/smtp from server config

    const result = await internalApi('/api/verify/jobs', ctx, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      success: true,
      data: {
        jobId: result.id,
        totalEmails: result.total_emails,
        status: 'running',
        message: `Verification job started for ${result.total_emails} emails. Use get_verification_status to track progress.`,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Check job progress */
export async function getVerificationStatus(args: {
  job_id: string;
}, ctx: ToolContext): Promise<ToolResult> {
  try {
    const job = await internalApi(`/api/verify/jobs/${args.job_id}`, ctx);
    const pct = job.total_emails > 0
      ? Math.round((job.processed_count / job.total_emails) * 100)
      : 0;

    return {
      success: true,
      data: {
        status: job.status,
        totalEmails: job.total_emails,
        processedCount: job.processed_count,
        safeCount: job.safe_count,
        riskyCount: job.risky_count,
        rejectedCount: job.rejected_count,
        uncertainCount: job.uncertain_count,
        percentComplete: pct,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        errorMessage: job.error_message,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Get paginated results from a completed job */
export async function getVerificationResults(args: {
  job_id: string;
  classification?: string;
  limit?: number;
  offset?: number;
}, ctx: ToolContext): Promise<ToolResult> {
  try {
    const params = new URLSearchParams({
      include: 'results',
      limit: String(args.limit || 100),
      offset: String(args.offset || 0),
    });
    if (args.classification && args.classification !== 'all') {
      params.set('classification', args.classification);
    }

    const job = await internalApi(`/api/verify/jobs/${args.job_id}?${params}`, ctx);

    return {
      success: true,
      data: {
        results: job.results || [],
        totalResults: job.totalResults,
        pagination: job.pagination,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** List all verification jobs */
export async function listVerificationJobs(_args: any, ctx: ToolContext): Promise<ToolResult> {
  try {
    const jobs = await internalApi('/api/verify/jobs', ctx);
    return { success: true, data: { jobs } };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
```

---

## File: `agents/tools/handlers/database.ts`

```typescript
import { ToolResult, ToolContext } from '../types';

const DANGEROUS_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i;

/** Run a read-only ClickHouse query */
export async function queryDatabase(args: {
  query: string;
  limit?: number;
}, ctx: ToolContext): Promise<ToolResult> {
  try {
    const q = args.query.trim();

    // GUARDRAIL: Only allow SELECT queries
    if (!q.toUpperCase().startsWith('SELECT')) {
      return { success: false, error: 'Only SELECT queries are allowed. No mutations.' };
    }
    if (DANGEROUS_KEYWORDS.test(q)) {
      return { success: false, error: 'Query contains forbidden keywords. Only SELECT is allowed.' };
    }

    // Ensure LIMIT exists
    const limit = args.limit || 100;
    const hasLimit = /\bLIMIT\b/i.test(q);
    const finalQuery = hasLimit ? q : `${q} LIMIT ${limit}`;

    const result = await internalApi('/api/clickhouse/query', ctx, {
      method: 'POST',
      body: JSON.stringify({ query: finalQuery }),
    });

    return {
      success: true,
      data: {
        data: result.data,
        columns: result.meta?.columns || [],
        rowCount: result.data?.length || 0,
        elapsed: result.meta?.elapsed,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Get table schema */
export async function getTableSchema(args: {
  table?: string;
}, ctx: ToolContext): Promise<ToolResult> {
  try {
    const table = args.table || 'universal_person';
    const result = await internalApi(`/api/clickhouse/schema/${table}`, ctx);
    return { success: true, data: result };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
```

**NOTE**: `internalApi` helper should be extracted to a shared util (`agents/tools/handlers/_internal.ts`) to avoid duplication across handler files.

---

## File: `agents/tools/handlers/system.ts`

```typescript
import { ToolResult, ToolContext } from '../types';
import { chQuery } from '../../../lib/clickhouse';

/** Get health of all connected services */
export async function getServerHealth(_args: any, ctx: ToolContext): Promise<ToolResult> {
  try {
    const result = await internalApi('/api/servers/health', ctx);
    return { success: true, data: result };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Get platform-wide dashboard statistics */
export async function getDashboardStats(_args: any, ctx: ToolContext): Promise<ToolResult> {
  try {
    // Direct ClickHouse queries for speed (no HTTP overhead)
    const [counts] = await chQuery<any>(`
      SELECT
        count() as total_leads,
        countIf(verification_status = 'verified') as verified,
        countIf(verification_status = 'unverified' OR verification_status = '') as unverified
      FROM universal_person
    `);

    const recentJobs = await chQuery<any>(`
      SELECT id, status, total_emails, safe_count, risky_count, started_at, completed_at
      FROM pipeline_jobs
      ORDER BY started_at DESC
      LIMIT 5
    `);

    return {
      success: true,
      data: {
        totalLeads: counts?.total_leads || 0,
        verifiedCount: counts?.verified || 0,
        unverifiedCount: counts?.unverified || 0,
        recentJobs,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
```

---

## Remaining Handler Files (same pattern)

### `handlers/segments.ts`
- `listSegments()` → `GET /api/segments`
- `createSegment(name, filters)` → `POST /api/segments`
- `getSegmentCount(segment_id)` → `GET /api/segments/:id/count`

### `handlers/content.ts`
- `generateEmailCopy(type, product, audience, tone, variants)` → Internal LLM call using the agent's configured provider. Does NOT call an API route — uses the same LLM client the chat uses.

### `handlers/ingestion.ts`
- `listS3Sources()` → `GET /api/ingestion/sources`
- `startIngestion(source_id, files, column_mapping)` → `POST /api/ingestion/start`

### `handlers/scoring.ts`
- `scoreLeads(segment_id, limit)` → `POST /api/segments/:id/execute` + scoring computation

All follow the exact same pattern: validate args → call existing API → transform response → return `ToolResult`.
