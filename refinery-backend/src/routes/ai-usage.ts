import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI Usage Stats — powers the AI Dashboard
// ═══════════════════════════════════════════════════════════

/** Supabase returns `numeric` columns as strings — parse safely */
function parseCost(val: string | null | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// GET /api/ai/usage/stats — aggregate usage statistics
router.get('/stats', async (_req, res) => {
  try {
    // All-time aggregate
    const { data: logs, error } = await supabaseAdmin
      .from('ai_usage_log')
      .select('service_slug, provider_type, provider_label, model, tokens_used, latency_ms, success, was_fallback, estimated_cost_usd, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) return res.status(500).json({ error: error.message });

    const rows = logs || [];

    // Per-service breakdown
    const byService: Record<string, { calls: number; tokens: number; avgLatency: number; errors: number; cost: number }> = {};
    // Per-provider breakdown
    const byProvider: Record<string, { calls: number; tokens: number; avgLatency: number; errors: number; cost: number; type: string }> = {};
    // Last 24h / 7d / 30d
    const now = Date.now();
    const h24 = now - 86400000;
    const d7 = now - 604800000;
    const d30 = now - 2592000000;
    let last24h = { calls: 0, tokens: 0, cost: 0 };
    let last7d = { calls: 0, tokens: 0, cost: 0 };
    let last30d = { calls: 0, tokens: 0, cost: 0 };

    let totalTokens = 0;
    let totalCost = 0;
    let totalErrors = 0;
    let totalLatency = 0;
    let totalFallbacks = 0;

    for (const r of rows) {
      const cost = parseCost(r.estimated_cost_usd);

      // Service
      if (!byService[r.service_slug]) byService[r.service_slug] = { calls: 0, tokens: 0, avgLatency: 0, errors: 0, cost: 0 };
      byService[r.service_slug].calls++;
      byService[r.service_slug].tokens += r.tokens_used || 0;
      byService[r.service_slug].avgLatency += r.latency_ms || 0;
      byService[r.service_slug].cost += cost;
      if (!r.success) byService[r.service_slug].errors++;

      // Provider
      const pk = r.provider_label || r.provider_type;
      if (!byProvider[pk]) byProvider[pk] = { calls: 0, tokens: 0, avgLatency: 0, errors: 0, cost: 0, type: r.provider_type };
      byProvider[pk].calls++;
      byProvider[pk].tokens += r.tokens_used || 0;
      byProvider[pk].avgLatency += r.latency_ms || 0;
      byProvider[pk].cost += cost;
      if (!r.success) byProvider[pk].errors++;

      // Totals
      totalTokens += r.tokens_used || 0;
      totalCost += cost;
      totalLatency += r.latency_ms || 0;
      if (!r.success) totalErrors++;
      if (r.was_fallback) totalFallbacks++;

      // Time windows
      const ts = new Date(r.created_at).getTime();
      if (ts >= h24) { last24h.calls++; last24h.tokens += r.tokens_used || 0; last24h.cost += cost; }
      if (ts >= d7) { last7d.calls++; last7d.tokens += r.tokens_used || 0; last7d.cost += cost; }
      if (ts >= d30) { last30d.calls++; last30d.tokens += r.tokens_used || 0; last30d.cost += cost; }
    }

    // Average latencies
    for (const s of Object.values(byService)) if (s.calls > 0) s.avgLatency = Math.round(s.avgLatency / s.calls);
    for (const p of Object.values(byProvider)) if (p.calls > 0) p.avgLatency = Math.round(p.avgLatency / p.calls);

    // Recent calls (last 20)
    const recentCalls = rows.slice(0, 20).map(r => ({
      service: r.service_slug,
      provider: r.provider_label,
      model: r.model,
      tokens: r.tokens_used,
      latencyMs: r.latency_ms,
      success: r.success,
      wasFallback: r.was_fallback,
      cost: parseCost(r.estimated_cost_usd),
      time: r.created_at,
    }));

    res.json({
      totals: {
        calls: rows.length,
        tokens: totalTokens,
        cost: Math.round(totalCost * 10000) / 10000,
        errors: totalErrors,
        avgLatency: rows.length > 0 ? Math.round(totalLatency / rows.length) : 0,
        successRate: rows.length > 0 ? Math.round(((rows.length - totalErrors) / rows.length) * 100) : 0,
        fallbackRate: rows.length > 0 ? Math.round((totalFallbacks / rows.length) * 100) : 0,
      },
      timeWindows: { last24h, last7d, last30d },
      byService,
      byProvider,
      recentCalls,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
