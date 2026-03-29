import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import {
  Send, Loader2, MessageSquare, Plus, Trash2, Pin, X,
  Save, BookOpen, Sliders, MessageCircle, FileText
} from 'lucide-react';

// ── Types ──
interface Agent {
  id: string; slug: string; name: string; role: string; avatar_emoji: string;
  accent_color: string; greeting: string; capabilities: string[]; enabled: boolean;
  system_prompt?: string; temperature?: number; max_tokens?: number;
  custom_instructions?: string; avatar_url?: string;
}
interface Conversation { id: string; title: string; pinned: boolean; created_at: string; updated_at: string }
interface Msg { id: string; role: string; content: string; tokens_used: number; latency_ms: number; provider_used?: string; model_used?: string; created_at: string }
interface KBEntry { id: string; agent_id: string; title: string; content: string; category: string; enabled: boolean; priority: number }

const AGENT_IMAGES: Record<string, string> = {
  data_scientist: '/agents/cortex.png', smtp_specialist: '/agents/bastion.png',
  email_marketer: '/agents/muse.png', supervisor: '/agents/overseer.png',
  verification_engineer: '/agents/litmus.png',
};

const KB_CATEGORIES = ['general', 'instructions', 'examples', 'data', 'reference'];

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
      }
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
        body: { system_prompt: editPrompt, greeting: editGreeting, custom_instructions: editInstructions, temperature: editTemp, max_tokens: editMaxTokens },
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

  const color = selectedAgent?.accent_color || '#8b5cf6';

  // ═══ Agent Selection Grid ═══
  if (!selectedAgent || showModal) {
    return (
      <>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>AI Agents</h2>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>5 specialist agents. Click to configure or chat.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {agents.map(a => (
            <div key={a.id} onClick={() => openModal(a)} style={{
              borderRadius: 16, overflow: 'hidden', background: 'var(--bg-card)', border: '1px solid var(--border)',
              cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 10px 30px ${a.accent_color}18`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <div style={{ background: `linear-gradient(135deg, ${a.accent_color} 0%, ${a.accent_color}cc 100%)`, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 12, minHeight: 80 }}>
                <img src={AGENT_IMAGES[a.slug] || ''} alt={a.name} style={{ width: 60, height: 60, borderRadius: 14, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} />
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

        {/* ═══ AGENT MANAGEMENT MODAL ═══ */}
        {showModal && agentDetails && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }} onClick={closeModal}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)', width: '100%', maxWidth: 800, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: `0 25px 60px ${color}15` }}>
              {/* Modal Header */}
              <div style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src={AGENT_IMAGES[agentDetails.slug] || ''} alt={agentDetails.name} style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{agentDetails.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{agentDetails.role}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={startChat} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><MessageCircle size={13} /> Chat</button>
                  <button onClick={closeModal} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, padding: '6px', cursor: 'pointer', color: '#fff' }}><X size={18} /></button>
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
                      background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`, color: '#fff',
                      fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: saving ? 0.6 : 1,
                    }}><Save size={13} /> {saving ? 'Saving...' : 'Save Core Prompt'}</button>
                  </div>
                )}

                {/* PROMPT STACK TAB (Custom Instructions) */}
                {modalTab === 'prompts' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ padding: 14, borderRadius: 10, background: `${color}08`, border: `1px solid ${color}20` }}>
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
                      background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`, color: '#fff',
                      fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, opacity: saving ? 0.6 : 1,
                    }}><Save size={13} /> {saving ? 'Saving...' : 'Save Instructions'}</button>
                  </div>
                )}

                {/* KNOWLEDGE BASE TAB */}
                {modalTab === 'kb' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ padding: 14, borderRadius: 10, background: `${color}08`, border: `1px solid ${color}20` }}>
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
                      <button onClick={addKBEntry} disabled={!newKBTitle.trim() || !newKBContent.trim()} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: color, color: '#fff', fontSize: 11, fontWeight: 700, opacity: !newKBTitle.trim() || !newKBContent.trim() ? 0.4 : 1 }}><Plus size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />Add Entry</button>
                    </div>

                    {/* Existing entries */}
                    {kbEntries.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 11 }}>No knowledge entries yet</div>}
                    {kbEntries.map(entry => (
                      <div key={entry.id} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: entry.enabled ? 'var(--bg-card)' : 'var(--bg-app)', opacity: entry.enabled ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: `${color}15`, color }}>{entry.category}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{entry.title}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => toggleKBEntry(entry)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: entry.enabled ? `${color}15` : 'var(--bg-app)', color: entry.enabled ? color : 'var(--text-tertiary)', fontSize: 9, fontWeight: 600, cursor: 'pointer' }}>{entry.enabled ? 'ON' : 'OFF'}</button>
                            <button onClick={() => deleteKBEntry(entry.id)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-app)', color: '#ef4444', fontSize: 9, cursor: 'pointer' }}><Trash2 size={10} /></button>
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
                    <button onClick={saveAgent} disabled={saving} style={{
                      alignSelf: 'flex-end', padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`, color: '#fff',
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
          <img src={AGENT_IMAGES[selectedAgent.slug]} alt="" style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedAgent.name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{selectedAgent.role}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '8px 10px 4px' }}>
          <button onClick={createConversation} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${color}40`, background: `${color}10`, color, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}><Plus size={12} /> New Chat</button>
          <button onClick={() => openModal(selectedAgent)} style={{ padding: '8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-tertiary)', cursor: 'pointer' }}><Sliders size={12} /></button>
        </div>
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
                  {c.pinned && <Pin size={8} style={{ color, flexShrink: 0 }} />}{c.title}
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

      {/* Right: Chat */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
        {!activeConv ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 40 }}>
            <img src={AGENT_IMAGES[selectedAgent.slug]} alt="" style={{ width: 80, height: 80, borderRadius: 16, objectFit: 'cover', border: `3px solid ${color}40` }} />
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{selectedAgent.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>{selectedAgent.greeting}</div>
            <button onClick={createConversation} style={{ marginTop: 8, padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`, color: '#fff', fontSize: 12, fontWeight: 700, boxShadow: `0 4px 14px ${color}30` }}>
              <MessageSquare size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Start Conversation
            </button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {loadingMsgs && <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} /></div>}
              {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', gap: 10, maxWidth: '85%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                  {m.role !== 'user' && <img src={AGENT_IMAGES[selectedAgent.slug]} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover', flexShrink: 0, marginTop: 2 }} />}
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
                  <img src={AGENT_IMAGES[selectedAgent.slug]} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }} />
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
                  color: input.trim() ? '#fff' : 'var(--text-tertiary)',
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
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
      `}</style>
    </div>
  );
}
