import { Send, Users, FileDown, Plus, Loader2, AlertCircle, CheckCircle2, Trash2, Download, Eye, Upload } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';
import AudiencePushModal from '../components/AudiencePushModal';

/* ── Types ── */
interface TargetList {
  id: string;
  name: string;
  segment_id: string;
  email_count: string;
  export_format: string;
  status: string;
  created_at: string;
  performed_by_name: string | null;
}

interface TargetStats {
  total_lists: string;
  total_emails: string;
  exported: string;
}

interface Segment {
  id: string;
  name: string;
  niche: string | null;
  lead_count: string;
  status: string;
}

function formatNumber(n: string | number): string {
  return Number(n).toLocaleString();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  generating: { color: 'var(--yellow)', bg: 'var(--yellow-muted)', label: 'Generating' },
  ready: { color: 'var(--green)', bg: 'var(--green-muted)', label: 'Ready' },
  pushed: { color: 'var(--blue)', bg: 'var(--blue-muted)', label: 'Pushed to Queue' },
  failed: { color: 'var(--red)', bg: 'var(--red-muted)', label: 'Failed' },
};

export default function TargetsPage() {
  const [lists, setLists] = useState<TargetList[]>([]);
  const [stats, setStats] = useState<TargetStats | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pushTarget, setPushTarget] = useState<{ id: string; name: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listData, statsData, segData] = await Promise.all([
        apiCall<TargetList[]>('/api/targets'),
        apiCall<TargetStats>('/api/targets/stats'),
        apiCall<Segment[]>('/api/segments'),
      ]);
      setLists(listData);
      setStats(statsData);
      setSegments(segData.filter(s => s.status === 'active'));
    } catch {
      // Silently fail on first load
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createList = async () => {
    if (!name.trim()) { setError('List name is required'); return; }
    if (!segmentId) { setError('Select a source segment'); return; }
    setCreating(true);
    setError(null);
    try {
      await apiCall('/api/targets', {
        method: 'POST',
        body: { name: name.trim(), segmentId },
      });
      setSuccess(`Target list "${name.trim()}" created`);
      setName('');
      setSegmentId('');
      fetchData();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    }
    setCreating(false);
  };

  const exportList = async (id: string) => {
    setExporting(id);
    setError(null);
    try {
      const blob = await apiCall<Blob>(`/api/targets/${id}/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `target-list-${id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('CSV downloaded');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setExporting(null);
  };

  const deleteList = async (id: string) => {
    if (!confirm('Delete this target list? This cannot be undone.')) return;
    try {
      await apiCall(`/api/targets/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const selectedSeg = segments.find(s => s.id === segmentId);

  const labelStyle = {
    fontSize: 11, fontWeight: 700 as const,
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    color: 'var(--text-tertiary)', display: 'block', marginBottom: 8,
  };

  return (
    <>
      <PageHeader
        title="Email Targets"
        sub="Build exportable target lists from verified segments for mailing campaigns."
        description="Pick an active segment containing verified leads, give the list a name, and generate it. The system pulls only contacts marked as 'valid' that have at least one email address. Download as CSV when ready, or push to the Mail Queue for automated dispatch."
        action={<ServerSelector type="clickhouse" />}
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard
          label="Target Lists" value={loading ? '...' : formatNumber(stats?.total_lists || '0')}
          sub="Generated from segments" icon={<Send size={18} />}
          color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.06}
        />
        <StatCard
          label="Total Emails" value={loading ? '...' : formatNumber(stats?.total_emails || '0')}
          sub="Verified & ready to mail" icon={<Users size={18} />}
          color="var(--green)" colorMuted="var(--green-muted)" delay={0.12}
        />
        <StatCard
          label="Exported" value={loading ? '...' : formatNumber(stats?.exported || '0')}
          sub="Downloaded or pushed" icon={<FileDown size={18} />}
          color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.18}
        />
      </div>

      {/* Alerts */}
      {error && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'var(--red-muted)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--red)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'var(--green-muted)', border: '1px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--green)' }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* Create Form */}
      <SectionHeader title="New Target List" />
      <div className="animate-fadeIn stagger-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={labelStyle}>List Name *</label>
            <Input placeholder="e.g. Client A — March 2026" value={name} onChange={(v: string) => setName(v)} />
          </div>
          <div>
            <label style={labelStyle}>Source Segment *</label>
            <select
              value={segmentId}
              onChange={e => setSegmentId(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 12, fontSize: 13, fontWeight: 500,
                background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                outline: 'none', transition: 'border-color 0.2s', cursor: 'pointer',
                appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <option value="">Select a verified segment...</option>
              {segments.map(seg => (
                <option key={seg.id} value={seg.id}>
                  {seg.name} ({formatNumber(seg.lead_count)} leads){seg.niche ? ` — ${seg.niche}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected segment info */}
        {selectedSeg && (
          <div style={{
            marginBottom: 20, padding: '12px 16px', borderRadius: 10,
            background: 'var(--bg-hover)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
          }}>
            <Eye size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>
              Segment <strong style={{ color: 'var(--text-primary)' }}>{selectedSeg.name}</strong> has{' '}
              <strong style={{ color: 'var(--accent)' }}>{formatNumber(selectedSeg.lead_count)}</strong> leads.
              Only verified emails with status "valid" will be included in the target list.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button
            icon={creating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            onClick={createList}
            disabled={creating}
          >
            {creating ? 'Generating...' : 'Create Target List'}
          </Button>
        </div>
      </div>

      {/* Saved Lists */}
      <SectionHeader title={`Saved Target Lists (${lists.length})`} />
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        {lists.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['List Name', 'Emails', 'Status', 'Created', 'By', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left', fontWeight: 700,
                      fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lists.map(list => {
                  const st = statusConfig[list.status] || { color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)', label: list.status };
                  return (
                    <tr
                      key={list.id}
                      style={{ transition: 'background 0.1s' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseOut={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                        {list.name}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        {formatNumber(list.email_count)}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                          padding: '4px 10px', borderRadius: 6,
                          color: st.color, background: st.bg,
                        }}>
                          {st.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                        {relativeTime(list.created_at)}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)', fontSize: 12 }}>
                        {list.performed_by_name || '—'}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {(list.status === 'ready' || list.status === 'pushed') && (
                            <Button
                              variant="ghost"
                              icon={<Upload size={14} />}
                              onClick={() => setPushTarget({ id: list.id, name: list.name })}
                            >
                              Push
                            </Button>
                          )}
                          {(list.status === 'ready' || list.status === 'pushed') && (
                            <Button
                              variant="ghost"
                              icon={exporting === list.id ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                              onClick={() => exportList(list.id)}
                              disabled={exporting !== null}
                            >
                              CSV
                            </Button>
                          )}
                          <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => deleteList(list.id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Send size={24} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>{loading ? 'Loading...' : 'No target lists'}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Create a target list from a verified segment above</div>
          </div>
        )}
      </div>

      <AudiencePushModal
        open={!!pushTarget}
        onClose={() => setPushTarget(null)}
        targetId={pushTarget?.id || ''}
        targetName={pushTarget?.name || ''}
        onPushed={() => { setPushTarget(null); fetchData(); }}
      />
    </>
  );
}
