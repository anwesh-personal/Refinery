import { Filter, Plus, Layers, Users, Loader2, Eye, AlertCircle, CheckCircle2, Wand2, Tag, Upload } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import FilterBuilder, { filterGroupToSQL, sqlToFilterGroup } from '../components/FilterBuilder';
import type { FilterGroup } from '../components/FilterBuilder';
import SegmentCard from '../components/SegmentCard';
import type { Segment } from '../components/SegmentCard';

interface PreviewResult {
  count: number;
  sample: Record<string, unknown>[];
}

function formatNumber(n: string | number): string {
  return Number(n).toLocaleString();
}

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [liveCountLoading, setLiveCountLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // CSV Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMatch, setUploadMatch] = useState<'any' | 'business_email' | 'personal_emails'>('any');
  const uploadRef = useRef<HTMLInputElement>(null);

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

  // Debounced live count while building filter
  useEffect(() => {
    if (!filterQuery.trim()) { setLiveCount(null); return; }
    const t = setTimeout(async () => {
      setLiveCountLoading(true);
      try {
        const r = await apiCall<{ count: number }>('/api/segments/count', { method: 'POST', body: { filterQuery } });
        setLiveCount(r.count);
      } catch { setLiveCount(null); }
      setLiveCountLoading(false);
    }, 800);
    return () => clearTimeout(t);
  }, [filterQuery]);

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
    setError(null);
    try {
      const res = await apiCall<{ count: number }>(`/api/segments/${id}/execute`, { method: 'POST' });
      setSuccess(`Segment executed — ${formatNumber(res.count)} leads tagged`);
      fetchSegments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
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
      <SectionHeader title="New Segment" action="📤 Upload CSV" onAction={() => setShowUpload(!showUpload)} />

      {/* ═══════ CSV Upload Panel ═══════ */}
      {showUpload && (
        <div className="animate-fadeIn" style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 16, padding: 28, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Upload size={18} color="var(--accent)" />
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Create Segment from CSV</span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Upload a CSV with emails → matches against your database → creates a segment</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 16, marginBottom: 16, alignItems: 'end' }}>
            <div>
              <label style={labelStyle}>Segment Name *</label>
              <Input placeholder="e.g. Verified Batch — Verify550" value={uploadName} onChange={(v: string) => setUploadName(v)} />
            </div>
            <div>
              <label style={labelStyle}>Match Against</label>
              <select
                value={uploadMatch}
                onChange={e => setUploadMatch(e.target.value as typeof uploadMatch)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', cursor: 'pointer',
                }}
              >
                <option value="any">Any email column</option>
                <option value="business_email">Business email only</option>
                <option value="personal_emails">Personal email only</option>
              </select>
            </div>
            <button
              onClick={async () => {
                if (!uploadFile || !uploadName.trim()) { setError('Select a file and enter a segment name'); return; }
                setUploading(true); setError(null);
                try {
                  const form = new FormData();
                  form.append('file', uploadFile);
                  form.append('name', uploadName.trim());
                  form.append('matchColumn', uploadMatch);
                  const result = await apiCall<{ id: string; matched: number; unmatched: number; total: number }>('/api/segments/upload', {
                    method: 'POST', body: form,
                  });
                  setSuccess(`Segment created! ${result.matched.toLocaleString()} matched, ${result.unmatched.toLocaleString()} unmatched out of ${result.total.toLocaleString()} emails`);
                  setShowUpload(false); setUploadFile(null); setUploadName('');
                  fetchSegments();
                  setTimeout(() => setSuccess(null), 6000);
                } catch (e: any) { setError(e.message); }
                setUploading(false);
              }}
              disabled={uploading || !uploadFile || !uploadName.trim()}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: uploading ? 'var(--bg-elevated)' : 'var(--accent)', color: uploading ? 'var(--text-tertiary)' : 'var(--accent-contrast)',
                border: 'none', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
              }}
            >
              {uploading ? <><Loader2 size={14} className="spin" /> Matching...</> : <><Upload size={14} /> Upload & Create</>}
            </button>
          </div>

          {/* Drop zone */}
          <div
            onClick={() => uploadRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border)'; const f = e.dataTransfer.files[0]; if (f) { setUploadFile(f); if (!uploadName) setUploadName(f.name.replace(/\.[^.]+$/, '')); } }}
            style={{
              padding: 24, borderRadius: 12, border: '2px dashed var(--border)', textAlign: 'center',
              cursor: 'pointer', transition: 'border-color 0.2s', background: 'var(--bg-elevated)',
            }}
          >
            <input ref={uploadRef} type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }} onChange={e => {
              const f = e.target.files?.[0];
              if (f) { setUploadFile(f); if (!uploadName) setUploadName(f.name.replace(/\.[^.]+$/, '')); }
            }} />
            {uploadFile ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <CheckCircle2 size={16} color="var(--green)" />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{uploadFile.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({(uploadFile.size / 1024).toFixed(0)} KB)</span>
                <button onClick={e => { e.stopPropagation(); setUploadFile(null); }} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11 }}>Remove</button>
              </div>
            ) : (
              <div>
                <Upload size={20} color="var(--text-tertiary)" style={{ marginBottom: 6 }} />
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Drop a CSV file here or click to browse</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Supports .csv, .txt, .tsv — auto-detects email column</div>
              </div>
            )}
          </div>
        </div>
      )}

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
          <label style={labelStyle}>Quick Templates — One-Click Segments</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: '✉️ Verified Emails Only', name: 'Verified Emails', query: "`_verification_status` = 'valid'" },
              { label: '📱 Has Phone Number', name: 'Has Phone', query: "`mobile_phone` IS NOT NULL AND toString(`mobile_phone`) != ''" },
              { label: '💼 Corporate Emails', name: 'Corporate Emails', query: "(`business_email` IS NOT NULL AND toString(`business_email`) != '') AND `business_email` NOT LIKE '%gmail.com%' AND `business_email` NOT LIKE '%yahoo.com%' AND `business_email` NOT LIKE '%hotmail.com%' AND `business_email` NOT LIKE '%outlook.com%'" },
              { label: '🔗 Has LinkedIn', name: 'Has LinkedIn', query: "`linkedin_url` IS NOT NULL AND toString(`linkedin_url`) != ''" },
              { label: '📱+✉️ Phone + Email', name: 'Phone and Email', query: "(`mobile_phone` IS NOT NULL AND toString(`mobile_phone`) != '') AND ((`business_email` IS NOT NULL AND toString(`business_email`) != '') OR (`personal_emails` IS NOT NULL AND toString(`personal_emails`) != ''))" },
              { label: '⚠️ Unverified Leads', name: 'Unverified Leads', query: "(`_verification_status` IS NULL OR `_verification_status` = '' OR `_verification_status` = 'unknown')" },
              { label: '🆕 Last 7 Days', name: 'Recent Ingest (7d)', query: "`_ingested_at` >= now() - INTERVAL 7 DAY" },
              { label: '📧 Gmail Users', name: 'Gmail Users', query: "(`personal_emails` LIKE '%gmail.com%' OR `business_email` LIKE '%gmail.com%')" },
              { label: '✅ V550 Safe', name: 'V550 Safe', query: "`_v550_category` IN ('ok', 'ok_for_all')" },
              { label: '🚫 V550 Threats', name: 'V550 Threats', query: "`_v550_category` IN ('complainers', 'spamtraps', 'seeds', 'email_bot', 'spamcops', 'sleeper_cell', 'bot_clickers', 'litigators', 'lashback', 'advisory_trap', 'blacklisted', 'disposables')" },
              { label: '⚠️ V550 Risky', name: 'V550 Risky', query: "`_v550_category` IN ('unknown', 'antispam_system', 'soft_bounce', 'departmental', 'invalid_vendor_response')" },
            ].map(t => (
              <button key={t.label} onClick={() => {
                const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                setName(`${t.name} — ${today}`);
                setFilterQuery(t.query);
                setFilterGroup(sqlToFilterGroup(t.query));
                setError(null); setSuggestion(null);
              }}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Filter Conditions *</label>
          <FilterBuilder
            value={filterGroup}
            onChange={g => { setFilterGroup(g); setFilterQuery(filterGroupToSQL(g)); setSuggestion(null); }}
          />
          {filterQuery && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-tertiary)', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, fontFamily: 'monospace' }}><strong>SQL:</strong> {filterQuery}</span>
              {liveCountLoading && <Loader2 size={12} className="spin" style={{ flexShrink: 0 }} />}
              {!liveCountLoading && liveCount !== null && (
                <span style={{ flexShrink: 0, fontWeight: 700, color: 'var(--accent)', fontFamily: 'inherit', fontSize: 12 }}>
                  ~{liveCount.toLocaleString()} leads
                </span>
              )}
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
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <Loader2 size={24} className="spin" style={{ marginBottom: 12, opacity: 0.5 }} />
          <div style={{ fontSize: 13 }}>Loading segments...</div>
        </div>
      ) : segments.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 16, border: '1px dashed var(--border)', color: 'var(--text-tertiary)' }}>
          <Tag size={28} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontWeight: 600 }}>No segments yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Build your first segment above</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
          {segments.map(seg => (
            <SegmentCard
              key={seg.id}
              seg={seg}
              onExecute={executeSegment}
              onDelete={deleteSegment}
              onEdit={openEdit}
              onRefresh={fetchSegments}
            />
          ))}
        </div>
      )}

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
