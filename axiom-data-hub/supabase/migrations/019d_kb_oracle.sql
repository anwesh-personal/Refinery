-- KB Seed: Oracle (seo_strategist)
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'seo_strategist'),
'Audience Intelligence from Lead Data',
'Oracle can cross-reference SEO insights with actual lead data in ClickHouse.

KEY ANALYSIS PATTERNS:
1. INDUSTRY DISTRIBUTION: What industries are in the database?
   → Recommend content topics that match top industries
2. GEOGRAPHIC TARGETING: Where are leads concentrated?
   → Localize SEO strategy (city pages, regional content)
3. JOB TITLE ANALYSIS: What roles do leads hold?
   → Create content addressing their specific pain points
4. COMPANY SIZE MAPPING: SMB vs Enterprise distribution?
   → Adjust messaging and keyword strategy accordingly
5. DOMAIN ANALYSIS: What websites do leads come from?
   → Identify competitor domains for SEO gap analysis

CROSS-REFERENCING:
- Use Cipher''s query_database tool (if available) or ask Cipher to run queries
- Connect SEO keyword opportunities to actual customer profiles
- "Your top industry is SaaS (35% of leads) — prioritize SaaS-related content"',
'instructions', 95, true),

((SELECT id FROM ai_agents WHERE slug = 'seo_strategist'),
'Email Marketing SEO Synergy',
'How SEO and email marketing work together in Refinery Nexus:

CONTENT TO EMAIL PIPELINE:
1. SEO identifies high-intent keywords → content created
2. Content drives organic traffic → captures leads via forms
3. Leads enter Refinery Nexus → verified → segmented
4. Segments receive targeted email campaigns
5. Email engagement signals feed back to content strategy

KEYWORD CATEGORIES FOR EMAIL MARKETERS:
- Awareness: "what is [solution]", "best [category] tools"
- Consideration: "[product] vs [competitor]", "[product] review"
- Decision: "[product] pricing", "[product] demo", "buy [product]"

CONTENT RECOMMENDATIONS:
- Blog posts targeting awareness keywords → top-of-funnel leads
- Comparison pages → mid-funnel, high-intent leads
- Case studies → bottom-funnel, sales-ready leads
- Landing pages → direct conversion, verify and add to segments

Always tie SEO recommendations back to lead generation impact.',
'instructions', 90, true),

((SELECT id FROM ai_agents WHERE slug = 'seo_strategist'),
'Competitive Domain Analysis Framework',
'When analyzing competitor activity:

METRICS TO EVALUATE:
1. Domain Authority: Overall site strength (0-100 scale)
2. Organic Traffic Estimate: Monthly organic visitors
3. Top Ranking Keywords: What terms they rank for
4. Content Gap: Keywords they rank for that we don''t
5. Backlink Profile: Quality and quantity of referring domains

FRAMEWORK:
Step 1: Identify top 5 competitors from lead data domains
Step 2: Analyze their content strategy (blog topics, frequency)
Step 3: Find keyword gaps — opportunities they miss
Step 4: Recommend content to fill those gaps
Step 5: Track progress quarterly

REPORTING FORMAT:
- Always present as actionable recommendations, not just data dumps
- Prioritize by search volume × relevance to our audience
- Include difficulty score (how hard to rank for each keyword)
- Suggest content type: blog, landing page, tool, comparison',
'instructions', 85, true),

((SELECT id FROM ai_agents WHERE slug = 'seo_strategist'),
'Technical SEO Checklist',
'When auditing or advising on technical SEO:

CRITICAL FACTORS:
- Page Speed: < 3 second load time, Core Web Vitals passing
- Mobile Responsive: Must work on all screen sizes
- SSL/HTTPS: Required for ranking and trust
- Sitemap: XML sitemap submitted to Search Console
- Robots.txt: Not blocking important pages
- Canonical Tags: Prevent duplicate content issues
- Schema Markup: Structured data for rich results
- Internal Linking: Topic clusters with pillar pages
- URL Structure: Clean, descriptive, keyword-relevant URLs
- 404 Errors: No broken links or missing pages
- Redirect Chains: Max 1 redirect hop

META TAGS:
- Title: 50-60 characters, primary keyword near start
- Description: 150-160 characters, compelling with CTA
- H1: One per page, includes target keyword
- Alt Text: Descriptive for all images

Always provide specific, actionable fixes — not generic advice.',
'reference', 80, true);
