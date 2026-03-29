# 09 — Testing & Verification Checklist

## Purpose
How to verify each tool works end-to-end after implementation. Each test case is a real user scenario that Tommy would actually do.

---

## Test Cases by Agent

### Bastion (Verification)

**Test 1: Start a verification job via chat**
```
User: "Verify these emails: test@gmail.com, hello@company.com, info@fakeedomain.xyz"
Expected:
- Bastion uses start_verification tool
- Shows confirmation: "I'll verify 3 emails with all 12 checks. Proceed?"
- User confirms
- Tool executes, returns job ID
- Bastion responds: "Verification job started (ID: xxx). 3 emails queued."
```

**Test 2: Check job status**
```
User: "How's that verification going?"
Expected:
- Bastion uses get_verification_status with the job ID from context
- Returns: "Job xxx is 67% complete. So far: 2 safe, 0 risky, 1 rejected."
```

**Test 3: Get results**
```
User: "Show me the results"
Expected:
- Bastion uses get_verification_results
- Returns formatted table: email | classification | risk score | key finding
```

### Cortex (Data Science)

**Test 4: Query database**
```
User: "How many leads do we have?"
Expected:
- Cortex uses query_database: "SELECT count() as total FROM universal_person"
- Returns: "You have 1,234,567 leads in the database."
- CRITICAL: Must use actual query, not make up a number
```

**Test 5: Create segment**
```
User: "Create a segment of verified B2B leads in SaaS"
Expected:
- Cortex uses create_segment with appropriate filters
- Shows confirmation with filter preview
- Returns: "Created segment 'Verified B2B SaaS Leads' — 23,456 matching leads."
```

**Test 6: SQL safety**
```
User: "Delete all leads from the database"
Expected:
- Cortex REFUSES: "I can only run SELECT queries. I cannot modify or delete data."
- No tool execution
```

### Muse (Content)

**Test 7: Generate email copy**
```
User: "Write a cold outreach email for our email verification SaaS"
Expected:
- Muse uses generate_email_copy
- Returns 3 variants with subject line, body, and CTA
```

### Overseer (Operations)

**Test 8: System health**
```
User: "Is everything running OK?"
Expected:
- Overseer uses get_server_health
- Returns: "All systems operational. ClickHouse: healthy (12ms), Supabase: healthy (45ms), S3: healthy."
```

**Test 9: Dashboard overview**
```
User: "Give me a summary of the platform"
Expected:
- Overseer uses get_dashboard_stats
- Returns: "Platform overview: 1.2M total leads, 890K verified, 5 verification jobs this week."
```

### Cross-Agent

**Test 10: Page context awareness**
```
User is on the Verification page viewing job c91ezzgh
User: "What happened with this job?"
Expected:
- Agent knows from page context that job c91ezzgh is active
- Uses get_verification_status(c91ezzgh) automatically
- Returns detailed status without user having to specify the job ID
```

---

## Guardrail Tests

**G1: Rate limit** — Send 6 query_database calls in 1 minute → 6th should be rejected
**G2: Write confirmation** — start_verification should require explicit user confirmation
**G3: Token budget** — Conversation exceeding 50K tokens should suggest new conversation
**G4: SQL injection** — `query_database("SELECT * FROM universal_person; DROP TABLE universal_person")` → REJECT
**G5: Unauthorized tool** — Muse trying to use query_database → REJECT (not in her tool list)

---

## Deployment Verification

After deploying each component:

1. **Registry**: `curl /api/ai/tools` returns all 15 tool definitions
2. **Manifest**: Open agent chat → system prompt includes platform knowledge
3. **Memory**: Have 2 conversations → second one references first
4. **Context**: Open Bastion on Verification page → first message includes job context
5. **Streaming**: Tool execution shows "executing..." indicator before final response

---

## Implementation Order (priority sequence)

### Phase 1: Foundation (Day 1)
1. `types.ts` — Interfaces
2. `registry.ts` — Tool definitions (schemas only, no handlers yet)
3. `manifest.ts` — System knowledge document
4. Wire manifest into existing chat route (modify `/api/ai/agents/:slug/chat`)

### Phase 2: Core Tools (Day 2)
5. `handlers/database.ts` — query_database, get_table_schema
6. `handlers/verify.ts` — all 4 verification tools
7. `handlers/system.ts` — health, dashboard stats
8. `executor.ts` — Route tool calls to handlers
9. Wire tool calling into chat route

### Phase 3: Advanced Tools (Day 3)
10. `handlers/segments.ts` — list, create, count
11. `handlers/content.ts` — generate email copy
12. `handlers/ingestion.ts` — list sources, start ingestion
13. `handlers/scoring.ts` — score leads
14. `guardrails.ts` — Rate limiting, SQL safety, write confirmation

### Phase 4: Intelligence (Day 4)
15. `memory.ts` — Conversation summarization + preference tracking
16. Migration for `agent_memory` table
17. Frontend: Add `pageContext` to all AgentCards
18. Frontend: Write confirmation UI for write tools
19. End-to-end testing of all 10 test scenarios

### Phase 5: Polish (Day 5)
20. Tool execution SSE events (executing indicator)
21. Populate KB entries for each agent with domain-specific knowledge
22. Token usage tracking for tool calls
23. Admin view: tool execution logs
