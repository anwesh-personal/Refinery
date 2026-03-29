import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import {
  Send, Loader2, MessageSquare, Plus, Trash2, Pin, X,
  Save, BookOpen, Sliders, MessageCircle, FileText, Copy, Check
} from 'lucide-react';
import MarkdownRenderer, { MARKDOWN_STYLES } from './MarkdownRenderer';

// ── Types ──
interface Agent {
  id: string; slug: string; name: string; role: string; avatar_emoji: string;
  accent_color: string; greeting: string; capabilities: string[]; enabled: boolean;
  system_prompt?: string; temperature?: number; max_tokens?: number;
  custom_instructions?: string; avatar_url?: string;
  provider_id?: string | null; model_id?: string;
}
interface ProviderOption { id: string; label: string; provider_type: string; selected_model: string; cached_models: string[] }
interface Conversation { id: string; title: string; pinned: boolean; created_at: string; updated_at: string }
interface Msg { id: string; role: string; content: string; tokens_used: number; latency_ms: number; provider_used?: string; model_used?: string; created_at: string }
interface KBEntry { id: string; agent_id: string; title: string; content: string; category: string; enabled: boolean; priority: number }

const AGENT_IMAGES: Record<string, string> = {
  data_scientist: '/agents/cipher.png', smtp_specialist: '/agents/sentinel.png',
  email_marketer: '/agents/calliope.png', supervisor: '/agents/crucible.png',
  verification_engineer: '/agents/argus.png',
};

/** Get the agent's display image — custom avatar_url takes priority, then hardcoded fallback */
function getAgentImage(agent: { slug: string; avatar_url?: string }): string {
  return agent.avatar_url || AGENT_IMAGES[agent.slug] || '';
}

const KB_CATEGORIES = ['general', 'instructions', 'examples', 'data', 'reference'];

const AGENT_META: Record<string, { pages: string[]; description: string; dataAccess: string[]; examples: string[] }> = {
  data_scientist: {
    pages: ['Database', 'Segments'],
    description: 'Analyzes your ClickHouse database — schema, column distributions, row counts, and filter state. Lives as a card on the Database page and auto-receives your table metadata.',
    dataAccess: ['ClickHouse schema', 'Table stats', 'Column metadata', 'Active filters', 'Visible columns'],
    examples: ['Analyze the data quality of this table', 'Find patterns in my lead data', 'Suggest segments based on industry and seniority', 'Build an ICP from top-performing leads'],
  },
  smtp_specialist: {
    pages: ['Config', 'MTA & Swarm'],
    description: 'Guards your infrastructure. Sees your configured servers, their connection status, ping history, and system settings. Lives on Config page and helps troubleshoot connectivity and deliverability.',
    dataAccess: ['Server configs', 'Connection status', 'Ping history', 'System settings', 'DNS records'],
    examples: ['Check the health of all my servers', 'Analyze DNS for deliverability issues', 'IP warmup plan for new satellites', 'Troubleshoot MTA configuration'],
  },
  email_marketer: {
    pages: ['Targets', 'Queue'],
    description: 'Your creative marketing strategist. Sees your target lists, segment composition, and audience profiles. Lives on the Targets page and helps craft campaigns, write copy, and optimize send strategies.',
    dataAccess: ['Target lists', 'Segment composition', 'Audience profiles', 'Email counts', 'Niche tags'],
    examples: ['Write a 5-email cold outreach sequence', 'Subject line ideas for SaaS CTOs', 'Campaign strategy for this niche', 'Optimize send timing for 50K emails'],
  },
  supervisor: {
    pages: ['Dashboard'],
    description: 'The all-seeing supervisor with the widest context. Sees total records, storage usage, ingestion trends, verification trends, top segments, and the activity feed. Lives on the Dashboard.',
    dataAccess: ['All statistics', 'Ingestion trends (7d)', 'Verification trends (7d)', 'Top segments', 'Activity feed'],
    examples: ['Give me a daily briefing', 'What should I prioritize today?', 'ROI analysis of the verification pipeline', 'Strategic recommendations for scaling'],
  },
  verification_engineer: {
    pages: ['Verification'],
    description: 'The verification expert. Appears on the Verification page after a job finishes. Auto-receives complete job data: file name, total/processed counts, suppression results, and timestamps.',
    dataAccess: ['Job results', 'Suppression breakdown', 'Domain analysis', 'Bounce patterns', 'Timestamps'],
    examples: ['Analyze these verification results', 'Which domains are catch-all?', 'Recommend which unknowns to retry', 'Risk assessment for this batch'],
  },
};

