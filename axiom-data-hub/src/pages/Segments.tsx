import { Filter, Plus, Layers, Users, Tag, Loader2, Play, Eye, Trash2, AlertCircle, CheckCircle2, Pencil, Wand2 } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';
import FilterBuilder, { filterGroupToSQL, sqlToFilterGroup } from '../components/FilterBuilder';
import type { FilterGroup } from '../components/FilterBuilder';

interface Segment {
  id: string;
  name: string;
  niche: string | null;
  client_name: string | null;
  filter_query: string;
  lead_count: string;
  status: string;
  created_at: string;
  performed_by_name: string | null;
}

interface PreviewResult {
  count: number;
  sample: Record<string, unknown>[];
}

function formatNumber(n: string | number): string {
  return Number(n).toLocaleString();
}

const statusColors: Record<string, string> = {
  active: 'var(--green)', draft: 'var(--text-tertiary)', executing: 'var(--blue)',
};

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Inline editor for existing segments
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [editQuery, setEditQuery] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuggestion, setEditSuggestion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editFilterGroup, setEditFilterGroup] = useState<FilterGroup>({ connector: 'AND', rules: [{ id: 'e0', column: '', operator: '=', value: '' }] });

  // Form
  const [name, setName] = useState('');
  const [niche, setNiche] = useState('');
  const [clientName, setClientName] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [filterGroup, setFilterGroup] = useState<FilterGroup>({ connector: 'AND', rules: [{ id: 'r0', column: '', operator: '=', value: '' }] });

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
    setSuggestion(null);
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
      if (e.suggestion) setSuggestion(e.suggestion);
    }
    setCreating(false);
  };

  const previewFilter = async () => {
    if (!filterQuery.trim()) { setError('Enter a filter query'); return; }
    setPreviewing(true);
    setError(null);
    setSuggestion(null);
    setPreview(null);
    try {
      const res = await apiCall<PreviewResult>('/api/segments/preview', {
        method: 'POST',
        body: { filterQuery },
      });
      setPreview(res);
    } catch (e: any) {
      setError(`Preview failed: ${e.message}`);
      if (e.suggestion) setSuggestion(e.suggestion);
    }
    setPreviewing(false);
  };


  const openEdit = (seg: Segment) => {
    setEditingSegment(seg);
    setEditQuery(seg.filter_query);
    const parsed = sqlToFilterGroup(seg.filter_query);
    setEditFilterGroup(parsed);
    setEditError(null);
    setEditSuggestion(null);
  };

  const saveEdit = async () => {
    if (!editingSegment) return;
    setSaving(true);
    setEditError(null);
    try {
      // Validate first
      const v = await apiCall<{valid: boolean; error?: string; suggestion?: string}>('/api/segments/validate', {
        method: 'POST', body: { filterQuery: editQuery },
      });
      if (!v.valid) {
        setEditError(v.error || 'Invalid query');
        if (v.suggestion) setEditSuggestion(v.suggestion);
        setSaving(false);
        return;
      }
      await apiCall(`/api/segments/${editingSegment.id}`, {
        method: 'PUT',
        body: { filterQuery: editQuery },
      });
      setSuccess(`Segment query updated`);
      setEditingSegment(null);
      fetchSegments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setEditError(e.message);
    }
    setSaving(false);
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
        sub="Create intelligent audience segments by filtering your universal lead database with SQL-powered rules."
        description="Each segment is a saved query that slices your data by industry, geography, job title, company size, or any combination of 50+ columns. Segments are the building blocks for verification batches, target exports, and campaign audiences. A segment's count updates live as new data is ingested."
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Total Segments" value={loading ? '...' : String(segments.length)} sub={`${activeSegments} active`} icon={<Filter size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06} />
        <StatCard label="Leads Segmented" value={loading ? '...' : formatNumber(totalLeads)} sub="Assigned to segments" icon={<Users size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Segments" value={loading ? '...' : `${segments.length - activeSegments}`} sub="In draft status" icon={<Layers size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.18} />
      </div>

      {/* Status messages */}
      {error && (
        <div style={{ marginBottom: suggestion ? 0 : 16, padding: '12px 18px', borderRadius: suggestion ? '10px 10px 0 0' : 10, background: 'var(--red-muted)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--red)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {suggestion && (
        <div style={{ marginBottom: 16, padding: '10px 18px', borderRadius: error ? '0 0 10px 10px' : 10, background: 'var(--accent-muted)', border: '1px solid var(--accent)', borderTop: error ? 'none' : undefined, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--accent)' }}>
          <Wand2 size={14} />
          <span style={{ flex: 1 }}>Auto-fix suggestion: <code style={{ fontFamily: 'monospace', fontWeight: 700 }}>{suggestion}</code></span>
          <button onClick={() => { setFilterQuery(suggestion); setSuggestion(null); setError(null); }}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Apply Fix
          </button>
        </div>
      )}
      {success && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'var(--green-muted)', border: '1px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--green)' }}>
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
          <label style={labelStyle}>Filter Conditions *</label>
          <FilterBuilder
            value={filterGroup}
            onChange={g => { setFilterGroup(g); setFilterQuery(filterGroupToSQL(g)); setSuggestion(null); }}
          />
          {filterQuery && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary)', wordBreak: 'break-all' }}>
              <strong>SQL:</strong> {filterQuery}
            </div>
          )}
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
                  {['Name', 'Niche', 'Client', 'Leads', 'Status', 'Created By', 'Actions'].map(h => (
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
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {seg.performed_by_name || '—'}
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(seg.status === 'draft' || seg.status === 'active') && (
                          <Button variant="ghost" icon={executing === seg.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />} onClick={() => executeSegment(seg.id)} disabled={executing !== null}>
                            Execute
                          </Button>
                        )}
                        <Button variant="ghost" icon={<Pencil size={14} />} onClick={() => openEdit(seg)} />
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

      {/* Inline Edit Modal */}
      {editingSegment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setEditingSegment(null); }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 640 }} className="animate-fadeIn">
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Edit Filter Query</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 20 }}>{editingSegment.name}</div>
            {editError && (
              <div style={{ marginBottom: editSuggestion ? 0 : 16, padding: '10px 14px', borderRadius: editSuggestion ? '8px 8px 0 0' : 8, background: 'var(--red-muted)', border: '1px solid var(--red)', fontSize: 12, color: 'var(--red)' }}>
                {editError}
              </div>
            )}
            {editSuggestion && (
              <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: editError ? '0 0 8px 8px' : 8, background: 'var(--accent-muted)', border: '1px solid var(--accent)', borderTop: editError ? 'none' : undefined, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--accent)' }}>
                <Wand2 size={13} />
                <span style={{ flex: 1 }}>Auto-fix: <code style={{ fontFamily: 'monospace', fontWeight: 700 }}>{editSuggestion}</code></span>
                <button onClick={() => { setEditQuery(editSuggestion); setEditSuggestion(null); setEditError(null); }}
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
              </div>
            )}
            <FilterBuilder
              value={editFilterGroup}
              onChange={g => { setEditFilterGroup(g); setEditQuery(filterGroupToSQL(g)); setEditError(null); setEditSuggestion(null); }}
            />
            {editQuery && (
              <div style={{ marginTop: 10, marginBottom: 16, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary)', wordBreak: 'break-all' }}>
                <strong>SQL:</strong> {editQuery}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button icon={saving ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving...' : 'Save & Validate'}
              </Button>
              <Button variant="ghost" onClick={() => setEditingSegment(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
