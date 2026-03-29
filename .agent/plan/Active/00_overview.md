# AI Agent Tool Layer — Master Plan

## Mission
Make every AI agent in Refinery Nexus **capable of executing real actions** — not just chatting.
Tommy (or any operator) should be able to say "verify these 50K emails" and have Bastion **actually start the job**, track it, and report results. No coding required.

## Current State (as of 2026-03-29)

### What EXISTS and WORKS
- **5 Agents**: Cortex (data science), Bastion (security/verification), Muse (content), Overseer (ops), Litmus (QA)
- **Agent DB**: `ai_agents` table in Supabase (name, slug, system_prompt, model, temperature, avatar_url, etc.)
- **KB System**: `agent_knowledge_base` table (agent_id, title, content, priority, category)
- **Chat**: `agent_conversations` + `agent_messages` tables with streaming response
- **Chat API Route**: `POST /api/ai/agents/:slug/chat` — sends messages, gets LLM response
- **Provider System**: 3-tier cascading provider resolution (agent → global default → fallback)
- **Frontend**: AgentsPanel with per-agent chat, AgentCard on every page

### What DOES NOT EXIST (the gap)
1. **Tool Definitions** — No tools are defined. Agents cannot call ANY function.
2. **Tool Executor** — No mechanism to receive a tool call from the LLM and execute it.
3. **Tool Handlers** — No domain-specific functions wrapping existing APIs.
4. **System Manifest** — Agents have no knowledge of what Refinery Nexus is, what it does, what tables exist.
5. **Page Context Injection** — Agents don't know what page the user is on or what data they're looking at.
6. **Memory/Summarization** — No cross-conversation memory. Every chat starts from zero.
7. **Guardrails** — No response validation, no anti-hallucination, no rate limiting on tool calls.

## Architecture Principles

1. **No god files** — Each domain gets its own handler file (verify.ts, database.ts, etc.). Max 150 lines each.
2. **No stubs** — Every function either works or doesn't exist. No `// TODO` placeholders.
3. **No hardcoded values** — All config comes from DB (agent settings, provider keys, server configs).
4. **Reuse existing APIs** — Tool handlers call the SAME functions the API routes use. No duplicate logic.
5. **Typed everything** — Full TypeScript interfaces for tool inputs, outputs, and schemas.
6. **Fail safe** — Tools return structured errors. Agent explains the error to the user. No silent failures.
7. **Audit trail** — Every tool execution is logged with agent_id, user_id, tool_name, args, result, timestamp.

## File Structure

```
refinery-backend/src/
  agents/
    tools/
      index.ts              — Exports registry + executor
      registry.ts           — Tool definitions map (name → schema + handler ref)
      executor.ts           — Receives tool call → validates → routes to handler → returns result
      types.ts              — ToolDefinition, ToolCall, ToolResult interfaces
      handlers/
        verify.ts           — start_verification, get_job_status, get_job_results
        database.ts         — query_clickhouse (SELECT only)
        segments.ts         — list_segments, create_segment, delete_segment
        enrichment.ts       — start_enrichment, get_enrichment_status
        scoring.ts          — score_leads, get_scoring_config
        content.ts          — generate_email_copy, analyze_spam_score
        system.ts           — get_server_health, get_dashboard_stats, get_pipeline_overview
        ingestion.ts        — list_s3_sources, start_ingestion, get_ingestion_status
    manifest.ts             — buildSystemManifest(agentSlug) → string
    memory.ts               — summarizeConversation(), getMemorySummaries()
    guardrails.ts           — validateToolCall(), sanitizeResponse()
  routes/
    agent-chat.ts           — MODIFIED: inject tools into LLM call, handle tool_use responses
```

## Plan Documents

| File | Contents |
|------|----------|
| `01_current_codebase.md` | Exact inventory of every API route, DB table, and function that handlers will call |
| `02_tool_registry.md` | Every tool definition with full JSON schema, description, which agent owns it |
| `03_tool_handlers.md` | Each handler file with exact function signatures, input/output types, and implementation logic |
| `04_system_manifest.md` | The system knowledge document injected into agent system prompts |
| `05_chat_integration.md` | How the existing chat route changes to support tool calling |
| `06_memory_system.md` | Cross-conversation memory architecture |
| `07_guardrails.md` | Validation, rate limiting, anti-hallucination |
| `08_frontend_context.md` | How pages pass context to AgentCard for page-aware agents |
| `09_testing_checklist.md` | How to verify each tool works end-to-end |
