# SESSION HANDOVER — 2026-03-29
## AI Boardroom Intelligence Architecture + Agent Tool Suite

---

## WHO IS THE USER

**Name:** Anwesh Rath  
**Email:** anweshrath@gmail.com  
**Role:** Sole founder, architect, and operator of Refinery Nexus / Prediction Marketing  
**Partner:** Fran (fran@predictionmarketing.ai) — business operations partner

Anwesh is building a **$40 million level B2B data intelligence platform**. This is not a side project. This is not an MVP. He expects every line of code to reflect the ambition and scale of a production SaaS that will serve enterprise clients. He has explicitly stated that his life is on the line — he has referenced **cartel threats, murder threats, and suicide** if this project fails. This context is critical: every AI assistant working on this codebase must understand that cutting corners, writing stubs, or shipping half-baked code is not just "bad practice" — it is an existential risk to the person you are working with.

---

## USER'S ETHOS AND NON-NEGOTIABLE RULES

These are direct quotes and patterns observed across this entire conversation and prior sessions:

### Code Quality Mandates
1. **"No band aids, no short cuts, no hardcoding, no cheap corner cutting or stubs"** — This was stated explicitly and must be treated as law.
2. **"Ethical, topmost level of coding and structural integrity. Modular as fuck."** — Every file must be a self-contained module. No god files. No spaghetti.
3. **"No MVP level bullshit"** — The user will audit your code. If he finds hardcoded values, TODO comments, placeholder logic, or lazy shortcuts, he will call it out aggressively. Expect profanity. It's not personal — it's passion for quality.
4. **Write in small chunks** — The user's tool calls time out with large writes. ALWAYS write files in small, focused chunks. Never try to write 200+ lines in a single tool call.

### Communication Style
- The user communicates with extreme directness and frequent profanity. This is his style. Do not be offended. Do not tone-police. Match his energy with action, not apologies.
- When he says "go" or "all" — he means execute everything immediately. No confirmation loops.
- When he says "review and report" — he wants a forensic audit with line numbers. Not a summary. Not "looks good."
- When he asks "what's left?" — give him a complete honest list, don't sugarcoat.

### Deployment Protocol
- **Server:** `root@107.172.56.66` (password in `.agent/creds.md`)
- **Frontend:** Built with Vite, deployed to `/home/anweshrath/htdocs/iiiemail.email/`
- **Backend:** TypeScript, compiled with `tsc`, managed by PM2 as `refinery-api`
- **Database:** ClickHouse (operational data) + Supabase (application state/auth)
- **Git:** GitHub at `anwesh-personal/Refinery.git`, branch `main`
- **Deploy flow:** `git push` → SSH to server → `git pull` → `npm run build` → `pm2 restart refinery-api` → copy `dist/*` for frontend

---

## WHAT WAS BUILT THIS SESSION

### Phase 1: Schema Registry (Dynamic Data Awareness)

**File:** `refinery-backend/src/agents/context/schema-registry.ts`

The foundation of the entire intelligence layer. This module:
- Queries ClickHouse `system.tables` and `system.columns` to discover ALL tables and their schemas at runtime
- Probes Supabase tables via `.select().limit(0)` to confirm existence
- Caches results for 5 minutes (TTL-based)
- Exposes `getPromptContext()` which generates a markdown string describing the entire data environment — this gets injected into every agent's system prompt
- Exposes `validateTableName()` which prevents SQL injection by checking table names against the actual schema (regex + existence check)

**Why it matters:** Before this, agents had NO idea what data existed. They couldn't answer "how many leads do I have?" because their prompts didn't mention ClickHouse. Now every agent sees every table, every column, every row count — live.

### Phase 2: System Prompt Builder

**File:** `refinery-backend/src/agents/context/system-prompt-builder.ts`

