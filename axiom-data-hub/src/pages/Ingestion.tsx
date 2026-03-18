import { CloudDownload, FolderSync, HardDrive, Clock, RefreshCw, Loader2, Play, CheckCircle2, AlertCircle, FileText, Eye } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';

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

export default function IngestionPage() {
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ source?: string; storage?: string } | null>(null);
  const [prefix, setPrefix] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, j] = await Promise.all([
        apiCall<IngestionStats>('/api/ingestion/stats').catch(() => null),
        apiCall<IngestionJob[]>('/api/ingestion/jobs').catch(() => []),
      ]);
      setStats(s);
      setJobs(j);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  // Auto-refresh if any jobs are in progress
  useEffect(() => {
    const hasActive = jobs.some(j => ['pending', 'downloading', 'uploading', 'ingesting'].includes(j.status));
    if (!hasActive) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [jobs, fetchData]);

  const browseFiles = async () => {
    setBrowsing(true);
    setError(null);
    try {
      const files = await apiCall<SourceFile[]>(`/api/ingestion/source-files${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`);
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
      const res = await apiCall<{ jobId: string }>('/api/ingestion/start', {
        method: 'POST',
        body: { sourceKey },
      });
      setSuccess(`Job started: ${res.jobId}`);
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (e: any) {
      setError(`Ingestion failed: ${e.message}`);
    }
    setIngesting(null);
  };

  const testConnections = async () => {
    setTestResult(null);
    setError(null);
    try {
      const [source, storage] = await Promise.all([
        apiCall<{ ok: boolean; error?: string }>('/api/ingestion/test-source', { method: 'POST' }),
        apiCall<{ ok: boolean; error?: string }>('/api/ingestion/test-storage', { method: 'POST' }),
      ]);
      setTestResult({
        source: source.ok ? '✅ S3 Source connected' : `❌ S3: ${source.error}`,
        storage: storage.ok ? '✅ MinIO connected' : `❌ MinIO: ${storage.error}`,
      });
    } catch (e: any) {
      setError(`Connection test failed: ${e.message}`);
    }
  };

  const totalRows = Number(stats?.total_rows || 0);
  const totalBytes = Number(stats?.total_bytes || 0);
  const pendingCount = Number(stats?.pending || 0);
  const lastJob = jobs[0];

  return (
    <>
      <PageHeader
        title="S3 Ingestion"
        sub="Manage data downloads from the 5x5 Co-Op S3 buckets to your ClickHouse server."
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Pending Jobs" value={loading ? '...' : String(pendingCount)} sub={pendingCount > 0 ? 'In progress' : 'All clear'} icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.06} />
        <StatCard label="Total Ingested" value={loading ? '...' : formatNumber(totalRows)} sub="Rows across all jobs" icon={<CloudDownload size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Storage Used" value={loading ? '...' : formatBytes(totalBytes)} sub="on Object Storage" icon={<HardDrive size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.18} />
        <StatCard label="Last Job" value={lastJob ? timeAgo(lastJob.started_at) : 'Never'} sub={lastJob?.file_name || 'No jobs yet'} icon={<FolderSync size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.24} />
      </div>

      {/* Connection Test & File Browser */}
      <SectionHeader title="S3 Source Browser" />
      <div className="animate-fadeIn stagger-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Prefix Filter</label>
            <Input placeholder="e.g. 2026/ or leads/" value={prefix} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrefix(e.target.value)} />
          </div>
          <Button icon={browsing ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} onClick={browseFiles} disabled={browsing}>
            {browsing ? 'Loading...' : 'Browse Files'}
          </Button>
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={testConnections}>Test Connections</Button>
        </div>

        {/* Test results */}
        {testResult && (
          <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'var(--bg-hover)', fontSize: 13 }}>
            <div>{testResult.source}</div>
            <div>{testResult.storage}</div>
          </div>
        )}

        {/* Source file list */}
        {sourceFiles.length > 0 && (
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
        )}
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

      {/* Job History */}
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
    </>
  );
}
