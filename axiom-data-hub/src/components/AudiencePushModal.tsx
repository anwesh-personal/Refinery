import { useState, useEffect } from 'react';
import { Button } from './UI';
import { apiCall } from '../lib/api';
import { useToast } from './Toast';
import { X, Loader2, Upload, Eye, ArrowRight, Filter, Plus, Trash2 } from 'lucide-react';

interface ColumnMapping {
  clickhouse_column: string;
  mta_field: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  targetId: string;
  targetName: string;
  onPushed: () => void;
}

const DEFAULT_MTA_FIELDS = [
  'first_name', 'last_name', 'email', 'company', 'job_title',
  'phone', 'city', 'state', 'country', 'custom_field_1', 'custom_field_2',
];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500,
  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--text-tertiary)', display: 'block', marginBottom: 4,
};

export default function AudiencePushModal({ open, onClose, targetId, targetName, onPushed }: Props) {
  const [columns, setColumns] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([
    { clickhouse_column: 'first_name', mta_field: 'first_name' },
    { clickhouse_column: 'last_name', mta_field: 'last_name' },
    { clickhouse_column: 'company_name', mta_field: 'company' },
  ]);
  const [excludeRole, setExcludeRole] = useState(true);
  const [excludeFree, setExcludeFree] = useState(false);
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; total: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ status: string; message: string } | null>(null);
  const { success, error: toastError } = useToast();

  useEffect(() => {
    if (open) {
      apiCall<string[]>('/api/targets/columns').then(setColumns).catch(() => {});
      setPushResult(null);
      setPreview(null);
    }
  }, [open]);

  if (!open) return null;

  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      const previewCols = mappings.map(m => m.clickhouse_column);
      if (!previewCols.includes('business_email')) previewCols.unshift('business_email');
      const data = await apiCall<{ rows: Record<string, unknown>[]; total: number }>(
        `/api/targets/${targetId}/preview`,
        { method: 'POST', body: { columns: previewCols, limit: 10, excludeRoleBased: excludeRole, excludeFreeProviders: excludeFree } },
      );
      setPreview(data);
    } catch (e: any) { toastError('Preview Error', e.message); }
    setLoadingPreview(false);
  };

  const doPush = async () => {
    setPushing(true);
    try {
      const result = await apiCall<{ status: string; message: string; pushed: number; failed: number }>(
        `/api/targets/${targetId}/push`,
        { method: 'POST', body: { columnMappings: mappings, excludeRoleBased: excludeRole, excludeFreeProviders: excludeFree } },
      );
      setPushResult(result);
      if (result.status === 'complete') {
        success('Audience Pushed', result.message);
        onPushed();
      } else {
        toastError('Push Failed', result.message);
      }
    } catch (e: any) { toastError('Push Error', e.message); }
    setPushing(false);
  };

  const addMapping = () => setMappings([...mappings, { clickhouse_column: '', mta_field: '' }]);
  const removeMapping = (i: number) => setMappings(mappings.filter((_, idx) => idx !== i));
  const updateMapping = (i: number, key: keyof ColumnMapping, val: string) => {
    const updated = [...mappings];
    updated[i] = { ...updated[i], [key]: val };
    setMappings(updated);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 20, padding: 32, position: 'relative',
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16, background: 'none', border: 'none',
          color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4,
        }}><X size={18} /></button>

        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
          Push to MTA
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>
          Push "{targetName}" to your configured MailWizz instance as a subscriber list.
        </p>

        {/* Column Mappings */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Column Mappings</label>
            <Button variant="ghost" icon={<Plus size={12} />} onClick={addMapping}>Add</Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mappings.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select style={{ ...inputStyle, flex: 1 }}
                  value={m.clickhouse_column}
                  onChange={e => updateMapping(i, 'clickhouse_column', e.target.value)}>
                  <option value="">Select ClickHouse column...</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ArrowRight size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <select style={{ ...inputStyle, flex: 1 }}
                  value={m.mta_field}
                  onChange={e => updateMapping(i, 'mta_field', e.target.value)}>
                  <option value="">Select MTA field...</option>
                  {DEFAULT_MTA_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <button onClick={() => removeMapping(i)} style={{
                  background: 'none', border: 'none', color: 'var(--text-tertiary)',
                  cursor: 'pointer', padding: 4, flexShrink: 0,
                }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Exclusion Filters */}
        <div style={{ marginBottom: 20, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <label style={{ ...labelStyle, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={12} /> Pre-Flight Exclusions
          </label>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={excludeRole} onChange={e => setExcludeRole(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)' }} />
              Exclude role-based emails (info@, admin@, etc.)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={excludeFree} onChange={e => setExcludeFree(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)' }} />
              Exclude free providers (gmail, yahoo, etc.)
            </label>
          </div>
        </div>

        {/* Preview Button */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Button variant="ghost" icon={loadingPreview ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
            onClick={loadPreview} disabled={loadingPreview}>
            Preview Audience
          </Button>
        </div>

        {/* Preview Table */}
        {preview && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {preview.total.toLocaleString()} leads match · Showing first {preview.rows.length}
            </div>
            <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {preview.rows[0] && Object.keys(preview.rows[0]).map(k => (
                      <th key={k} style={{
                        padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
                        borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)',
                        whiteSpace: 'nowrap',
                      }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} style={{
                          padding: '6px 10px', borderBottom: '1px solid var(--border)',
                          color: 'var(--text-secondary)', whiteSpace: 'nowrap', maxWidth: 200,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{String(v ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Push Result */}
        {pushResult && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, marginBottom: 16,
            background: pushResult.status === 'complete' ? 'var(--green-muted)' : 'var(--red-muted)',
            border: `1px solid ${pushResult.status === 'complete' ? 'var(--green)' : 'var(--red)'}`,
            color: pushResult.status === 'complete' ? 'var(--green)' : 'var(--red)',
            fontSize: 13,
          }}>
            {pushResult.message}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            icon={pushing ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
            onClick={doPush}
            disabled={pushing || mappings.length === 0 || pushResult?.status === 'complete'}
          >
            {pushing ? 'Pushing...' : 'Push to MTA'}
          </Button>
        </div>
      </div>
    </div>
  );
}
