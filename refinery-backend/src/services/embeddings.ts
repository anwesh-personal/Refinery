// ═══════════════════════════════════════════════════════════
// Embedding Service — generates vector embeddings for KB entries
//
// Reads provider + model from ai_service_config (slug: 'embeddings').
// Zero hardcoded values — everything from the DB.
// ═══════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabaseAdmin.js';

interface EmbeddingConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  providerType: string;
}

interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  tokensUsed?: number;
  error?: string;
}

/**
 * Resolve the embedding provider from ai_service_config → ai_providers.
 * Service slug: 'embeddings'
 * If not configured, tries to find any enabled OpenAI-compatible provider.
 */
async function resolveEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  // Tier 1: Explicit embedding service config
  const { data: svc } = await supabaseAdmin
    .from('ai_service_config')
    .select('provider_id, model_id')
    .eq('service_slug', 'embeddings')
    .single();

  if (svc?.provider_id) {
    const { data: provider } = await supabaseAdmin
      .from('ai_providers')
      .select('api_key, provider_type, endpoint, selected_model')
      .eq('id', svc.provider_id)
      .eq('enabled', true)
      .single();

    if (provider) {
      const endpoint = provider.provider_type === 'openai'
        ? 'https://api.openai.com/v1/embeddings'
        : `${(provider.endpoint || '').replace(/\/$/, '')}/v1/embeddings`;

      return {
        apiKey: provider.api_key,
        endpoint,
        model: svc.model_id || provider.selected_model || 'text-embedding-3-small',
        providerType: provider.provider_type,
      };
    }
  }

  // Tier 2: Fall back to first enabled OpenAI-compatible provider
  const { data: providers } = await supabaseAdmin
    .from('ai_providers')
    .select('api_key, provider_type, endpoint')
    .eq('enabled', true)
    .in('provider_type', ['openai', 'private_vps'])
    .limit(1);

  if (providers?.[0]) {
    const p = providers[0];
    return {
      apiKey: p.api_key,
      endpoint: p.provider_type === 'openai'
        ? 'https://api.openai.com/v1/embeddings'
        : `${(p.endpoint || '').replace(/\/$/, '')}/v1/embeddings`,
      model: 'text-embedding-3-small', // Cheapest OpenAI model as last resort
      providerType: p.provider_type,
    };
  }

  return null;
}

/**
 * Generate an embedding vector for a given text.
 * Provider, model, and API key all resolved from the DB.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text?.trim()) return { success: false, error: 'Empty text' };

  const config = await resolveEmbeddingConfig();
  if (!config) {
    return { success: false, error: 'No embedding provider configured. Add an OpenAI provider in AI Settings, or configure the "embeddings" service.' };
  }

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: text.slice(0, 8000), // Stay within token limits
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: (err as any).error?.message || `HTTP ${response.status}` };
    }

    const data: any = await response.json();
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      return { success: false, error: 'No embedding vector in provider response' };
    }

    return { success: true, embedding, tokensUsed: data.usage?.total_tokens };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Embed a KB entry and store the vector in Supabase.
 * Called after KB entry create/update.
 */
export async function embedKBEntry(entryId: string): Promise<boolean> {
  const { data: entry } = await supabaseAdmin
    .from('ai_agent_knowledge')
    .select('id, title, content')
    .eq('id', entryId)
    .single();

  if (!entry) return false;

  const config = await resolveEmbeddingConfig();
  const text = `${entry.title}\n\n${entry.content}`;
  const result = await generateEmbedding(text);

  if (!result.success || !result.embedding) {
    console.warn(`[Embeddings] Failed to embed KB entry ${entryId}:`, result.error);
    return false;
  }

  const { error } = await supabaseAdmin
    .from('ai_agent_knowledge')
    .update({
      embedding: JSON.stringify(result.embedding),
      embedding_model: config?.model || 'unknown',
      token_count: result.tokensUsed || 0,
      last_embedded_at: new Date().toISOString(),
    })
    .eq('id', entryId);

  if (error) {
    console.warn(`[Embeddings] Failed to store embedding for ${entryId}:`, error.message);
    return false;
  }

  console.log(`[Embeddings] Embedded KB entry "${entry.title}" (${result.tokensUsed} tokens)`);
  return true;
}

/**
 * Generate embedding for a user query (for semantic search).
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  const result = await generateEmbedding(query);
  return result.success ? result.embedding! : null;
}

/**
 * Bulk re-embed all KB entries for an agent (or all if no agentId).
 */
export async function reembedAll(agentId?: string): Promise<{ success: number; failed: number }> {
  let query = supabaseAdmin
    .from('ai_agent_knowledge')
    .select('id')
    .eq('enabled', true);

  if (agentId) query = query.eq('agent_id', agentId);

  const { data: entries } = await query;
  if (!entries?.length) return { success: 0, failed: 0 };

  let success = 0, failed = 0;
  for (const entry of entries) {
    const ok = await embedKBEntry(entry.id);
    if (ok) success++; else failed++;
    await new Promise(r => setTimeout(r, 50)); // Rate limit
  }

  console.log(`[Embeddings] Re-embedded ${success}/${entries.length} entries (${failed} failed)`);
  return { success, failed };
}
