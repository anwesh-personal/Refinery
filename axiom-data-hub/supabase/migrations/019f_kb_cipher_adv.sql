-- KB Supplement: Cipher (data_scientist) — advanced patterns
INSERT INTO ai_agent_knowledge (agent_id, title, content, category, priority, enabled)
VALUES

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'ClickHouse Performance and Pitfalls',
'Common mistakes and how to avoid them:

NEVER DO:
- SELECT * FROM universal_person — always specify columns and add LIMIT
- Subqueries in WHERE with large result sets — use JOIN instead
- String comparisons without lower() — data may have mixed case
- Assume column exists — use get_table_schema first if unsure

PERFORMANCE TIPS:
- ClickHouse is columnar: selecting fewer columns = faster
- Use IN () instead of multiple OR conditions
- For existence checks: use EXISTS or IN with a subquery, not LEFT JOIN
- count() is extremely fast in ClickHouse (metadata-level)
- Approximate functions are 10x faster: uniq() vs uniqExact(), quantile() vs exact
- PREWHERE is faster than WHERE for filtering before decompression:
  SELECT ... FROM table PREWHERE domain = ''gmail.com'' WHERE city = ''NYC''
- For large aggregations, use GROUP BY with LIMIT to avoid memory issues

JOINS:
- ClickHouse supports JOIN but prefers left table to be smaller
- Syntax: SELECT ... FROM small_table JOIN large_table ON ...
- Use ANY JOIN for dedup: SELECT ... FROM a ANY LEFT JOIN b ON a.email = b.email
- GLOBAL JOIN for distributed queries (our setup is single-node, rarely needed)

COMMON PATTERNS:
- Percentage: round(countIf(condition) / count() * 100, 1) as pct
- Running totals: sum(cnt) OVER (ORDER BY month) as running_total
- Top-N per group: ROW_NUMBER() OVER (PARTITION BY industry ORDER BY count DESC)',
'reference', 92, true),

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'Ingestion Job Analysis',
'When a user asks about an ingestion job or what data came in:

HOW TO FIND INGESTED DATA:
- Each ingestion writes source_file column with the filename
- SELECT DISTINCT source_file, count() as rows, min(created_at), max(created_at)
  FROM universal_person GROUP BY source_file ORDER BY max(created_at) DESC LIMIT 20

POST-INGESTION CHECKLIST:
1. Row count: How many rows were inserted?
2. Column fill: Which columns have data vs empty?
   Profile with: SELECT countIf(col != '''') / count() * 100 as fill_pct for each column
3. Duplicate check: How many duplicate emails in this file?
   SELECT count() - uniqExact(email) as dupes FROM universal_person WHERE source_file = ''filename''
4. Overlap with existing: How many emails already existed before this file?
   SELECT countIf(source_file = ''new_file'') as new_rows,
          countIf(source_file != ''new_file'' AND email IN (SELECT email FROM universal_person WHERE source_file = ''new_file'')) as existing
5. Data preview: Show sample rows
   SELECT email, first_name, last_name, company, job_title FROM ... WHERE source_file = ''x'' LIMIT 10

ALWAYS tell the user both the total rows and unique emails — they are often different.',
'instructions', 88, true),

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'ICP Building and Lead Scoring',
'When users ask to build an Ideal Customer Profile or score leads:

ICP DIMENSIONS:
1. Industry (SaaS, Healthcare, Finance, etc.)
2. Company size (employee_count ranges)
3. Geography (country, state, city)
4. Seniority (C-Level, VP, Director, Manager)
5. Department (Sales, Marketing, Engineering, IT, HR)
6. Revenue range (if available)

SCORING APPROACH:
- Users define their ideal criteria
- Query ClickHouse to count matches per criterion
- Create a composite score: +1 for each matching criterion
- Present as a distribution: "42% of your database matches 3+ criteria"

EXAMPLE QUERIES:
- ICP match rate: 
  SELECT countIf(industry LIKE ''%SaaS%'' AND seniority_level IN (''VP'',''Director'') AND country=''US'') / count() * 100
- ICP segment creation:
  Create segment with combined filters matching ICP criteria
- Score distribution:
  Use CASE WHEN to assign points, then group by score buckets

ALWAYS connect scoring back to action: "Your ICP segment has 12,400 leads. Want me to create a segment and prep them for verification?"',
'instructions', 82, true),

((SELECT id FROM ai_agents WHERE slug = 'data_scientist'),
'Reporting and Visualization Guidance',
'When presenting data analysis results:

FORMAT RULES:
- Use markdown tables for structured data (always)
- Bold the most important numbers
- Include percentages alongside raw counts
- Compare against benchmarks when possible
- Use text-based bar charts for distributions: ██████░░░░ 62%

EXECUTIVE SUMMARY PATTERN:
1. One-line headline: "Your database has 245K unique leads across 14 industries"
2. Key metrics in a table: total, unique, verified, top industry
3. Insights: 2-3 observations that are non-obvious
4. Recommendations: specific next steps

COMPARISON PATTERN (for merge/overlap analysis):
| Metric | List A | List B | Combined |
|--------|--------|--------|----------|
| Total rows | 50,000 | 30,000 | 72,000 |
| Unique emails | 48,500 | 29,200 | 69,700 |
| Overlap | - | - | 8,000 |

TREND PATTERN (for time-series):
Show month-over-month with direction arrows: 
Jan: 12,400 | Feb: 15,600 (+25.8% ↑) | Mar: 14,200 (-9.0% ↓)

Never dump raw query results. Always interpret and explain.',
'instructions', 78, true);
