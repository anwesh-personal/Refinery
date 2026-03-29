import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Target, Layers, Activity, Database, PenTool, Rocket,
  Zap, TrendingUp, Clock, AlertTriangle, CheckCircle, Settings
} from 'lucide-react';

interface UsageStats {
  totals: { calls: number; tokens: number; cost: number; errors: number; avgLatency: number; successRate: number; fallbackRate: number };
  timeWindows: { last24h: TimeWindow; last7d: TimeWindow; last30d: TimeWindow };
  byService: Record<string, { calls: number; tokens: number; avgLatency: number; errors: number; cost: number }>;
  byProvider: Record<string, { calls: number; tokens: number; avgLatency: number; errors: number; cost: number; type: string }>;
  recentCalls: RecentCall[];
}
interface TimeWindow { calls: number; tokens: number; cost: number }
interface RecentCall { service: string; provider: string; model: string; tokens: number; latencyMs: number; success: boolean; wasFallback: boolean; cost: number; time: string }

const FEATURES = [
  { slug: 'lead_scoring', name: 'Lead Scoring', desc: 'AI-powered quality scoring with configurable weights and tier thresholds', icon: Sparkles, color: 'var(--yellow)', gradient: 'linear-gradient(135deg, #ffd700 0%, #ccad00 100%)', path: '/lead-scoring' },
  { slug: 'icp_analysis', name: 'ICP Analysis', desc: 'Build Ideal Customer Profiles from verified lead data', icon: Target, color: 'var(--blue)', gradient: 'linear-gradient(135deg, #4285f4 0%, #1a5bc4 100%)', path: '/icp-analysis' },
  { slug: 'list_segmentation', name: 'List Segmentation', desc: 'Intelligent lead grouping with per-segment campaign strategy', icon: Layers, color: 'var(--purple)', gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6d3ad4 100%)', path: '/list-segmentation' },
  { slug: 'bounce_analysis', name: 'Bounce Analysis', desc: 'Pre-send deliverability prediction and domain health scoring', icon: Activity, color: 'var(--red)', gradient: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', path: '/bounce-analysis' },
  { slug: 'data_enrichment', name: 'Data Enrichment', desc: 'AI-inferred company, role, industry, tech stack from emails', icon: Database, color: 'var(--green)', gradient: 'linear-gradient(135deg, #10a37f 0%, #0a7a5e 100%)', path: '/data-enrichment' },
  { slug: 'content_generation', name: 'Content Gen', desc: 'Email copywriting: subject lines, body, follow-ups, spam analysis', icon: PenTool, color: '#e91e63', gradient: 'linear-gradient(135deg, #e91e63 0%, #ad1457 100%)', path: '/content-generation' },
  { slug: 'campaign_optimizer', name: 'Campaign Optimizer', desc: 'Send timing, volume pacing, A/B testing, reputation safeguards', icon: Rocket, color: 'var(--yellow)', gradient: 'linear-gradient(135deg, #ff6b35 0%, #cc5229 100%)', path: '/campaign-optimizer' },
];

const TYPE_ICONS: Record<string, string> = { anthropic: '🟣', gemini: '🔵', openai: '🟢', mistral: '🟠', private_vps: '🖥️', ollama: '🦙' };

export default function AIDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | 'all'>('all');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<UsageStats>('/api/ai/usage/stats');
        setStats(data);
      } catch { /* no usage data yet */ }
      finally { setLoading(false); }
    })();
  }, []);

  const tw = stats?.timeWindows?.[timeRange === '24h' ? 'last24h' : timeRange === '7d' ? 'last7d' : 'last30d'];
  const displayCalls = timeRange === 'all' ? stats?.totals?.calls || 0 : tw?.calls || 0;
  const displayTokens = timeRange === 'all' ? stats?.totals?.tokens || 0 : tw?.tokens || 0;
  const displayCost = timeRange === 'all' ? stats?.totals?.cost || 0 : tw?.cost || 0;

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 12 }}>
      <Sparkles size={28} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading AI Dashboard...</div>
    </div>
  );

  return (
    <>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'var(--accent)', opacity: 0.04 }} />
        <div style={{ position: 'absolute', bottom: -50, left: 200, width: 160, height: 160, borderRadius: '50%', background: 'var(--purple)', opacity: 0.03 }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sparkles size={20} style={{ color: 'var(--accent)' }} /></div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>AI Command Center</h1>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>7 AI-powered features · Usage tracking · One dashboard</p>
            </div>
          </div>
        </div>
      </div>

      {/* Usage Stats Strip */}
      {stats && stats.totals.calls > 0 && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={14} /> Usage Overview</div>
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-app)', borderRadius: 8, padding: 2 }}>
              {(['24h', '7d', '30d', 'all'] as const).map(r => (
                <button key={r} onClick={() => setTimeRange(r)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: timeRange === r ? 'var(--accent)' : 'transparent', color: timeRange === r ? '#fff' : 'var(--text-tertiary)', fontSize: 10, fontWeight: 600 }}>{r}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <MetricCard label="API Calls" value={displayCalls.toLocaleString()} icon={<Zap size={14} />} color="var(--accent)" />
            <MetricCard label="Tokens Used" value={formatTokens(displayTokens)} icon={<Activity size={14} />} color="var(--purple)" />
            <MetricCard label="Est. Cost" value={`$${displayCost.toFixed(4)}`} icon={<TrendingUp size={14} />} color="var(--green)" />
            {timeRange === 'all' && <>
              <MetricCard label="Avg Latency" value={`${stats.totals.avgLatency}ms`} icon={<Clock size={14} />} color="var(--yellow)" />
              <MetricCard label="Success Rate" value={`${stats.totals.successRate}%`} icon={<CheckCircle size={14} />} color="var(--green)" />
              <MetricCard label="Fallback Rate" value={`${stats.totals.fallbackRate}%`} icon={<AlertTriangle size={14} />} color="var(--yellow)" />
            </>}
          </div>
        </div>
      )}

      {/* Feature Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 14, marginBottom: 20 }}>
        {FEATURES.map(f => {
          const usage = stats?.byService?.[f.slug];
          const Icon = f.icon;
          return (
            <div key={f.slug} onClick={() => navigate(f.path)} style={{
              borderRadius: 16, overflow: 'hidden', background: 'var(--bg-card)',
              border: '1px solid var(--border)', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 10px 30px ${f.color}18`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              {/* Gradient header */}
              <div style={{ background: f.gradient, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={18} style={{ color: 'var(--accent-contrast, #fff)' }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-contrast, #fff)' }}>{f.name}</span>
                </div>
                {usage && usage.calls > 0 && (
                  <div style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.2)', fontSize: 9, fontWeight: 700, color: 'var(--accent-contrast, #fff)' }}>
                    {usage.calls} calls
                  </div>
                )}
              </div>
              <div style={{ padding: '12px 18px' }}>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 10px 0' }}>{f.desc}</p>
                {usage && usage.calls > 0 ? (
                  <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-tertiary)' }}>
                    <span>🔤 {formatTokens(usage.tokens)}</span>
                    <span>⚡ {usage.avgLatency}ms avg</span>
                    <span>💰 ${usage.cost.toFixed(4)}</span>
                    {usage.errors > 0 && <span style={{ color: 'var(--red)' }}>❌ {usage.errors}</span>}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No usage yet</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Row: Provider Usage + Recent Calls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {/* Provider Breakdown */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Settings size={14} /> Provider Usage
          </div>
          {stats && Object.keys(stats.byProvider).length > 0 ? (
            Object.entries(stats.byProvider).map(([name, p]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{TYPE_ICONS[p.type] || '🤖'}</span>
                  <div><div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div><div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{p.calls} calls · {p.avgLatency}ms avg</div></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{formatTokens(p.tokens)}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>${p.cost.toFixed(4)}</div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>No provider data yet</div>
          )}
        </div>

        {/* Recent Calls */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18, maxHeight: 380, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={14} /> Recent Calls
          </div>
          {stats?.recentCalls?.length ? (
            stats.recentCalls.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {c.success ? <CheckCircle size={9} style={{ color: 'var(--green)' }} /> : <AlertTriangle size={9} style={{ color: 'var(--red)' }} />}
                    {c.service.replace(/_/g, ' ')}
                    {c.wasFallback && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#ff6b3515', color: 'var(--yellow)', fontWeight: 700 }}>FB</span>}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{c.provider} → {c.model}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600 }}>{c.latencyMs}ms · {formatTokens(c.tokens)}</div>
                  <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>{new Date(c.time).toLocaleString()}</div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>No calls logged yet. Use any AI feature to see data here.</div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => navigate('/ai-settings')} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}><Settings size={12} /> AI Settings</button>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </>
  );
}

function MetricCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div style={{ background: 'var(--bg-app)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span style={{ color }}>{icon}</span> {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
