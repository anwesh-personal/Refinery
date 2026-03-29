import { useState } from 'react';
import { apiCall } from '../lib/api';
import {
  Loader2, PenTool, Copy, Check, Mail, Zap
} from 'lucide-react';
import AgentCard from '../components/AgentCard';

interface ContentConfig {
  contentType: string; tone: string; length: string;
  audience: { segment: string; seniority: string; industry: string; painPoints: string };
  campaign: { product: string; valueProposition: string; goal: string; urgency: string };
  generation: { subjectLineCount: number; bodyVariations: number; includePS: boolean; includePersonalization: boolean; generateFollowUps: number; avoidSpamTriggers: boolean };
  brand: { companyName: string; senderName: string; signatureStyle: string };
  customInstructions: string;
}
interface SubjectLine { text: string; type: string; estimatedOpenRate: string }
interface EmailVariation { subjectLine: string; preheader: string; body: string; callToAction: string; psLine?: string }
interface FollowUp { dayDelay: number; subjectLine: string; body: string; purpose: string }
interface ContentResult {
  subjectLines: SubjectLine[]; emailVariations: EmailVariation[]; followUps: FollowUp[];
  spamAnalysis: { score: number; flaggedWords: string[]; suggestions: string[] };
  copywritingTips: string[];
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

const DEFAULT_CONFIG: ContentConfig = {
  contentType: 'cold_outreach', tone: 'professional', length: 'medium',
  audience: { segment: '', seniority: '', industry: '', painPoints: '' },
  campaign: { product: '', valueProposition: '', goal: '', urgency: '' },
  generation: { subjectLineCount: 5, bodyVariations: 3, includePS: true, includePersonalization: true, generateFollowUps: 2, avoidSpamTriggers: true },
  brand: { companyName: '', senderName: '', signatureStyle: 'professional' },
  customInstructions: '',
};
const TYPES = ['cold_outreach', 'follow_up', 'newsletter', 'announcement', 're_engagement', 'custom'];
const TONES = ['professional', 'casual', 'urgent', 'educational', 'witty', 'empathetic'];
const LENGTHS = ['short', 'medium', 'long'];
const SIG_STYLES = ['minimal', 'professional', 'friendly'];

export default function ContentGenerationPage() {
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);
  const showToast = (type: string, msg: string) => { setToast({ type, message: msg.slice(0, 200) }); setTimeout(() => setToast(null), 6000); };
  const [config, setConfig] = useState<ContentConfig>(DEFAULT_CONFIG);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ContentResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>('subjects');
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 2000);
  };

  const run = async () => {
    if (!config.campaign.product && !config.campaign.valueProposition) return showToast('warning', 'Product or value proposition required');
    setGenerating(true); setResult(null);
    try {
      const res = await apiCall<ContentResult>('/api/ai/content-generation', { method: 'POST', body: { config } });
      setResult(res); showToast('info', `Generated in ${res.ai.latencyMs}ms`);
    } catch (e: any) { showToast('error', e.message); } finally { setGenerating(false); }
  };

  return (
    <>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, borderRadius: '50%', background: '#e91e63', opacity: 0.04 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #e91e63 0%, #ad1457 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PenTool size={18} style={{ color: '#fff' }} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Content Generation</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 600, lineHeight: 1.6 }}>AI copywriter: subject lines, email body variations, follow-up sequences, spam analysis — all configurable.</p>
      </div>

      {/* Config — always visible for content gen since there's no job selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
        {/* Type & Tone */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
          <label style={labelStyle}>Content Type</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {TYPES.map(t => <button key={t} onClick={() => setConfig(p => ({ ...p, contentType: t }))} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 600, border: `1px solid ${config.contentType === t ? '#e91e63' : 'var(--border)'}`, background: config.contentType === t ? '#e91e63' : 'transparent', color: config.contentType === t ? '#fff' : 'var(--text-tertiary)', cursor: 'pointer', textTransform: 'capitalize' }}>{t.replace(/_/g, ' ')}</button>)}
          </div>
          <label style={labelStyle}>Tone</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {TONES.map(t => <button key={t} onClick={() => setConfig(p => ({ ...p, tone: t }))} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 600, border: `1px solid ${config.tone === t ? '#e91e63' : 'var(--border)'}`, background: config.tone === t ? '#e91e63' : 'transparent', color: config.tone === t ? '#fff' : 'var(--text-tertiary)', cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>)}
          </div>
          <label style={labelStyle}>Length</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {LENGTHS.map(l => <button key={l} onClick={() => setConfig(p => ({ ...p, length: l }))} style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 10, fontWeight: 600, border: `1px solid ${config.length === l ? '#e91e63' : 'var(--border)'}`, background: config.length === l ? '#e91e63' : 'transparent', color: config.length === l ? '#fff' : 'var(--text-tertiary)', cursor: 'pointer', textTransform: 'capitalize' }}>{l}</button>)}
          </div>
        </div>

        {/* Campaign */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
          <label style={labelStyle}>Product / Service *</label>
          <input value={config.campaign.product} onChange={e => setConfig(p => ({ ...p, campaign: { ...p.campaign, product: e.target.value } }))} placeholder="What you're promoting" style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Value Proposition</label>
          <input value={config.campaign.valueProposition} onChange={e => setConfig(p => ({ ...p, campaign: { ...p.campaign, valueProposition: e.target.value } }))} placeholder="Why it matters" style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Goal</label>
          <input value={config.campaign.goal} onChange={e => setConfig(p => ({ ...p, campaign: { ...p.campaign, goal: e.target.value } }))} placeholder="Book demo, sign up..." style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Urgency</label>
          <input value={config.campaign.urgency} onChange={e => setConfig(p => ({ ...p, campaign: { ...p.campaign, urgency: e.target.value } }))} placeholder="Limited spots, price increase..." style={inputStyle} />
        </div>

        {/* Audience */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
          <label style={labelStyle}>Segment</label>
          <input value={config.audience.segment} onChange={e => setConfig(p => ({ ...p, audience: { ...p.audience, segment: e.target.value } }))} placeholder="Tech Decision Makers" style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Seniority</label>
          <input value={config.audience.seniority} onChange={e => setConfig(p => ({ ...p, audience: { ...p.audience, seniority: e.target.value } }))} placeholder="C-Suite, Manager..." style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Industry</label>
          <input value={config.audience.industry} onChange={e => setConfig(p => ({ ...p, audience: { ...p.audience, industry: e.target.value } }))} placeholder="SaaS, Healthcare..." style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Pain Points</label>
          <input value={config.audience.painPoints} onChange={e => setConfig(p => ({ ...p, audience: { ...p.audience, painPoints: e.target.value } }))} placeholder="Slow onboarding, high churn" style={inputStyle} />
        </div>
      </div>

      {/* Generation Options + Brand */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Generation Options</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><label style={{ ...labelStyle, fontSize: 8 }}>Subject Lines</label><input type="number" min={1} max={10} value={config.generation.subjectLineCount} onChange={e => setConfig(p => ({ ...p, generation: { ...p.generation, subjectLineCount: Number(e.target.value) } }))} style={{ ...inputStyle, maxWidth: 60 }} /></div>
            <div><label style={{ ...labelStyle, fontSize: 8 }}>Body Variations</label><input type="number" min={1} max={5} value={config.generation.bodyVariations} onChange={e => setConfig(p => ({ ...p, generation: { ...p.generation, bodyVariations: Number(e.target.value) } }))} style={{ ...inputStyle, maxWidth: 60 }} /></div>
            <div><label style={{ ...labelStyle, fontSize: 8 }}>Follow-ups</label><input type="number" min={0} max={5} value={config.generation.generateFollowUps} onChange={e => setConfig(p => ({ ...p, generation: { ...p.generation, generateFollowUps: Number(e.target.value) } }))} style={{ ...inputStyle, maxWidth: 60 }} /></div>
          </div>
          {[{ k: 'includePS', l: 'P.S. Line' }, { k: 'includePersonalization', l: 'Personalization {{tokens}}' }, { k: 'avoidSpamTriggers', l: 'Avoid Spam Triggers' }].map(o => (
            <label key={o.k} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <input type="checkbox" checked={(config.generation as any)[o.k]} onChange={e => setConfig(p => ({ ...p, generation: { ...p.generation, [o.k]: e.target.checked } }))} style={{ accentColor: '#e91e63' }} />{o.l}
            </label>
          ))}
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Brand</div>
          <label style={labelStyle}>Company</label><input value={config.brand.companyName} onChange={e => setConfig(p => ({ ...p, brand: { ...p.brand, companyName: e.target.value } }))} style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Sender Name</label><input value={config.brand.senderName} onChange={e => setConfig(p => ({ ...p, brand: { ...p.brand, senderName: e.target.value } }))} style={{ ...inputStyle, marginBottom: 8 }} />
          <label style={labelStyle}>Signature</label>
          <div style={{ display: 'flex', gap: 4 }}>{SIG_STYLES.map(s => <button key={s} onClick={() => setConfig(p => ({ ...p, brand: { ...p.brand, signatureStyle: s } }))} style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 9, fontWeight: 600, border: `1px solid ${config.brand.signatureStyle === s ? '#e91e63' : 'var(--border)'}`, background: config.brand.signatureStyle === s ? '#e91e63' : 'transparent', color: config.brand.signatureStyle === s ? '#fff' : 'var(--text-tertiary)', cursor: 'pointer', textTransform: 'capitalize' }}>{s}</button>)}</div>
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 16 }}>
          <label style={labelStyle}>Custom Instructions</label>
          <textarea value={config.customInstructions} onChange={e => setConfig(p => ({ ...p, customInstructions: e.target.value }))} placeholder="Additional copywriting instructions..." rows={5} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          <button onClick={run} disabled={generating} style={{ marginTop: 12, width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #e91e63 0%, #ad1457 100%)', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: generating ? 0.5 : 1, boxShadow: '0 4px 14px rgba(233,30,99,0.25)' }}>
            {generating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <PenTool size={14} />} {generating ? 'Generating...' : 'Generate Content'}
          </button>
        </div>
      </div>

      {/* ── RESULTS ── */}
      {result && (
        <>
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', width: 'fit-content' }}>
            {[{ k: 'subjects', l: `Subject Lines (${result.subjectLines?.length || 0})` }, { k: 'emails', l: `Emails (${result.emailVariations?.length || 0})` }, { k: 'followups', l: `Follow-ups (${result.followUps?.length || 0})` }, { k: 'spam', l: 'Spam Analysis' }].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: activeTab === t.k ? '#e91e63' : 'transparent', color: activeTab === t.k ? '#fff' : 'var(--text-tertiary)', fontSize: 11, fontWeight: 600 }}>{t.l}</button>
            ))}
          </div>

          {/* Subject Lines */}
          {activeTab === 'subjects' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(result.subjectLines || []).map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{s.text}</div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text-tertiary)' }}>
                      <span style={{ padding: '1px 6px', borderRadius: 4, background: '#e91e6315', color: '#e91e63', fontWeight: 600 }}>{s.type}</span>
                      <span>📈 {s.estimatedOpenRate}</span>
                    </div>
                  </div>
                  <button onClick={() => copyText(s.text, `subj-${i}`)} style={{ padding: '6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', cursor: 'pointer', color: copied === `subj-${i}` ? '#10a37f' : 'var(--text-tertiary)' }}>{copied === `subj-${i}` ? <Check size={12} /> : <Copy size={12} />}</button>
                </div>
              ))}
            </div>
          )}

          {/* Email Variations */}
          {activeTab === 'emails' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(result.emailVariations || []).map((e, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <div style={{ background: 'linear-gradient(135deg, #e91e6310 0%, #ad145710 100%)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                    <div><div style={{ fontSize: 11, fontWeight: 700, color: '#e91e63' }}>Variation {i + 1}</div><div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{e.subjectLine}</div></div>
                    <button onClick={() => copyText(`Subject: ${e.subjectLine}\n\n${e.body}${e.psLine ? '\n\nP.S. ' + e.psLine : ''}`, `email-${i}`)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: copied === `email-${i}` ? '#10a37f' : 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 3 }}>{copied === `email-${i}` ? <Check size={10} /> : <Copy size={10} />} Copy</button>
                  </div>
                  <div style={{ padding: 16 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6 }}>Preheader: {e.preheader}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 10 }}>{e.body}</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ fontSize: 10, color: '#e91e63', fontWeight: 600 }}><Mail size={10} style={{ verticalAlign: 'middle' }} /> CTA: {e.callToAction}</span>
                      {e.psLine && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>P.S. {e.psLine}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Follow-ups */}
          {activeTab === 'followups' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(result.followUps || []).map((f, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div><span style={{ fontSize: 9, fontWeight: 700, color: '#e91e63', textTransform: 'uppercase' }}>Day +{f.dayDelay}</span><div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{f.subjectLine}</div></div>
                    <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{f.purpose}</span>
                  </div>
                  <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{f.body}</div>
                </div>
              ))}
            </div>
          )}

          {/* Spam */}
          {activeTab === 'spam' && result.spamAnalysis && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)', padding: 22, textAlign: 'center' }}>
                <div style={{ fontSize: 42, fontWeight: 900, color: result.spamAnalysis.score <= 20 ? '#10a37f' : result.spamAnalysis.score <= 50 ? '#ffd700' : '#ef4444' }}>{result.spamAnalysis.score}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Spam Score (lower = better)</div>
              </div>
              {result.spamAnalysis.flaggedWords.length > 0 && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid #ef444430', padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>⚠️ Flagged Words</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{result.spamAnalysis.flaggedWords.map(w => <span key={w} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#ef444415', color: '#ef4444', border: '1px solid #ef444430' }}>{w}</span>)}</div>
                </div>
              )}
              {result.spamAnalysis.suggestions.length > 0 && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#10a37f', marginBottom: 6 }}>💡 Suggestions</div>
                  {result.spamAnalysis.suggestions.map((s, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.5 }}>• {s}</div>)}
                </div>
              )}
              {result.copywritingTips?.length > 0 && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>✍️ Copywriting Tips</div>
                  {result.copywritingTips.map((t, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.5 }}>• {t}</div>)}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> {result.ai.latencyMs}ms</span><span>🤖 {result.ai.provider} → {result.ai.model}</span>
            {result.ai.tokensUsed && <span>📊 {result.ai.tokensUsed} tokens</span>}
          </div>
        </>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '14px 22px', borderRadius: 12, maxWidth: 420, background: toast.type === 'error' ? 'var(--red)' : 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'slideUp 0.25s ease-out', cursor: 'pointer' }} onClick={() => setToast(null)}>{toast.type === 'error' ? '❌' : 'ℹ️'} {toast.message}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* AI Agent */}
      <div style={{ marginTop: 36 }}>
        <AgentCard slug="email_marketer" contextLabel="Email Copy & Sequence Writing" />
      </div>
    </>
  );
}
const labelStyle: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 };
