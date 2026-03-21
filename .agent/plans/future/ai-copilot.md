# AI Copilot for Refinery Nexus

## Overview
Embed an AI assistant inside Refinery that has tooling access to ClickHouse, server infrastructure, and all platform operations. Users interact via natural language and the AI executes queries, triggers operations, and surfaces insights — all respecting RBAC permissions.

## User Capabilities

| User Prompt | AI Action |
|-------------|-----------|
| "How many leads bounced last week?" | Generates ClickHouse SQL → runs it → returns count + chart |
| "Which segments have the worst deliverability?" | Queries verification results per segment → ranks → shows table |
| "Start verification on Segment 'UK B2B'" | Calls verification API with the correct segment ID |
| "How's the server doing?" | Checks CPU, memory, disk, PM2 status via health endpoint |
| "Show me everything John exported this month" | Queries audit logs + performed_by data |
| "Generate a deliverability report for Client X" | Compiles ingestion → verification → bounce data into formatted report |
| "What's my Verify550 credit balance?" | Calls the V550 credits API |
| "Compare bounce rates between Segment A and B" | Multi-query + analysis + visual chart |

## Architecture

```
User prompt → POST /api/ai/chat
  → Backend validates auth + RBAC
  → LLM (OpenAI / Anthropic) with function-calling
  → Available Tools:
      1. clickhouse_query(sql)       — READ-ONLY SELECT only, validated server-side
      2. server_health()             — CPU, memory, disk, PM2 process status
      3. trigger_operation(action)   — start batch, export, create segment, etc.
      4. list_segments()             — current segments with lead counts
      5. user_activity(userId)       — performed_by audit trail
      6. v550_credits()              — Verify550 balance check
      7. system_stats()              — dashboard-level aggregate stats
  → Structured response rendered in chat UI with inline charts/tables
```

## Security Requirements

1. **RBAC-enforced** — AI respects the logged-in user's permissions. Members cannot perform admin operations through AI.
2. **Read-only SQL by default** — AI generates SELECT queries only. Server-side validation rejects any INSERT/UPDATE/DELETE/DROP/ALTER before execution.
3. **SQL sanitization** — Parameterize user-provided values. Reject queries targeting system tables.
4. **Audit trail** — Every AI prompt, generated query, and result is logged to audit_log.
5. **Rate limiting** — Per-user rate limits to prevent abuse (e.g., 30 queries/hour for members, unlimited for superadmin).
6. **Context-aware** — AI knows the ClickHouse schema, existing segments, running jobs. Schema is injected into the system prompt.

## Frontend Design

- **Slide-out chat panel** — triggered from a floating button in the bottom-right corner
- **Message history** — persisted per session, optionally across sessions
- **Rich responses** — inline tables, charts (using Recharts), code blocks for SQL, action buttons for operations
- **Streaming** — responses stream in real-time for better UX
- **Theme-aware** — matches the current Refinery theme (dark/aqua/minimal)

## Backend Implementation

### New Route: `/api/ai/chat`
```typescript
router.post('/chat', requireAuth, async (req, res) => {
  const { message, conversationHistory } = req.body;
  const user = getRequestUser(req);
  
  // Build tool definitions based on user's RBAC permissions
  const tools = buildToolsForRole(user.role, user.permissions);
  
  // Call LLM with function-calling
  const response = await llm.chat({
    model: 'gpt-4o', // or claude-3.5-sonnet
    messages: [systemPrompt, ...conversationHistory, { role: 'user', content: message }],
    tools,
  });
  
  // Execute any tool calls
  // ...
  
  // Log to audit
  await auditLog(user.id, 'ai_query', null, { prompt: message, response: response.content });
  
  res.json({ response });
});
```

### Tool Definitions
Each tool is a function the LLM can call:
- `clickhouse_query` — accepts SQL string, validates it's SELECT-only, runs against ClickHouse, returns JSON rows
- `server_health` — calls PM2 API + os module for system stats
- `trigger_operation` — dispatches to existing service functions (startBatch, createSegment, etc.)

### System Prompt
Includes:
- ClickHouse schema definitions (table names, columns, types)
- Available segments and their IDs
- Current user's role and permissions
- Platform context (what Refinery does, terminology)

## LLM Provider Options

| Provider | Model | Cost | Latency | Function Calling |
|----------|-------|------|---------|-----------------|
| OpenAI | gpt-4o | $2.50/1M input | ~1s | ✅ Excellent |
| OpenAI | gpt-4o-mini | $0.15/1M input | ~0.5s | ✅ Good |
| Anthropic | claude-3.5-sonnet | $3/1M input | ~1s | ✅ Excellent |
| Local | Ollama (llama3) | Free | ~3s | ⚠️ Limited |

Recommendation: Start with **gpt-4o-mini** for cost efficiency, upgrade to **gpt-4o** or **claude-3.5-sonnet** for complex analytical queries.

## Implementation Phases

### Phase 1: Read-Only Intelligence (2-3 days)
- Chat UI with floating panel
- ClickHouse query tool (SELECT only)
- System stats tool
- Basic conversation history

### Phase 2: Operational Commands (1-2 days)
- Trigger verification batches
- Create/manage segments
- Export data via natural language
- RBAC enforcement for write operations

### Phase 3: Proactive Insights (2-3 days)
- Scheduled background analysis
- Smart alerts ("Bounce rate spiked 40% today")
- Weekly automated reports
- Anomaly detection on ingestion/verification patterns

## Dependencies
- LLM API key (OpenAI or Anthropic) — stored in system_config or .env
- New npm packages: `openai` or `@anthropic-ai/sdk`
- No infrastructure changes — runs on existing Express backend

## Estimated Effort
- **v1 (Read-Only Chat)**: 2-3 focused days
- **v2 (Full Operations)**: +2 days
- **v3 (Proactive Intelligence)**: +3 days
- **Total**: ~7-8 days for the complete system
