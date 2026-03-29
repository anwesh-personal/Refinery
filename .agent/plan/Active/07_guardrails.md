# 07 — Guardrails

## Purpose
Prevent agents from doing damage, hallucinating data, or running up costs.

---

## 1. Query Safety

**Rule**: `query_database` tool ONLY allows SELECT statements. Enforced in the handler:
```typescript
// HARD BLOCK: regex check BEFORE execution
if (!query.trim().toUpperCase().startsWith('SELECT')) → REJECT
if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i.test(query)) → REJECT
```

**No exceptions.** If a future tool needs mutations, it gets its own dedicated handler with explicit parameters (not raw SQL).

## 2. Rate Limiting

**Per conversation**:
- Max 10 tool calls per conversation (prevents runaway loops)
- Max 1 `start_verification` call per conversation (prevents accidental duplicate jobs)
- Max 1 `start_ingestion` call per conversation

**Per minute (global)**:
- Max 5 `query_database` calls per minute per user
- Max 1 `start_verification` per minute per user

**Implementation**: Simple in-memory counter per userId+toolName. Resets every 60 seconds.

## 3. Write Confirmation

Tools with `riskLevel: 'write'`:
- `start_verification`
- `create_segment`
- `start_ingestion`

When the LLM wants to use a `write` tool, the response should include a confirmation step:
```
Agent: I'll start a verification job for 50,000 emails. This will:
- Use all 12 verification checks
- Take approximately 15-20 minutes
- Use SMTP resources on your server

Shall I proceed? (The agent waits for user "yes" before executing)
```

**Implementation**: The chat route detects `riskLevel: 'write'` and returns the tool call as a "pending" action. The frontend shows a confirmation button. User confirms → re-sends with `confirmed: true` → tool executes.

## 4. Anti-Hallucination

**Rule**: When Cortex answers a data question, it MUST use `query_database` to get real numbers. The system prompt includes:
```
CRITICAL: Never fabricate numbers. If the user asks "how many leads do we have?",
you MUST use query_database to get the real count. If a tool fails, say so —
do not make up data.
```

**Enforcement**: Post-response check — if the response contains specific numbers and no tool was called, flag it with a soft warning: `⚠️ This response may contain estimated numbers. Ask me to verify with a database query.`

## 5. Token Budget

**Per conversation limit**: 50,000 tokens (input + output combined). After this:
- Agent suggests starting a new conversation
- Old conversation gets auto-summarized and stored in memory

**Per tool result limit**: Tool results are truncated to 4,000 tokens before being sent back to the LLM. For large query results, only first 50 rows are sent with a note: "Showing 50 of 12,345 results."

## 6. PII Handling

**Rule**: Tool results that contain email addresses or personal data are fine to show to the authenticated user. But they MUST NOT be:
- Logged in full to Supabase audit_log (log only counts, job IDs, not actual email addresses)
- Included in conversation summaries for memory

**Implementation**: The memory summarizer strips email addresses before storing summaries.

---

## File: `agents/guardrails.ts`

```typescript
export function validateToolCall(toolName: string, riskLevel: string, userId: string): {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
} {
  // Check rate limits
  const key = `${userId}:${toolName}`;
  const count = rateLimitMap.get(key) || 0;
  
  if (toolName === 'query_database' && count >= 5) {
    return { allowed: false, reason: 'Rate limit: max 5 queries per minute' };
  }
  if (toolName === 'start_verification' && count >= 1) {
    return { allowed: false, reason: 'Rate limit: max 1 verification job per minute' };
  }

  // Check write confirmation
  if (riskLevel === 'write' || riskLevel === 'destructive') {
    return { allowed: true, requiresConfirmation: true };
  }

  // Increment counter
  rateLimitMap.set(key, count + 1);
  setTimeout(() => rateLimitMap.delete(key), 60000);

  return { allowed: true };
}

export function truncateToolResult(result: any, maxTokens = 4000): any {
  const json = JSON.stringify(result);
  if (json.length > maxTokens * 4) { // rough char-to-token ratio
    // For arrays, slice to fit
    if (Array.isArray(result.data)) {
      const sliced = result.data.slice(0, 50);
      return {
        ...result,
        data: sliced,
        _truncated: true,
        _totalRows: result.data.length,
        _note: `Showing first 50 of ${result.data.length} results`,
      };
    }
    // For other large objects, stringify and truncate
    return { ...result, _truncated: true };
  }
  return result;
}

export function stripPII(text: string): string {
  // Remove email addresses from memory summaries
  return text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
}
```
