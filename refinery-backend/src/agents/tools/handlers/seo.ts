// ═══════════════════════════════════════════════════════════
// SEO Tool Handlers — Oracle's toolkit
// Keywords, domains, competitors, cross-referencing
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { clickhouse } from '../../../db/clickhouse.js';

/**
 * Search keywords — placeholder until SEMrush API key is configured.
 * For now, returns a structured "not configured" response that Oracle
 * can explain to the user, rather than silently failing.
 */
export async function searchKeywords(
  args: { keyword: string; limit?: number },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.keyword?.trim()) return { success: false, error: 'Keyword is required.' };

  // TODO: Wire to SEMrush API when key is available
  return {
    success: true,
    data: {
      keyword: args.keyword,
      status: 'semrush_not_configured',
      message: 'SEMrush API is not yet configured. Once the API key is added, this tool will return keyword volume, difficulty, CPC, trend data, and related keywords.',
      action_needed: 'Configure SEMrush API key in AI Settings → Integrations',
    },
  };
}

/** Get domain analytics — placeholder until SEMrush API */
export async function getDomainAnalytics(
  args: { domain: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.domain?.trim()) return { success: false, error: 'Domain is required.' };

  return {
    success: true,
    data: {
      domain: args.domain,
      status: 'semrush_not_configured',
      message: 'SEMrush API not yet configured. This tool will return domain authority, organic traffic estimate, top keywords, and backlink profile.',
      action_needed: 'Configure SEMrush API key in AI Settings → Integrations',
    },
  };
}

/** Find domains ranking for keywords — placeholder until SEMrush API */
export async function findRankingDomains(
  args: { keyword: string; limit?: number },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.keyword?.trim()) return { success: false, error: 'Keyword is required.' };

  return {
    success: true,
    data: {
      keyword: args.keyword,
      status: 'semrush_not_configured',
      message: 'SEMrush API not yet configured. This tool will return the top domains ranking for this keyword in Google organic results.',
      action_needed: 'Configure SEMrush API key in AI Settings → Integrations',
    },
  };
}

/**
 * Cross-reference domains — THIS ONE WORKS NOW.
 * Checks if given domains exist in our ClickHouse universal_person table.
 * This is Oracle's killer feature even without SEMrush.
 */
export async function crossReferenceDomains(
  args: { domains: string[] },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.domains?.length) return { success: false, error: 'Provide an array of domains to check.' };

  try {
    const domainList = args.domains.map(d => `'${d.replace(/'/g, "''").toLowerCase()}'`).join(',');
    const query = `
      SELECT
        domain,
        count() as lead_count,
        countIf(verification_status = 'safe') as verified_safe,
        countIf(verification_status = 'risky') as verified_risky,
        uniqExact(company) as unique_companies,
        groupUniqArray(10)(title) as sample_titles
      FROM universal_person
      WHERE lower(domain) IN (${domainList})
      GROUP BY domain
      ORDER BY lead_count DESC
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json();

    const found = (rows as any[]).map(r => r.domain);
    const notFound = args.domains.filter(d => !found.includes(d.toLowerCase()));

    return {
      success: true,
      data: {
        total_checked: args.domains.length,
        found_in_database: found.length,
        not_found: notFound.length,
        matches: rows,
        missing_domains: notFound,
      },
    };
  } catch (e: any) {
    return { success: false, error: `Database query failed: ${e.message}` };
  }
}

/** Get competitor keywords — placeholder until SEMrush API */
export async function getCompetitorKeywords(
  args: { domain: string; competitor_domain?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.domain?.trim()) return { success: false, error: 'Domain is required.' };

  return {
    success: true,
    data: {
      domain: args.domain,
      competitor: args.competitor_domain || null,
      status: 'semrush_not_configured',
      message: 'SEMrush API not yet configured. This tool will return keyword overlap, gaps, and competitive positioning data.',
      action_needed: 'Configure SEMrush API key in AI Settings → Integrations',
    },
  };
}
