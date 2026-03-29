import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';
import {
  Users, Send, Loader2, CheckCircle2, AlertCircle,
  Clock, Zap, ChevronDown, ChevronUp, Trash2, Brain
} from 'lucide-react';

interface Agent {
  id: string; slug: string; name: string; role: string;
  avatar_emoji: string; accent_color: string; greeting: string;
  capabilities: string[]; enabled: boolean;
}

interface Report {
  id: string; meeting_id: string; agent_slug: string;
  agent_name: string; report_content: string | null;
  tools_used: string[]; tokens_used: number;
  latency_ms: number; status: string; error: string | null;
}

interface Meeting {
  id: string; title: string; question: string;
  agent_slugs: string[]; status: string;
  executive_summary: string | null; total_tokens: number;
  total_latency_ms: number; created_at: string;
  completed_at: string | null;
}

const AGENT_COLORS: Record<string, string> = {
  data_scientist: 'var(--blue)',
  smtp_specialist: 'var(--green)',
  seo_strategist: 'var(--red)',
  supervisor: 'var(--purple)',
  verification_engineer: 'var(--yellow)',
};

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: '⏳', color: 'var(--text-tertiary)' },
  running: { icon: '🔄', color: 'var(--blue)' },
  consolidating: { icon: '🧠', color: 'var(--purple)' },
  complete: { icon: '✅', color: 'var(--green)' },
  failed: { icon: '❌', color: 'var(--red)' },
};