export default function AgentsPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showModal, setShowModal] = useState(false);
  // Chat state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  // Modal state
  const [modalTab, setModalTab] = useState<'core' | 'prompts' | 'kb' | 'config'>('core');
  const [agentDetails, setAgentDetails] = useState<Agent | null>(null);
  const [kbEntries, setKBEntries] = useState<KBEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editGreeting, setEditGreeting] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editTemp, setEditTemp] = useState(0.5);
  const [editMaxTokens, setEditMaxTokens] = useState(4096);
  const [editProviderId, setEditProviderId] = useState<string>('');
  const [editModelId, setEditModelId] = useState<string>('');
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editAccentColor, setEditAccentColor] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newKBTitle, setNewKBTitle] = useState('');
  const [newKBContent, setNewKBContent] = useState('');
  const [newKBCategory, setNewKBCategory] = useState('general');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load agents
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ agents: Agent[] }>('/api/ai/agents');
        setAgents(data.agents || []);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  // Open modal
  const openModal = async (agent: Agent) => {
    setSelectedAgent(agent);
    setModalTab('core');
    setShowModal(true);
    // Fetch full agent details
    try {
      const data = await apiCall<{ agents: Agent[] }>('/api/ai/agents/admin/all');
      const full = (data.agents || []).find(a => a.id === agent.id);
      if (full) {
        setAgentDetails(full);
        setEditPrompt(full.system_prompt || '');
        setEditGreeting(full.greeting || '');
        setEditInstructions(full.custom_instructions || '');
        setEditTemp(parseFloat(String(full.temperature)) || 0.5);
        setEditMaxTokens(full.max_tokens || 4096);
        setEditProviderId(full.provider_id || '');
        setEditModelId(full.model_id || '');
        setEditName(full.name || '');
        setEditRole(full.role || '');
        setEditAccentColor(full.accent_color || 'var(--purple)');
        setEditAvatarUrl(full.avatar_url || '');
      }
    } catch {}
    // Fetch providers for override selector
    try {
      const pData = await apiCall<{ providers: ProviderOption[] }>('/api/ai/providers');
      setProviders((pData.providers || []).filter(p => p.selected_model));
    } catch {}
    // Fetch KB
    try {
      const kb = await apiCall<{ entries: KBEntry[] }>(`/api/ai/agents/admin/${agent.id}/knowledge`);
      setKBEntries(kb.entries || []);
    } catch {}
  };

  const closeModal = () => { setShowModal(false); setAgentDetails(null); setKBEntries([]); };

  const saveAgent = async () => {
    if (!agentDetails) return;
    setSaving(true);
    try {
      await apiCall(`/api/ai/agents/admin/${agentDetails.id}`, {
        method: 'PUT',
        body: {
          system_prompt: editPrompt, greeting: editGreeting,
          custom_instructions: editInstructions, temperature: editTemp,
          max_tokens: editMaxTokens,
          provider_id: editProviderId || null,
          model_id: editModelId || '',
          name: editName, role: editRole, accent_color: editAccentColor,
          avatar_url: editAvatarUrl || null,
        },
      });
      // Refresh
      const data = await apiCall<{ agents: Agent[] }>('/api/ai/agents');
      setAgents(data.agents || []);
    } catch {} finally { setSaving(false); }
  };

  const addKBEntry = async () => {
    if (!agentDetails || !newKBTitle.trim() || !newKBContent.trim()) return;
    try {
      await apiCall(`/api/ai/agents/admin/${agentDetails.id}/knowledge`, {
        method: 'POST', body: { title: newKBTitle, content: newKBContent, category: newKBCategory },
      });
      const kb = await apiCall<{ entries: KBEntry[] }>(`/api/ai/agents/admin/${agentDetails.id}/knowledge`);
      setKBEntries(kb.entries || []);
      setNewKBTitle(''); setNewKBContent(''); setNewKBCategory('general');
    } catch {}
  };

  const deleteKBEntry = async (id: string) => {
    if (!agentDetails) return;
    try {
      await apiCall(`/api/ai/agents/admin/knowledge/${id}`, { method: 'DELETE' });
      setKBEntries(prev => prev.filter(e => e.id !== id));
    } catch {}
  };

  const toggleKBEntry = async (entry: KBEntry) => {
    try {
      await apiCall(`/api/ai/agents/admin/knowledge/${entry.id}`, { method: 'PUT', body: { enabled: !entry.enabled } });
      setKBEntries(prev => prev.map(e => e.id === entry.id ? { ...e, enabled: !e.enabled } : e));
    } catch {}
  };

  // Chat functions
  const loadConversations = useCallback(async (slug: string) => {
    try {
      const data = await apiCall<{ conversations: Conversation[] }>(`/api/ai/agents/${slug}/conversations`);
      setConversations(data.conversations || []);
    } catch {}
  }, []);

  const startChat = () => {
    setShowModal(false);
    if (selectedAgent) loadConversations(selectedAgent.slug);
  };

  useEffect(() => { if (selectedAgent && !showModal) loadConversations(selectedAgent.slug); }, [selectedAgent, showModal, loadConversations]);

  useEffect(() => {
    if (!activeConv) { setMessages([]); return; }
    (async () => {
      setLoadingMsgs(true);
      try { const data = await apiCall<{ messages: Msg[] }>(`/api/ai/agents/conversations/${activeConv}/messages`); setMessages(data.messages || []); } catch {}
      finally { setLoadingMsgs(false); }
    })();
  }, [activeConv]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const createConversation = async () => {
    if (!selectedAgent) return;
    try {
      const data = await apiCall<{ conversation: Conversation }>(`/api/ai/agents/${selectedAgent.slug}/conversations`, { method: 'POST', body: { title: 'New Conversation' } });
      setActiveConv(data.conversation.id); setMessages([]);
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
    const msg = input.trim(); setInput(''); setSending(true);
    const userMsg: Msg = { id: `t-${Date.now()}`, role: 'user', content: msg, tokens_used: 0, latency_ms: 0, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    try {
      const data = await apiCall<{ reply: string; latencyMs: number; tokensUsed?: number; provider?: string; model?: string }>(`/api/ai/agents/conversations/${activeConv}/messages`, { method: 'POST', body: { message: msg } });
      setMessages(prev => [...prev, { id: `r-${Date.now()}`, role: 'assistant', content: data.reply, tokens_used: data.tokensUsed || 0, latency_ms: data.latencyMs, provider_used: data.provider, model_used: data.model, created_at: new Date().toISOString() }]);
      if (selectedAgent) loadConversations(selectedAgent.slug);
    } catch (e: any) {
      setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: `❌ ${e.message}`, tokens_used: 0, latency_ms: 0, created_at: new Date().toISOString() }]);
    } finally { setSending(false); inputRef.current?.focus(); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /></div>;

  const color = selectedAgent?.accent_color || 'var(--purple)';

  // ═══ Agent Selection Grid ═══
  if (!selectedAgent || showModal) {
    return (
      <>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>AI Agents</h2>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>5 specialist agents. Click to configure or chat.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
          {agents.map(a => {
            const meta = AGENT_META[a.slug];
            return (
            <div key={a.id} onClick={() => openModal(a)} style={{
              borderRadius: 18, overflow: 'hidden', background: 'var(--bg-card)',
              border: '1px solid var(--border)', cursor: 'pointer',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              {/* Header */}
              <div style={{ background: `linear-gradient(135deg, ${a.accent_color} 0%, ${a.accent_color}cc 100%)`, padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <img src={getAgentImage(a)} alt={a.name} style={{
                  width: 64, height: 64, borderRadius: 16, objectFit: 'cover',
                  border: '3px solid rgba(255,255,255,0.25)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--accent-contrast, #fff)' }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{a.role}</div>
                  {meta && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                      {meta.pages.map(p => (
                        <span key={p} style={{
                          fontSize: 8, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                          background: 'rgba(255,255,255,0.15)', color: 'var(--accent-contrast, #fff)',
                        }}>📍 {p}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: '18px 22px' }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 14px' }}>
                  {meta?.description || a.greeting}
                </p>

                {/* What it sees */}
                {meta && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      🔍 What it sees (auto-injected)
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {meta.dataAccess.map(d => (
                        <span key={d} style={{
                          padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 600,
                          background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                        }}>{d}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Example Questions */}
                {meta && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      💬 Example questions
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {meta.examples.map((q, i) => (
                        <div key={i} style={{
                          padding: '6px 10px', borderRadius: 8, fontSize: 11, color: 'var(--text-primary)',
                          background: 'var(--bg-hover)', border: '1px solid var(--border)',
                          fontStyle: 'italic',
                        }}>"{q}"</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Capabilities */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    ⚡ Capabilities
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {a.capabilities.map(c => (
                      <span key={c} style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 8, fontWeight: 700,
                        textTransform: 'uppercase',
                        background: 'var(--accent-muted)', color: 'var(--accent)',
                        border: '1px solid var(--accent-muted)',
                      }}>{c.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );})}
        </div>

        {/* ═══ AGENT MANAGEMENT MODAL ═══ */}
        {showModal && agentDetails && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }} onClick={closeModal}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)', width: '100%', maxWidth: 800, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
              {/* Modal Header */}
              <div style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src={getAgentImage(agentDetails)} alt={agentDetails.name} style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-contrast, #fff)' }}>{agentDetails.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{agentDetails.role}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={startChat} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.2)', color: 'var(--accent-contrast, #fff)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><MessageCircle size={13} /> Chat</button>
                  <button onClick={closeModal} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, padding: '6px', cursor: 'pointer', color: 'var(--accent-contrast, #fff)' }}><X size={18} /></button>
                </div>
              </div>

              {/* Modal Tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-app)' }}>
                {([
                  { key: 'core', label: 'Core Prompt', icon: FileText },
                  { key: 'prompts', label: 'Prompt Stack', icon: Sliders },
                  { key: 'kb', label: 'Knowledge Base', icon: BookOpen },
                  { key: 'config', label: 'Settings', icon: Sliders },
                ] as const).map(t => (
                  <button key={t.key} onClick={() => setModalTab(t.key)} style={{
                    padding: '10px 18px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    background: modalTab === t.key ? 'var(--bg-card)' : 'transparent',
                    color: modalTab === t.key ? color : 'var(--text-tertiary)',
                    borderBottom: modalTab === t.key ? `2px solid ${color}` : '2px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}><t.icon size={12} /> {t.label}</button>
                ))}
              </div>

              {/* Modal Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

                {/* CORE PROMPT TAB */}
                {modalTab === 'core' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>System Prompt (Core Personality & Expertise)</label>
                      <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={16} style={{
                        width: '100%', padding: 14, borderRadius: 10, border: '1px solid var(--border)',
                        background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
                        fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box',
                      }} />
                      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 4 }}>{editPrompt.length} chars — Defines personality, demeanour, expertise, and behavior rules</div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>Greeting Message</label>
                      <textarea value={editGreeting} onChange={e => setEditGreeting(e.target.value)} rows={3} style={{
                        width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--border)',
                        background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
                        fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box',
                      }} />
                    </div>
                    <button onClick={saveAgent} disabled={saving} style={{
                      alignSelf: 'flex-end', padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: `linear-gradient(135deg, ${color} 0%, color-mix(in srgb, ${color} 80%, transparent) 100%)`, color: 'var(--accent-contrast, #fff)',
                      fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: saving ? 0.6 : 1,
                    }}><Save size={13} /> {saving ? 'Saving...' : 'Save Core Prompt'}</button>
                  </div>
                )}

                {/* PROMPT STACK TAB (Custom Instructions) */}
                {modalTab === 'prompts' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ padding: 14, borderRadius: 10, background: `color-mix(in srgb, ${color} 8%, var(--bg-app))`, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: color, marginBottom: 4 }}>How Prompt Stack Works</div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Custom instructions are injected AFTER the core prompt but BEFORE the conversation context. Use this to add project-specific rules, constraints, or personality tweaks without modifying the core prompt.</div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>Custom Instructions (appended to core prompt)</label>
                      <textarea value={editInstructions} onChange={e => setEditInstructions(e.target.value)} rows={12} placeholder="Add custom rules, constraints, or instructions here...\n\nExamples:\n- Always respond in bullet points\n- Reference our company policies when giving advice\n- Use a maximum of 3 paragraphs per response" style={{
                        width: '100%', padding: 14, borderRadius: 10, border: '1px solid var(--border)',
                        background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
                        fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box',
                      }} />
                      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 4 }}>{editInstructions.length} chars</div>
                    </div>
                    <button onClick={saveAgent} disabled={saving} style={{
                      alignSelf: 'flex-end', padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: `linear-gradient(135deg, ${color} 0%, color-mix(in srgb, ${color} 80%, transparent) 100%)`, color: 'var(--accent-contrast, #fff)',
                      fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: saving ? 0.6 : 1,
                    }}><Save size={13} /> {saving ? 'Saving...' : 'Save Instructions'}</button>
                  </div>
                )}

                {/* KNOWLEDGE BASE TAB */}
                {modalTab === 'kb' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ padding: 14, borderRadius: 10, background: `color-mix(in srgb, ${color} 8%, var(--bg-app))`, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: color, marginBottom: 4 }}>Knowledge Base</div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>KB entries are injected as context in every conversation. The agent references this knowledge when answering. Higher priority entries are injected first.</div>
                    </div>

                    {/* Add new KB entry */}
                    <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Add Knowledge Entry</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input value={newKBTitle} onChange={e => setNewKBTitle(e.target.value)} placeholder="Title" style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                        <select value={newKBCategory} onChange={e => setNewKBCategory(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 11 }}>
                          {KB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <textarea value={newKBContent} onChange={e => setNewKBContent(e.target.value)} rows={4} placeholder="Knowledge content..." style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }} />
                      <button onClick={addKBEntry} disabled={!newKBTitle.trim() || !newKBContent.trim()} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: color, color: 'var(--accent-contrast, #fff)', fontSize: 11, fontWeight: 700, opacity: !newKBTitle.trim() || !newKBContent.trim() ? 0.4 : 1 }}><Plus size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />Add Entry</button>
                    </div>

                    {/* Existing entries */}
                    {kbEntries.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 11 }}>No knowledge entries yet</div>}
                    {kbEntries.map(entry => (
                      <div key={entry.id} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: entry.enabled ? 'var(--bg-card)' : 'var(--bg-app)', opacity: entry.enabled ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: `color-mix(in srgb, ${color} 15%, var(--bg-elevated))`, color }}>{entry.category}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{entry.title}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => toggleKBEntry(entry)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: entry.enabled ? `color-mix(in srgb, ${color} 15%, var(--bg-elevated))` : 'var(--bg-app)', color: entry.enabled ? color : 'var(--text-tertiary)', fontSize: 9, fontWeight: 600, cursor: 'pointer' }}>{entry.enabled ? 'ON' : 'OFF'}</button>
                            <button onClick={() => deleteKBEntry(entry.id)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--red)', fontSize: 9, cursor: 'pointer' }}><Trash2 size={10} /></button>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{entry.content}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* CONFIG TAB */}
                {modalTab === 'config' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Identity */}
                    <div style={{ padding: 16, background: 'var(--bg-app)', borderRadius: 12, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 10 }}>Identity</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Name</label>
                          <input value={editName} onChange={e => setEditName(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Role</label>
                          <input value={editRole} onChange={e => setEditRole(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, boxSizing: 'border-box' }} />
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Accent Color</label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input type="color" value={editAccentColor} onChange={e => setEditAccentColor(e.target.value)} style={{ width: 36, height: 36, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'transparent' }} />
                          <input value={editAccentColor} onChange={e => setEditAccentColor(e.target.value)} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 11, fontFamily: 'monospace', boxSizing: 'border-box' }} />
                          <div style={{ width: 80, height: 36, borderRadius: 8, background: `linear-gradient(135deg, ${editAccentColor} 0%, ${editAccentColor}cc 100%)` }} />
                        </div>
                      </div>

                      {/* Avatar Image */}
                      <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Avatar Image</label>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <img
                            src={editAvatarUrl || AGENT_IMAGES[agentDetails?.slug || ''] || ''}
                            alt="Preview"
                            style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '2px solid var(--border)', flexShrink: 0 }}
                            onError={(e) => { (e.target as HTMLImageElement).src = AGENT_IMAGES[agentDetails?.slug || ''] || ''; }}
                          />
                          <div style={{ flex: 1 }}>
                            <input
                              value={editAvatarUrl}
                              onChange={e => setEditAvatarUrl(e.target.value)}
                              placeholder="Paste image URL or leave blank for default"
                              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 11, boxSizing: 'border-box' }}
                            />
                            <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginTop: 3 }}>Paste any direct image URL. Clear to revert to default.</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Generation Params */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>Temperature ({editTemp})</label>
                        <input type="range" min="0" max="1" step="0.05" value={editTemp} onChange={e => setEditTemp(parseFloat(e.target.value))} style={{ width: '100%' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-tertiary)' }}><span>Precise</span><span>Creative</span></div>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>Max Tokens</label>
                        <input type="number" value={editMaxTokens} onChange={e => setEditMaxTokens(parseInt(e.target.value) || 4096)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>Capabilities (comma-separated tool slugs)</label>
                      <input value={(agentDetails?.capabilities || []).join(', ')} readOnly style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-secondary)', fontSize: 12, boxSizing: 'border-box' }} />
                    </div>

                    {/* Provider/Model Override */}
                    <div style={{ padding: 16, background: 'var(--bg-app)', borderRadius: 12, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>AI Provider & Model</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                        Leave as "System Default" to inherit from AI Settings. Override to give this agent a specific model.
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Provider</label>
                          <select value={editProviderId} onChange={e => {
                            setEditProviderId(e.target.value);
                            const prov = providers.find(p => p.id === e.target.value);
                            setEditModelId(prov?.selected_model || '');
                          }} style={{
                            width: '100%', padding: '8px 12px', borderRadius: 8,
                            border: '1px solid var(--border)', background: 'var(--bg-input)',
                            color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer',
                          }}>
                            <option value="">🔄 System Default (cascaded)</option>
                            {providers.map(p => (
                              <option key={p.id} value={p.id}>{p.label} ({p.provider_type})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Model</label>
                          <select value={editModelId} onChange={e => setEditModelId(e.target.value)} disabled={!editProviderId} style={{
                            width: '100%', padding: '8px 12px', borderRadius: 8,
                            border: '1px solid var(--border)', background: editProviderId ? 'var(--bg-input)' : 'var(--bg-app)',
                            color: editProviderId ? 'var(--text-primary)' : 'var(--text-tertiary)',
                            fontSize: 12, cursor: editProviderId ? 'pointer' : 'default',
                          }}>
                            <option value="">Auto (provider default)</option>
                            {(providers.find(p => p.id === editProviderId)?.cached_models || []).map((m: string) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {!editProviderId && (
                        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>
                          ℹ️ Inheriting from system default. All agents share the same provider unless overridden.
                        </div>
                      )}
                    </div>

                    <button onClick={saveAgent} disabled={saving} style={{
                      alignSelf: 'flex-end', padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: `linear-gradient(135deg, ${color} 0%, color-mix(in srgb, ${color} 80%, transparent) 100%)`, color: 'var(--accent-contrast, #fff)',
                      fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: saving ? 0.6 : 1,
                    }}><Save size={13} /> {saving ? 'Saving...' : 'Save Settings'}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  // ═══ Chat View ═══
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 0, height: 'calc(100vh - 180px)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {/* Left sidebar */}
      <div style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { setSelectedAgent(null); setActiveConv(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 0, color: 'var(--text-secondary)' }}>←</button>
          <img src={getAgentImage(selectedAgent)} alt="" style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedAgent.name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{selectedAgent.role}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '8px 10px 4px' }}>
          <button onClick={createConversation} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: `color-mix(in srgb, ${color} 12%, var(--bg-elevated))`, color: 'var(--text-primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}><Plus size={12} /> New Chat</button>
          <button onClick={() => openModal(selectedAgent)} style={{ padding: '8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-tertiary)', cursor: 'pointer' }}><Sliders size={12} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
          {conversations.map(c => (
            <div key={c.id} onClick={() => setActiveConv(c.id)} style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
              background: activeConv === c.id ? `color-mix(in srgb, ${color} 12%, var(--bg-elevated))` : 'transparent',
              border: activeConv === c.id ? '1px solid var(--border-hover)' : '1px solid transparent',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
                  {c.pinned && <Pin size={8} style={{ color, flexShrink: 0 }} />}{c.title}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{new Date(c.updated_at).toLocaleDateString()}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); deleteConversation(c.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-tertiary)', opacity: 0.4 }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--red)'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              ><Trash2 size={10} /></button>
            </div>
          ))}
          {conversations.length === 0 && <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: 10, color: 'var(--text-tertiary)' }}>No conversations yet</div>}
        </div>
      </div>

      {/* Right: Chat */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
        {!activeConv ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 40 }}>
            <img src={getAgentImage(selectedAgent)} alt="" style={{ width: 80, height: 80, borderRadius: 16, objectFit: 'cover', border: '3px solid var(--border)' }} />
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{selectedAgent.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>{selectedAgent.greeting}</div>
            <button onClick={createConversation} style={{ marginTop: 8, padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${color} 0%, color-mix(in srgb, ${color} 80%, transparent) 100%)`, color: 'var(--accent-contrast, #fff)', fontSize: 12, fontWeight: 700, boxShadow: 'var(--shadow-md)' }}>
              <MessageSquare size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Start Conversation
            </button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {loadingMsgs && <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} /></div>}
              {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', gap: 10, maxWidth: m.role === 'user' ? '80%' : '95%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                  {m.role !== 'user' && <img src={getAgentImage(selectedAgent)} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover', flexShrink: 0, marginTop: 2 }} />}
                  <div style={{
                    padding: m.role === 'user' ? '12px 16px' : '14px 18px', borderRadius: 14,
                    background: m.role === 'user' ? `color-mix(in srgb, ${color} 18%, var(--bg-elevated))` : 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: m.role === 'user' ? `1px solid ${color}35` : '1px solid var(--border)',
                    fontSize: 13, lineHeight: 1.7, wordBreak: 'break-word',
                    borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                    borderBottomLeftRadius: m.role === 'user' ? 14 : 4,
                  }}>
                    {m.role === 'user' ? (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    ) : (
                      <MarkdownRenderer content={m.content} />
                    )}
                    {m.role === 'assistant' && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', display: 'flex', gap: 8 }}>
                          {m.latency_ms > 0 && <span>⚡{m.latency_ms}ms</span>}
                          {m.tokens_used > 0 && <span>📊 {m.tokens_used} tokens</span>}
                          {m.model_used && <span>🤖 {m.model_used}</span>}
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(m.content); setCopiedId(m.id); setTimeout(() => setCopiedId(null), 1500); }} style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                          color: copiedId === m.id ? 'var(--green)' : 'var(--text-tertiary)', fontSize: 10,
                          display: 'flex', alignItems: 'center', gap: 3,
                        }}>
                          {copiedId === m.id ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <img src={getAgentImage(selectedAgent)} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }} />
                  <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderBottomLeftRadius: 4 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: color, animation: `bounce 1.4s infinite ${i * 0.16}s` }} />)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={`Ask ${selectedAgent.name} something...`} rows={1}
                  style={{ flex: 1, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto' }}
                  onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
                />
                <button onClick={sendMessage} disabled={sending || !input.trim()} style={{
                  width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: input.trim() ? `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)` : 'var(--bg-app)',
                  color: input.trim() ? 'var(--accent-contrast, #fff)' : 'var(--text-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: sending ? 0.5 : 1, flexShrink: 0,
                }}>{sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}</button>
              </div>
            </div>
          </>
        )}
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-5px); } }
        ${MARKDOWN_STYLES}
      `}</style>
    </div>
  );
}
