import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import {
  Loader2, ChevronDown, Settings, Database, AlertTriangle,
  Zap, Users, Building2, Briefcase, BarChart3, Download
} from 'lucide-react';
import AgentCard from '../components/AgentCard';

interface EnrichConfig {
  enrichmentFields: Record<string, boolean>;
  enrichmentDepth: string; outputFormat: string; industryContext: string;
  customFields: string; includeClassifications: string[]; maxLeads: number;
}
interface Enrichment { companyName?: string; companySize?: string; industry?: string; role?: string; seniority?: string; department?: string; techStack?: string[]; buyerPersona?: string; communicationPreference?: string }
interface EnrichedLead { email: string; enrichments: Enrichment; confidence: string; enrichmentNotes: string }
interface DistItem { label: string; count: number; percentage: number }
interface Insight { title: string; description: string; impact: string }
interface EnrichResult {
  leads: EnrichedLead[]; aggregated: { companySizeDistribution: DistItem[]; industryDistribution: DistItem[]; seniorityDistribution: DistItem[]; departmentDistribution: DistItem[] };
  insights: Insight[]; ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}
interface Job { id: string; status: string; totalProcessed: number; safe: number; uncertain: number; results: any[] }

const CONF_COLOR: Record<string, string> = { high: 'var(--green)', medium: 'var(--yellow)', low: 'var(--yellow)' };
const DIST_COLORS = ['var(--blue)', 'var(--green)', 'var(--purple)', 'var(--yellow)'];
const DEFAULT_CONFIG: EnrichConfig = {
  enrichmentFields: { companyName: true, companySize: true, industry: true, roleSeniority: true, department: true, techStack: true, buyerPersona: true, communicationPreference: false },
  enrichmentDepth: 'standard', outputFormat: 'per_lead', industryContext: '', customFields: '',
  includeClassifications: ['safe', 'uncertain'], maxLeads: 100,
};

