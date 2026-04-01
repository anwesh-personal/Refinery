-- KB Seed: Sentinel (smtp_specialist)
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'SMTP Protocol Deep Reference',
'SMTP verification flow used by our engine:
1. DNS MX Lookup — resolve mail server for domain
2. TCP Connect — port 25 (or 587/465 for submission)
3. EHLO/HELO — announce ourselves
4. MAIL FROM:<probe@ourdomain> — set sender
5. RCPT TO:<target@domain> — test recipient
6. Read response code:
   - 250: Valid mailbox exists
   - 550/551/552/553: Mailbox does not exist (hard bounce)
   - 450/451/452: Temporary failure (greylist, try later)
   - 421: Service not available (rate limited)
   - 503: Bad sequence of commands
7. QUIT — close connection

CATCH-ALL DETECTION: Send RCPT TO a random nonexistent address.
If server returns 250, it accepts everything (catch-all). Our results then mark the domain as catch-all and flag real emails as "uncertain" since we cannot confirm individual mailboxes.

IMPORTANT: A 250 on a catch-all domain does NOT confirm the email exists.',
'reference', 100, true),

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'Email Authentication Stack',
'Three pillars of email authentication:

SPF (Sender Policy Framework):
- TXT record on domain listing authorized sending IPs
- Example: v=spf1 ip4:192.168.1.0/24 include:_spf.google.com -all
- -all = hard fail (reject), ~all = soft fail (mark), ?all = neutral
- Our satellites MUST be in the SPF record of sending domains

DKIM (DomainKeys Identified Mail):
- Cryptographic signature in email headers
- Public key published as DNS TXT record: selector._domainkey.domain
- Signs specific headers (From, Subject, Date, body hash)
- Our MTA generates DKIM signatures per sending domain

DMARC (Domain-based Message Authentication):
- Policy record: _dmarc.domain TXT "v=DMARC1; p=reject; rua=mailto:..."
- p=none (monitor), p=quarantine (spam folder), p=reject (block)
- Requires BOTH SPF and DKIM alignment
- rua = aggregate report destination, ruf = forensic reports

When troubleshooting deliverability, ALWAYS check all three.',
'reference', 95, true),

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'IP Warmup Strategy',
'New IP addresses have NO reputation. ISPs will throttle or block unknown senders.

WARMUP SCHEDULE (per IP):
Day 1-3: 50 emails/day to engaged contacts only
Day 4-7: 100-200/day, mix of engaged + recent
Day 8-14: 500-1000/day, broader audience
Day 15-21: 2000-5000/day
Day 22-30: 5000-10000/day
Day 30+: Full volume (up to 50K/day per IP)

RULES:
- Send to VERIFIED emails only during warmup
- Start with Gmail/Outlook (strictest) to build reputation early
- Monitor bounce rate: >2% means slow down immediately
- Monitor spam complaints: >0.1% is critical
- Use consistent From domain and sending patterns
- Rotate IPs across satellites — never blast from one IP
- Check blacklists daily: Spamhaus, Barracuda, SORBS

With 50 satellites: stagger warmup in waves of 5-10 IPs per week.',
'instructions', 90, true),

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'MTA Satellite Architecture',
'Our email dispatch uses a 50-satellite constellation:
- Each satellite: dedicated VPS with Postfix/PowerMTA
- Each has its own IP (or small IP pool)
- Managed via the MTA Swarm page in Refinery Nexus

KEY METRICS PER SATELLITE:
- Delivery rate: should be >95%
- Bounce rate: should be <3%
- Queue depth: messages waiting to send
- Connection status: online/offline/degraded

TROUBLESHOOTING:
- Satellite offline → check SSH connectivity, Postfix service status
- High bounce rate → check if IP is blacklisted, verify DNS records
- Slow delivery → check queue depth, connection limits to destination ISPs
- Authentication failures → verify DKIM keys, SPF records

LOAD BALANCING: Distribute sends across satellites based on:
1. IP reputation score
2. Current queue depth
3. Warmup stage (newer IPs get less volume)
4. Domain affinity (some ISPs prefer consistent source IPs)',
'reference', 85, true),

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'Bounce Code Reference',
'Common SMTP response codes and what to do:

HARD BOUNCES (remove from list):
- 550 User unknown / Mailbox not found
- 551 User not local
- 552 Mailbox full (if persistent)
- 553 Mailbox name invalid
- 554 Transaction failed

SOFT BOUNCES (retry later):
- 421 Service temporarily unavailable
- 450 Mailbox temporarily unavailable
- 451 Local error in processing
- 452 Insufficient storage

BLOCKS (fix infrastructure):
- 550 with "blocked" or "blacklisted" — IP on blocklist
- 550 with "policy" — content/reputation rejection
- 421 with "rate" — sending too fast, throttle back

GREYLIST (auto-retry):
- 450/451 on first attempt, 250 on retry after 5-15 minutes
- Our engine handles this automatically with retry logic

ACTION RULES:
- 3 consecutive hard bounces → suppress email permanently
- Soft bounce 5+ times over 7 days → treat as hard bounce
- Block responses → pause satellite, investigate IP reputation',
'reference', 88, true);
