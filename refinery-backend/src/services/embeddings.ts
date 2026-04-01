// ═══════════════════════════════════════════════════════════
// Embedding Service — Provider-Agnostic Vector Generation
//
// Supports ALL provider types: gemini, openai, mistral,
// private_vps, ollama, anthropic (via proxy).
//
// Resolution order:
// 1. Explicit ai_service_config (slug: 'embeddings')
// 2. First enabled provider in ai_providers (ANY type)
//
// Each provider type has its own API format for embeddings.
// Zero hardcoded keys — everything from the DB.
// ═══════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabaseAdmin.js';

interface EmbeddingProvider {
  apiKey: string;
  endpoint: string;
  model: string;
  providerType: string;
}

interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  tokensUsed?: number;
  model?: string;
  error?: string;
}

// Default embedding models per provider (used when no explicit model configured)
const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  gemini: 'gemini-embedding-001',
  openai: 'text-embedding-3-small',
  mistral: 'mistral-embed',
  private_vps: 'text-embedding-3-small',
  ollama: 'nomic-embed-text',
  anthropic: 'text-embedding-3-small', // Anthropic has no native embeddings — route through OpenAI-compatible proxy if configured
};

/**
 * Resolve the embedding provider from DB.
 * Tier 1: explicit service config (ai_service_config slug='embeddings')
 * Tier 2: first enabled provider of ANY type
 */
async function resolveProvider(): Promise<EmbeddingProvider | null> {
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
      return {
        apiKey: provider.api_key,
        endpoint: (provider.endpoint || '').replace(/\/$/, ''),
        model: svc.model_id || DEFAULT_EMBEDDING_MODELS[provider.provider_type] || provider.selected_model,
        providerType: provider.provider_type,
      };
    }
  }

  // Tier 2: First enabled provider — ANY type that supports embeddings
  const { data: providers } = await supabaseAdmin
    .from('ai_providers')
    .select('api_key, provider_type, endpoint, selected_model')
    .eq('enabled', true)
    .order('created_at', { ascending: true })
    .limit(1);

  if (providers?.[0]) {
    const p = providers[0];
    return {
      apiKey: p.api_key,
      endpoint: (p.endpoint || '').replace(/\/$/, ''),
      model: DEFAULT_EMBEDDING_MODELS[p.provider_type] || 'text-embedding-3-small',
      providerType: p.provider_type,
    };
  }

  return null;
}

/**
 * Generate an embedding vector for given text.
 * Dispatches to the correct API format based on provider_type.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text?.trim()) return { success: false, error: 'Empty text' };

  const provider = await resolveProvider();
  if (!provider) {
    return { success: false, error: 'No AI provider configured. Add any provider in AI Settings.' };
  }

  const truncated = text.slice(0, 8000);

  try {
    switch (provider.providerType) {

      // ═══ GEMINI ═══
      case 'gemini': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:embedContent?key=${provider.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text: truncated }] },
            outputDimensionality: 1536,
          }),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({}));
          return { success: false, error: err.error?.message || `Gemini HTTP ${res.status}`, model: provider.model };
        }
        const data: any = await res.json();
        const embedding = data.embedding?.values;
        if (!embedding || !Array.isArray(embedding)) {
          return { success: false, error: 'No embedding in Gemini response', model: provider.model };
        }
        return { success: true, embedding, model: provider.model };
      }

      // ═══ OPENAI ═══
      case 'openai': {
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: provider.model, input: truncated }),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({}));
          return { success: false, error: err.error?.message || `OpenAI HTTP ${res.status}`, model: provider.model };
        }
        const data: any = await res.json();
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding)) {
          return { success: false, error: 'No embedding in OpenAI response', model: provider.model };
        }
        return { success: true, embedding, tokensUsed: data.usage?.total_tokens, model: provider.model };
      }

      // ═══ MISTRAL ═══
      case 'mistral': {
        const res = await fetch('https://api.mistral.ai/v1/embeddings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: provider.model, input: [truncated] }),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({}));
          return { success: false, error: err.error?.message || `Mistral HTTP ${res.status}`, model: provider.model };
        }
        const data: any = await res.json();
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding)) {
          return { success: false, error: 'No embedding in Mistral response', model: provider.model };
        }
        return { success: true, embedding, tokensUsed: data.usage?.total_tokens, model: provider.model };
      }

      // ═══ PRIVATE VPS (OpenAI-compatible) ═══
      case 'private_vps': {
        const url = `${provider.endpoint}/v1/embeddings`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: provider.model, input: truncated }),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({}));
          return { success: false, error: err.error?.message || `VPS HTTP ${res.status}`, model: provider.model };
        }
        const data: any = await res.json();
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding)) {
          return { success: false, error: 'No embedding in VPS response', model: provider.model };
        }
        return { success: true, embedding, tokensUsed: data.usage?.total_tokens, model: provider.model };
      }

      // ═══ OLLAMA ═══
      case 'ollama': {
        const url = `${provider.endpoint || 'http://localhost:11434'}/api/embed`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: provider.model, input: truncated }),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({}));
          return { success: false, error: err.error || `Ollama HTTP ${res.status}`, model: provider.model };
        }
        const data: any = await res.json();
        const embedding = data.embeddings?.[0];
        if (!embedding || !Array.isArray(embedding)) {
          return { success: false, error: 'No embedding in Ollama response', model: provider.model };
        }
        return { success: true, embedding, model: provider.model };
      }

      // ═══ ANTHROPIC — no native embedding API ═══
      case 'anthropic': {
        return { success: false, error: 'Anthropic does not offer an embeddings API. Configure a Gemini, OpenAI, or Mistral provider for embeddings.', model: 'none' };
      }

      default:
        return { success: false, error: `Unsupported provider type for embeddings: ${provider.providerType}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message, model: provider.model };
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

  const text = `${entry.title}\n\n${entry.content}`;
  const result = await generateEmbedding(text);

  if (!result.success || !result.embedding) {
    console.warn(`[Embeddings] Failed to embed KB entry ${entryId}:`, result.error);
    return false;
  }

  const { error } = await supabaseAdmin
    .from('ai_agent_knowledge')
    .update({
      embedding: result.embedding,
      embedding_model: result.model || 'unknown',
      token_count: result.tokensUsed || 0,
      last_embedded_at: new Date().toISOString(),
    })
    .eq('id', entryId);

  if (error) {
    console.warn(`[Embeddings] Failed to store embedding for ${entryId}:`, error.message);
    return false;
  }

  console.log(`[Embeddings] ✓ "${entry.title}" (${result.model}, ${result.tokensUsed || '?'} tokens)`);
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
  let q = supabaseAdmin
    .from('ai_agent_knowledge')
    .select('id')
    .eq('enabled', true);

  if (agentId) q = q.eq('agent_id', agentId);

  const { data: entries } = await q;
  if (!entries?.length) return { success: 0, failed: 0 };

  let success = 0, failed = 0;
  for (const entry of entries) {
    const ok = await embedKBEntry(entry.id);
    if (ok) success++; else failed++;
    await new Promise(r => setTimeout(r, 100)); // Rate limit between calls
  }

  console.log(`[Embeddings] Re-embedded ${success}/${entries.length} entries (${failed} failed)`);
  return { success, failed };
}