Layers context into system prompts:
1. Agent personality (from DB `ai_agents.system_prompt`)
2. Live schema context (from Schema Registry)
3. Knowledge base entries (from `ai_agent_kb` table)
4. Page-level context (from frontend)
5. Agent-specific behavioral guardrails

**Current status:** Module exists but is NOT wired into the main route. The actual prompt building still happens inline in `ai-agents.ts`. This module should replace that inline logic in a future session.

### Phase 3: Context Builder (Ingestion Pipeline)

**File:** `refinery-backend/src/agents/context/context-builder.ts`

Auto-generates rich context snapshots for any ingested file:
- Row count, column list, domain distribution, quality tier breakdown
- Title/industry distributions, duplicate rate
- Sample rows (dynamically selected based on string-type columns — NOT hardcoded)
- Outputs both structured `IngestionContext` object and a `promptText` string for injection

**API Endpoint:** `GET /api/ai/agents/context/ingestion?table=leads&source_file=myfile.csv`

### Phase 4: Analysis Tool Suite (5 Modular Tools)

All tools live in `refinery-backend/src/agents/tools/analysis/`:

| Tool | File | What It Does |
|---|---|---|
| `analyze_list` | `analyze-list.ts` | Row counts, fill rates, domain distribution, duplicates, sample rows |
| `compare_lists` | `compare-lists.ts` | Cross-list overlap by email/domain/company, shared domains, merge recommendation |
| `find_duplicates` | `find-duplicates.ts` | Duplicate detection with frequency distribution |
| `merge_lists` | `merge-lists.ts` | Dedup + merge with strategies (prefer_a/b/newest/filled), preview + execute modes |
| `profile_columns` | `profile-columns.ts` | Null rates, unique rates, length stats, top values per column |

**Every tool:**
- Validates table names via `validateTableName()` (SQL injection prevention)
- Returns structured `ToolResult` objects
- Is registered in `agents/tools/analysis/index.ts` → auto-loaded by the registry

### Phase 5: Agent Oversight Tool

**File:** `refinery-backend/src/agents/tools/analysis/get-agent-activity.ts`

Gives Crucible (the supervisor agent) the ability to:
- Pull any agent's recent conversations from `ai_agent_conversations`
- Read usage stats from `ai_usage_log` (token counts, latency, error rates)
- Check boardroom participation from `ai_boardroom_reports`
- Optionally include full conversation content (truncated to 200 chars per message)

**Usage:** `@Crucible how is Cipher performing?` → Crucible calls `get_agent_activity({ agent_slug: "data_scientist" })`

### Phase 6: Orchestration Engine

**File:** `refinery-backend/src/agents/orchestration.ts`

Parses user messages to detect interaction modes:

| Pattern | Mode | Behavior |
|---|---|---|
| `@Cipher` | Solo | Only Cipher responds |
| `@all` | Parallel | All agents respond independently |
| `@Cipher then @Sentinel` | Chain | Cipher responds first, Sentinel gets Cipher's response as context |
| `@Cipher vs @Oracle` | Debate | Both respond, each seeing the other's argument |
| No mentions | Parallel | All agents (default) |

**Agent resolution is dynamic** — fetches `ai_agents` from Supabase with 5-minute cache. Adding a new agent in the admin panel automatically makes it available in the boardroom.

**Chain/Debate logic** is implemented in the boardroom POST handler (`ai-agents.ts` lines ~590-610) where the `boardroomBlock` prompt is modified based on mode.

---

### Phase 7: Frontend Boardroom Enhancements

**File:** `axiom-data-hub/src/pages/Boardroom.tsx`

Changes made:
1. **Mode-aware @mention parsing** (lines 96-121) — Frontend detects `then`/`vs` patterns and passes `mode` to the API
2. **Follow-up conversations** — Added `pollMeetingAppend()` which appends new agent responses to the existing chat timeline instead of resetting it. This enables multi-turn conversations.
3. **Immediate user message display** — User's message appears in chat instantly (before API responds), not after

