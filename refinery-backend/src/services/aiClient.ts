import { supabaseAdmin } from './supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════
// Core AI Client — shared service for all AI features
//
// Usage:
//   const result = await callAI('lead_scoring', systemPrompt, userPrompt);
//   const json   = await callAIJSON('icp_analysis', systemPrompt, userPrompt);
//
// Reads provider+model from ai_service_config for the given service slug.
// Falls through to fallback provider if primary fails.
// ═══════════════════════════════════════════════════════════

export interface AICallResult {
  success: boolean;
  response: string;
  providerType: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
  tokensUsed?: number;
  wasFallback: boolean;
  error?: string;
}

interface ProviderRow {
  id: string;
  provider_type: string;
  label: string;
  api_key: string;
  endpoint: string;
  selected_model: string;
  enabled: boolean;
  validated: boolean;
}

interface ServiceRow {
  service_slug: string;
  service_name: string;
  provider_id: string | null;
  model_id: string;
  fallback_provider_id: string | null;
  fallback_model_id: string;
}

// ─── Main entry point ───

export async function callAI(
  serviceSlug: string,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number; timeout?: number }
): Promise<AICallResult> {
  // 1. Resolve service config
  const { data: svc, error: svcErr } = await supabaseAdmin
    .from('ai_service_config')
    .select('*')
    .eq('service_slug', serviceSlug)
    .single();

  if (svcErr || !svc) {
    return fail(`Service "${serviceSlug}" not configured`, 0);
  }

  const config = svc as ServiceRow;
  if (!config.provider_id) {
    return fail(`No AI provider assigned to service "${serviceSlug}". Go to AI Settings → Service Assignments.`, 0);
  }

  // 2. Try primary provider
  const primary = await resolveProvider(config.provider_id);
  if (primary) {
    const model = config.model_id || primary.selected_model;
    if (model) {
      const result = await executeCall(primary, model, systemPrompt, userPrompt, options);
      if (result.success) return { ...result, wasFallback: false };
      console.warn(`[AI] Primary provider "${primary.label}" failed for ${serviceSlug}: ${result.error}`);
    }
  }

  // 3. Try fallback provider
  if (config.fallback_provider_id) {
    const fallback = await resolveProvider(config.fallback_provider_id);
    if (fallback) {
      const model = config.fallback_model_id || fallback.selected_model;
      if (model) {
        console.log(`[AI] Falling back to "${fallback.label}" for ${serviceSlug}`);
        const result = await executeCall(fallback, model, systemPrompt, userPrompt, options);
        return { ...result, wasFallback: true };
      }
    }
  }

  return fail(`All AI providers failed for service "${serviceSlug}"`, 0);
}

/**
 * Call AI and parse the response as JSON.
 * Automatically adds JSON instruction to the system prompt.
 */
export async function callAIJSON<T = any>(
  serviceSlug: string,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number; timeout?: number }
): Promise<{ data: T | null; raw: AICallResult }> {
  const jsonSystemPrompt = `${systemPrompt}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no explanation — just raw JSON.`;
  const result = await callAI(serviceSlug, jsonSystemPrompt, userPrompt, options);

  if (!result.success) return { data: null, raw: result };

  try {
    // Strip markdown code fences if the model ignores the instruction
    let cleaned = result.response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const data = JSON.parse(cleaned) as T;
    return { data, raw: result };
  } catch {
    return { data: null, raw: { ...result, success: false, error: `Failed to parse AI response as JSON: ${result.response.slice(0, 200)}` } };
  }
}

// ─── Provider resolution ───

async function resolveProvider(providerId: string): Promise<ProviderRow | null> {
  const { data, error } = await supabaseAdmin
    .from('ai_providers')
    .select('id, provider_type, label, api_key, endpoint, selected_model, enabled, validated')
    .eq('id', providerId)
    .single();

  if (error || !data) return null;
  if (!data.enabled) {
    console.warn(`[AI] Provider "${data.label}" is disabled`);
    return null;
  }
  return data as ProviderRow;
}

// ─── Provider-specific API calls ───

async function executeCall(
  provider: ProviderRow,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number; timeout?: number }
): Promise<AICallResult> {
  const start = Date.now();
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.3;
  const timeoutMs = options?.timeout ?? 60_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const base: Omit<AICallResult, 'success' | 'response' | 'error' | 'wasFallback'> = {
    providerType: provider.provider_type,
    providerLabel: provider.label,
    model,
    latencyMs: 0,
  };

  try {
    switch (provider.provider_type) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': provider.api_key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        base.latencyMs = Date.now() - start;
        base.tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
        if (!r.ok) return { ...base, success: false, response: '', error: data.error?.message || `HTTP ${r.status}`, wasFallback: false };
        return { ...base, success: true, response: data.content?.[0]?.text || '', wasFallback: false };
      }

      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${provider.api_key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        base.latencyMs = Date.now() - start;
        base.tokensUsed = data.usage?.total_tokens;
        if (!r.ok) return { ...base, success: false, response: '', error: data.error?.message || `HTTP ${r.status}`, wasFallback: false };
        return { ...base, success: true, response: data.choices?.[0]?.message?.content || '', wasFallback: false };
      }

      case 'gemini': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.api_key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { maxOutputTokens: maxTokens, temperature },
          }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        base.latencyMs = Date.now() - start;
        base.tokensUsed = data.usageMetadata?.totalTokenCount;
        if (!r.ok) return { ...base, success: false, response: '', error: data.error?.message || `HTTP ${r.status}`, wasFallback: false };
        return { ...base, success: true, response: data.candidates?.[0]?.content?.parts?.[0]?.text || '', wasFallback: false };
      }

      case 'mistral': {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${provider.api_key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        base.latencyMs = Date.now() - start;
        base.tokensUsed = data.usage?.total_tokens;
        if (!r.ok) return { ...base, success: false, response: '', error: data.error?.message || `HTTP ${r.status}`, wasFallback: false };
        return { ...base, success: true, response: data.choices?.[0]?.message?.content || '', wasFallback: false };
      }

      case 'private_vps': {
        const ep = provider.endpoint.replace(/\/$/, '');
        const r = await fetch(`${ep}/v1/chat/completions`, {
          method: 'POST',
          headers: { ...(provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        base.latencyMs = Date.now() - start;
        base.tokensUsed = data.usage?.total_tokens;
        if (!r.ok) return { ...base, success: false, response: '', error: data.error?.message || `HTTP ${r.status}`, wasFallback: false };
        return { ...base, success: true, response: data.choices?.[0]?.message?.content || '', wasFallback: false };
      }

      case 'ollama': {
        const ep = (provider.endpoint || 'http://localhost:11434').replace(/\/$/, '');
        const r = await fetch(`${ep}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: `${systemPrompt}\n\n${userPrompt}`, stream: false, options: { temperature, num_predict: maxTokens } }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        base.latencyMs = Date.now() - start;
        if (!r.ok) return { ...base, success: false, response: '', error: data.error || `HTTP ${r.status}`, wasFallback: false };
        return { ...base, success: true, response: data.response || '', wasFallback: false };
      }

      default:
        return { ...base, success: false, response: '', error: `Unknown provider type: ${provider.provider_type}`, wasFallback: false, latencyMs: Date.now() - start };
    }
  } catch (err: any) {
    return {
      ...base, success: false, response: '', wasFallback: false,
      error: err.name === 'AbortError' ? `Timed out after ${timeoutMs / 1000}s` : err.message,
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

function fail(error: string, latencyMs: number): AICallResult {
  return { success: false, response: '', providerType: '', providerLabel: '', model: '', latencyMs, wasFallback: false, error };
}
