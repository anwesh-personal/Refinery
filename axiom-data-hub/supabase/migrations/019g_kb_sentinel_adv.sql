-- KB Supplement: Sentinel (smtp_specialist) — advanced patterns
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'ISP-Specific Sending Rules',
'Each major ISP has different rules. Violating them = spam folder or block.

GMAIL (google.com, gmail.com, googlemail.com):
- Strictest spam filter. DMARC enforcement is mandatory from Feb 2024.
- Requires valid SPF + DKIM + DMARC alignment
- Throttles new IPs aggressively — max 50-100/day initially
- Monitors engagement: low open rates = future emails go to spam
- List-Unsubscribe header REQUIRED for bulk senders
- One-click unsubscribe required for >5000 emails/day to Gmail

MICROSOFT (outlook.com, hotmail.com, live.com, office365):
- Uses Sender Reputation Data (SRD) — user votes matter
- Smart Network Data Services (SNDS) for monitoring
- Junk filters train on user behavior per-mailbox
- Less aggressive throttling than Gmail but harder to get out of spam

YAHOO/AOL (yahoo.com, aol.com):
- Uses DomainKeys and DMARC strictly
- Complaint Feedback Loop (CFL) — register to receive complaints
- Throttles based on volume + complaint ratio
- p=reject DMARC policy enforced

GENERAL RULES:
- Never send more than 50K/day per IP without established reputation
- Maintain complaint rate <0.1% across ALL providers
- Warm up separately for each major ISP',
'reference', 92, true),

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'Blacklist Detection and Remediation',
'When a satellite IP gets blacklisted:

MAJOR BLACKLISTS TO CHECK:
- Spamhaus (ZEN): Most impactful. SBL (spam), XBL (exploits), PBL (dynamic IPs)
- Barracuda BRBL: Common enterprise filter
- SORBS: Spam and Open Relay Blocking System
- SpamCop: User-reported, auto-expires after 24 hours
- URIBL/SURBL: Domain-based (content URLs in emails)

DETECTION:
- Check via multirbl.valli.org or mxtoolbox.com/blacklists
- Monitor bounce messages: "blocked" or "blacklisted" in 550 responses
- get_server_health tool shows basic IP status

REMEDIATION STEPS:
1. STOP sending from the blacklisted IP immediately
2. Identify the cause: bad list? high bounces? spam complaints?
3. Fix the root cause before requesting delisting
4. Submit delisting request:
   - Spamhaus: https://www.spamhaus.org/lookup/ (manual review)
   - Barracuda: https://www.barracudacentral.org/rbl/removal
   - SpamCop: Auto-expires in 24h if no new reports
5. Resume sending slowly — treat as new warmup
6. Monitor for 7 days after delisting

PREVENTION:
- Only send to verified emails (safe classification)
- Process bounces and complaints in real-time
- Remove hard bounces immediately, never retry them
- If >2% bounce rate on any send: pause and investigate',
'instructions', 88, true),

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'Email Content Deliverability',
'Content factors that affect inbox placement:

SUBJECT LINES — AVOID:
- ALL CAPS: "FREE OFFER NOW!!!"
- Excessive punctuation: "!!!" or "???"
- Spam trigger words: "free", "guaranteed", "act now", "limited time"
- Misleading Re: or Fwd: on first contact
- Empty or overly generic subjects

EMAIL BODY — BEST PRACTICES:
- Text-to-image ratio: at least 60% text, max 40% images
- Always include plain text version (multipart/alternative)
- Use real links — no URL shorteners (they are flagged)
- Include physical address (CAN-SPAM requirement)
- Include unsubscribe link (legal requirement in US, EU, CA)
- Keep HTML clean — no excessive styles, avoid <style> in <body>
- Max email size: 100KB ideally, 250KB max

ENGAGEMENT SIGNALS:
- ISPs track: opens, clicks, replies, moves to inbox, marks as "not spam"
- Low engagement → future emails go to spam for ALL recipients
- Strategy: send to most engaged contacts first, let positive signals build
- Re-engagement: contacts who haven''t opened in 90 days should be suppressed

WARM-UP CONTENT:
- During IP warmup, send to MOST ENGAGED contacts only
- Use personalized content: merge fields increase engagement
- Avoid links in first warmup emails — just text builds trust',
'reference', 84, true),

((SELECT id FROM ai_agents WHERE slug = 'smtp_specialist'),
'DNS Configuration for Sending Domains',
'Required DNS records for email sending infrastructure:

SPF RECORD:
Type: TXT
Name: @ (root domain)
Value: v=spf1 ip4:<satellite_ip> include:_spf.domain.com -all
Rules: Max 10 DNS lookups. Use ip4/ip6 for our IPs, include: for third parties.
Example for 3 satellites:
v=spf1 ip4:192.168.1.10 ip4:192.168.1.11 ip4:192.168.1.12 -all

DKIM RECORD:
Type: TXT
Name: selector._domainkey
Value: v=DKIM1; k=rsa; p=<public_key_base64>
Generate keypair: openssl genrsa -out dkim.key 2048
Each sending domain needs its own DKIM selector
Rotate keys every 6-12 months

DMARC RECORD:
Type: TXT  
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@domain.com; pct=100
Start with p=none (monitor), then p=quarantine, finally p=reject
rua sends aggregate reports — monitor weekly

rDNS (Reverse DNS):
Each satellite IP MUST have valid PTR record
PTR should resolve to a hostname that forward-resolves back to the IP
Example: 10.1.168.192.in-addr.arpa → mail1.domain.com → 192.168.1.10

MX RECORD (for receiving bounces):
Type: MX
Priority: 10
Value: mail.domain.com
Required if MAIL FROM domain needs to receive bounce notifications',
'reference', 80, true);