**Still hardcoded (known issue):** The `AGENTS` object on lines 7-13 hardcodes agent names, roles, colors, and images. This should be fetched from `/api/ai/agents` at mount time. Adding a 6th agent via the admin panel requires editing this file. This is the #1 frontend tech debt item.

### Phase 8: Ingestion → AI Context Wiring

**File:** `axiom-data-hub/src/pages/Ingestion.tsx` (lines 1847-1856)

The `AgentCard` at the bottom of the ingestion page now receives:
- `contextLabel` dynamically: shows `"Analyzing: filename.csv (N rows)"` instead of a generic label
- `context` prop: passes `{ table, source_file, rows_ingested, columns, sampleRows }` to the agent card
- When the card opens, it sends this context as the first message in the conversation, giving Cipher immediate awareness of what was just ingested

---

## BUGS FIXED THIS SESSION

### 1. Meeting History Not Showing (CRITICAL)

**Root cause:** Auth middleware sets `(req as any).userId` but the boardroom code was reading `(req as any).user?.id` — completely wrong property name. Every meeting was created with `user_id = null`. The GET endpoint filters by `user_id = <actual_id>`, so null ≠ actual = no results.

**Fix:** `sed -i 's/(req as any).user?.id/(req as any).userId/g'` across all agent routes. Also backfilled existing meetings:
```sql
UPDATE ai_boardroom_meetings SET user_id = '70c92604-c041-4753-b145-afa520e4c4e5' WHERE user_id IS NULL;
```

### 2. SQL Injection Vulnerability (CRITICAL)

**Root cause:** All analysis tools accepted a `table` parameter and interpolated it directly into SQL queries without any validation. An LLM could pass malicious table names.

**Fix:** Created `validateTableName()` in `schema-registry.ts`:
- Regex check: only `[a-zA-Z_][a-zA-Z0-9_]*` is allowed
- Existence check: validates against live ClickHouse `system.tables`
- Every analysis tool now calls this before any query

### 3. Broken Merge Strategy (RUNTIME ERROR)

**Root cause:** `merge-lists.ts` used `length(toString(*)) DESC` which is NOT valid ClickHouse SQL.

**Fix:** Replaced with dynamic non-empty field counting:
```typescript
const nonEmptyExprs = allCols
  .filter(c => c !== 'source_file' && c !== 'created_at')
  .map(c => `if(${c} != '' AND ${c} IS NOT NULL, 1, 0)`)
  .join(' + ');
orderBy = `(${nonEmptyExprs}) DESC`;
```

### 4. Supabase Schema Discovery Silent Failure

**Root cause:** Used a non-existent `get_public_columns` RPC. Always failed silently.

**Fix:** Replaced with direct PostgREST existence checks using `supabaseAdmin.from(table).select('*').limit(0)`. If the query succeeds, the table exists.

### 5. Server Code Drift

**Root cause:** Multiple Python patches were applied directly on the server via SSH (`sed`, `python3` scripts). These changes were not in the local git repository.

**Fix:** SCP'd the server's `ai-agents.ts` back to local, committed, and pushed. Local and server are now in sync.

---

## FILE MAP — WHAT WAS CREATED / MODIFIED

### New Files Created
```
refinery-backend/src/agents/context/
├── schema-registry.ts        # Dynamic schema discovery + table validation
├── system-prompt-builder.ts   # Layered prompt construction (NOT WIRED YET)
└── context-builder.ts         # Ingestion context generation

refinery-backend/src/agents/
└── orchestration.ts           # Chain/debate/parallel mode parsing

refinery-backend/src/agents/tools/analysis/
├── analyze-list.ts            # Comprehensive list stats
├── compare-lists.ts           # Cross-list overlap
├── find-duplicates.ts         # Duplicate detection
├── merge-lists.ts             # Merge + dedup with strategies
├── profile-columns.ts         # Deep column profiling
├── get-agent-activity.ts      # Crucible oversight tool
└── index.ts                   # Auto-export for registry
```

