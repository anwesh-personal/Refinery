import { useState, useEffect } from 'react';
import { SectionHeader, Button } from '../components/UI';
import { Trash2, AlertTriangle, Play, Info } from 'lucide-react';
import { apiCall } from '../lib/api';

interface CleanupRule {
  type: 'date_range' | 'missing_email' | 'keyword' | 'source' | 'duplicates' | 'empty_columns';
  date_from?: string;
  date_to?: string;
  email_columns?: string[];
  column?: string;
  keyword?: string;
  source_key?: string;
  job_id?: string;
  dedup_column?: string;
  columns?: string[];
}

interface CleanupPreview {
  affectedRows: number;
  sampleRows: Record<string, unknown>[];
}

export default function JanitorPage() {
  const [columns, setColumns] = useState<string[]>([]);
  const [jobs, setJobs] = useState<{ id: string; file_name: string; started_at: string }[]>([]);
  const [rule, setRule] = useState<CleanupRule>({ type: 'missing_email' });
  
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<CleanupPreview | null>(null);
  
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState<{ deletedRows: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiCall<string[]>('/api/janitor/columns').then(setColumns).catch(console.error);
    apiCall<{ id: string; file_name: string; started_at: string }[]>('/api/janitor/jobs').then(setJobs).catch(console.error);
  }, []);

  const handlePreview = async () => {
    setPreviewing(true);
    setError('');
    setPreviewResult(null);
    setExecuteResult(null);
    try {
      const res = await apiCall<CleanupPreview>('/api/janitor/preview', { method: 'POST', body: rule });
      setPreviewResult(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleExecute = async () => {
    if (!confirm('Are you absolutely sure? This will PERMANENTLY DELETE data from ClickHouse. This action cannot be undone.')) return;
    
    setExecuting(true);
    setError('');
    try {
      const res = await apiCall<{ deletedRows: number }>('/api/janitor/execute', { method: 'POST', body: rule });
      setExecuteResult(res);
      setPreviewResult(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExecuting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    background: 'var(--bg-app)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', fontSize: 14
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: 8
  };

  return (
    <div className="animate-fadeIn" style={{ paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 12, background: 'var(--red-muted)', color: 'var(--red)', borderRadius: 12 }}>
          <Trash2 size={32} />
        </div>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>The Janitor</h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Permanently clean up garbage data from the database.</p>
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <SectionHeader title="Cleanup Configuration" />
        
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 2fr', gap: 24, marginTop: 16 }}>
          {/* Rule Type Selector */}
          <div>
            <label style={labelStyle}>Rule Type</label>
            <select 
              value={rule.type}
              onChange={(e) => setRule({ type: e.target.value as CleanupRule['type'] })}
              style={inputStyle}
            >
              <option value="missing_email">Missing Email Address</option>
              <option value="duplicates">Deduplicate Rows</option>
              <option value="date_range">Ingestion Date Range</option>
              <option value="source">Specific Ingestion Job / Source</option>
              <option value="keyword">Specific Keyword</option>
              <option value="empty_columns">Specific Empty Columns</option>
            </select>
            
            <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-hover)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
              <Info size={16} style={{ marginBottom: 8 }} />
              {rule.type === 'missing_email' && "Deletes all rows where specified email columns are completely empty."}
              {rule.type === 'duplicates' && "Keeps the oldest record and deletes all newer duplicates based on a specific column (like email)."}
              {rule.type === 'date_range' && "Deletes all data ingested within a specific timestamp range."}
              {rule.type === 'source' && "Deletes data that was ingested from a specific job ID or file name pattern."}
              {rule.type === 'keyword' && "Deletes matching rows. Example: Delete if column 'company' contains 'test'."}
              {rule.type === 'empty_columns' && "Deletes rows where ALL the selected columns are completely empty or null."}
            </div>
          </div>

          {/* Rule Configuration Options */}
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 24 }}>
            
            {rule.type === 'missing_email' && (
              <div>
                <label style={labelStyle}>Columns to check (comma separated)</label>
                <input 
                  type="text" 
                  value={(rule.email_columns || ['email', 'email_address', 'work_email', 'personal_email']).join(', ')}
                  onChange={e => setRule({ ...rule, email_columns: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  style={inputStyle}
                />
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Row is deleted ONLY if ALL of these columns are empty.</p>
              </div>
            )}

            {rule.type === 'duplicates' && (
              <div>
                <label style={labelStyle}>Column to Deduplicate By</label>
                <select 
                  value={rule.dedup_column || 'email'}
                  onChange={e => setRule({ ...rule, dedup_column: e.target.value })}
                  style={inputStyle}
                >
                  {columns.length > 0 ? (
                    columns.map(c => <option key={c} value={c}>{c}</option>)
                  ) : (
                    <option value="email">email</option>
                  )}
                </select>
              </div>
            )}

            {rule.type === 'date_range' && (
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>From</label>
                  <input 
                    type="datetime-local" 
                    value={rule.date_from || ''}
                    onChange={e => setRule({ ...rule, date_from: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>To</label>
                  <input 
                    type="datetime-local" 
                    value={rule.date_to || ''}
                    onChange={e => setRule({ ...rule, date_to: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}

            {rule.type === 'source' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Job ID (Exact Match)</label>
                  <select 
                    value={rule.job_id || ''}
                    onChange={e => setRule({ ...rule, job_id: e.target.value, source_key: undefined })}
                    style={inputStyle}
                  >
                    <option value="">Select a recent job...</option>
                    {jobs.map(j => (
                      <option key={j.id} value={j.id}>
                        {j.file_name} ({new Date(j.started_at).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>OR</div>
                <div>
                  <label style={labelStyle}>Source Key (Contains)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. leads_2023.csv"
                    value={rule.source_key || ''}
                    onChange={e => setRule({ ...rule, source_key: e.target.value, job_id: undefined })}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}

            {rule.type === 'keyword' && (
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Column</label>
                  <select 
                    value={rule.column || ''}
                    onChange={e => setRule({ ...rule, column: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="">Select column...</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Keyword</label>
                  <input 
                    type="text" 
                    value={rule.keyword || ''}
                    onChange={e => setRule({ ...rule, keyword: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}

            {rule.type === 'empty_columns' && (
              <div>
                <label style={labelStyle}>Columns that must ALL be empty (comma separated)</label>
                <input 
                  type="text" 
                  value={(rule.columns || []).join(', ')}
                  onChange={e => setRule({ ...rule, columns: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  style={inputStyle}
                />
              </div>
            )}

          </div>
        </div>

        {/* Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
          <Button onClick={handlePreview} disabled={previewing || executing} icon={<Play size={16} />}>
            {previewing ? 'Calculating...' : 'Preview Cleanup'}
          </Button>
          <Button 
            onClick={handleExecute} 
            disabled={!previewResult || executing} 
            style={{ background: 'var(--red)', color: 'white', opacity: previewResult ? 1 : 0.5 }}
            icon={<Trash2 size={16} />}
          >
            {executing ? 'Deleting...' : 'EXECUTE DELETE'}
          </Button>
        </div>

        {error && (
          <div style={{ marginTop: 24, padding: 16, background: 'var(--red-muted)', color: 'var(--red)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertTriangle size={20} />
            <div>{error}</div>
          </div>
        )}
      </div>

      {previewResult && (
        <div className="animate-fadeIn" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: 18, margin: '0 0 16px', color: 'var(--text-primary)' }}>Preview Results</h2>
          
          <div style={{ 
            fontSize: 32, fontWeight: 800, color: 'var(--accent)', 
            padding: 24, background: 'var(--bg-app)', borderRadius: 12, textAlign: 'center',
            marginBottom: 24
          }}>
            {previewResult.affectedRows.toLocaleString()} rows will be deleted.
          </div>

          {/* Sample rows */}
          {previewResult.sampleRows?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>Sample affected rows (up to 10)</h3>
              <div style={{ overflow: 'auto', maxHeight: 300, borderRadius: 8, border: '1px solid var(--border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {Object.keys(previewResult.sampleRows[0]).slice(0, 8).map(k => (
                        <th key={k} style={{ padding: '8px 12px', textAlign: 'left', background: 'var(--bg-hover)', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewResult.sampleRows.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).slice(0, 8).map((v, j) => (
                          <td key={j} style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v == null ? <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>null</span> : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          <p style={{ color: 'var(--red)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} /> If you click EXECUTE, these rows will be permanently destroyed.
          </p>
        </div>
      )}

      {executeResult && (
        <div className="animate-fadeIn" style={{ background: 'var(--green-muted)', border: '1px solid var(--green)', borderRadius: 16, padding: 24, marginTop: 24 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 8px', color: 'var(--green)' }}>Success</h2>
          <p style={{ margin: 0, color: 'var(--green)' }}>
            Successfully deleted <strong>{executeResult.deletedRows.toLocaleString()}</strong> rows from ClickHouse.
          </p>
        </div>
      )}
    </div>
  );
}
