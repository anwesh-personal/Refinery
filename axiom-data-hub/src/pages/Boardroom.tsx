import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { Send, Loader2, Users, Trash2 } from 'lucide-react';

/* ── Agent metadata type ── */
interface AgentMeta { name: string; role: string; color: string; img: string; }
const IMG_V = '?v=20260329e';
const UNKNOWN_AGENT: AgentMeta = { name: 'Agent', role: 'AI Specialist', color: '#6366f1', img: '/agents/unknown.jpg' };

/* ── Types ── */
interface Meeting { id: string; title: string; question: string; agent_slugs: string[]; status: string; executive_summary: string | null; total_tokens: number; total_latency_ms: number; created_at: string; completed_at: string | null; }
interface Report { id: string; meeting_id: string; agent_slug: string; agent_name: string; report_content: string | null; status: string; latency_ms: number; tokens_used: number; error: string | null; created_at: string; }
interface ChatMsg { id: string; type: 'user' | 'agent' | 'system' | 'typing'; slug?: string; content: string; ts: string; }

export default function BoardroomPage() {
  const [AGENTS, setAgents] = useState<Record<string, AgentMeta>>({});
  const AGENT_SLUGS = Object.keys(AGENTS);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [, setPolling] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // scroll to bottom on new messages
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

  // ── Load agents from API (no hardcoding) ──
  useEffect(() => {
    apiCall<{ agents: Array<{ slug: string; name: string; role: string; accent_color: string; avatar_emoji: string }> }>('/api/ai/agents')
      .then(d => {
        const map: Record<string, AgentMeta> = {};
        for (const a of (d.agents || [])) {
          map[a.slug] = {
            name: a.name,
            role: a.role || a.slug,
            color: a.accent_color || '#6366f1',
            img: `/agents/${a.name.toLowerCase()}.jpg`,
          };
        }
        setAgents(map);
      })
      .catch(() => {});
  }, []);

  // load meeting history
  useEffect(() => {
    apiCall<{ meetings: Meeting[] }>('/api/ai/agents/boardroom/meetings')
      .then(d => setMeetings(d.meetings || [])).catch(() => {});
  }, []);

  // ── Poll active meeting for reports ──
  const pollMeeting = useCallback((meetingId: string, question: string, slugs: string[]) => {
    setPolling(true);
    // initial system message
    setChatMsgs([{ id: 'sys-start', type: 'system', content: `Meeting started — ${slugs.length} agents invited`, ts: new Date().toISOString() }]);
    // add user question
    setChatMsgs(prev => [...prev, { id: 'user-q', type: 'user', content: question, ts: new Date().toISOString() }]);

    const interval = setInterval(async () => {
      try {
        const d = await apiCall<{ meeting: Meeting; reports: Report[] }>(`/api/ai/agents/boardroom/meetings/${meetingId}`);
        setActiveMeeting(d.meeting);

        // Build chat from reports
        const msgs: ChatMsg[] = [
          { id: 'sys-start', type: 'system', content: `Meeting started — ${slugs.length} agents invited`, ts: d.meeting.created_at },
          { id: 'user-q', type: 'user', content: question, ts: d.meeting.created_at },
        ];

        for (const r of (d.reports || [])) {
          if (r.status === 'complete' && r.report_content) {
            msgs.push({ id: r.id, type: 'agent', slug: r.agent_slug, content: r.report_content, ts: r.created_at });
          } else if (r.status === 'running') {
            msgs.push({ id: `typing-${r.agent_slug}`, type: 'typing', slug: r.agent_slug, content: '', ts: r.created_at });
          } else if (r.status === 'failed') {
            msgs.push({ id: r.id, type: 'agent', slug: r.agent_slug, content: `⚠️ ${r.error || 'Agent encountered an error'}`, ts: r.created_at });
          }
        }

        // Executive summary
        if (d.meeting.executive_summary && d.meeting.status === 'complete') {
          msgs.push({ id: 'crucible-summary', type: 'agent', slug: 'supervisor', content: d.meeting.executive_summary, ts: d.meeting.completed_at || new Date().toISOString() });
        }

        setChatMsgs(msgs);

        if (d.meeting.status === 'complete' || d.meeting.status === 'failed') {
          clearInterval(interval);
          setPolling(false);
          apiCall<{ meetings: Meeting[] }>('/api/ai/agents/boardroom/meetings').then(r => setMeetings(r.meetings || []));
        }
      } catch { clearInterval(interval); setPolling(false); }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // ── Poll and APPEND agent results to existing chat (for follow-ups) ──
  const pollMeetingAppend = useCallback((meetingId: string, slugs: string[]) => {
    setPolling(true);
    // Show typing indicators for invited agents
    setChatMsgs(prev => [
      ...prev.filter(m => m.type !== 'typing'),
      ...slugs.map(s => ({ id: `typing-${s}-${meetingId}`, type: 'typing' as const, slug: s, content: '', ts: new Date().toISOString() })),
    ]);

    const interval = setInterval(async () => {
      try {
        const d = await apiCall<{ meeting: Meeting; reports: Report[] }>(`/api/ai/agents/boardroom/meetings/${meetingId}`);
        setActiveMeeting(d.meeting);

        // Remove typing indicators and add completed reports
        setChatMsgs(prev => {
          const withoutTyping = prev.filter(m => !m.id.startsWith(`typing-`) || !m.id.includes(meetingId));
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs: ChatMsg[] = [];

          for (const r of (d.reports || [])) {
            if (r.status === 'complete' && r.report_content && !existingIds.has(r.id)) {
              newMsgs.push({ id: r.id, type: 'agent', slug: r.agent_slug, content: r.report_content, ts: r.created_at });
            } else if (r.status === 'running' && !existingIds.has(`typing-${r.agent_slug}-${meetingId}`)) {
              newMsgs.push({ id: `typing-${r.agent_slug}-${meetingId}`, type: 'typing', slug: r.agent_slug, content: '', ts: r.created_at });
            }
          }

          // Add executive summary if done
          if (d.meeting.executive_summary && d.meeting.status === 'complete' && !existingIds.has(`summary-${meetingId}`)) {
            newMsgs.push({ id: `summary-${meetingId}`, type: 'agent', slug: 'supervisor', content: d.meeting.executive_summary, ts: d.meeting.completed_at || new Date().toISOString() });
          }

          return [...withoutTyping, ...newMsgs];
        });

        if (d.meeting.status === 'complete' || d.meeting.status === 'failed') {
          clearInterval(interval);
          setPolling(false);
          apiCall<{ meetings: Meeting[] }>('/api/ai/agents/boardroom/meetings').then(r => setMeetings(r.meetings || []));
        }
      } catch { clearInterval(interval); setPolling(false); }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // ── Send message ──
  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    // Parse @mentions and detect orchestration mode
    const lower = text.toLowerCase();
    let mode: 'parallel' | 'chain' | 'debate' = 'parallel';
    let targetSlugs: string[] = [];

    // Chain mode: @Cipher then @Sentinel
    const thenMatch = lower.match(/@(\w+)\s+then\s+@(\w+)/);
    // Debate mode: @Cipher vs @Oracle
    const vsMatch = lower.match(/@(\w+)\s+vs\.?\s+@(\w+)/);

    if (thenMatch) {
      mode = 'chain';
      const nameToSlug = (n: string) => Object.entries(AGENTS).find(([, m]) => m.name.toLowerCase() === n)?.[0] || n;
      targetSlugs = [nameToSlug(thenMatch[1]), nameToSlug(thenMatch[2])];
    } else if (vsMatch) {
      mode = 'debate';
      const nameToSlug = (n: string) => Object.entries(AGENTS).find(([, m]) => m.name.toLowerCase() === n)?.[0] || n;
      targetSlugs = [nameToSlug(vsMatch[1]), nameToSlug(vsMatch[2])];
    } else if (/@all\b/i.test(text)) {
      targetSlugs = [...AGENT_SLUGS];
    } else {
      for (const [slug, meta] of Object.entries(AGENTS)) {
        if (lower.includes(`@${meta.name.toLowerCase()}`)) targetSlugs.push(slug);
      }
      if (targetSlugs.length === 0) targetSlugs = [...AGENT_SLUGS];
    }

    // Add user message to chat immediately
    setChatMsgs(prev => [...prev, { id: `user-${Date.now()}`, type: 'user', content: text, ts: new Date().toISOString() }]);

    try {
      const d = await apiCall<{ meeting: Meeting }>('/api/ai/agents/boardroom/meetings', {
        method: 'POST',
        body: { question: text, agents: targetSlugs, title: text.slice(0, 80), mode },
      });
      setActiveMeeting(d.meeting);
      // Poll and APPEND results (don't reset chat)
      pollMeetingAppend(d.meeting.id, targetSlugs);
    } catch (e: any) {
      setChatMsgs(prev => [...prev, { id: `err-${Date.now()}`, type: 'system', content: `❌ ${e.message}`, ts: new Date().toISOString() }]);
    }
    setSending(false);
  };

  // ── Open past meeting ──
  const openMeeting = async (m: Meeting) => {
    const d = await apiCall<{ meeting: Meeting; reports: Report[] }>(`/api/ai/agents/boardroom/meetings/${m.id}`);
    setActiveMeeting(d.meeting);
    const msgs: ChatMsg[] = [
      { id: 'sys-start', type: 'system', content: `Meeting — ${m.agent_slugs.length} agents`, ts: m.created_at },
      { id: 'user-q', type: 'user', content: m.question, ts: m.created_at },
    ];
    for (const r of (d.reports || [])) {
      if (r.report_content) {
        msgs.push({ id: r.id, type: 'agent', slug: r.agent_slug, content: r.report_content, ts: r.created_at });
      }
    }
    if (d.meeting.executive_summary) {
      msgs.push({ id: 'crucible-summary', type: 'agent', slug: 'supervisor', content: d.meeting.executive_summary, ts: d.meeting.completed_at || m.created_at });
    }
    setChatMsgs(msgs);
    if (d.meeting.status === 'running' || d.meeting.status === 'consolidating') {
      pollMeeting(m.id, m.question, m.agent_slugs);
    }
  };

  const deleteMeeting = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await apiCall(`/api/ai/agents/boardroom/meetings/${id}`, { method: 'DELETE' });
    setMeetings(prev => prev.filter(m => m.id !== id));
    if (activeMeeting?.id === id) { setActiveMeeting(null); setChatMsgs([]); }
  };

  // ── @mention handler ──
  const handleInputChange = (val: string) => {
    setInput(val);
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0 && lastAt === val.length - 1 - (val.length - 1 - lastAt)) {
      const after = val.slice(lastAt + 1);
      if (after.length <= 12 && !after.includes(' ')) {
        setShowMentions(true);
        setMentionFilter(after.toLowerCase());
        return;
      }
    }
    setShowMentions(false);
  };

  const insertMention = (name: string) => {
    const lastAt = input.lastIndexOf('@');
    setInput(input.slice(0, lastAt) + `@${name} `);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const timeAgo = (d: string) => {
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const filteredMentions = [{ slug: 'all', name: 'all', role: 'Everyone responds' }, ...AGENT_SLUGS.map(s => ({ slug: s, name: AGENTS[s].name, role: AGENTS[s].role }))].filter(a => a.name.toLowerCase().includes(mentionFilter));

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 0, borderRadius: 20, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>

      {/* ── Left: Sessions + Agent Roster ── */}
      <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)' }}>
        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg, #a855f7, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>AI Boardroom</div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{AGENT_SLUGS.length} agents online</div>
            </div>
          </div>
        </div>

        {/* Agent Roster */}
        <div style={{ padding: '14px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 10 }}>Participants</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {AGENT_SLUGS.map(slug => {
              const a = AGENTS[slug];
              return (
                <div key={slug} onClick={() => insertMention(a.name)} className="agent-roster-item" style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
                  borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease',
                  border: '1px solid transparent',
                }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = `${a.color}10`;
                    e.currentTarget.style.borderColor = `${a.color}30`;
                    const img = e.currentTarget.querySelector('img');
                    if (img) { img.style.transform = 'scale(1.12)'; img.style.boxShadow = `0 0 14px ${a.color}50`; }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'transparent';
                    const img = e.currentTarget.querySelector('img');
                    if (img) { img.style.transform = 'scale(1)'; img.style.boxShadow = 'none'; }
                  }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={a.img + IMG_V} alt={a.name} style={{
                      width: 38, height: 38, borderRadius: 10, objectFit: 'cover',
                      border: `2px solid ${a.color}50`, transition: 'all 0.25s ease',
                    }} />
                    <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--bg-sidebar)' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: a.color }}>{a.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.role}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Meeting History */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', padding: '4px 4px 8px' }}>History</div>
          {meetings.map(m => (
            <div key={m.id} onClick={() => openMeeting(m)} style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
              background: activeMeeting?.id === m.id ? 'var(--bg-hover)' : 'transparent',
              border: activeMeeting?.id === m.id ? '1px solid var(--border)' : '1px solid transparent',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>{m.agent_slugs.length} agents</span>
                <span>{timeAgo(m.created_at)}</span>
                <button onClick={e => deleteMeeting(m.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0 }}><Trash2 size={10} /></button>
              </div>
            </div>
          ))}
          {meetings.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: 12, textAlign: 'center' }}>No meetings yet</div>}
        </div>
      </div>

      {/* ── Right: Chat Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Chat Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {chatMsgs.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, opacity: 0.4 }}>
              <Users size={48} />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Welcome to the Boardroom</div>
              <div style={{ fontSize: 12, maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
                Type <strong>@all</strong> to brief everyone, or <strong>@Cipher</strong> to ask a specific agent. Just type normally and all agents will respond.
              </div>
            </div>
          )}

          {chatMsgs.map(msg => {
            if (msg.type === 'system') {
              return (
                <div key={msg.id} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-tertiary)', padding: '4px 0' }}>
                  ── {msg.content} ──
                </div>
              );
            }

            if (msg.type === 'user') {
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{
                    maxWidth: '70%', padding: '12px 16px', borderRadius: '16px 16px 4px 16px',
                    background: 'linear-gradient(135deg, #a855f7, #3b82f6)', color: '#fff',
                    fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                  }}>{msg.content}</div>
                </div>
              );
            }

            if (msg.type === 'typing') {
              const a = AGENTS[msg.slug || ''] || UNKNOWN_AGENT;
              return (
                <div key={msg.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', animation: 'fadeSlideIn 0.3s ease-out' }}>
                  <img src={a.img + IMG_V} alt={a.name} style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'cover', border: `2px solid ${a.color}`, boxShadow: `0 0 10px ${a.color}30`, flexShrink: 0, transition: 'all 0.2s' }} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: a.color, marginBottom: 4 }}>{a.name}</div>
                    <div style={{ padding: '10px 14px', borderRadius: '4px 16px 16px 16px', background: 'var(--bg-hover)', border: '1px solid var(--border)', display: 'flex', gap: 4, alignItems: 'center' }}>
                      {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: a.color, animation: `typingDot 1.4s infinite ${i * 0.2}s` }} />)}
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 6, fontStyle: 'italic' }}>analyzing...</span>
                    </div>
                  </div>
                </div>
              );
            }

            // Agent message
            const a = AGENTS[msg.slug || ''] || UNKNOWN_AGENT;
            const isSummary = msg.id === 'crucible-summary';
            return (
              <div key={msg.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', animation: 'fadeSlideIn 0.4s ease-out' }}>
                <img src={a.img + IMG_V} alt={a.name} className="chat-avatar" style={{
                  width: 40, height: 40, borderRadius: 12, objectFit: 'cover', flexShrink: 0,
                  border: `2px solid ${a.color}`, transition: 'all 0.25s ease',
                  boxShadow: isSummary ? `0 0 16px ${a.color}50` : `0 0 8px ${a.color}20`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.12)'; e.currentTarget.style.boxShadow = `0 0 18px ${a.color}60`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = isSummary ? `0 0 16px ${a.color}50` : `0 0 8px ${a.color}20`; }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: a.color }}>{a.name}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{a.role}</span>
                    {isSummary && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: `${a.color}20`, color: a.color }}>SUMMARY</span>}
                  </div>
                  <div style={{
                    padding: '14px 18px', borderRadius: '4px 16px 16px 16px',
                    background: isSummary ? `linear-gradient(135deg, ${a.color}08, var(--bg-card))` : 'var(--bg-card)',
                    border: isSummary ? `2px solid ${a.color}40` : '1px solid var(--border)',
                    maxWidth: '95%',
                  }}>
                    <MarkdownRenderer content={msg.content} />
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* ── Input Bar ── */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', position: 'relative' }}>
          {/* @mention dropdown */}
          {showMentions && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 20, right: 20, marginBottom: 4,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12,
              boxShadow: 'var(--shadow-lg)', overflow: 'hidden', zIndex: 10,
            }}>
              {filteredMentions.map(a => (
                <button key={a.slug} onClick={() => insertMention(a.name)} style={{
                  width: '100%', padding: '8px 14px', border: 'none', cursor: 'pointer',
                  background: 'transparent', display: 'flex', alignItems: 'center', gap: 10,
                  textAlign: 'left', fontSize: 12, transition: 'background 0.1s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {a.slug === 'all' ? (
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #a855f7, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Users size={14} color="#fff" />
                    </div>
                  ) : (
                    <img src={AGENTS[a.slug]?.img + IMG_V} alt="" style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }} />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, color: a.slug === 'all' ? 'var(--accent)' : (AGENTS[a.slug]?.color || 'var(--text-primary)') }}>@{a.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{a.role}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } if (e.key === 'Escape') setShowMentions(false); }}
              placeholder="Type @ to mention an agent, or just ask a question..."
              rows={1}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 14, border: '1px solid var(--border)',
                background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13,
                resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 100, overflowY: 'auto', outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
              onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }}
            />
            <button onClick={sendMessage} disabled={sending || !input.trim()} style={{
              width: 42, height: 42, borderRadius: 12, border: 'none', cursor: sending ? 'wait' : 'pointer', flexShrink: 0,
              background: input.trim() ? 'linear-gradient(135deg, #a855f7, #3b82f6)' : 'var(--bg-hover)',
              color: input.trim() ? '#fff' : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s', opacity: sending ? 0.6 : 1,
            }}>
              {sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes typingDot { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-4px); opacity: 1; } }
      `}</style>
    </div>
  );
}
