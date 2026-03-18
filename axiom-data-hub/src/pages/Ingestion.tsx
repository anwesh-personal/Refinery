import { CloudDownload, FolderSync, HardDrive, Clock, Loader2, Play, CheckCircle2, AlertCircle, FileText, Eye, Server, Edit2, Trash2 } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';

/* ---------------- Interfaces ---------------- */
interface IngestionStats {
  total_jobs: string;
  total_rows: string;
  total_bytes: string;
  pending: string;
}

interface IngestionJob {
  id: string;
  source_bucket: string;
  source_key: string;
  file_name: string;
  file_size_bytes: string;
  rows_ingested: string;
  status: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface SourceFile {
  key: string;
  size: number;
  modified: string;
}

interface S3Source {
  id: string;
  label: string;
  bucket: string;
  region: string;
  access_key: string;
  secret_key: string;
  prefix: string;
  is_active: number;
  last_tested_at?: string;
  last_test_result?: string;
  created_at: string;
}

/* ---------------- Helpers ---------------- */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatNumber(n: string | number): string {
  return Number(n).toLocaleString();
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const statusColors: Record<string, string> = {
  complete: '#22c55e', ingesting: '#3b82f6', downloading: '#f59e0b',
  uploading: '#8b5cf6', pending: '#6b7280', failed: '#ef4444',
};

/* ---------------- Component ---------------- */
export default function IngestionPage() {
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [sources, setSources] = useState<S3Source[]>([]);
  
  // Browsing state
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(''); // empty means use legacy env
  const [prefix, setPrefix] = useState('');
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [ingesting, setIngesting] = useState<string | null>(null);
  
  // Source Modal state
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [editingSource, setEditingSource] = useState<Partial<S3Source> | null>(null);
  const [testingCreds, setTestingCreds] = useState(false);
  const [testCredsResult, setTestCredsResult] = useState<{ok: boolean, msg: string} | null>(null);

  // Global messages
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /* --- Fetch --- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, j, src] = await Promise.all([
        apiCall<IngestionStats>('/api/ingestion/stats').catch(() => null),
        apiCall<IngestionJob[]>('/api/ingestion/jobs').catch(() => []),
        apiCall<S3Source[]>('/api/s3-sources').catch(() => []),
      ]);
      setStats(s);
      setJobs(j);
      setSources(src);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh jobs
  useEffect(() => {
    const hasActive = jobs.some(j => ['pending', 'downloading', 'uploading', 'ingesting'].includes(j.status));
    if (!hasActive) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [jobs, fetchData]);

  /* --- S3 Sources Management --- */
  const handleSaveSource = async () => {
    if (!editingSource?.label || !editingSource?.bucket) {
      setError("Label and Bucket are required.");
      return;
    }
    setError(null);
    try {
      const payload = {
        label: editingSource.label,
        bucket: editingSource.bucket,
        region: editingSource.region || 'us-east-1',
        accessKey: editingSource.access_key,
        secretKey: editingSource.secret_key,
        prefix: editingSource.prefix || ''
      };
      
      if (editingSource.id) {
        await apiCall(`/api/s3-sources/${editingSource.id}`, { method: 'PUT', body: payload });
        setSuccess('Source updated successfully.');
      } else {
        await apiCall('/api/s3-sources', { method: 'POST', body: payload });
        setSuccess('Source added successfully.');
      }
      setShowSourceModal(false);
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(`Failed to save source: ${e.message}`);
    }
  };

  const handleDeleteSource = async (id: string) => {
    if (!confirm('Are you sure you want to delete this source?')) return;
    try {
      await apiCall(`/api/s3-sources/${id}`, { method: 'DELETE' });
      setSuccess('Source deleted.');
      if (selectedSourceId === id) setSelectedSourceId('');
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(`Delete failed: ${e.message}`);
    }
  };

  const handleTestCredentials = async () => {
    if (!editingSource?.bucket) return;
    setTestingCreds(true);
    setTestCredsResult(null);
    try {
      const res = await apiCall<{ok: boolean, fileCount?: number, error?: string}>('/api/s3-sources/test-credentials', {
        method: 'POST',
        body: {
          bucket: editingSource.bucket,
          region: editingSource.region || 'us-east-1',
          accessKey: editingSource.access_key || '',
          secretKey: editingSource.secret_key || '',
          prefix: editingSource.prefix || ''
        }
      });
      if (res.ok) {
        setTestCredsResult({ ok: true, msg: `Success! Found ${res.fileCount} files in prefix.`});
      } else {
        setTestCredsResult({ ok: false, msg: `Failed: ${res.error}`});
      }
    } catch (e: any) {
      setTestCredsResult({ ok: false, msg: `Error: ${e.message}`});
    }
    setTestingCreds(false);
  };

  /* --- Browsing & Ingestion --- */
  const browseFiles = async () => {
    setBrowsing(true);
    setError(null);
    try {
      let url = `/api/ingestion/source-files?1=1`;
      if (prefix) url += `&prefix=${encodeURIComponent(prefix)}`;
      if (selectedSourceId) url += `&sourceId=${encodeURIComponent(selectedSourceId)}`;
      
      const files = await apiCall<SourceFile[]>(url);
      setSourceFiles(files);
    } catch (e: any) {
      setError(`Failed to browse: ${e.message}`);
    }
    setBrowsing(false);
  };

  const startIngestion = async (sourceKey: string) => {
    setIngesting(sourceKey);
    setError(null);
    try {
      const payload: any = { sourceKey };
      if (selectedSourceId) payload.sourceId = selectedSourceId;

      const res = await apiCall<{ jobId: string }>('/api/ingestion/start', {
        method: 'POST',
        body: payload,
      });
      setSuccess(`Job started: ${res.jobId}`);
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (e: any) {
      setError(`Ingestion failed: ${e.message}`);
    }
    setIngesting(null);
  };

  const totalRows = Number(stats?.total_rows || 0);
  const totalBytes = Number(stats?.total_bytes || 0);
  const pendingCount = Number(stats?.pending || 0);
  const lastJob = jobs[0];

  return (
    <>
      <PageHeader
        title="Data Ingestion"
        sub="Connect S3 sources, browse files, and ingest into ClickHouse."
        action={<ServerSelector type="clickhouse" />}
      />

      {/* Global Alerts */}
      {error && (
        <div className="animate-fadeIn" style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#ef4444' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="animate-fadeIn" style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#22c55e' }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* --- STATS --- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Pending Jobs" value={loading ? '...' : String(pendingCount)} sub={pendingCount > 0 ? 'In progress' : 'All clear'} icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.06} />
        <StatCard label="Total Ingested" value={loading ? '...' : formatNumber(totalRows)} sub="Rows across all jobs" icon={<CloudDownload size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Storage Used" value={loading ? '...' : formatBytes(totalBytes)} sub="on Object Storage" icon={<HardDrive size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.18} />
        <StatCard label="Last Job" value={lastJob ? timeAgo(lastJob.started_at) : 'Never'} sub={lastJob?.file_name || 'No jobs yet'} icon={<FolderSync size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.24} />
      </div>

      {/* --- S3 SOURCES MANAGEMENT --- */}
      <SectionHeader 
        title="Configured S3 Sources" 
        action="+ Add Source" 
        onAction={() => {
          setEditingSource({});
          setTestCredsResult(null);
          setShowSourceModal(true);
        }} 
      />
      <div className="animate-fadeIn stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 36 }}>
        
        {/* Legacy Mode Card */}
        <div 
          onClick={() => setSelectedSourceId('')}
          style={{ 
            background: selectedSourceId === '' ? 'var(--bg-hover)' : 'var(--bg-card)', 
            border: `1px solid ${selectedSourceId === '' ? 'var(--accent)' : 'var(--border)'}`, 
            borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'all 0.2s',
            boxShadow: selectedSourceId === '' ? '0 0 0 1px var(--accent)' : 'none'
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <Server size={18} color={selectedSourceId === '' ? 'var(--accent)' : 'var(--text-tertiary)'} />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>System Default (Env)</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Uses environment variables for legacy compatibility.</div>
        </div>

        {sources.map(src => (
          <div 
            key={src.id}
            onClick={() => setSelectedSourceId(src.id)}
            style={{ 
              background: selectedSourceId === src.id ? 'var(--bg-hover)' : 'var(--bg-card)', 
              border: `1px solid ${selectedSourceId === src.id ? 'var(--accent)' : 'var(--border)'}`, 
              borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'all 0.2s', position: 'relative',
              boxShadow: selectedSourceId === src.id ? '0 0 0 1px var(--accent)' : 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <HardDrive size={18} color={selectedSourceId === src.id ? 'var(--accent)' : 'var(--text-tertiary)'} />
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{src.label}</div>
              </div>
              
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  onClick={(e) => { e.stopPropagation(); setEditingSource(src); setTestCredsResult(null); setShowSourceModal(true); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  <Edit2 size={14} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteSource(src.id); }}
                  style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <strong>Bucket:</strong> {src.bucket} <br/>
              <strong>Region:</strong> {src.region}
            </div>
          </div>
        ))}
      </div>

      {/* --- SOURCE BROWSER --- */}
      <SectionHeader title="Source Browser" />
      <div className="animate-fadeIn stagger-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Prefix Filter</label>
            <Input placeholder="e.g. 2026/ or outgoing/" value={prefix} onChange={(v: string) => setPrefix(v)} />
          </div>
          <Button icon={browsing ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} onClick={browseFiles} disabled={browsing}>
            {browsing ? 'Loading...' : 'Browse Files'}
          </Button>
        </div>

        {sourceFiles.length > 0 ? (
          <div style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {sourceFiles.map((f) => (
              <div
                key={f.key}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 18px', borderBottom: '1px solid var(--border)',
                  transition: 'background 0.15s',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseOut={e => (e.currentTarget.style.background = '')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileText size={16} color="var(--text-tertiary)" />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{f.key}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {formatBytes(f.size)} · {new Date(f.modified).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  icon={ingesting === f.key ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                  onClick={() => startIngestion(f.key)}
                  disabled={ingesting !== null}
                >
                  {ingesting === f.key ? 'Starting...' : 'Ingest'}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, background: 'var(--bg-hover)', borderRadius: 8 }}>
            Select a source and click Browse Files to see available data.
          </div>
        )}
      </div>

      {/* --- JOB HISTORY --- */}
      <SectionHeader title={`Ingestion Jobs (${jobs.length})`} action="Refresh" onAction={fetchData} />
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        {jobs.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Job ID', 'File', 'Size', 'Rows', 'Status', 'Started'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} style={{ transition: 'background 0.1s' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseOut={e => (e.currentTarget.style.background = '')}>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 12 }}>{job.id.slice(0, 8)}...</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{job.file_name}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)' }}>{formatBytes(Number(job.file_size_bytes))}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>{formatNumber(job.rows_ingested)}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 6, color: statusColors[job.status] || '#6b7280', background: (statusColors[job.status] || '#6b7280') + '18' }}>{job.status}</span>
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)' }}>{timeAgo(job.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <CloudDownload size={24} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>{loading ? 'Loading...' : 'No ingestion jobs yet'}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Browse S3 source files above and click Ingest to start</div>
          </div>
        )}
      </div>

      {/* --- ADD / EDIT SOURCE MODAL --- */}
      {showSourceModal && editingSource && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div className="animate-scaleIn" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            padding: 32, borderRadius: 20, width: '100%', maxWidth: 500,
            boxShadow: 'var(--shadow-lg)'
          }}>
            <h2 style={{ margin: '0 0 20px 0', fontSize: 20, color: 'var(--text-primary)' }}>
              {editingSource.id ? 'Edit S3 Source' : 'Add S3 Source'}
            </h2>
            
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Label Name</label>
                <Input placeholder="e.g. Partner A Data" value={editingSource.label || ''} onChange={(v: string) => setEditingSource({...editingSource, label: v})} />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Bucket</label>
                  <Input placeholder="e.g. my-bucket" value={editingSource.bucket || ''} onChange={(v: string) => setEditingSource({...editingSource, bucket: v})} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Region</label>
                  <Input placeholder="e.g. us-east-1" value={editingSource.region || ''} onChange={(v: string) => setEditingSource({...editingSource, region: v})} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Access Key ID {editingSource.id ? '(Leave blank to keep)' : ''}</label>
                <Input placeholder="AKIA..." value={editingSource.access_key || ''} onChange={(v: string) => setEditingSource({...editingSource, access_key: v})} />
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Secret Access Key {editingSource.id ? '(Leave blank to keep)' : ''}</label>
                {/* Normal input string to pass correctly to Input component */}
                <input 
                  type="password"
                  placeholder="Secret key..." 
                  value={editingSource.secret_key || ''} 
                  onChange={(e) => setEditingSource({...editingSource, secret_key: e.target.value})}
                  style={{ 
                    width: '100%', padding: '10px 14px', borderRadius: 10, 
                    border: '1px solid var(--border)', background: 'var(--bg-input)', 
                    color: 'var(--text-primary)', fontSize: 14 
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Default Prefix</label>
                <Input placeholder="e.g. outgoing/" value={editingSource.prefix || ''} onChange={(v: string) => setEditingSource({...editingSource, prefix: v})} />
              </div>
            </div>

            {testCredsResult && (
              <div style={{
                marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
                background: testCredsResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: testCredsResult.ok ? '#22c55e' : '#ef4444', border: `1px solid ${testCredsResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`
              }}>
                {testCredsResult.msg}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
              <Button variant="secondary" onClick={() => setShowSourceModal(false)}>Cancel</Button>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button 
                  variant="secondary" 
                  onClick={handleTestCredentials}
                  disabled={testingCreds || !editingSource.bucket}
                >
                  {testingCreds ? 'Testing...' : 'Test Credentials'}
                </Button>
                <Button onClick={handleSaveSource}>Save Source</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
