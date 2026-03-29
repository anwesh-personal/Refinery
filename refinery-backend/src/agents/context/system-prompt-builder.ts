import { getPromptContext } from './schema-registry.js';
import { supabaseAdmin } from '../../services/supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════
// System Prompt Builder — Assembles context-aware system prompts
// ═══════════════════════════════════════════════════════════

interface PromptBuildOptions {
  agentSlug: string;
  agentName: string;
  agentRole: string;
  basePrompt: string;       // The agent's personality/role prompt from DB
  kbEntries?: string[];     // Knowledge base entries
  pageContext?: any;         // Context from the page the user is on
}

/**
 * Builds a complete system prompt by layering:
 * 1. Agent personality (from DB)
 * 2. Live schema context (from Schema Registry)
 * 3. Knowledge base entries
 * 4. Page-level context (if provided)
 */
export async function buildSystemPrompt(options: PromptBuildOptions): Promise<string> {
  const sections: string[] = [];

  // 1. Agent personality
  sections.push(options.basePrompt);

  // 2. Live schema context
  try {
    const schemaCtx = await getPromptContext();
    sections.push(schemaCtx);
  } catch (e: any) {
    console.warn('[PromptBuilder] Schema context failed:', e.message);
  }

  // 3. Knowledge base entries
  if (options.kbEntries && options.kbEntries.length > 0) {
    sections.push('## Knowledge Base\n');
    for (const entry of options.kbEntries) {
      sections.push(entry);
    }
  }

  // 4. Page-level context
  if (options.pageContext) {
    sections.push('## Current Context\n');
    if (typeof options.pageContext === 'string') {
      sections.push(options.pageContext);
    } else {
      sections.push('```json\n' + JSON.stringify(options.pageContext, null, 2) + '\n```');
    }
  }

  // 5. Behavioral guardrails
  sections.push(buildGuardrails(options.agentSlug));

  return sections.join('\n\n');
}

/**
 * Agent-specific behavioral guardrails
 */
function buildGuardrails(agentSlug: string): string {
  const common = [
    '## Operating Guidelines',
    '- Always reference actual data from your tools — never fabricate numbers.',
    '- When presenting data, use markdown tables for structured output.',
    '- For code blocks, specify the language (sql, json, etc.).',
    '- If you need data you do not have, use your tools to fetch it.',
    '- Be concise but thorough. Executives read your reports.',
  ];

  const specific: Record<string, string[]> = {
    data_scientist: [
      '- You have full read access to ClickHouse. Use query_database for any data question.',
      '- Always provide sample data and statistics, not just descriptions.',
      '- When analyzing lists, cover: row count, column breakdown, domain distribution, quality tiers, duplicates.',
    ],
    smtp_specialist: [
      '- Focus on deliverability, DNS health, IP reputation, and bounce analysis.',
      '- When checking domains, look at MX, SPF, DKIM, and DMARC records.',
    ],
    seo_strategist: [
      '- Focus on keyword opportunities, domain rankings, and competitive intelligence.',
      '- Cross-reference SEO data with our lead data when relevant.',
    ],
    verification_engineer: [
      '- Focus on email verification results, quality scoring, and risk assessment.',
      '- Provide actionable recommendations for improving deliverability.',
    ],
    supervisor: [
      '- You oversee all departments. Synthesize information across domains.',
      '- Provide executive-level summaries with clear action items.',
      '- When multiple agents report, identify conflicts and resolve them.',
    ],
  };

  return [...common, ...(specific[agentSlug] || [])].join('\n');
}

/**
 * Fetch KB entries for an agent from Supabase
 */
export async function fetchKBEntries(agentId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('ai_agent_kb')
    .select('title, content')
    .eq('agent_id', agentId)
    .eq('enabled', true)
    .order('priority', { ascending: false });

  if (!data || data.length === 0) return [];

  return data.map(e => `### ${e.title}\n${e.content}`);
}
