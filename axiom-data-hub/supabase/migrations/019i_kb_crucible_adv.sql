-- KB Supplement: Crucible (supervisor) — troubleshooting and compliance
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'Platform Troubleshooting Runbook',
'Common issues and how to diagnose them:

INGESTION FAILURES:
- "Socket hang up" → File too large or binary corruption. Check file format.
- "Column mismatch" → Source columns don''t match mapping. Review column mapping.
- "Timeout" → File >500MB. Split into smaller chunks.
- Rolled back jobs → Check ingestion logs. Clear via admin panel.
Action: Check file format (CSV/TSV/Parquet), verify column mapping, retry.

VERIFICATION STALLS:
- Progress stuck at same % → Worker may have crashed. Check pm2 status.
- High timeout rate → DNS or network issues on verification server.
- Slow processing → Too many concurrent SMTP connections. Reduce parallelism.
Action: Check worker logs, restart pm2 process, verify network.

AGENT NOT RESPONDING:
- "Provider error" → AI provider API key expired or rate limited.
- Slow responses → Check token usage, provider latency in AI usage logs.
- Wrong answers → Check KB entries, guardrails, system prompt.
Action: Check ai_providers table, verify API key, check usage quotas.

CLICKHOUSE DOWN:
- Queries failing → Check CH service status.
- Slow queries → Check system.query_log for heavy queries.
Action: SSH to server, check clickhouse-server status, check disk space.

DATABASE (SUPABASE):
- Auth errors → Check JWT expiry, Supabase status.
- RLS blocking → Check policies for the affected table.
Action: Check Supabase dashboard, verify RLS policies.',
'reference', 92, true),

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'Compliance and Legal Requirements',
'Email marketing legal requirements that affect platform operations:

CAN-SPAM (United States):
- Must include physical mailing address in every email
- Must include clear unsubscribe mechanism
- Must honor unsubscribe within 10 business days
- "From" must accurately identify the sender
- Subject line must not be deceptive
- Penalty: up to $50,000 per violation

GDPR (European Union):
- Requires explicit consent for marketing emails
- Right to erasure: must delete data on request
- Data portability: must export data on request
- Legitimate interest basis requires balancing test
- Must have Data Processing Agreement (DPA) with sub-processors
- Penalty: up to 4% of annual revenue or €20M

CASL (Canada):
- Strictest anti-spam law globally
- Requires express consent (implied consent expires after 2 years)
- Must include sender identity, contact info, unsubscribe
- Penalty: up to $10M per violation

PLATFORM IMPLICATIONS:
- All verified lists should track consent source
- Unsubscribe handling must be automated and immediate
- Data retention policies should be configurable
- PII handling: agents must never expose full email lists in responses
- Our guardrails enforce PII redaction — never disable safety rules',
'reference', 88, true),

((SELECT id FROM ai_agents WHERE slug = 'supervisor'),
'Capacity Planning and Scaling',
'Platform capacity guidelines:

CLICKHOUSE:
- Current: single-node, can handle 50M+ rows efficiently
- Warning threshold: >100M rows → consider partitioning
- Query performance: sub-second for most aggregations up to 50M rows
- Storage: ~1GB per 5M rows (compressed)

VERIFICATION ENGINE:
- Throughput: ~1000 emails/minute per worker
- Concurrent jobs: max 3 recommended (to avoid IP rotation issues)
- Daily capacity: ~150K verifications per worker
- With multiple workers: scale linearly

MTA SATELLITES (50 total):
- Per satellite: 10-50K emails/day (warm IP)
- Total daily capacity: ~1M emails across constellation
- Warmup bottleneck: new IPs need 30 days to reach full volume
- IP rotation: minimum 5 IPs per campaign for deliverability

SUPABASE:
- Free tier: 500MB storage, 50K auth users
- Pro tier: 8GB storage, unlimited auth
- Monitor: storage usage, connection pool, edge function invocations

WHEN TO SCALE:
- ClickHouse slow → add indexes, optimize table, or shard
- Verification backlog → add worker processes
- Email volume >1M/day → add more satellites
- Auth issues → upgrade Supabase tier',
'instructions', 82, true);
