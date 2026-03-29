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
 * 5. Behavioral guardrails (dynamically from DB capabilities)
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

  // 5. Behavioral guardrails (dynamic — from DB capabilities, not hardcoded slugs)
  sections.push(await buildGuardrails(options.agentSlug));

  return sections.join('\n\n');
}

/**
 * Agent-specific behavioral guardrails.
 * Common rules are always applied.
 * Agent-specific rules are pulled from the agent's `capabilities` array in the DB.
 */
async function buildGuardrails(agentSlug: string): Promise<string> {
  const common = [
    '## Operating Guidelines',
    '- Always reference actual data from your tools — never fabricate numbers.',
    '- When presenting data, use markdown tables for structured output.',
    '- For code blocks, specify the language (sql, json, etc.).',
    '- If you need data you do not have, use your tools to fetch it.',
    '- Be concise but thorough. Executives read your reports.',
  ];

  // Fetch agent capabilities from DB to generate dynamic guardrails
  try {
    const { data: agent } = await supabaseAdmin
      .from('ai_agents')
      .select('capabilities')
      .eq('slug', agentSlug)
      .single();

    if (agent?.capabilities && Array.isArray(agent.capabilities)) {
      common.push(`- Your capabilities: ${agent.capabilities.join(', ')}.`);
      common.push('- Only operate within your defined capabilities. Defer to other agents for domains outside your scope.');
    }
  } catch {
    // Non-fatal — proceed with common rules only
  }

  return common.join('\n');
}

/**
 * Fetch KB entries for an agent from Supabase
 */
export async function fetchKBEntries(agentId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('ai_agent_knowledge')
    .select('title, content')
    .eq('agent_id', agentId)
    .eq('enabled', true)
    .order('priority', { ascending: false });

  if (!data || data.length === 0) return [];

  return data.map(e => `### ${e.title}\n${e.content}`);
}