export default function BoardroomPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [activeReports, setActiveReports] = useState<Report[]>([]);
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());
  const [polling, setPolling] = useState(false);

  // Load agents + meetings on mount
  useEffect(() => {
    apiCall<{ agents: Agent[] }>('/api/ai/agents').then(d => setAgents(d.agents || []));
    apiCall<{ meetings: Meeting[] }>('/api/ai/agents/boardroom/meetings').then(d => setMeetings(d.meetings || []));
  }, []);

  // Poll active meeting
  const pollMeeting = useCallback(async (meetingId: string) => {
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const d = await apiCall<{ meeting: Meeting; reports: Report[] }>(`/api/ai/agents/boardroom/meetings/${meetingId}`);
        setActiveMeeting(d.meeting);
        setActiveReports(d.reports || []);
        if (d.meeting.status === 'complete' || d.meeting.status === 'failed') {
          clearInterval(interval);
          setPolling(false);
          // Refresh meetings list
          apiCall<{ meetings: Meeting[] }>('/api/ai/agents/boardroom/meetings').then(r => setMeetings(r.meetings || []));
        }
      } catch { clearInterval(interval); setPolling(false); }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggleAgent = (slug: string) => {
    const next = new Set(selectedAgents);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    setSelectedAgents(next);
  };

  const startMeeting = async () => {
    if (!question.trim() || selectedAgents.size === 0) return;
    setCreating(true);
    try {
      const d = await apiCall<{ meeting: Meeting }>('/api/ai/agents/boardroom/meetings', {
        method: 'POST',
        body: { question, agents: Array.from(selectedAgents), title: question.slice(0, 80) },
      });
      setActiveMeeting(d.meeting);
      setActiveReports([]);
      setExpandedReports(new Set());
      setQuestion('');
      setSelectedAgents(new Set());
      pollMeeting(d.meeting.id);
    } catch (e: any) {
      alert('Failed: ' + (e.message || e));
    }
    setCreating(false);
  };

  const openMeeting = async (m: Meeting) => {
    const d = await apiCall<{ meeting: Meeting; reports: Report[] }>(`/api/ai/agents/boardroom/meetings/${m.id}`);
    setActiveMeeting(d.meeting);
    setActiveReports(d.reports || []);
    setExpandedReports(new Set(d.reports?.map(r => r.agent_slug) || []));
    if (d.meeting.status === 'running' || d.meeting.status === 'consolidating') {
      pollMeeting(m.id);
    }
  };

  const deleteMeeting = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this meeting?')) return;
    await apiCall(`/api/ai/agents/boardroom/meetings/${id}`, { method: 'DELETE' });
    setMeetings(prev => prev.filter(m => m.id !== id));
    if (activeMeeting?.id === id) { setActiveMeeting(null); setActiveReports([]); }
  };

  const toggleExpand = (slug: string) => {
    const next = new Set(expandedReports);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    setExpandedReports(next);
  };

  const timeAgo = (d: string) => {
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  return (
    <>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)', borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 200, height: 200, background: 'radial-gradient(circle, var(--purple) 0%, transparent 70%)', opacity: 0.06 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, var(--purple) 0%, var(--blue) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={22} color="var(--accent-contrast)" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>AI Boardroom</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Multi-agent meetings • Select agents • Ask strategic questions • Get consolidated intelligence</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: activeMeeting ? '320px 1fr' : '1fr', gap: 24 }}>
        {/* Left: Create + History */}
        <div>
          {/* Agent Selection */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
              <Brain size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Select Agents
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {agents.map(ag => {
                const selected = selectedAgents.has(ag.slug);
                const c = AGENT_COLORS[ag.slug] || 'var(--accent)';
                return (
                  <button key={ag.slug} onClick={() => toggleAgent(ag.slug)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    borderRadius: 10, border: selected ? `2px solid ${c}` : '2px solid var(--border)',
                    background: selected ? `color-mix(in srgb, ${c} 8%, var(--bg-card))` : 'var(--bg-card)',
                    cursor: 'pointer', transition: 'all 0.15s', width: '100%', textAlign: 'left',
                  }}>
                    <span style={{ fontSize: 18 }}>{ag.avatar_emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: selected ? c : 'var(--text-primary)' }}>{ag.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ag.role}</div>
                    </div>
                    {selected && <CheckCircle2 size={16} color={c} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Question Input */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Ask a strategic question... e.g. 'Full intelligence report on zerobounce.net'"
              rows={3}
              style={{
                width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 10, padding: 12, fontSize: 13, color: 'var(--text-primary)',
                resize: 'vertical', fontFamily: 'inherit', outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            <button
              onClick={startMeeting}
              disabled={creating || !question.trim() || selectedAgents.size === 0}
              style={{
                marginTop: 10, width: '100%', padding: '12px 16px', borderRadius: 10,
                border: 'none', cursor: creating ? 'wait' : 'pointer',
                background: selectedAgents.size > 0 && question.trim() ? 'linear-gradient(135deg, var(--purple), var(--blue))' : 'var(--border)',
                color: selectedAgents.size > 0 && question.trim() ? 'var(--accent-contrast)' : 'var(--text-tertiary)',
                fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.2s', opacity: creating ? 0.7 : 1,
              }}
            >
              {creating ? <><Loader2 size={14} className="spin" /> Starting Meeting...</> : <><Send size={14} /> Start Meeting ({selectedAgents.size} agent{selectedAgents.size !== 1 ? 's' : ''})</>}
            </button>
          </div>

          {/* Meeting History */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
              <Clock size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Meeting History ({meetings.length})
            </h3>
            {meetings.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 }}>No meetings yet. Select agents and ask a question!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
                {meetings.map(m => {
                  const st = STATUS_ICONS[m.status] || STATUS_ICONS.pending;
                  const isActive = activeMeeting?.id === m.id;
                  return (
                    <div key={m.id} onClick={() => openMeeting(m)} style={{
                      padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                      border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: isActive ? 'var(--bg-hover)' : 'transparent',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14 }}>{st.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{m.agent_slugs.length} agents • {timeAgo(m.created_at)}</div>
                        </div>
                        <button onClick={(e) => deleteMeeting(m.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Active Meeting View */}
        {activeMeeting && (
          <div>
            {/* Meeting Header */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{STATUS_ICONS[activeMeeting.status]?.icon || '⏳'}</span>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{activeMeeting.title}</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {activeMeeting.agent_slugs.length} agents • {activeMeeting.status}
                    {activeMeeting.total_tokens > 0 && ` • ${activeMeeting.total_tokens} tokens`}
                    {activeMeeting.total_latency_ms > 0 && ` • ${(activeMeeting.total_latency_ms / 1000).toFixed(1)}s`}
                  </p>
                </div>
                {polling && <Loader2 size={16} className="spin" color="var(--accent)" />}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '10px 14px', background: 'var(--bg-hover)', borderRadius: 8, fontStyle: 'italic' }}>
                "{activeMeeting.question}"
              </div>
            </div>

            {/* Executive Summary (Crucible) */}
            {activeMeeting.executive_summary && (
              <div style={{
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--purple) 8%, var(--bg-card)), var(--bg-card))',
                border: '2px solid var(--purple)', borderRadius: 16, padding: 20, marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 18 }}>🏛️</span>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--purple)' }}>Executive Summary — Crucible</div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                  {activeMeeting.executive_summary}
                </div>
              </div>
            )}

            {/* Individual Reports */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activeReports.map(report => {
                const c = AGENT_COLORS[report.agent_slug] || 'var(--accent)';
                const expanded = expandedReports.has(report.agent_slug);
                const isRunning = report.status === 'running';
                const isDone = report.status === 'complete';
                const isFailed = report.status === 'failed';

                return (
                  <div key={report.id} style={{
                    background: 'var(--bg-card)', border: `1px solid ${isDone ? c : 'var(--border)'}`,
                    borderRadius: 14, overflow: 'hidden', transition: 'all 0.2s',
                  }}>
                    {/* Report Header */}
                    <button onClick={() => toggleExpand(report.agent_slug)} style={{
                      width: '100%', padding: '14px 16px', border: 'none', cursor: 'pointer',
                      background: 'transparent', display: 'flex', alignItems: 'center', gap: 10,
                      textAlign: 'left',
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: isRunning ? 'var(--yellow)' : isDone ? c : isFailed ? 'var(--red)' : 'var(--border)',
                        animation: isRunning ? 'pulse 1.5s ease-in-out infinite' : 'none',
                        boxShadow: isRunning ? `0 0 8px var(--yellow)` : 'none',
                      }} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: isDone ? c : 'var(--text-primary)', flex: 1 }}>
                        {report.agent_name}
                      </span>
                      {report.tools_used.length > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                          <Zap size={10} /> {report.tools_used.length} tools
                        </span>
                      )}
                      {report.latency_ms > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                          {(report.latency_ms / 1000).toFixed(1)}s
                        </span>
                      )}
                      {isRunning && <Loader2 size={14} className="spin" color="var(--yellow)" />}
                      {isDone && (expanded ? <ChevronUp size={14} color={c} /> : <ChevronDown size={14} color={c} />)}
                      {isFailed && <AlertCircle size={14} color="var(--red)" />}
                    </button>

                    {/* Report Content */}
                    {expanded && report.report_content && (
                      <div style={{
                        padding: '0 16px 16px', fontSize: 13, lineHeight: 1.7,
                        color: 'var(--text-primary)', whiteSpace: 'pre-wrap',
                        borderTop: '1px solid var(--border)',
                        paddingTop: 14,
                      }}>
                        {report.report_content}
                      </div>
                    )}

                    {/* Error */}
                    {isFailed && report.error && (
                      <div style={{ padding: '8px 16px 12px', fontSize: 11, color: 'var(--red)' }}>
                        ⚠️ {report.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Loading state */}
            {activeReports.length === 0 && (activeMeeting.status === 'running' || activeMeeting.status === 'pending') && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                <Loader2 size={32} className="spin" style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>Agents are preparing their reports...</div>
              </div>
            )}
          </div>
        )}

        {/* Empty state when no meeting selected */}
        {!activeMeeting && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Users size={48} style={{ marginBottom: 16, opacity: 0.2 }} />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Select agents and ask a question</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Or click a past meeting from the history</div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
