import { Router } from 'express';
import { requireSuperadmin } from '../middleware/auth.js';
import * as configService from '../services/config.js';
import { getRequestUser } from '../types/auth.js';

const router = Router();
router.use(requireSuperadmin);

// ═══════════════════════════════════════════════════════════
// AI Provider Management — Store keys, validate, fetch models
//
// Providers stored in system_config with prefix 'ai.provider.'
// Format: ai.provider.{slug} → JSON string of ProviderConfig
// Priority order: ai.priority → JSON array of slug strings
// ═══════════════════════════════════════════════════════════

interface ProviderConfig {
  slug: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  endpoint?: string;      // For Private VPS / Ollama
  selectedModel: string;
  validated: boolean;
  lastValidated?: string;
}

const PROVIDER_DEFS = [
  { slug: 'anthropic',  name: 'Anthropic (Claude)',    requiresKey: true,  requiresEndpoint: false, defaultEndpoint: 'https://api.anthropic.com' },
  { slug: 'gemini',     name: 'Google Gemini',         requiresKey: true,  requiresEndpoint: false, defaultEndpoint: 'https://generativelanguage.googleapis.com' },
  { slug: 'openai',     name: 'OpenAI (ChatGPT)',      requiresKey: true,  requiresEndpoint: false, defaultEndpoint: 'https://api.openai.com' },
  { slug: 'mistral',    name: 'Mistral AI',            requiresKey: true,  requiresEndpoint: false, defaultEndpoint: 'https://api.mistral.ai' },
  { slug: 'private_vps',name: 'Private VPS Node',      requiresKey: false, requiresEndpoint: true,  defaultEndpoint: '' },
  { slug: 'ollama',     name: 'Local LLM (Ollama)',    requiresKey: false, requiresEndpoint: true,  defaultEndpoint: 'http://localhost:11434' },
];

const CONFIG_PREFIX = 'ai.provider.';
const PRIORITY_KEY = 'ai.priority';

// ─── GET /api/ai/providers — List all providers with their config ───

