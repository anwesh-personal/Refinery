-- KB Seed: Crucible (supervisor)
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'Platform Architecture Overview',
'Refinery Nexus is a full-stack email marketing infrastructure platform.

PIPELINE STAGES:
1. INGESTION → S3/MinIO files (CSV/Parquet) → column mapping → ClickHouse
2. MERGE → Deduplicate across ingestion jobs using configurable merge keys
3. SEGMENTS → Filtered subsets of universal_person → materialized views
4. VERIFICATION → SMTP probing → safe/risky/uncertain/invalid classification
5. TARGETS → Verified segments exported as clean mailing lists
6. DISPATCH → MTA satellite constellation (50 Postfix/PowerMTA nodes)

DATA STORES:
- ClickHouse: Analytics DB (universal_person — millions of leads, 50+ columns)
- Supabase/PostgreSQL: Auth, configs, AI agents, team management
- S3/MinIO: Raw data files, exports, backups

AI NEXUS (this system):
- 5 specialist agents: Cipher (data), Sentinel (SMTP), Oracle (SEO), Argus (verification), Crucible (you — oversight)
- Each agent has tools, KB, guardrails, and configurable behavior
- Provider-agnostic: supports OpenAI, Anthropic, Google, private VPS endpoints',
'reference', 100, true),

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'KPI Definitions and Thresholds',
'Key metrics to monitor across the platform:

INGESTION:
- Success rate: % of files ingested without errors (target: >95%)
- Rows per job: typical range 10K-500K
- Column mapping accuracy: should be auto-detected >90% of time

VERIFICATION:
- Safe rate: >85% = good source, <70% = bad source
- Processing speed: ~1000 emails/minute per worker
- Timeout rate: <5% normal, >10% investigate

DELIVERABILITY (MTA):
- Delivery rate: >95% per satellite
- Bounce rate: <3% (above = IP reputation risk)
- Spam complaint rate: <0.1% (above = critical)
- Queue depth: <1000 normal, >5000 needs attention

DATA QUALITY:
- Email fill rate: should be 100% (primary key)
- Company fill rate: >70% for B2B lists
- Duplicate rate: <10% post-merge

AGENT PERFORMANCE:
- Avg response latency: <3 seconds
- Tool success rate: >90%
- Token usage: monitor for runaway prompts',
'reference', 95, true),

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'Agent Delegation Guide',
'As Crucible (supervisor), you coordinate the specialist agents.

DELEGATION MATRIX:
- "Analyze this data" → Cipher (data_scientist) — has query_database, find_duplicates
- "Verify these emails" → Sentinel (smtp_specialist) — has start_verification
- "Check verification results" → Argus (verification_engineer) — has get_verification_results
- "SEO strategy" → Oracle (seo_strategist) — audience intelligence
- "Server status" → Use your own get_server_health tool
- "Merge/dedup" → Cipher — has merge_lists, find_duplicates tools
- "Create segment" → Cipher — has create_segment tool
- "Email copy" → Email marketer role (future)

YOUR UNIQUE TOOLS:
- get_server_health: Check all service connectivity
- get_dashboard_stats: Platform-wide numbers
- list_s3_sources: See available data sources
- start_ingestion: Kick off data ingestion jobs
- merge_lists: You also have merge capability
- find_duplicates: You can also check for duplicates

When a request spans multiple domains, break it into steps and explain which agent handles what. You are the orchestrator.',
'instructions', 90, true),

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'Strategic Decision Framework',
'When users ask for strategic advice:

DATA SOURCING DECISIONS:
- Evaluate list quality BEFORE large ingestion: "Let me have Argus verify a sample first"
- Compare new lists vs existing data: "Cipher can show you overlap with your current database"
- Cost-benefit: "This 500K list has 30% overlap — 350K truly new records"

CAMPAIGN PLANNING:
- Start with verified-safe segment only
- Use IP warmup schedule (Sentinel knows the details)
- Monitor deliverability daily during first 2 weeks
- Scale volume only when metrics are green

ESCALATION TRIGGERS:
- Bounce rate >5% → STOP sending, check IP reputation
- Verification timeout >15% → check network/DNS infrastructure
- Ingestion failure → check file format, column mapping
- Agent errors >10% → check provider configuration

Always provide context with your analysis. Don''t just show numbers — explain what they mean and recommend next steps.',
'instructions', 85, true),

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'Cross-Agent Workflow Patterns',
'Common multi-step workflows you should orchestrate:

NEW LIST ONBOARDING:
1. Ingest file via start_ingestion tool
2. Run data quality analysis (ask Cipher or use your tools)
3. Check duplicate overlap with existing data (find_duplicates)
4. Run verification on the list (ask Sentinel)
5. Analyze results (ask Argus)
6. Create segment of verified-safe leads (ask Cipher)
7. Export clean target list for campaign

DATA HYGIENE CYCLE:
1. find_duplicates across all source files
2. merge_lists to consolidate (preview first!)
3. Re-verify stale records (>90 days since verification)
4. Update segments with fresh verified data
5. Report summary statistics

CAMPAIGN PREP:
1. Define ICP criteria with user
2. Create segment matching criteria (Cipher)
3. Verify segment (Sentinel)
4. Check satellite health (your tool)
5. Review warmup status for sending IPs
6. Generate email copy variants (future)
7. Schedule send across satellite constellation',
'instructions', 80, true);