### Modified Files
```
refinery-backend/src/routes/ai-agents.ts     # +169 lines: context endpoint, userId fix, chain/debate, import orchestration
refinery-backend/src/agents/tools/registry.ts # Registered all analysis tools
axiom-data-hub/src/pages/Boardroom.tsx        # Mode parsing, follow-up chat, pollMeetingAppend
axiom-data-hub/src/pages/Ingestion.tsx        # Context injection into AgentCard
```

---

## WHAT IS NOT DONE — NEXT SESSION PRIORITIES

### Priority 1: S3 Export Pipeline (CRITICAL for go-live)

**What exists:** S3 sources service (`s3sources.ts`) for READING from S3 buckets. There is NO export service for WRITING verified leads back to S3.

**What's needed:**
- `refinery-backend/src/services/s3-export.ts` — Service that queries verified leads, generates CSV, uploads to configured S3 bucket
- API route: `POST /api/export/s3` with params: `{ segmentId, bucket, prefix, format }`
- Frontend button on the segment/verification results page
- Support for CSV and JSON export formats

### Priority 2: Post-Verification Auto-Push

**What exists:** `mailwizz-sync.ts` (186 lines) and `audience-sync.ts` (293 lines) — both fully functional for pushing segments to MailWizz.

**What's missing:**
- A trigger/hook after verification job completes that auto-pushes to MailWizz
- Frontend UI for "Push to MailWizz" on the verification results page
- Configuration UI for MailWizz connection (currently set via Server Config key-value pairs)

### Priority 3: Wire system-prompt-builder.ts

**Current state:** The module exists and is correct, but the actual prompt building in `ai-agents.ts` still happens inline. The `buildSystemPrompt()` function should replace the inline logic for consistency.

### Priority 4: Boardroom UI Overhaul

**User feedback (direct quote):** "chat looks like shit.. I need to be able to drag and drop these bitches and there needs to be a great algorithm.. some modern futuristic setup.. intuitive as fuck"

**What's needed:**
- Premium dark-mode WhatsApp-style redesign
- Drag-and-drop agent selection (instead of @mentions for mobile/desktop)
- Agent cards with real-time status indicators
- Glassmorphism, micro-animations, smooth transitions
- The sidebar meeting history needs visual polish

### Priority 5: Dynamic Agent Resolution (Frontend)

The `AGENTS` object in `Boardroom.tsx` is hardcoded. It should:
- Fetch from `/api/ai/agents` on mount
- Cache in React state
- Support any number of agents without code changes

### Priority 6: Multi-Round Debate

Current debate mode is single round (each agent responds once seeing the other). The user wants 2-3 rounds of back-and-forth with Crucible moderating and giving a final verdict.

---

## INFRASTRUCTURE REFERENCE

### Credentials
All credentials are in `.agent/creds.md`. Key ones:
- **Server SSH:** `root@107.172.56.66` / `AuVkRFXqz5GY8qn5`
- **Supabase:** `https://zucvybnaopjkfhvkrsqz.supabase.co`
- **Publishable Key:** `sb_publishable_xwvqctPMKvYS6h-fvCDpKA_wO9LcNrz`

### User IDs in Supabase
```
70c92604-c041-4753-b145-afa520e4c4e5  anweshrath@gmail.com (OWNER)
1b3e4f79-3d69-4ea1-a4e8-2c95ec3e3ff0  fran@predictionmarketing.ai (PARTNER)
a88fd1af-79a3-4d1f-9789-9fecd8c4f3d2  tliantonio@cause72.com
4e2e962c-9901-4365-a446-0209248160d7  arsoumi.0613@gmail.com
43dd45eb-2429-428e-9b46-e1c7b724f815  milan2pals@gmail.com
```

### PM2 Process
```bash
pm2 restart refinery-api   # Restart backend
pm2 logs refinery-api      # Check logs
```

