-- KB Supplement: Oracle (seo_strategist) — advanced methodology
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'seo_strategist'),
'Search Intent Mapping for Lead Gen',
'Map search intent to lead generation stage:

INFORMATIONAL (Top of Funnel):
- Queries: "what is email verification", "how to clean email list"
- Content: Blog posts, guides, educational content
- Lead value: Low — awareness stage, far from purchase
- Strategy: Capture with content upgrades (checklists, templates)

COMMERCIAL INVESTIGATION (Mid Funnel):
- Queries: "best email verification tools 2024", "NeverBounce vs ZeroBounce"
- Content: Comparison pages, reviews, feature lists
- Lead value: Medium-High — actively evaluating solutions
- Strategy: Feature pages with clear CTAs, free trial offers

TRANSACTIONAL (Bottom of Funnel):
- Queries: "email verification API pricing", "bulk email verifier signup"
- Content: Landing pages, pricing pages, demo booking
- Lead value: Highest — ready to purchase
- Strategy: Landing pages with minimal friction, direct CTA

NAVIGATIONAL:
- Queries: "[brand name] login", "[brand name] support"
- Content: Ensure brand pages rank for brand terms
- Strategy: Defensive SEO — own your brand SERPs

CONNECTING TO REFINERY NEXUS:
- Leads from informational queries → longer nurture sequence
- Leads from commercial queries → prioritize for sales outreach
- Track source URL in CRM → segment by intent level
- Use this framework to tag and score incoming leads',
'reference', 92, true),

((SELECT id FROM ai_agents WHERE slug = 'seo_strategist'),
'Content Strategy for B2B Email Infrastructure',
'Specific content recommendations for our market:

HIGH-VALUE TOPICS:
- "Email deliverability guide" — evergreen, high search volume
- "SMTP verification explained" — technical audience, qualified leads
- "IP warmup schedule template" — highly specific, attracts practitioners
- "CAN-SPAM compliance checklist" — legal concern drives urgency
- "Catch-all email detection" — niche but highly targeted
- "Email list cleaning ROI calculator" — interactive, shareable

CONTENT TYPES RANKED BY LEAD VALUE:
1. Interactive tools (ROI calculators, spam score checkers) — highest
2. Templates and checklists (downloadable) — high
3. Comparison pages (vs competitors) — high
4. How-to guides (detailed, 2000+ words) — medium
5. Industry reports (original data/research) — medium-high
6. Blog posts (shorter, topical) — lower but volume play

CONTENT CALENDAR:
- 2 long-form guides per month (2000+ words, target primary keywords)
- 4 blog posts per month (800-1200 words, target long-tail)
- 1 comparison/vs page per month
- 1 updated/refreshed piece per month (update dates, stats, examples)

PROMOTION:
- Every content piece → email to relevant segment
- Repurpose: blog → LinkedIn post → email snippet → social graphic
- Internal linking: every new post links to 3+ existing posts',
'instructions', 86, true),

((SELECT id FROM ai_agents WHERE slug = 'seo_strategist'),
'Analytics and ROI Measurement',
'How to measure SEO impact and connect it to business results:

KEY METRICS:
- Organic traffic (monthly sessions from search)
- Keyword rankings (position tracking for target terms)
- Organic conversions (signups, demo requests from search)
- Cost per acquisition vs paid channels
- Domain authority / domain rating (DR) trend

ROI CALCULATION:
1. Track organic signups per month
2. Assign value per signup (based on conversion rate to paid)
3. Compare against: content production cost + tool costs
4. Typical SEO ROI: 5-10x over 12 months (compounds over time)

ATTRIBUTION:
- First-touch: which page did they land on from search?
- Multi-touch: did they come back via search before converting?
- Source URL tracking through to Refinery Nexus lead record
- Connect: SEO keyword → landing page → lead → email campaign → conversion

REPORTING FORMAT:
Monthly report should include:
| Metric | This Month | Last Month | Change |
|--------|-----------|-----------|---------|
| Organic Sessions | 45,230 | 41,100 | +10.0% |
| Keyword Top 10 | 127 | 112 | +13.4% |
| Organic Signups | 342 | 298 | +14.8% |
| Cost per Lead | $8.20 | $9.10 | -9.9% |

Always contextualize: "SEO cost per lead is $8.20 vs $35+ for paid search."',
'instructions', 80, true);
