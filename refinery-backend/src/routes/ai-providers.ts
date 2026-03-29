import { Router } from 'express';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import { getRequestUser } from '../types/auth.js';

const router = Router();
router.use(requireAuth);
router.use(requireSuperadmin);

// ═══════════════════════════════════════════════════════════
// AI Provider Management — Supabase-backed, multi-key per type
//
// Each saved key = one provider instance (row in ai_providers).
// Models are fetched dynamically and cached in the row.
// Services reference provider_id + model_id independently.
// ═══════════════════════════════════════════════════════════

const VALID_TYPES = ['anthropic', 'gemini', 'openai', 'mistral', 'private_vps', 'ollama'] as const;

// ─── GET /api/ai/providers — List all provider instances ───

router.get('/providers', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_providers')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Mask API keys
    const providers = (data || []).map(p => ({
      ...p,
      api_key_masked: p.api_key
        ? `${p.api_key.slice(0, 8)}${'•'.repeat(Math.max(0, (p.api_key?.length || 0) - 12))}${p.api_key.slice(-4)}`
        : '',
      api_key_set: !!(p.api_key && p.api_key.length > 0),
      api_key: undefined, // never send raw key to frontend
    }));

    res.json({ providers });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/ai/providers — Create a new provider instance ───

router.post('/providers', async (req, res) => {
  try {
    const { provider_type, label, api_key, endpoint } = req.body;
    if (!provider_type || !VALID_TYPES.includes(provider_type)) {
      return res.status(400).json({ error: `Invalid provider_type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!label?.trim()) return res.status(400).json({ error: 'Label is required' });

    const user = getRequestUser(req);

    // Get next priority value
    const { data: maxRows } = await supabaseAdmin
      .from('ai_providers')
      .select('priority')
      .order('priority', { ascending: false })
      .limit(1);
    const nextPriority = (maxRows?.[0]?.priority ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('ai_providers')
      .insert({
        provider_type,
        label: label.trim(),
        api_key: api_key || '',
        endpoint: endpoint || '',
        priority: nextPriority,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[AI] ${user.name} created provider "${label}" (${provider_type})`);
    res.json({ provider: { ...data, api_key: undefined, api_key_set: !!(data.api_key), api_key_masked: data.api_key ? `${data.api_key.slice(0, 8)}••••${data.api_key.slice(-4)}` : '' } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/ai/providers/:id — Update a provider instance ───

router.put('/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { label, api_key, endpoint, enabled, selected_model, priority } = req.body;

    const updates: Record<string, any> = {};
    if (label !== undefined) updates.label = label.trim();
    if (api_key !== undefined) updates.api_key = api_key;
    if (endpoint !== undefined) updates.endpoint = endpoint;
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (selected_model !== undefined) updates.selected_model = selected_model;
    if (typeof priority === 'number') updates.priority = priority;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('ai_providers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    const user = getRequestUser(req);
    console.log(`[AI] ${user.name} updated provider "${data.label}" (${data.provider_type})`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/ai/providers/:id — Delete a provider instance ───

router.delete('/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = getRequestUser(req);

    // Get provider info before deletion for logging
    const { data: prov } = await supabaseAdmin.from('ai_providers').select('label, provider_type').eq('id', id).single();

    const { error } = await supabaseAdmin.from('ai_providers').delete().eq('id', id);
    if (error) throw error;

    console.log(`[AI] ${user.name} deleted provider "${prov?.label}" (${prov?.provider_type})`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/ai/priority — Bulk update priority order ───

router.put('/priority', async (req, res) => {
  try {
    const { order } = req.body; // Array of { id, priority }
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array of {id, priority}' });

    for (const item of order) {
      await supabaseAdmin.from('ai_providers').update({ priority: item.priority }).eq('id', item.id);
    }

    const user = getRequestUser(req);
    console.log(`[AI] ${user.name} updated priority order (${order.length} providers)`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/ai/providers/:id/validate — Validate API key against provider ───

router.post('/providers/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;

    // Read full config from DB (need actual api_key)
    const { data: prov, error: pErr } = await supabaseAdmin.from('ai_providers').select('*').eq('id', id).single();
    if (pErr || !prov) return res.status(404).json({ error: 'Provider not found' });

    const result = await validateProvider(prov.provider_type, prov.api_key || '', prov.endpoint || '');

    // Update validation status
    await supabaseAdmin.from('ai_providers').update({
      validated: result.valid,
      last_validated_at: new Date().toISOString(),
    }).eq('id', id);

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message, valid: false });
  }
});

// ─── POST /api/ai/providers/:id/fetch-models — Fetch & cache models ───

router.post('/providers/:id/fetch-models', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: prov, error: pErr } = await supabaseAdmin.from('ai_providers').select('*').eq('id', id).single();
    if (pErr || !prov) return res.status(404).json({ error: 'Provider not found' });

    const models = await fetchModels(prov.provider_type, prov.api_key || '', prov.endpoint || '');

    // Cache models in the provider row
    await supabaseAdmin.from('ai_providers').update({
      cached_models: models,
      models_fetched_at: new Date().toISOString(),
    }).eq('id', id);

    res.json({ models });
  } catch (e: any) {
    res.status(500).json({ error: e.message, models: [] });
  }
});

// ─── POST /api/ai/providers/:id/test — Send test prompt ───

router.post('/providers/:id/test', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: prov, error: pErr } = await supabaseAdmin.from('ai_providers').select('*').eq('id', id).single();
    if (pErr || !prov) return res.status(404).json({ error: 'Provider not found' });
    if (!prov.selected_model) return res.status(400).json({ error: 'No model selected' });

    const result = await sendTestPrompt(prov.provider_type, prov.api_key || '', prov.endpoint || '', prov.selected_model);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/ai/services — List all service configs ───

router.get('/services', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_service_config')
      .select('*, provider:provider_id(id, label, provider_type, selected_model), fallback:fallback_provider_id(id, label, provider_type, selected_model)')
      .order('service_name');

    if (error) throw error;
    res.json({ services: data || [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/ai/services/:slug — Assign provider+model to a service ───

router.put('/services/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { provider_id, model_id, fallback_provider_id, fallback_model_id } = req.body;

    const updates: Record<string, any> = {};
    if (provider_id !== undefined) updates.provider_id = provider_id || null;
    if (model_id !== undefined) updates.model_id = model_id || '';
    if (fallback_provider_id !== undefined) updates.fallback_provider_id = fallback_provider_id || null;
    if (fallback_model_id !== undefined) updates.fallback_model_id = fallback_model_id || '';

    const { error } = await supabaseAdmin
      .from('ai_service_config')
      .update(updates)
      .eq('service_slug', slug);

    if (error) throw error;

    const user = getRequestUser(req);
    console.log(`[AI] ${user.name} assigned provider to service "${slug}"`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// Provider-specific validation & model fetching — ALL DYNAMIC
// ═══════════════════════════════════════════════════════════

async function validateProvider(type: string, key: string, endpoint: string): Promise<{ valid: boolean; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    switch (type) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: controller.signal,
        });
        if (r.status === 401) return { valid: false, message: 'Invalid API key' };
        if (r.status === 403) return { valid: false, message: 'API key lacks permissions' };
        return { valid: r.ok, message: r.ok ? 'Key validated ✓' : `Error: ${r.status}` };
      }
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (r.status === 401) return { valid: false, message: 'Invalid API key' };
        return { valid: r.ok, message: r.ok ? 'Key validated ✓' : `Error: ${r.status}` };
      }
      case 'gemini': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
          signal: controller.signal,
        });
        if (r.status === 400 || r.status === 403) return { valid: false, message: 'Invalid API key' };
        return { valid: r.ok, message: r.ok ? 'Key validated ✓' : `Error: ${r.status}` };
      }
      case 'mistral': {
        const r = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (r.status === 401) return { valid: false, message: 'Invalid API key' };
        return { valid: r.ok, message: r.ok ? 'Key validated ✓' : `Error: ${r.status}` };
      }
      case 'private_vps': {
        if (!endpoint) return { valid: false, message: 'Endpoint URL is required' };
        const r = await fetch(`${endpoint.replace(/\/$/, '')}/v1/models`, { signal: controller.signal });
        return { valid: r.ok, message: r.ok ? 'VPS node reachable ✓' : `Unreachable: ${r.status}` };
      }
      case 'ollama': {
        const ep = endpoint || 'http://localhost:11434';
        const r = await fetch(`${ep.replace(/\/$/, '')}/api/tags`, { signal: controller.signal });
        return { valid: r.ok, message: r.ok ? 'Ollama reachable ✓' : `Unreachable: ${r.status}` };
      }
      default:
        return { valid: false, message: 'Unknown provider type' };
    }
  } catch (err: any) {
    return { valid: false, message: err.name === 'AbortError' ? 'Connection timed out (15s)' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchModels(type: string, key: string, endpoint: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    switch (type) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.data || []).map((m: any) => m.id).filter((id: string) => id.includes('claude')).sort().reverse();
      }
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.data || []).map((m: any) => m.id).filter((id: string) => id.startsWith('gpt-') || id.startsWith('o') || id.startsWith('chatgpt')).sort();
      }
      case 'gemini': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.models || []).map((m: any) => m.name?.replace('models/', '')).filter((id: string) => id && (id.includes('gemini') || id.includes('flash'))).sort();
      }
      case 'mistral': {
        const r = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.data || []).map((m: any) => m.id).sort();
      }
      case 'private_vps': {
        if (!endpoint) return [];
        const r = await fetch(`${endpoint.replace(/\/$/, '')}/v1/models`, { signal: controller.signal });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.data || []).map((m: any) => m.id).sort();
      }
      case 'ollama': {
        const ep = endpoint || 'http://localhost:11434';
        const r = await fetch(`${ep.replace(/\/$/, '')}/api/tags`, { signal: controller.signal });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.models || []).map((m: any) => m.name).sort();
      }
      default:
        return [];
    }
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTestPrompt(type: string, key: string, endpoint: string, model: string): Promise<{ success: boolean; response?: string; error?: string; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const prompt = 'Respond with exactly: "AI connection verified. Ready for deployment." Nothing else.';

  try {
    switch (type) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 50, messages: [{ role: 'user', content: prompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        if (!r.ok) return { success: false, error: data.error?.message || `HTTP ${r.status}`, latencyMs: Date.now() - start };
        return { success: true, response: data.content?.[0]?.text || '', latencyMs: Date.now() - start };
      }
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 50, messages: [{ role: 'user', content: prompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        if (!r.ok) return { success: false, error: data.error?.message || `HTTP ${r.status}`, latencyMs: Date.now() - start };
        return { success: true, response: data.choices?.[0]?.message?.content || '', latencyMs: Date.now() - start };
      }
      case 'gemini': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 50 } }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        if (!r.ok) return { success: false, error: data.error?.message || `HTTP ${r.status}`, latencyMs: Date.now() - start };
        return { success: true, response: data.candidates?.[0]?.content?.parts?.[0]?.text || '', latencyMs: Date.now() - start };
      }
      case 'mistral': {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 50, messages: [{ role: 'user', content: prompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        if (!r.ok) return { success: false, error: data.error?.message || `HTTP ${r.status}`, latencyMs: Date.now() - start };
        return { success: true, response: data.choices?.[0]?.message?.content || '', latencyMs: Date.now() - start };
      }
      case 'private_vps': {
        const r = await fetch(`${endpoint.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 50, messages: [{ role: 'user', content: prompt }] }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        if (!r.ok) return { success: false, error: data.error?.message || `HTTP ${r.status}`, latencyMs: Date.now() - start };
        return { success: true, response: data.choices?.[0]?.message?.content || '', latencyMs: Date.now() - start };
      }
      case 'ollama': {
        const ep = endpoint || 'http://localhost:11434';
        const r = await fetch(`${ep.replace(/\/$/, '')}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, stream: false }),
          signal: controller.signal,
        });
        const data: any = await r.json();
        if (!r.ok) return { success: false, error: data.error || `HTTP ${r.status}`, latencyMs: Date.now() - start };
        return { success: true, response: data.response || '', latencyMs: Date.now() - start };
      }
      default:
        return { success: false, error: 'Unknown provider type', latencyMs: Date.now() - start };
    }
  } catch (err: any) {
    return { success: false, error: err.name === 'AbortError' ? 'Timed out (30s)' : err.message, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

export default router;