router.get('/providers', async (_req, res) => {
  try {
    const providers = [];
    for (const def of PROVIDER_DEFS) {
      const raw = await configService.getConfig(`${CONFIG_PREFIX}${def.slug}`);
      if (raw) {
        try {
          const config = JSON.parse(raw) as ProviderConfig;
          // Mask API key in response
          providers.push({
            ...config,
            apiKey: config.apiKey ? `${config.apiKey.slice(0, 8)}${'•'.repeat(Math.max(0, config.apiKey.length - 12))}${config.apiKey.slice(-4)}` : '',
            apiKeySet: !!config.apiKey,
          });
        } catch { providers.push({ slug: def.slug, name: def.name, enabled: false, apiKey: '', selectedModel: '', validated: false, apiKeySet: false }); }
      } else {
        providers.push({ slug: def.slug, name: def.name, enabled: false, apiKey: '', selectedModel: '', validated: false, apiKeySet: false });
      }
    }

    // Get priority order
    const priorityRaw = await configService.getConfig(PRIORITY_KEY);
    const priority = priorityRaw ? JSON.parse(priorityRaw) : PROVIDER_DEFS.map(d => d.slug);

    res.json({ providers, priority, definitions: PROVIDER_DEFS });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/ai/providers/:slug — Update a provider config ───

router.put('/providers/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const def = PROVIDER_DEFS.find(d => d.slug === slug);
    if (!def) return res.status(404).json({ error: `Unknown provider: ${slug}` });

    const { apiKey, endpoint, selectedModel, enabled } = req.body;

    // Read existing config to preserve fields not being updated
    const existingRaw = await configService.getConfig(`${CONFIG_PREFIX}${slug}`);
    const existing: Partial<ProviderConfig> = existingRaw ? JSON.parse(existingRaw) : {};

    const config: ProviderConfig = {
      slug,
      name: def.name,
      enabled: typeof enabled === 'boolean' ? enabled : (existing.enabled ?? false),
      apiKey: apiKey !== undefined ? apiKey : (existing.apiKey ?? ''),
      endpoint: endpoint !== undefined ? endpoint : (existing.endpoint ?? def.defaultEndpoint),
      selectedModel: selectedModel !== undefined ? selectedModel : (existing.selectedModel ?? ''),
      validated: existing.validated ?? false,
      lastValidated: existing.lastValidated,
    };

    await configService.setConfig(`${CONFIG_PREFIX}${slug}`, JSON.stringify(config), true);

    const user = getRequestUser(req);
    console.log(`[AI] ${user.name} updated provider "${slug}" (enabled: ${config.enabled}, model: ${config.selectedModel})`);

    res.json({ ok: true, slug });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /api/ai/priority — Update provider priority order ───

router.put('/priority', async (req, res) => {
  try {
    const { priority } = req.body;
    if (!Array.isArray(priority)) return res.status(400).json({ error: 'priority must be an array of slugs' });
    await configService.setConfig(PRIORITY_KEY, JSON.stringify(priority));
    const user = getRequestUser(req);
    console.log(`[AI] ${user.name} updated AI priority: ${priority.join(' → ')}`);
    res.json({ ok: true, priority });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/ai/providers/:slug/validate — Test if API key works ───

router.post('/providers/:slug/validate', async (req, res) => {
  try {
    const { slug } = req.params;
    const { apiKey, endpoint } = req.body;
    const def = PROVIDER_DEFS.find(d => d.slug === slug);
    if (!def) return res.status(404).json({ error: `Unknown provider: ${slug}` });

    // If apiKey not provided in body, read from stored config
    let key = apiKey;
    let ep = endpoint;
    if (!key) {
      const raw = await configService.getConfig(`${CONFIG_PREFIX}${slug}`);
      if (raw) {
        const c = JSON.parse(raw);
        key = c.apiKey;
        if (!ep) ep = c.endpoint;
      }
    }

    const result = await validateProviderKey(slug, key || '', ep || def.defaultEndpoint);

    // Update validated status in stored config
    if (result.valid) {
      const raw = await configService.getConfig(`${CONFIG_PREFIX}${slug}`);
      if (raw) {
        const config = JSON.parse(raw);
        config.validated = true;
        config.lastValidated = new Date().toISOString();
        await configService.setConfig(`${CONFIG_PREFIX}${slug}`, JSON.stringify(config), true);
      }
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message, valid: false });
  }
});

// ─── GET /api/ai/providers/:slug/models — Fetch available models ───

router.get('/providers/:slug/models', async (req, res) => {
  try {
    const { slug } = req.params;
    const def = PROVIDER_DEFS.find(d => d.slug === slug);
    if (!def) return res.status(404).json({ error: `Unknown provider: ${slug}` });

    // Read key from config
    const raw = await configService.getConfig(`${CONFIG_PREFIX}${slug}`);
    let key = '', ep = def.defaultEndpoint;
    if (raw) {
      const c = JSON.parse(raw);
      key = c.apiKey || '';
      ep = c.endpoint || def.defaultEndpoint;
    }

    const models = await fetchProviderModels(slug, key, ep);
    res.json({ models });
  } catch (e: any) {
    res.status(500).json({ error: e.message, models: [] });
  }
});

// ─── POST /api/ai/providers/:slug/test — Send a test prompt ───

router.post('/providers/:slug/test', async (req, res) => {
  try {
    const { slug } = req.params;
    const def = PROVIDER_DEFS.find(d => d.slug === slug);
    if (!def) return res.status(404).json({ error: `Unknown provider: ${slug}` });

    const raw = await configService.getConfig(`${CONFIG_PREFIX}${slug}`);
    if (!raw) return res.status(400).json({ error: 'Provider not configured' });
    const config = JSON.parse(raw) as ProviderConfig;

    if (!config.selectedModel) return res.status(400).json({ error: 'No model selected' });

    const result = await sendTestPrompt(slug, config.apiKey, config.endpoint || def.defaultEndpoint, config.selectedModel);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// Provider-specific validation & model fetching
// ═══════════════════════════════════════════════════════════

async function validateProviderKey(slug: string, key: string, endpoint: string): Promise<{ valid: boolean; message: string; models?: string[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    switch (slug) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: controller.signal,
        });
        if (r.status === 401) return { valid: false, message: 'Invalid API key' };
        if (r.status === 403) return { valid: false, message: 'API key lacks permissions' };
        return { valid: r.ok, message: r.ok ? 'Key validated successfully' : `Error: ${r.status}` };
      }
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (r.status === 401) return { valid: false, message: 'Invalid API key' };
        return { valid: r.ok, message: r.ok ? 'Key validated successfully' : `Error: ${r.status}` };
      }
      case 'gemini': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
          signal: controller.signal,
        });
        if (r.status === 400 || r.status === 403) return { valid: false, message: 'Invalid API key' };
        return { valid: r.ok, message: r.ok ? 'Key validated successfully' : `Error: ${r.status}` };
      }
      case 'mistral': {
        const r = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (r.status === 401) return { valid: false, message: 'Invalid API key' };
        return { valid: r.ok, message: r.ok ? 'Key validated successfully' : `Error: ${r.status}` };
      }
      case 'private_vps': {
        if (!endpoint) return { valid: false, message: 'Endpoint URL is required' };
        const r = await fetch(`${endpoint.replace(/\/$/, '')}/v1/models`, { signal: controller.signal });
        return { valid: r.ok, message: r.ok ? 'VPS node reachable' : `Unreachable: ${r.status}` };
      }
      case 'ollama': {
        const ep = endpoint || 'http://localhost:11434';
        const r = await fetch(`${ep.replace(/\/$/, '')}/api/tags`, { signal: controller.signal });
        return { valid: r.ok, message: r.ok ? 'Ollama reachable' : `Unreachable: ${r.status}` };
      }
      default:
        return { valid: false, message: 'Unknown provider' };
    }
  } catch (err: any) {
    return { valid: false, message: err.name === 'AbortError' ? 'Connection timed out (15s)' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderModels(slug: string, key: string, endpoint: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    switch (slug) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.data || [])
          .map((m: any) => m.id)
          .filter((id: string) => id.includes('claude'))
          .sort()
          .reverse(); // newest first
      }
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.data || [])
          .map((m: any) => m.id)
          .filter((id: string) => id.startsWith('gpt-') || id.startsWith('o') || id.startsWith('chatgpt'))
          .sort();
      }
      case 'gemini': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const data: any = await r.json();
        return (data.models || [])
          .map((m: any) => m.name?.replace('models/', ''))
          .filter((id: string) => id && (id.includes('gemini') || id.includes('flash')))
          .sort();
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

async function sendTestPrompt(slug: string, key: string, endpoint: string, model: string): Promise<{ success: boolean; response?: string; error?: string; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const prompt = 'Respond with exactly: "AI connection verified. Ready for deployment." Nothing else.';

  try {
    switch (slug) {
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
        return { success: false, error: 'Unknown provider', latencyMs: Date.now() - start };
    }
  } catch (err: any) {
    return { success: false, error: err.name === 'AbortError' ? 'Timed out (30s)' : err.message, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

export default router;
