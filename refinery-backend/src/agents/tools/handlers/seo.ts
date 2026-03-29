// ═══════════════════════════════════════════════════════════
// SEO Tool Handlers — Oracle's toolkit
// Keywords, domains, competitors, cross-referencing
// Uses SEMrush API (key stored in system_config table)
// ═══════════════════════════════════════════════════════════

import type { ToolResult, ToolContext } from '../types.js';
import { clickhouse } from '../../../db/clickhouse.js';
import { getConfig } from '../../../services/config.js';

const SEMRUSH_BASE = 'https://api.semrush.com';

/** Get SEMrush API key from config — throws descriptive error if missing */
async function getSemrushKey(): Promise<string> {
  const key = await getConfig('semrush_api_key');
  if (!key) {
    throw new Error(
      'SEMrush API key not configured. Go to Server Config page and add a key named "semrush_api_key" with your SEMrush API key as the value (mark as secret).'
    );
  }
  return key;
}

/** Call SEMrush API and parse the semicolon-delimited response */
async function semrushRequest(params: Record<string, string>): Promise<Record<string, string>[]> {
  const key = await getSemrushKey();
  const qs = new URLSearchParams({ ...params, key });
  const url = `${SEMRUSH_BASE}/?${qs.toString()}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();

  if (text.startsWith('ERROR')) {
    throw new Error(`SEMrush API error: ${text.trim()}`);
  }

  // SEMrush returns semicolon-delimited data with header row
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(';');
  return lines.slice(1).map(line => {
    const vals = line.split(';');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h.trim()] = vals[i]?.trim() || ''; });
    return obj;
  });
}

// ═══════════════════════════════════════════════════════════
// TOOL: Search Keywords
// ═══════════════════════════════════════════════════════════

export async function searchKeywords(
  args: { keyword: string; limit?: number; database?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.keyword?.trim()) return { success: false, error: 'Keyword is required.' };

  try {
    const results = await semrushRequest({
      type: 'phrase_related',
      phrase: args.keyword.trim(),
      database: args.database || 'us',
      display_limit: String(args.limit || 20),
      export_columns: 'Ph,Nq,Cp,Co,Nr,Td',
    });

    return {
      success: true,
      data: {
        keyword: args.keyword,
        database: args.database || 'us',
        results: results.map(r => ({
          keyword: r.Ph || r.Keyword,
          volume: parseInt(r.Nq || '0'),
          cpc: parseFloat(r.Cp || '0'),
          competition: parseFloat(r.Co || '0'),
          results_count: parseInt(r.Nr || '0'),
          trend: r.Td || '',
        })),
        count: results.length,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// TOOL: Domain Analytics
// ═══════════════════════════════════════════════════════════

export async function getDomainAnalytics(
  args: { domain: string; database?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.domain?.trim()) return { success: false, error: 'Domain is required.' };

  try {
    // Get domain overview
    const overview = await semrushRequest({
      type: 'domain_ranks',
      domain: args.domain.trim(),
      database: args.database || 'us',
      export_columns: 'Db,Dn,Rk,Or,Ot,Oc,Ad,At,Ac',
    });

    // Get top organic keywords
    const keywords = await semrushRequest({
      type: 'domain_organic',
      domain: args.domain.trim(),
      database: args.database || 'us',
      display_limit: '10',
      export_columns: 'Ph,Po,Nq,Cp,Ur,Tr,Tc',
    });

    const ov = overview[0] || {};

    return {
      success: true,
      data: {
        domain: args.domain,
        overview: {
          rank: parseInt(ov.Rk || '0'),
          organic_keywords: parseInt(ov.Or || '0'),
          organic_traffic: parseInt(ov.Ot || '0'),
          organic_cost: parseFloat(ov.Oc || '0'),
          paid_keywords: parseInt(ov.Ad || '0'),
          paid_traffic: parseInt(ov.At || '0'),
          paid_cost: parseFloat(ov.Ac || '0'),
        },
        top_keywords: keywords.map(k => ({
          keyword: k.Ph,
          position: parseInt(k.Po || '0'),
          volume: parseInt(k.Nq || '0'),
          cpc: parseFloat(k.Cp || '0'),
          url: k.Ur || '',
          traffic_percent: parseFloat(k.Tr || '0'),
        })),
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// TOOL: Find Ranking Domains
// ═══════════════════════════════════════════════════════════

export async function findRankingDomains(
  args: { keyword: string; limit?: number; database?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.keyword?.trim()) return { success: false, error: 'Keyword is required.' };

  try {
    const results = await semrushRequest({
      type: 'phrase_organic',
      phrase: args.keyword.trim(),
      database: args.database || 'us',
      display_limit: String(args.limit || 20),
      export_columns: 'Dn,Ur,Po,Nq,Cp,Tr,Tc',
    });

    return {
      success: true,
      data: {
        keyword: args.keyword,
        ranking_domains: results.map(r => ({
          domain: r.Dn,
          url: r.Ur,
          position: parseInt(r.Po || '0'),
          volume: parseInt(r.Nq || '0'),
          cpc: parseFloat(r.Cp || '0'),
          traffic_percent: parseFloat(r.Tr || '0'),
        })),
        count: results.length,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// TOOL: Cross-Reference Domains (ClickHouse — always works)
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// TOOL: Competitor Keywords
// ═══════════════════════════════════════════════════════════

export async function getCompetitorKeywords(
  args: { domain: string; competitor_domain?: string; database?: string },
  _ctx: ToolContext
): Promise<ToolResult> {
  if (!args.domain?.trim()) return { success: false, error: 'Domain is required.' };

  try {
    if (args.competitor_domain) {
      // Domain vs domain comparison
      const results = await semrushRequest({
        type: 'domain_domains',
        domains: `${args.domain}|or|${args.competitor_domain}|or`,
        database: args.database || 'us',
        display_limit: '20',
        export_columns: 'Ph,P0,P1,Nq,Cp,Co',
      });

      return {
        success: true,
        data: {
          domain: args.domain,
          competitor: args.competitor_domain,
          shared_keywords: results.map(r => ({
            keyword: r.Ph,
            your_position: parseInt(r.P0 || '0'),
            competitor_position: parseInt(r.P1 || '0'),
            volume: parseInt(r.Nq || '0'),
            cpc: parseFloat(r.Cp || '0'),
          })),
          count: results.length,
        },
      };
    } else {
      // Find competitors organically
      const results = await semrushRequest({
        type: 'domain_organic_organic',
        domain: args.domain.trim(),
        database: args.database || 'us',
        display_limit: '10',
        export_columns: 'Dn,Cr,Np,Or,Ot,Oc',
      });

      return {
        success: true,
        data: {
          domain: args.domain,
          organic_competitors: results.map(r => ({
            competitor: r.Dn,
            competition_level: parseFloat(r.Cr || '0'),
            common_keywords: parseInt(r.Np || '0'),
            organic_keywords: parseInt(r.Or || '0'),
            organic_traffic: parseInt(r.Ot || '0'),
          })),
          count: results.length,
        },
      };
    }
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
