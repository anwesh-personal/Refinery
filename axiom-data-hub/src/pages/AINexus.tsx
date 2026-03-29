import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiCall } from '../lib/api';
import {
  Sparkles, Target, Layers, Activity, Database, PenTool, Rocket,
  Brain, Settings2, LayoutDashboard, Send, Loader2, MessageSquare,
  Plus, Trash2, Pin
} from 'lucide-react';

// ── Lazy-loaded feature pages (imported as components) ──
import AIDashboardPage from './AIDashboard';
import LeadScoringPage from './LeadScoring';
import ICPAnalysisPage from './ICPAnalysis';
import ListSegmentationPage from './ListSegmentation';
import BounceAnalysisPage from './BounceAnalysis';
import DataEnrichmentPage from './DataEnrichment';
import ContentGenerationPage from './ContentGeneration';
import CampaignOptimizerPage from './CampaignOptimizer';
import AISettingsPage from './AISettings';

// ── Types ──
interface Agent { id: string; slug: string; name: string; role: string; avatar_emoji: string; accent_color: string; greeting: string; capabilities: string[]; enabled: boolean }
interface Conversation { id: string; title: string; pinned: boolean; created_at: string; updated_at: string }
interface Msg { id: string; role: string; content: string; tool_name?: string; tokens_used: number; latency_ms: number; provider_used?: string; model_used?: string; created_at: string }

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'lead-scoring', label: 'Lead Scoring', icon: Sparkles },
  { key: 'icp-analysis', label: 'ICP Analysis', icon: Target },
  { key: 'list-segmentation', label: 'Segmentation', icon: Layers },
  { key: 'bounce-analysis', label: 'Bounce', icon: Activity },
  { key: 'data-enrichment', label: 'Enrichment', icon: Database },
  { key: 'content-generation', label: 'Content', icon: PenTool },
  { key: 'campaign-optimizer', label: 'Optimizer', icon: Rocket },
  { key: 'agents', label: 'Agents', icon: Brain },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

