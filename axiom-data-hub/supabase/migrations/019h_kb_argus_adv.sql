-- KB Supplement: Argus (verification_engineer) — edge cases and advanced
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'verification_engineer'),
'Verification Edge Cases and Traps',
'Scenarios where verification results need careful interpretation:

CATCH-ALL DOMAINS:
- Domain accepts ALL emails — even fake ones
- Our probe gets 250 for everything, including random@domain.com
- Result: "uncertain" — cannot confirm individual mailbox
- Common in: small businesses, custom Exchange servers
- Action: safe to send but expect some bounces. Target <5% bounce rate.

GREYLISTING:
- Server rejects first attempt (450), accepts on retry after delay
- Our engine auto-retries after 5 minutes
- If timeout occurs before retry: classified as "uncertain"
- Action: re-verify after 24h if many greylisted results

RATE-LIMITING SERVERS:
- Some servers block after N probes from same IP
- Appears as: spike in timeouts mid-job
- Action: smaller batches, longer delays between probes

HONEYPOT/SPAM TRAPS:
- We CANNOT detect spam traps via SMTP — they return 250
- Types: pristine (never used), recycled (abandoned → repurposed)
- Pristine traps: only appear on bought/scraped lists
- Prevention: never buy lists, always verify engagement

TEMPORARY MAILBOX SERVICES:
- Disposable detection catches known providers
- New disposable domains appear daily — list needs updates
- Some corporate temp addresses look legitimate
- Action: flag short-lived domains (<6 months old) as risky',
'reference', 92, true),

((SELECT id FROM ai_agents WHERE slug = 'verification_engineer'),
'Re-Verification Strategy',
'When and how to re-verify existing records:

TIMING RULES:
- Verified <30 days ago: No need to re-verify
- Verified 30-90 days ago: Re-verify before major campaign
- Verified >90 days ago: Must re-verify — emails go stale ~2.5% per month
- Never verified: Verify immediately before any send
- Previously invalid: Don''t re-verify for 6+ months (mailboxes rarely reactivate)

RE-VERIFICATION QUERIES (for Cipher collaboration):
Find stale records:
SELECT count() FROM universal_person
WHERE verification_status = ''valid''
AND verification_date < now() - INTERVAL 90 DAY

Find never-verified:
SELECT count() FROM universal_person
WHERE verification_status = '''' OR verification_status IS NULL

BATCH STRATEGY:
- Re-verify in batches of 50K max
- Prioritize: upcoming campaign targets first
- Compare results: track verify→invalid conversion rate
- If >5% of previously-valid emails are now invalid: list is aging fast

REPORTING:
Always show comparison: "Of 50K previously-valid emails, 47,500 (95%) are still valid, 1,200 (2.4%) are now invalid, 1,300 (2.6%) uncertain."',
'instructions', 86, true),

((SELECT id FROM ai_agents WHERE slug = 'verification_engineer'),
'Source Quality Assessment',
'How to evaluate the quality of a lead source based on verification results:

QUALITY TIERS:
- Tier 1 (Premium): >90% safe rate, <3% invalid, <5% catch-all
- Tier 2 (Good): 80-90% safe, <8% invalid, <15% catch-all  
- Tier 3 (Usable): 70-80% safe, <15% invalid, needs cleaning
- Tier 4 (Poor): <70% safe — investigate source, may be scraped/old
- Tier 5 (Toxic): <50% safe — reject entirely, contains spam traps

RED FLAGS:
- >20% role-based (info@, admin@): likely scraped from websites
- >40% free email providers: not a B2B list
- >30% invalid: stale or fabricated data
- Many emails on same obscure domains: possible fake list
- All from same date range: possible one-time scrape dump

COMPARISON REPORT FORMAT:
| Source | Total | Safe% | Invalid% | CatchAll% | RoleBased% | Verdict |
|--------|-------|-------|----------|-----------|------------|---------|
| vendor_a.csv | 50K | 88% | 5% | 4% | 3% | Tier 1 ✅ |
| scraped_b.csv | 30K | 52% | 28% | 8% | 18% | Tier 5 ❌ |

Always recommend action: keep, clean, or reject each source.',
'instructions', 82, true);
