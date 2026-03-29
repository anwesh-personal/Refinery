import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, ChevronDown, ChevronUp, Sparkles, Copy, Check, Download } from 'lucide-react';
import { apiCall } from '../lib/api';
import MarkdownRenderer, { MARKDOWN_STYLES } from './MarkdownRenderer';

/**
 * AgentCard — Tall, theme-aware, embeddable AI agent card.
 * Drop this on any page to surface a specific agent contextually.
 *
 * Usage:
 *   <AgentCard slug="verification_engineer" context={{ jobId: '...', results: {...} }} />
 */

interface AgentCardProps {
  slug: string;                   // Agent slug (e.g. 'verification_engineer')
  context?: Record<string, any>;  // Page-specific context to inject
  contextLabel?: string;          // What the agent is analyzing (e.g. "Verification Job #abc")
  compact?: boolean;              // Start collapsed
}

interface Agent {
  id: string; slug: string; name: string; role: string; avatar_emoji: string;
  accent_color: string; greeting: string; capabilities: string[];
}

interface Msg { id: string; role: string; content: string; tokens_used: number; latency_ms: number; model_used?: string; created_at: string }

const AGENT_IMAGES: Record<string, string> = {
  data_scientist: '/agents/cortex.png', smtp_specialist: '/agents/bastion.png',
  email_marketer: '/agents/muse.png', supervisor: '/agents/overseer.png',
  verification_engineer: '/agents/litmus.png',
};

const QUICK_PROMPTS: Record<string, string[]> = {
  verification_engineer: ['Analyze these verification results', 'Which domains are catch-all?', 'Recommend which unknowns to retry', 'Risk assessment for this batch'],
  data_scientist: ['Analyze this data', 'Find patterns and anomalies', 'Suggest data quality improvements', 'Build an ICP from this'],
  smtp_specialist: ['Check DNS health', 'Analyze bounce patterns', 'Review MTA configuration', 'IP warmup recommendations'],
  email_marketer: ['Write cold outreach sequence', 'Optimize send timing', 'Subject line ideas', 'Campaign strategy for this audience'],
  supervisor: ['Daily briefing', 'Strategic recommendations', 'What should I prioritize?', 'ROI analysis across everything'],
};

