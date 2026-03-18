import { Filter, Plus, Layers, Users, Tag, Loader2, Play, Eye, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';

interface Segment {
  id: string;
  name: string;
  niche: string | null;
  client_name: string | null;
  filter_query: string;
  lead_count: string;
  status: string;
  created_at: string;
}

interface PreviewResult {
  count: number;
  sample: Record<string, unknown>[];
}

function formatNumber(n: string | number): string {
  return Number(n).toLocaleString();
}

const statusColors: Record<string, string> = {
  active: '#22c55e', draft: '#6b7280', executing: '#3b82f6',
};

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form
  const [name, setName] = useState('');
  const [niche, setNiche] = useState('');
  const [clientName, setClientName] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  const fetchSegments = useCallback(async () => {
    setLoading(true);
    try {
      const segs = await apiCall<Segment[]>('/api/segments');
      setSegments(segs);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSegments(); }, [fetchSegments]);

  const createSegment = async () => {
    if (!name.trim() || !filterQuery.trim()) {
      setError('Name and filter query are required');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await apiCall('/api/segments', {
        method: 'POST',
        body: { name, niche: niche || undefined, clientName: clientName || undefined, filterQuery },
      });
      setSuccess(`Segment "${name}" created`);
      setName(''); setNiche(''); setClientName(''); setFilterQuery('');
      setPreview(null);
      fetchSegments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setCreating(false);
  };

  const previewFilter = async () => {
    if (!filterQuery.trim()) { setError('Enter a filter query'); return; }
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const res = await apiCall<PreviewResult>('/api/segments/preview', {
        method: 'POST',
        body: { filterQuery },
      });
      setPreview(res);
    } catch (e: any) {
      setError(`Preview failed: ${e.message}`);
    }
    setPreviewing(false);
  };

  const executeSegment = async (id: string) => {
    setExecuting(id);
    setError(null);
    try {
      const res = await apiCall<{ count: number }>(`/api/segments/${id}/execute`, { method: 'POST' });
      setSuccess(`Segment executed — ${formatNumber(res.count)} leads tagged`);
      fetchSegments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setExecuting(null);
  };

  const deleteSegment = async (id: string) => {
    if (!confirm('Delete this segment?')) return;
    try {
      await apiCall(`/api/segments/${id}`, { method: 'DELETE' });
      fetchSegments();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const totalLeads = segments.reduce((s, seg) => s + Number(seg.lead_count || 0), 0);
  const activeSegments = segments.filter(s => s.status === 'active').length;

  const labelStyle = { fontSize: 11, fontWeight: 700 as const, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 };

  return (
    <>
      <PageHeader
        title="Segments"
        sub="Create and manage lead segmentation rules for niche-based routing."
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Total Segments" value={loading ? '...' : String(segments.length)} sub={`${activeSegments} active`} icon={<Filter size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06} />
        <StatCard label="Leads Segmented" value={loading ? '...' : formatNumber(totalLeads)} sub="Assigned to segments" icon={<Users size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Segments" value={loading ? '...' : `${segments.length - activeSegments}`} sub="In draft status" icon={<Layers size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.18} />
      </div>

      {/* Status messages */}
      {error && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#ef4444' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#22c55e' }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* Create Form */}
      <SectionHeader title="New Segment" />
      <div className="animate-fadeIn stagger-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={labelStyle}>Segment Name *</label>
            <Input placeholder="e.g. Real Estate — Texas" value={name} onChange={(v: string) => setName(v)} />
          </div>
          <div>
            <label style={labelStyle}>Niche</label>
            <Input placeholder="e.g. Real Estate" value={niche} onChange={(v: string) => setNiche(v)} />
          </div>
          <div>
            <label style={labelStyle}>Assigned Client</label>
            <Input placeholder="e.g. Client A" value={clientName} onChange={(v: string) => setClientName(v)} />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Filter Query (WHERE clause) *</label>
          <textarea
            rows={3}
            placeholder="e.g. primary_industry = 'Real Estate' AND personal_state = 'TX'"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 12,
              fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500,
              outline: 'none', resize: 'vertical',
              background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={creating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} onClick={createSegment} disabled={creating}>
            {creating ? 'Creating...' : 'Create Segment'}
          </Button>
          <Button variant="secondary" icon={previewing ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} onClick={previewFilter} disabled={previewing}>
            {previewing ? 'Previewing...' : 'Preview Filter'}
          </Button>
        </div>

        {/* Preview Results */}
        {preview && (
          <div style={{ marginTop: 20, padding: '16px 20px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--bg-hover)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              Preview: {formatNumber(preview.count)} matching leads
            </div>
            {preview.sample.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {Object.keys(preview.sample[0]).map(col => (
                        <th key={col} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                            {val === null ? <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>null</span> : String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Saved Segments */}
      <SectionHeader title={`Saved Segments (${segments.length})`} />
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        {segments.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Name', 'Niche', 'Client', 'Leads', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segments.map((seg) => (
                  <tr key={seg.id} style={{ transition: 'background 0.1s' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseOut={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{seg.name}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{seg.niche || '—'}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{seg.client_name || '—'}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>{formatNumber(seg.lead_count)}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 6, color: statusColors[seg.status] || '#6b7280', background: (statusColors[seg.status] || '#6b7280') + '18' }}>{seg.status}</span>
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {seg.status === 'draft' && (
                          <Button variant="ghost" icon={executing === seg.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />} onClick={() => executeSegment(seg.id)} disabled={executing !== null}>
                            Execute
                          </Button>
                        )}
                        <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => deleteSegment(seg.id)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Tag size={24} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>{loading ? 'Loading...' : 'No segments created'}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Create your first niche segment above</div>
          </div>
        )}
      </div>
    </>
  );
}