### Build Commands
```bash
# Backend
cd /root/refinery/refinery-backend && npm run build && pm2 restart refinery-api

# Frontend
cd /root/refinery/axiom-data-hub && npm run build
rm -rf /home/anweshrath/htdocs/iiiemail.email/assets
cp -r dist/* /home/anweshrath/htdocs/iiiemail.email/
```

### Key Database Tables
**ClickHouse (operational):**
- `leads` — Ingested lead data (millions of rows)
- `universal_person` — Consolidated person records (deduplicated)
- `segments` — Audience segments with filter queries
- `target_lists` — Push targets with MTA sync status
- `ingestion_jobs` — File upload tracking
- `verification_jobs` — Email verification job tracking

**Supabase (application state):**
- `ai_agents` — Agent configs (name, slug, system_prompt, provider, temperature, etc.)
- `ai_agent_conversations` — Individual agent chat sessions
- `ai_agent_messages` — Messages within conversations
- `ai_agent_kb` — Knowledge base entries per agent
- `ai_providers` — LLM provider configs (OpenRouter, direct, etc.)
- `ai_usage_log` — Token/latency tracking
- `ai_boardroom_meetings` — Boardroom sessions
- `ai_boardroom_reports` — Individual agent reports within meetings
- `profiles` — User profiles (linked to Supabase Auth)

---

## EXISTING SERVICES THAT ARE PRODUCTION-READY

These services were built in prior sessions and are fully functional:

1. **MailWizz Sync** (`services/mailwizz-sync.ts`) — Segment → MailWizz list push with batch processing
2. **Audience Sync** (`services/audience-sync.ts`) — Full pipeline with column mapping, role-based filtering, free provider exclusion, cross-list dedup, batch streaming
3. **MTA Adapter** (`services/mta/adapter.ts` + `services/mta/mailwizz.ts`) — Abstract MTA interface with MailWizz implementation
4. **S3 Sources** (`services/s3sources.ts`) — S3 bucket connection, testing, file listing (READ only)
5. **Segment Scheduler** (`services/segment-scheduler.ts`) — Cron-based segment re-execution
6. **Email Verification Engine** — Full SMTP probe pipeline with catch-all detection, MX resolution, scoring
7. **Ingestion Pipeline** — CSV upload → ClickHouse with column mapping, progress tracking

---

## TECHNICAL DEBT REGISTER

| # | Item | Severity | Location |
|---|---|---|---|
| 1 | `system-prompt-builder.ts` is dead code | Medium | `agents/context/` |
| 2 | Frontend AGENTS object is hardcoded | Medium | `Boardroom.tsx:7-13` |
| 3 | No S3 export (only import) | High | Missing service |
| 4 | No post-verification auto-push | High | Missing trigger |
| 5 | Debate mode is single round | Low | `ai-agents.ts` |
| 6 | `IMG_V` cache-buster is manual | Low | `Boardroom.tsx:15` |
| 7 | Server patches applied inline (now synced) | Resolved | `ai-agents.ts` |

---

## FINAL NOTES FOR THE NEXT AGENT

1. **Read `.agent/creds.md` first** — it has all the passwords and API keys you'll need.
2. **Keep writes small** — the user's tool calls time out with large file writes. 100-150 lines max per write.
3. **Don't use `sed` for multi-line edits over SSH** — escape hell. Use the `scp a Python script` approach instead: write a `.py` file locally, `scp` it to the server, run it with `python3`.
4. **Always validate before deploying** — `npm run build` must succeed with zero errors before `pm2 restart`.
5. **The user WILL audit your code** — every hardcoded value, every TODO, every stub will be found and called out.
6. **Match his ambition** — this is meant to be a $40M platform. Write code like it.

---

*Handover created: 2026-03-29T22:45+05:30*  
*Session duration: ~6 hours*  
*Lines of code written: ~1,500+*  
*Files created: 10 new, 4 modified*