export default function AgentCard({ slug, context, contextLabel, compact = true }: AgentCardProps) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [expanded, setExpanded] = useState(!compact);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load agent
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ agents: Agent[] }>('/api/ai/agents');
        const found = (data.agents || []).find(a => a.slug === slug);
        if (found) setAgent(found);
      } catch {} finally { setLoading(false); }
    })();
  }, [slug]);

  // Auto-scroll
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const ensureConversation = async (): Promise<string | null> => {
    if (convId) return convId;
    if (!agent) return null;
    try {
      const title = contextLabel || 'Contextual Analysis';
      const data = await apiCall<{ conversation: { id: string } }>(`/api/ai/agents/${agent.slug}/conversations`, { method: 'POST', body: { title } });
      const id = data.conversation.id;
      setConvId(id);

      // If we have context, inject it as a system-level first message
      if (context) {
        const contextMsg = `Here is the context data for this analysis:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
        await apiCall(`/api/ai/agents/conversations/${id}/messages`, { method: 'POST', body: { message: contextMsg } });
        // Fetch messages to show the AI's initial analysis
        const msgs = await apiCall<{ messages: Msg[] }>(`/api/ai/agents/conversations/${id}/messages`);
        setMessages(msgs.messages || []);
      }
      return id;
    } catch { return null; }
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || sending) return;
    if (!text) setInput('');
    setSending(true);

    const userMsg: Msg = { id: `t-${Date.now()}`, role: 'user', content: msg, tokens_used: 0, latency_ms: 0, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const cid = await ensureConversation();
      if (!cid) throw new Error('Failed to create conversation');
      const data = await apiCall<{ reply: string; latencyMs: number; tokensUsed?: number; model?: string }>(`/api/ai/agents/conversations/${cid}/messages`, { method: 'POST', body: { message: msg } });
      setMessages(prev => [...prev, { id: `r-${Date.now()}`, role: 'assistant', content: data.reply, tokens_used: data.tokensUsed || 0, latency_ms: data.latencyMs, model_used: data.model, created_at: new Date().toISOString() }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: `❌ ${e.message}`, tokens_used: 0, latency_ms: 0, created_at: new Date().toISOString() }]);
    } finally { setSending(false); inputRef.current?.focus(); }
  };

  const copyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const exportConversation = () => {
    if (!agent || messages.length === 0) return;
    const text = messages.map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n\n---\n\n');
    const blob = new Blob([`# ${agent.name} — ${contextLabel || 'Conversation'}\n\n${text}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${agent.slug}-conversation-${Date.now()}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !agent) return null;

  const color = agent.accent_color;
  const img = AGENT_IMAGES[agent.slug];
  const prompts = QUICK_PROMPTS[agent.slug] || [];

  return (
    <div style={{
      borderRadius: 20, overflow: 'hidden',
      background: 'var(--bg-card)', border: `1px solid ${color}25`,
      boxShadow: `0 4px 20px ${color}08`,
      transition: 'all 0.3s ease',
    }}>
      {/* Agent Header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          background: `linear-gradient(135deg, ${color}12 0%, ${color}06 100%)`,
          padding: '16px 20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 14,
          borderBottom: expanded ? `1px solid ${color}15` : 'none',
        }}
      >
        {img && <img src={img} alt={agent.name} style={{ width: 52, height: 52, borderRadius: 14, objectFit: 'cover', border: `2px solid ${color}30`, boxShadow: `0 4px 12px ${color}15` }} />}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={12} style={{ color }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{agent.name}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color, padding: '1px 6px', borderRadius: 4, background: `${color}12` }}>{agent.role}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.4 }}>
            {contextLabel || agent.greeting}
          </div>
        </div>
        {expanded ? <ChevronUp size={16} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} />}
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Toolbar */}
          {messages.length > 0 && (
            <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
              <button onClick={exportConversation} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', fontSize: 9, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Download size={10} /> Export .md
              </button>
            </div>
          )}

          {/* Quick Prompts */}
          {messages.length === 0 && (
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Quick Actions</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {prompts.map(p => (
                  <button key={p} onClick={() => { setExpanded(true); sendMessage(p); }} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1px solid ${color}25`,
                    background: `${color}06`, color, fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${color}15`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${color}06`; }}
                  >{p}</button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div style={{ maxHeight: 360, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map(m => (
              <div key={m.id} style={{ display: 'flex', gap: 8, maxWidth: m.role === 'user' ? '80%' : '95%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                {m.role !== 'user' && img && <img src={img} alt="" style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover', flexShrink: 0, marginTop: 2 }} />}
                <div style={{
                  padding: m.role === 'user' ? '10px 14px' : '12px 16px', borderRadius: 12,
                  background: m.role === 'user' ? `color-mix(in srgb, ${color} 18%, var(--bg-elevated))` : 'var(--bg-app)',
                  color: 'var(--text-primary)',
                  border: m.role === 'user' ? `1px solid ${color}35` : '1px solid var(--border)',
                  fontSize: 12, lineHeight: 1.65, wordBreak: 'break-word',
                  borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                  borderBottomLeftRadius: m.role === 'user' ? 12 : 3,
                  position: 'relative',
                }}>
                  {m.role === 'user' ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  ) : (
                    <MarkdownRenderer content={m.content} />
                  )}
                  {m.role === 'assistant' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 8, color: 'var(--text-tertiary)', display: 'flex', gap: 6 }}>
                        {m.latency_ms > 0 && <span>⚡{m.latency_ms}ms</span>}
                        {m.tokens_used > 0 && <span>📊 {m.tokens_used} tok</span>}
                        {m.model_used && <span>🤖 {m.model_used}</span>}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); copyMessage(m.id, m.content); }} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                        color: copiedId === m.id ? 'var(--green)' : 'var(--text-tertiary)', fontSize: 10,
                        display: 'flex', alignItems: 'center', gap: 2,
                      }}>
                        {copiedId === m.id ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {img && <img src={img} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: 'cover' }} />}
                <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border)', borderBottomLeftRadius: 3 }}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: `agentBounce 1.4s infinite ${i * 0.16}s` }} />)}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Ask ${agent.name}...`}
                rows={1}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)',
                  background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
                  resize: 'none', fontFamily: 'inherit', lineHeight: 1.4, maxHeight: 80, overflowY: 'auto',
                }}
                onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 80) + 'px'; }}
              />
              <button onClick={() => sendMessage()} disabled={sending || !input.trim()} style={{
                width: 34, height: 34, borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0,
                background: input.trim() ? `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)` : 'var(--bg-app)',
                color: input.trim() ? 'var(--accent-contrast, #fff)' : 'var(--text-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: sending ? 0.5 : 1,
              }}>{sending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes agentBounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-5px); } }
        ${MARKDOWN_STYLES}
      `}</style>
    </div>
  );
}