export default function AINexusPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'dashboard';
  const setTab = (t: string) => setSearchParams({ tab: t });

  return (
    <>
      {/* Tab bar — scrollable horizontal strip */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 12, padding: 4, border: '1px solid var(--border)', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-tertiary)',
              fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
              transition: 'all 0.15s ease', flexShrink: 0,
            }}><Icon size={13} /> {t.label}</button>
          );
        })}
      </div>

      {/* Content Area */}
      {tab === 'dashboard' && <AIDashboardPage />}
      {tab === 'lead-scoring' && <LeadScoringPage />}
      {tab === 'icp-analysis' && <ICPAnalysisPage />}
      {tab === 'list-segmentation' && <ListSegmentationPage />}
      {tab === 'bounce-analysis' && <BounceAnalysisPage />}
      {tab === 'data-enrichment' && <DataEnrichmentPage />}
      {tab === 'content-generation' && <ContentGenerationPage />}
      {tab === 'campaign-optimizer' && <CampaignOptimizerPage />}
      {tab === 'settings' && <AISettingsPage />}
      {tab === 'agents' && <AgentsPanel />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Agents Panel — the chat interface for all 5 agents
// ═══════════════════════════════════════════════════════════

function AgentsPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load agents
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ agents: Agent[] }>('/api/ai/agents');
        setAgents(data.agents || []);
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  // Load conversations when agent selected
  const loadConversations = useCallback(async (slug: string) => {
    try {
      const data = await apiCall<{ conversations: Conversation[] }>(`/api/ai/agents/${slug}/conversations`);
      setConversations(data.conversations || []);
    } catch {}
  }, []);

  useEffect(() => {
    if (selectedAgent) loadConversations(selectedAgent.slug);
  }, [selectedAgent, loadConversations]);

  // Load messages when conversation selected
  useEffect(() => {
    if (!activeConv) { setMessages([]); return; }
    (async () => {
      setLoadingMsgs(true);
      try {
        const data = await apiCall<{ messages: Msg[] }>(`/api/ai/agents/conversations/${activeConv}/messages`);
        setMessages(data.messages || []);
      } catch {}
      finally { setLoadingMsgs(false); }
    })();
  }, [activeConv]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createConversation = async () => {
    if (!selectedAgent) return;
    try {
      const data = await apiCall<{ conversation: Conversation }>(`/api/ai/agents/${selectedAgent.slug}/conversations`, { method: 'POST', body: { title: 'New Conversation' } });
      setActiveConv(data.conversation.id);
      setMessages([]);
      await loadConversations(selectedAgent.slug);
    } catch {}
  };

  const deleteConversation = async (id: string) => {
    try {
      await apiCall(`/api/ai/agents/conversations/${id}`, { method: 'DELETE' });
      if (activeConv === id) { setActiveConv(null); setMessages([]); }
      if (selectedAgent) await loadConversations(selectedAgent.slug);
    } catch {}
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeConv || sending) return;
    const msg = input.trim();
    setInput('');
    setSending(true);

    // Optimistic add
    const userMsg: Msg = { id: `temp-${Date.now()}`, role: 'user', content: msg, tokens_used: 0, latency_ms: 0, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const data = await apiCall<{ reply: string; latencyMs: number; tokensUsed?: number; provider?: string; model?: string }>(`/api/ai/agents/conversations/${activeConv}/messages`, { method: 'POST', body: { message: msg } });
      const assistantMsg: Msg = { id: `resp-${Date.now()}`, role: 'assistant', content: data.reply, tokens_used: data.tokensUsed || 0, latency_ms: data.latencyMs, provider_used: data.provider, model_used: data.model, created_at: new Date().toISOString() };
      setMessages(prev => [...prev, assistantMsg]);
      if (selectedAgent) loadConversations(selectedAgent.slug); // Refresh titles
    } catch (e: any) {
      const errMsg: Msg = { id: `err-${Date.now()}`, role: 'assistant', content: `❌ Error: ${e.message}`, tokens_used: 0, latency_ms: 0, created_at: new Date().toISOString() };
      setMessages(prev => [...prev, errMsg]);
    } finally { setSending(false); inputRef.current?.focus(); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /></div>;

  // Agent selection view
  if (!selectedAgent) {
    return (
      <>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>AI Agents</h2>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>5 specialist agents with conversational AI, system awareness, and tool access.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {agents.map(a => (
            <div key={a.id} onClick={() => setSelectedAgent(a)} style={{
              borderRadius: 16, overflow: 'hidden', background: 'var(--bg-card)', border: '1px solid var(--border)',
              cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 10px 30px ${a.accent_color}18`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div style={{ background: `linear-gradient(135deg, ${a.accent_color} 0%, ${a.accent_color}cc 100%)`, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 32 }}>{a.avatar_emoji}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{a.role}</div>
                </div>
              </div>
              <div style={{ padding: '14px 20px' }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 10px' }}>{a.greeting}</p>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {a.capabilities.map(c => <span key={c} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', background: `${a.accent_color}12`, color: a.accent_color, border: `1px solid ${a.accent_color}30` }}>{c.replace(/_/g, ' ')}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  // Chat view
  const color = selectedAgent.accent_color;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 0, height: 'calc(100vh - 180px)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {/* Left: Conversations sidebar */}
      <div style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        {/* Agent header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { setSelectedAgent(null); setActiveConv(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 0 }}>←</button>
          <span style={{ fontSize: 20 }}>{selectedAgent.avatar_emoji}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedAgent.name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{selectedAgent.role}</div>
          </div>
        </div>
        {/* New conversation button */}
        <button onClick={createConversation} style={{ margin: '10px 10px 4px', padding: '8px 12px', borderRadius: 8, border: `1px solid ${color}40`, background: `${color}10`, color, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}><Plus size={12} /> New Chat</button>
        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
          {conversations.map(c => (
            <div key={c.id} onClick={() => setActiveConv(c.id)} style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
              background: activeConv === c.id ? `${color}12` : 'transparent',
              border: activeConv === c.id ? `1px solid ${color}30` : '1px solid transparent',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
                  {c.pinned && <Pin size={8} style={{ color, flexShrink: 0 }} />}
                  {c.title}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{new Date(c.updated_at).toLocaleDateString()}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); deleteConversation(c.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-tertiary)', opacity: 0.4 }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              ><Trash2 size={10} /></button>
            </div>
          ))}
          {conversations.length === 0 && <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: 10, color: 'var(--text-tertiary)' }}>No conversations yet</div>}
        </div>
      </div>

      {/* Right: Chat area */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
        {!activeConv ? (
          // Welcome state
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 40 }}>
            <span style={{ fontSize: 48 }}>{selectedAgent.avatar_emoji}</span>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{selectedAgent.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>{selectedAgent.greeting}</div>
            <button onClick={createConversation} style={{ marginTop: 8, padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`, color: '#fff', fontSize: 12, fontWeight: 700, boxShadow: `0 4px 14px ${color}30` }}>
              <MessageSquare size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Start Conversation
            </button>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {loadingMsgs && <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} /></div>}
              {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', gap: 10, maxWidth: '85%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                  {m.role !== 'user' && <span style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{selectedAgent.avatar_emoji}</span>}
                  <div style={{
                    padding: '12px 16px', borderRadius: 14,
                    background: m.role === 'user' ? color : 'var(--bg-card)',
                    color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                    border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                    fontSize: 13, lineHeight: 1.7, wordBreak: 'break-word',
                    borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                    borderBottomLeftRadius: m.role === 'user' ? 14 : 4,
                  }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    {m.role === 'assistant' && m.latency_ms > 0 && (
                      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 6, display: 'flex', gap: 8 }}>
                        <span>⚡{m.latency_ms}ms</span>
                        {m.tokens_used > 0 && <span>📊 {m.tokens_used} tokens</span>}
                        {m.model_used && <span>🤖 {m.model_used}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 20 }}>{selectedAgent.avatar_emoji}</span>
                  <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderBottomLeftRadius: 4 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: color, animation: `bounce 1.4s infinite ${i * 0.16}s` }} />)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ask ${selectedAgent.name} something...`}
                  rows={1}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border)',
                    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13,
                    resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                    maxHeight: 120, overflowY: 'auto',
                  }}
                  onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !input.trim()}
                  style={{
                    width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: input.trim() ? `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)` : 'var(--bg-app)',
                    color: input.trim() ? '#fff' : 'var(--text-tertiary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: sending ? 0.5 : 1, flexShrink: 0, transition: 'all 0.15s',
                  }}
                >
                  {sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
      `}</style>
    </div>
  );
}