export default function DataEnrichmentPage() {
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const showToast = (type: string, msg: string) => { setToast({ type, message: msg.slice(0, 200) }); setTimeout(() => setToast(null), 6000); };
  const [config, setConfig] = useState<EnrichConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>('leads');
  const [filterConf, setFilterConf] = useState<string>('all');
  const [jobs, setJobs] = useState<Job[]>([]); const [selectedJobId, setSelectedJobId] = useState(''); const [loadingJobs, setLoadingJobs] = useState(true);

  useEffect(() => {
    (async () => {
      try { const d = await apiCall<{ jobs: Job[] }>('/api/verify/jobs'); const c = (d.jobs || []).filter(j => j.status === 'completed' && j.results?.length > 0); setJobs(c); if (c.length > 0) setSelectedJobId(c[0].id); }
      catch (e: any) { showToast('error', e.message); } finally { setLoadingJobs(false); }
    })();
  }, []);

  const run = async () => {
    const j = jobs.find(j => j.id === selectedJobId);
    if (!j) return showToast('warning', 'No job selected');
    setEnriching(true); setResult(null);
    try {
      const leads = j.results.map((r: any) => ({ email: r.email, classification: r.classification, riskScore: r.riskScore, checks: r.checks }));
      const res = await apiCall<EnrichResult>('/api/ai/data-enrichment', { method: 'POST', body: { leads, config } });
      setResult(res); showToast('info', `Enriched ${res.leads?.length || 0} leads in ${res.ai.latencyMs}ms`);
    } catch (e: any) { showToast('error', e.message); } finally { setEnriching(false); }
  };

  const exportCSV = () => {
    if (!result) return;
    const headers = ['Email', 'Company', 'Size', 'Industry', 'Role', 'Seniority', 'Department', 'Tech Stack', 'Buyer Persona', 'Confidence'];
    const rows = [headers.join(','), ...result.leads.map(l => [l.email, l.enrichments.companyName || '', l.enrichments.companySize || '', l.enrichments.industry || '', l.enrichments.role || '', l.enrichments.seniority || '', l.enrichments.department || '', (l.enrichments.techStack || []).join('; '), l.enrichments.buyerPersona || '', l.confidence].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `enriched_leads_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const filtered = result?.leads?.filter(l => filterConf === 'all' || l.confidence === filterConf) || [];

  if (loadingJobs) return <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 12 }}><Database size={28} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} /><div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading...</div></div>;

  return (
    <>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'var(--green)', opacity: 0.04 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #10a37f 0%, #0a7a5e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Database size={18} style={{ color: 'var(--accent-contrast, #fff)' }} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Data Enrichment</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 600, lineHeight: 1.6 }}>AI-inferred company data, role seniority, industry, tech stack, and buyer personas from email addresses.</p>
      </div>

      {/* Source */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
          <label style={labelStyle}>Source</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer' }}><option value="">Select...</option>{jobs.map(j => <option key={j.id} value={j.id}>Job {j.id.slice(0, 8)} — {j.totalProcessed} emails</option>)}</select>
              <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
            </div>
            <button onClick={run} disabled={enriching || !selectedJobId} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #10a37f 0%, #0a7a5e 100%)', color: 'var(--accent-contrast, #fff)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, opacity: (enriching || !selectedJobId) ? 0.5 : 1 }}>
              {enriching ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Database size={14} />} {enriching ? 'Enriching...' : 'Enrich Data'}
            </button>
          </div>
        </div>
        <button onClick={() => setShowConfig(!showConfig)} style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 22px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 100, color: showConfig ? 'var(--accent)' : 'var(--text-secondary)' }}>
          <Settings size={20} style={{ transition: 'transform 0.3s', transform: showConfig ? 'rotate(90deg)' : '' }} /><span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Configure</span>
        </button>
      </div>

      {/* Config */}
      {showConfig && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--accent)', padding: 24, marginBottom: 24, animation: 'slideDown 0.2s ease-out' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 18 }}><Settings size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Enrichment Config</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
            <div><label style={labelStyle}>Depth</label>
              <div style={{ display: 'flex', gap: 4 }}>{(['basic', 'standard', 'comprehensive'] as const).map(d => (
                <button key={d} onClick={() => setConfig(p => ({ ...p, enrichmentDepth: d }))} style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: `1px solid ${config.enrichmentDepth === d ? 'var(--green)' : 'var(--border)'}`, background: config.enrichmentDepth === d ? 'var(--green)' : 'transparent', color: config.enrichmentDepth === d ? '#fff' : 'var(--text-secondary)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>{d}</button>
              ))}</div></div>
            <div><label style={labelStyle}>Industry Context</label><input value={config.industryContext} onChange={e => setConfig(p => ({ ...p, industryContext: e.target.value }))} placeholder="e.g. SaaS, Fintech" style={inputStyle} /></div>
            <div><label style={labelStyle}>Max Leads</label><input type="number" min={5} max={300} value={config.maxLeads} onChange={e => setConfig(p => ({ ...p, maxLeads: Number(e.target.value) }))} style={{ ...inputStyle, maxWidth: 100 }} /></div>
          </div>
          <div><div style={{ ...labelStyle, marginBottom: 6 }}>Fields</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
              {Object.entries(config.enrichmentFields).map(([k, v]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={v} onChange={e => setConfig(p => ({ ...p, enrichmentFields: { ...p.enrichmentFields, [k]: e.target.checked } }))} style={{ accentColor: 'var(--green)' }} />{k.replace(/([A-Z])/g, ' $1').trim()}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 14 }}><label style={labelStyle}>Custom Fields</label><textarea value={config.customFields} onChange={e => setConfig(p => ({ ...p, customFields: e.target.value }))} placeholder="Also infer: geographic market, buying stage..." rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} /></div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', width: 'fit-content' }}>
            {[{ k: 'leads', l: `Leads (${result.leads?.length || 0})` }, { k: 'dist', l: 'Distribution' }, { k: 'insights', l: `Insights (${result.insights?.length || 0})` }].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: activeTab === t.k ? 'var(--green)' : 'transparent', color: activeTab === t.k ? '#fff' : 'var(--text-tertiary)', fontSize: 11, fontWeight: 600 }}>{t.l}</button>
            ))}
          </div>

          {/* Leads Tab */}
          {activeTab === 'leads' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['all', 'high', 'medium', 'low'].map(c => (
                    <button key={c} onClick={() => setFilterConf(c)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, border: `1px solid ${c === 'all' ? 'var(--border)' : (CONF_COLOR[c] || 'var(--border)')}`, background: filterConf === c ? (c === 'all' ? 'var(--accent)' : CONF_COLOR[c]) : 'transparent', color: filterConf === c ? '#fff' : 'var(--text-tertiary)', cursor: 'pointer', textTransform: 'capitalize' }}>{c}</button>
                  ))}
                </div>
                <button onClick={exportCSV} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}><Download size={12} /> CSV</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map((l, i) => (
                  <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace', marginBottom: 4 }}>{l.email}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        {l.enrichments.companyName && <Tag icon={<Building2 size={8} />} text={l.enrichments.companyName} color="var(--blue)" />}
                        {l.enrichments.companySize && <Tag text={l.enrichments.companySize} color="var(--purple)" />}
                        {l.enrichments.industry && <Tag text={l.enrichments.industry} color="var(--green)" />}
                        {l.enrichments.role && <Tag icon={<Briefcase size={8} />} text={l.enrichments.role} color="var(--yellow)" />}
                        {l.enrichments.seniority && <Tag text={l.enrichments.seniority} color="var(--yellow)" />}
                        {l.enrichments.department && <Tag icon={<Users size={8} />} text={l.enrichments.department} color="var(--blue)" />}
                        {l.enrichments.buyerPersona && <Tag text={l.enrichments.buyerPersona} color="var(--red)" />}
                      </div>
                      {l.enrichments.techStack && l.enrichments.techStack.length > 0 && (
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>Tech: {l.enrichments.techStack.join(', ')}</div>
                      )}
                    </div>
                    <div style={{ padding: '4px 8px', borderRadius: 6, alignSelf: 'flex-start', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: `${CONF_COLOR[l.confidence]}15`, color: CONF_COLOR[l.confidence], border: `1px solid ${CONF_COLOR[l.confidence]}40` }}>{l.confidence}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Distribution */}
          {activeTab === 'dist' && result.aggregated && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              {([
                { key: 'companySizeDistribution', title: 'Company Size', icon: <Building2 size={14} /> },
                { key: 'industryDistribution', title: 'Industry', icon: <BarChart3 size={14} /> },
                { key: 'seniorityDistribution', title: 'Seniority', icon: <Briefcase size={14} /> },
                { key: 'departmentDistribution', title: 'Department', icon: <Users size={14} /> },
              ] as const).map((d, di) => (
                <div key={d.key} style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>{d.icon} {d.title}</div>
                  {(result.aggregated[d.key] || []).map(item => (
                    <div key={item.label} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{item.count} ({item.percentage}%)</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-app)' }}><div style={{ height: '100%', borderRadius: 3, width: `${item.percentage}%`, background: DIST_COLORS[di % DIST_COLORS.length] }} /></div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Insights */}
          {activeTab === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(result.insights || []).map((ins, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, padding: '14px 18px', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
                  <div><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{ins.title}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ins.description}</div></div>
                  <span style={{ padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', alignSelf: 'flex-start', background: ins.impact === 'high' ? '#ff6b3520' : ins.impact === 'medium' ? '#ffd70020' : '#10a37f20', color: ins.impact === 'high' ? 'var(--yellow)' : ins.impact === 'medium' ? 'var(--yellow)' : 'var(--green)' }}>{ins.impact}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> {result.ai.latencyMs}ms</span>
            <span>🤖 {result.ai.provider} → {result.ai.model}</span>
            {result.ai.tokensUsed && <span>📊 {result.ai.tokensUsed} tokens</span>}
          </div>
        </>
      )}

      {!result && !enriching && jobs.length === 0 && <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 20, border: '1px dashed var(--border)' }}><AlertTriangle size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 12, opacity: 0.4 }} /><div style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>No verification jobs found</div></div>}
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '14px 22px', borderRadius: 12, maxWidth: 420, background: toast.type === 'error' ? 'var(--red)' : 'var(--accent)', color: 'var(--accent-contrast, #fff)', fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'slideUp 0.25s ease-out', cursor: 'pointer' }} onClick={() => setToast(null)}>{toast.type === 'error' ? '❌' : 'ℹ️'} {toast.message}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* AI Agent */}
      <div style={{ marginTop: 36 }}>
        <AgentCard slug="data_scientist" contextLabel="Data Enrichment Strategy" />
      </div>
    </>
  );
}

function Tag({ text, color, icon }: { text: string; color: string; icon?: React.ReactNode }) {
  return <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: `${color}12`, color, border: `1px solid ${color}30`, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{icon}{text}</span>;
}
const labelStyle: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 };
