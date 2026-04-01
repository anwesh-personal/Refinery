-- KB Seed: Cipher (data_scientist)
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'ClickHouse SQL Reference',
'ClickHouse is NOT MySQL/Postgres. Key differences:
- Use count() not COUNT(*). Use uniqExact() for distinct counts.
- String functions: lower(), upper(), trimBoth(), splitByChar().
- Date: today(), toDate(), toStartOfMonth(), dateDiff(''day'', d1, d2).
- Arrays: arrayJoin(), groupArray(), has().
- Conditional: countIf(condition), sumIf(col, condition), avgIf().
- No UPDATE/DELETE — data is append-only. Use INSERT SELECT for transforms.
- LIMIT is required for safety. Always add LIMIT unless aggregating.
- Use FORMAT JSON for structured output from CLI.
- LIKE is case-sensitive. Use lower(col) LIKE lower(pattern) for case-insensitive.
- NULL handling: isNull(), isNotNull(), coalesce(), ifNull().
- Window functions: ROW_NUMBER() OVER (PARTITION BY x ORDER BY y).
- Sampling: SELECT ... FROM table SAMPLE 0.1 for 10% random sample.',
'reference', 100, true),

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'Universal Person Table Schema',
'The universal_person table is the core data store. Key columns:
- email (String) — primary identifier, always lowercase
- first_name, last_name (String) — contact name
- company (String) — organization name
- job_title (String) — role/position
- industry (String) — sector classification
- city, state, country (String) — location
- phone (String) — contact phone
- linkedin_url (String) — LinkedIn profile
- website (String) — company website
- domain (String) — extracted email domain
- source_file (String) — which ingestion file this came from
- created_at (DateTime) — when the record was ingested
- seniority_level (String) — C-Level, VP, Director, Manager, etc.
- department (String) — Sales, Marketing, Engineering, etc.
- employee_count (String) — company size range
- revenue_range (String) — estimated company revenue
- verification_status (String) — valid/invalid/unknown/risky
- verification_date (DateTime) — when last verified

CRITICAL: Always filter by source_file when analyzing specific ingestion jobs.
Use uniqExact(email) for true unique counts — count() includes duplicates.',
'reference', 99, true),

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'Data Quality Analysis Patterns',
'When asked about data quality, run these checks:
1. COMPLETENESS: For each column, calculate fill rate:
   SELECT count() as total, countIf(email != '''') as has_email, countIf(company != '''') as has_company ... FROM table
2. DUPLICATES: Check email uniqueness:
   SELECT count() as total, uniqExact(email) as unique_emails, count() - uniqExact(email) as duplicates
3. FORMAT VALIDITY: Email format check:
   SELECT countIf(NOT match(email, ''^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'')) as invalid_format
4. DOMAIN DISTRIBUTION: Top domains:
   SELECT domain, count() as cnt FROM table GROUP BY domain ORDER BY cnt DESC LIMIT 20
5. FRESHNESS: Age distribution:
   SELECT toStartOfMonth(created_at) as month, count() as cnt GROUP BY month ORDER BY month
6. GEOGRAPHIC SPREAD:
   SELECT country, count() as cnt GROUP BY country ORDER BY cnt DESC LIMIT 15

Always present results with context: "85% fill rate is good for company field" vs just numbers.',
'instructions', 95, true),

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'Merge and Dedup Strategy Guide',
'When merging or deduplicating lists:

STRATEGIES (merge_lists tool):
- prefer_filled: Keeps the record with most non-null fields. Best default.
- prefer_newest: Keeps most recently ingested record. Good when data updates over time.
- prefer_a / prefer_b: Explicit preference. Use when one source is more trusted.

WORKFLOW:
1. ALWAYS preview first (preview=true) — show user overlap stats before executing.
2. Explain the numbers: "List A has 50K rows, List B has 30K, with 8K overlapping emails."
3. Recommend a strategy based on context.
4. Only execute after user confirms.

DEDUP CHECKLIST:
- find_duplicates tool first to assess scale
- Check if duplicates are exact (same email) or fuzzy (similar names)
- For fuzzy: use compare_lists with different match columns (email, company+last_name)
- After merge: verify count matches expectation',
'instructions', 90, true),

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'Segment Creation Best Practices',
'When creating segments:
- Always validate filters against actual data before creating
- Run a COUNT query first to show the user how many records match
- Common segment patterns:
  * By industry: WHERE industry LIKE ''%technology%''
  * By seniority: WHERE seniority_level IN (''C-Level'', ''VP'', ''Director'')
  * By geography: WHERE country = ''United States'' AND state = ''California''
  * By company size: WHERE employee_count IN (''51-200'', ''201-500'')
  * Verified only: WHERE verification_status = ''valid''
  * Combined ICP: multiple conditions with AND
- Name segments descriptively: "US Tech Directors 200+ employees"
- Always tell the user the resulting count before finalizing',
'instructions', 85, true);
