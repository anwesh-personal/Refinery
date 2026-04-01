-- KB Seed: Argus (verification_engineer)
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'verification_engineer'),
'Verification Pipeline Architecture',
'Our verification engine (Verify550) performs 9-step pipeline:

1. SYNTAX CHECK: Regex validation of email format
2. TYPO FIX: Detects common misspellings (gmial→gmail, yaho→yahoo)
3. DEDUPLICATION: Removes exact duplicates within the batch
4. DISPOSABLE DETECTION: Checks against 50K+ disposable domain list (guerrillamail, tempmail, etc.)
5. ROLE-BASED CHECK: Flags addresses like info@, admin@, support@ — these have lower engagement
6. FREE PROVIDER CHECK: Identifies gmail, yahoo, outlook, aol, etc.
7. MX LOOKUP: Resolves mail server via DNS — no MX = undeliverable
8. SMTP HANDSHAKE: The actual mailbox probe (EHLO → MAIL FROM → RCPT TO)
9. CATCH-ALL DETECTION: Tests random address to detect accept-all servers

CLASSIFICATIONS:
- safe: Verified mailbox exists, not disposable, not role-based
- risky: Catch-all domain, or role-based, or free provider
- uncertain: Could not definitively confirm (greylisted, timeout)
- invalid: Hard bounce, no MX, syntax fail, disposable

RISK SCORE: 0-100 where 0 = definitely valid, 100 = definitely invalid
Threshold recommendations: safe < 30, risky 30-70, reject > 70',
'reference', 100, true),

((SELECT id FROM ai_agents WHERE slug = 'verification_engineer'),
'Interpreting Verification Results',
'When analyzing verification job results:

HEALTHY LIST BENCHMARKS:
- Safe rate > 85% → excellent quality
- Safe rate 70-85% → acceptable, remove invalids
- Safe rate < 70% → poor quality source, investigate origin
- Invalid rate > 15% → list is stale or poorly sourced
- Catch-all rate > 30% → many domains cannot be definitively verified

KEY METRICS TO REPORT:
1. Overall breakdown: safe / risky / uncertain / invalid percentages
2. Top invalid domains (which domains have most bad emails)
3. Catch-all domains (where verification is inconclusive)
4. Role-based percentage (info@, admin@ etc.)
5. Free vs corporate email ratio
6. Processing speed and any timeout/retry patterns

RECOMMENDATIONS BY SCENARIO:
- High invalid: "This list has X% invalid emails. I recommend removing them before any send."
- High catch-all: "X% of emails are on catch-all domains. These will deliver but engagement is uncertain."
- High role-based: "X% are role-based addresses (info@, sales@). These typically have lower open rates."
- Mixed: Always prioritize by risk score — send to score < 30 first.',
'instructions', 95, true),

((SELECT id FROM ai_agents WHERE slug = 'verification_engineer'),
'Domain Reputation Analysis',
'When asked about domain health or reputation:

SIGNALS TO CHECK:
1. MX Records: Do they exist? Are they Google/Microsoft/custom?
2. SPF Record: Is one published? Is it strict (-all) or loose (~all)?
3. DMARC Record: Does p=reject/quarantine/none?
4. Catch-all: Does the domain accept all emails?
5. SMTP Response Patterns: Consistent 250s? Mixed? Timeouts?

DOMAIN CATEGORIES:
- Corporate (custom MX): Most reliable for B2B outreach
- Google Workspace: Common, well-maintained
- Microsoft 365: Common, strict spam filters
- Free providers (gmail.com, yahoo.com): Consumer addresses, lower B2B value
- Disposable: Never send to these
- Parked/No MX: Domain exists but no email server

When presenting domain analysis, group by domain and show:
- Total emails on that domain
- Verification pass rate per domain
- Whether domain is catch-all
- Domain type (corporate/free/disposable)',
'instructions', 88, true),

((SELECT id FROM ai_agents WHERE slug = 'verification_engineer'),
'Verification Job Management',
'How to work with verification jobs:

STARTING VERIFICATION:
- Max 200,000 emails per job
- Always warn user about expected duration: ~1000 emails/minute
- 50K list ≈ 50 minutes, 200K list ≈ 3-4 hours
- User can check progress via get_verification_status

MONITORING:
- Check processed count vs total
- If progress stalls, timeouts may be occurring (DNS issues, slow servers)
- Normal timeout rate: < 5%
- Concerning timeout rate: > 10% — may indicate network issues

POST-VERIFICATION:
1. Show summary: safe/risky/uncertain/invalid percentages
2. Recommend action: "Remove X invalid, review Y uncertain"
3. Offer to create a segment of only verified-safe emails
4. Suggest re-verifying uncertain emails after 24-48 hours
5. Flag any domains with unusual patterns (all invalid, all catch-all)

NEVER re-verify the same list within 24 hours — wastes resources and may trigger rate limits.',
'instructions', 85, true);
