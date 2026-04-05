import { CloudDownload, FolderSync, HardDrive, Clock, Loader2, Play, CheckCircle2, AlertCircle, FileText, Eye, Edit2, Trash2, Folder, CheckSquare, Square, Layers, ArrowUpDown, Filter, ChevronUp, ChevronDown, Zap, Settings, RotateCw, Calendar, X, Download, Search, ChevronLeft, ChevronRight, Table2, GitMerge } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button, Input } from '../components/UI';
import MergePlayground from './MergePlayground';
import { ServerSelector } from '../components/ServerSelector';
import React, { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';
import { timeAgo } from '../lib/timeAgo';
import AgentCard from '../components/AgentCard';

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
  performed_by: string | null;
  performed_by_name: string | null;
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
  endpoint_url?: string;
  is_active: number;
  last_tested_at?: string;
  last_test_result?: string;
  created_at: string;
}

interface IngestionRule {
  id: string;
  source_id: string;
  label: string;
  prefix_pattern: string;
  file_types: string[];
  min_date: string | null;
  max_file_size_mb: number | null;
  min_file_size_mb: number | null;
  schedule: string;
  enabled: number;
  skip_duplicates: number;
  created_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
  files_found_last_run: number | null;
  files_ingested_last_run: number | null;
}

interface JobProgress {
  id: string;
  fileName: string;
  status: string;
  rowsIngested: number;
  fileSizeBytes: number;
  startedAt: string;
  elapsedSec: number;
  rowsPerSec: number;
  etaRemainingSec: number | null;
}

interface ActiveProgressResult {
  jobs: JobProgress[];
  queueDepth: number;
  maxConcurrent: number;
  avgRowsPerSec: number;
  overallEtaSec: number | null;
}

const SCHEDULE_PRESETS = [
  { label: 'Every 15 Minutes', value: '*/15 * * * *' },
  { label: 'Every 30 Minutes', value: '*/30 * * * *' },
  { label: 'Every Hour', value: '0 * * * *' },
  { label: 'Every 2 Hours', value: '0 */2 * * *' },
  { label: 'Every 4 Hours', value: '0 */4 * * *' },
  { label: 'Every 6 Hours', value: '0 */6 * * *' },
  { label: 'Every 12 Hours', value: '0 */12 * * *' },
  { label: 'Daily (Midnight)', value: '0 0 * * *' },
  { label: 'Daily (6 AM)', value: '0 6 * * *' },
  { label: 'Daily (Noon)', value: '0 12 * * *' },
  { label: 'Weekly (Sunday Midnight)', value: '0 0 * * 0' },
  { label: 'Weekly (Monday 6 AM)', value: '0 6 * * 1' },
  { label: 'Bi-Weekly (1st & 15th)', value: '0 0 1,15 * *' },
  { label: 'Monthly (1st at Midnight)', value: '0 0 1 * *' },
  { label: 'Monthly (1st at 6 AM)', value: '0 6 1 * *' },
  { label: 'Monthly (Last Day)', value: '0 0 28 * *' },
  { label: 'Quarterly (Jan/Apr/Jul/Oct)', value: '0 0 1 1,4,7,10 *' },
];

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

function formatDuration(sec: number): string {
  if (sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}



const statusColors: Record<string, string> = {
  complete: 'var(--green)', ingesting: 'var(--blue)', downloading: 'var(--yellow)',
  uploading: 'var(--purple)', pending: 'var(--text-secondary)', failed: 'var(--red)',
  cancelled: 'var(--yellow)', rolled_back: 'var(--red)', archived: 'var(--purple)',
};

type FileFormat = 'csv' | 'gz' | 'parquet' | 'other';
const FORMAT_COLORS: Record<FileFormat, string> = {
  csv: 'var(--green)', gz: 'var(--purple)', parquet: 'var(--blue)', other: 'var(--text-tertiary)',
};
function getFileFormat(name: string): FileFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.parquet') || lower.endsWith('.pqt')) return 'parquet';
  if (lower.endsWith('.gz')) return 'gz';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv';
  return 'other';
}

type FileSortKey = 'name' | 'size' | 'date';
type JobSortKey = 'date' | 'rows' | 'status' | 'file';
type IngestionStatusFilter = 'all' | 'ingested' | 'uningested' | 'in_progress';

/* ---------------- Component ---------------- */
export default function IngestionPage() {
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [sources, setSources] = useState<S3Source[]>([]);

  // Browsing state
  const [folders, setFolders] = useState<string[]>([]);
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(''); // empty means use legacy env
  const [prefix, setPrefix] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [fileStatusMap, setFileStatusMap] = useState<Record<string, { status: string; rowsIngested: number }>>({}); // ingestion status per source key

  // Sort & filter state
  const [fileSortKey, setFileSortKey] = useState<FileSortKey>('date');
  const [fileSortAsc, setFileSortAsc] = useState(false); // default: latest first
  const [fileTypeFilter, setFileTypeFilter] = useState<FileFormat | 'all'>('all');
  const [jobSortKey, setJobSortKey] = useState<JobSortKey>('date');
  const [jobSortAsc, setJobSortAsc] = useState(false);
  const [ingestionStatusFilter, setIngestionStatusFilter] = useState<IngestionStatusFilter>('all');

  // Auto-ingest rules
  const [rules, setRules] = useState<IngestionRule[]>([]);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<IngestionRule> | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [ingestingBulk, setIngestingBulk] = useState(false);

  // Source Modal state
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [editingSource, setEditingSource] = useState<Partial<S3Source> | null>(null);
  const [testingCreds, setTestingCreds] = useState(false);
  const [testCredsResult, setTestCredsResult] = useState<{ ok: boolean, msg: string } | null>(null);

  // Global messages
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Preview modal state
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: string[][]; fileName: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  // Job data viewer state
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<{ job: { id: string; file_name: string; rows_ingested: string }; columns: string[]; rows: Record<string, any>[]; total: number; page: number; pageSize: number } | null>(null);
  const [jobDataLoading, setJobDataLoading] = useState(false);
  const [jobDataSearch, setJobDataSearch] = useState('');
  const [jobDataPage, setJobDataPage] = useState(1);
  const [jobDataSortBy, setJobDataSortBy] = useState('');
  const [jobDataSortDir, setJobDataSortDir] = useState<'asc' | 'desc'>('asc');
  const [jobDataExporting, setJobDataExporting] = useState(false);
  const [browsePageSize, setBrowsePageSize] = useState(50);

  // Date-range ingestion state
  const [dateRangeStart, setDateRangeStart] = useState('');
  const [dateRangeEnd, setDateRangeEnd] = useState('');
  const [dateRangeIngesting, setDateRangeIngesting] = useState(false);

  const [activeView, setActiveView] = useState<'data' | 'merge'>('data');

  // Active progress & ETA state
  const [activeProgress, setActiveProgress] = useState<ActiveProgressResult | null>(null);

  /* --- Fetch --- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, j, src, r] = await Promise.all([
        apiCall<IngestionStats>('/api/ingestion/stats').catch(() => null),
        apiCall<IngestionJob[]>('/api/ingestion/jobs').catch(() => []),
        apiCall<S3Source[]>('/api/s3-sources').catch(() => []),
        apiCall<IngestionRule[]>('/api/ingestion-rules').catch(() => []),
      ]);
      setStats(s);
      setJobs(j);
      setSources(src);
      setRules(r);
      // Auto-select first source if none selected
      if (!selectedSourceId && src.length > 0) {
        setSelectedSourceId(src[0].id);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedSourceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Rule handlers
  const handleSaveRule = async () => {
    if (!editingRule) return;
    try {
      if (editingRule.id) {
        await apiCall(`/api/ingestion-rules/${editingRule.id}`, { method: 'PUT', body: editingRule });
      } else {
        await apiCall('/api/ingestion-rules', { method: 'POST', body: editingRule });
      }
      setShowRuleModal(false);
      setEditingRule(null);
      setSuccess('Rule saved successfully');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (e: any) {
      setError(`Failed to save rule: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await apiCall(`/api/ingestion-rules/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (e: any) {
      setError(`Failed to delete rule: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    try {
      await apiCall(`/api/ingestion-rules/${id}/toggle`, { method: 'POST', body: { enabled } });
      fetchData();
    } catch (e: any) {
      setError(`Failed to toggle rule: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRunRule = async (id: string) => {
    setRunningRuleId(id);
    try {
      const result = await apiCall<{ filesFound: number; filesIngested: number; skipped: number }>(`/api/ingestion-rules/${id}/run`, { method: 'POST' });
      setSuccess(`Rule executed: ${result.filesFound} found, ${result.filesIngested} ingested, ${result.skipped} skipped`);
      setTimeout(() => setSuccess(null), 5000);
      fetchData();
    } catch (e: any) {
      setError(`Rule execution failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunningRuleId(null);
    }
  };

  // ─── Job Data Viewer ───
  const fetchJobData = useCallback(async (jobId: string, page: number, search: string, sortBy: string, sortDir: 'asc' | 'desc') => {
    setJobDataLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(browsePageSize), search, sortBy, sortDir });
      const data = await apiCall<any>(`/api/ingestion/${jobId}/data?${params}`);
      setJobData(data);
    } catch (e: any) {
      setError(`Failed to load job data: ${e.message}`);
    } finally {
      setJobDataLoading(false);
    }
  }, [browsePageSize]);

  const openJobDataViewer = (jobId: string) => {
    setViewingJobId(jobId);
    setJobDataSearch('');
    setJobDataPage(1);
    setJobDataSortBy('');
    setJobDataSortDir('asc');
    fetchJobData(jobId, 1, '', '', 'asc');
  };

  const closeJobDataViewer = () => {
    setViewingJobId(null);
    setJobData(null);
    setJobDataSearch('');
    setJobDataPage(1);
  };

  // Re-fetch when search/page/sort changes
  useEffect(() => {
    if (viewingJobId) {
      fetchJobData(viewingJobId, jobDataPage, jobDataSearch, jobDataSortBy, jobDataSortDir);
    }
  }, [viewingJobId, jobDataPage, jobDataSortBy, jobDataSortDir, browsePageSize, fetchJobData]);

  // Debounced search
  useEffect(() => {
    if (!viewingJobId) return;
    const t = setTimeout(() => {
      setJobDataPage(1);
      fetchJobData(viewingJobId, 1, jobDataSearch, jobDataSortBy, jobDataSortDir);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobDataSearch]);

  const exportJobData = async (jobId: string) => {
    setJobDataExporting(true);
    try {
      const blob = await apiCall<Blob>(`/api/ingestion/${jobId}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `job-${jobId.slice(0, 8)}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(`Export failed: ${e.message}`);
    } finally {
      setJobDataExporting(false);
    }
  };


  // Auto-browse when source changes
  useEffect(() => {
    if (selectedSourceId) {
      browseFilesForSource(selectedSourceId, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceId]);

  // Auto-refresh jobs + active progress
  useEffect(() => {
    const hasActive = jobs.some(j => ['pending', 'downloading', 'uploading', 'ingesting'].includes(j.status));
    if (!hasActive) { setActiveProgress(null); return; }
    // Fetch progress immediately on first detect
    apiCall<ActiveProgressResult>('/api/ingestion/active-progress').then(setActiveProgress).catch(() => {});
    // Then poll both: full data every 5s, progress every 3s
    const dataInterval = setInterval(fetchData, 5000);
    const progressInterval = setInterval(() => {
      apiCall<ActiveProgressResult>('/api/ingestion/active-progress').then(setActiveProgress).catch(() => {});
    }, 3000);
    return () => { clearInterval(dataInterval); clearInterval(progressInterval); };
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
        endpoint_url: editingSource.endpoint_url || null,
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
    } catch (e) {
      setError(`Failed to save source: ${e instanceof Error ? e.message : String(e)}`);
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
    } catch (e) {
      setError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleTestCredentials = async () => {
    if (!editingSource?.bucket) return;
    setTestingCreds(true);
    setTestCredsResult(null);
    try {
      const res = await apiCall<{ ok: boolean, fileCount?: number, error?: string }>('/api/s3-sources/test-credentials', {
        method: 'POST',
        body: {
          bucket: editingSource.bucket,
          region: editingSource.region || 'us-east-1',
          accessKey: editingSource.access_key || '',
          secretKey: editingSource.secret_key || '',
          endpoint_url: editingSource.endpoint_url || null,
          prefix: editingSource.prefix || ''
        }
      });
      if (res.ok) {
        setTestCredsResult({ ok: true, msg: `Success! Found ${res.fileCount} files in prefix.` });
      } else {
        setTestCredsResult({ ok: false, msg: `Failed: ${res.error}` });
      }
    } catch (e) {
      setTestCredsResult({ ok: false, msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
    }
    setTestingCreds(false);
  };

  /* --- Browsing & Ingestion --- */
  const browseFilesForSource = async (srcId: string, overridePrefix?: string) => {
    if (!srcId) {
      setError('Please select an S3 source first, or add one using the + button.');
      return;
    }
    const currentPrefix = overridePrefix !== undefined ? overridePrefix : prefix;
    setBrowsing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (currentPrefix) params.set('prefix', currentPrefix);
      params.set('sourceId', srcId);
      const url = `/api/ingestion/source-files?${params.toString()}`;

      const res = await apiCall<{ folders: string[], files: SourceFile[], prefix: string }>(url);
      setFolders(res.folders || []);
      setSourceFiles(res.files || []);
      setPrefix(res.prefix || '');
      setSelectedFiles(new Set());

      // Fetch ingestion statuses for these files (non-blocking)
      if (res.files && res.files.length > 0) {
        apiCall<{ statuses: Record<string, { status: string; rowsIngested: number }> }>('/api/ingestion/file-statuses', {
          method: 'POST',
          body: { sourceKeys: res.files.map(f => f.key) },
        }).then(r => setFileStatusMap(r.statuses || {})).catch(() => {});
      } else {
        setFileStatusMap({});
      }
    } catch (e) {
      setError(`Failed to browse: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBrowsing(false);
  };

  const browseFiles = (overridePrefix?: string) => browseFilesForSource(selectedSourceId, overridePrefix);

  const startIngestion = async (sourceKey: string, force = false) => {
    setIngesting(sourceKey);
    setError(null);
    try {
      const body: { sourceKey: string; sourceId?: string; force?: boolean } = { sourceKey };
      if (selectedSourceId) body.sourceId = selectedSourceId;
      if (force) body.force = true;

      const res = await apiCall<{ jobId: string }>('/api/ingestion/start', {
        method: 'POST',
        body,
      });
      setSuccess(`Job started: ${res.jobId}`);
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Handle duplicate conflict — ask user to force
      if (msg.includes('already ingested') && !force) {
        const fileName = sourceKey.split('/').pop() || sourceKey;
        if (confirm(`⚠️ "${fileName}" is already ingested in ClickHouse.\n\nThis will create DUPLICATE data. Are you sure you want to re-ingest?`)) {
          setIngesting(null);
          return startIngestion(sourceKey, true);
        }
      } else {
        setError(`Ingestion failed: ${msg}`);
      }
    }
    setIngesting(null);
  };

  const startBulkIngestion = async (force = false) => {
    if (selectedFiles.size === 0) return;
    setIngestingBulk(true);
    setError(null);
    try {
      const res = await apiCall<{ jobIds: string[]; count: number; skipped?: Array<{ fileName: string; rowsIngested: number }> }>('/api/ingestion/start-bulk', {
        method: 'POST',
        body: {
          sourceKeys: Array.from(selectedFiles),
          sourceId: selectedSourceId,
          force,
        },
      });

      const skippedCount = res.skipped?.length || 0;

      if (res.count === 0 && skippedCount > 0 && !force) {
        // All files already ingested — ask user
        const skippedNames = res.skipped!.map(s => `  • ${s.fileName} (${s.rowsIngested.toLocaleString()} rows)`).join('\n');
        setIngestingBulk(false);
        if (confirm(`⚠️ All ${skippedCount} selected files are already ingested:\n\n${skippedNames}\n\nRe-ingesting will create DUPLICATE data. Force re-ingest all?`)) {
          return startBulkIngestion(true);
        }
        return;
      }

      let msg = `Started ${res.count} ingestion jobs.`;
      if (skippedCount > 0) {
        msg += ` ${skippedCount} already-ingested files skipped.`;
      }
      setSuccess(msg);
      setTimeout(() => setSuccess(null), 5000);
      setSelectedFiles(new Set());
      fetchData();
    } catch (e) {
      setError(`Bulk ingestion failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setIngestingBulk(false);
  };



  const toggleFile = (key: string) => {
    const next = new Set(selectedFiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedFiles(next);
  };

  const handlePreview = async (sourceKey: string) => {
    setPreviewLoading(sourceKey);
    try {
      const params = new URLSearchParams({ sourceKey });
      if (selectedSourceId) params.set('sourceId', selectedSourceId);
      const data = await apiCall<{ columns: string[]; rows: string[][]; totalPreviewRows: number; format: string }>(
        `/api/ingestion/preview-file?${params.toString()}`
      );
      const fileName = sourceKey.split('/').pop() || sourceKey;
      setPreviewData({ columns: data.columns, rows: data.rows, fileName });
    } catch (e: any) {
      setError(`Preview failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleDateRangeIngestion = async () => {
    if (!dateRangeStart || !dateRangeEnd || !selectedSourceId) {
      setError('Select a source and specify both start and end dates.');
      return;
    }
    setDateRangeIngesting(true);
    setError(null);
    try {
      const res = await apiCall<{ jobIds: string[]; count: number; skipped?: Array<{ fileName: string }>; filesMatched?: number; message?: string }>(
        '/api/ingestion/start-bulk-daterange',
        {
          method: 'POST',
          body: {
            sourceId: selectedSourceId,
            prefix: prefix || '',
            startDate: dateRangeStart,
            endDate: dateRangeEnd,
          },
        }
      );
      const skippedCount = res.skipped?.length || 0;
      if (res.count === 0 && skippedCount === 0) {
        setError(res.message || 'No files found in the specified date range.');
      } else {
        let msg = `Started ${res.count} ingestion jobs from ${res.filesMatched || res.count} matching files.`;
        if (skippedCount > 0) msg += ` ${skippedCount} already-ingested files skipped.`;
        setSuccess(msg);
        setTimeout(() => setSuccess(null), 5000);
        fetchData();
      }
    } catch (e: any) {
      setError(`Date-range ingestion failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDateRangeIngesting(false);
    }
  };

  const totalRows = Number(stats?.total_rows || 0);
  const totalBytes = Number(stats?.total_bytes || 0);
  const pendingCount = Number(stats?.pending || 0);
  const lastJob = jobs[0];

  return (
    <>
      <PageHeader
        title="Data Ingestion"
        sub="Connect S3-compatible object storage, browse files, and ingest millions of leads into ClickHouse."
        description="Step 1: Register an S3/MinIO/Linode source with credentials. Step 2: Browse available files and select a CSV or Parquet to ingest. Step 3: Map source columns to universal schema fields. Step 4: Hit Ingest — the engine downloads, parses, deduplicates, and inserts into ClickHouse. Set up automated Ingestion Rules with cron schedules for hands-free daily syncs."
        action={<ServerSelector type="clickhouse" />}
      />

      {/* Global Alerts */}
      {error && (
        <div className="animate-fadeIn" style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'var(--red-muted)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--red)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="animate-fadeIn" style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'var(--green-muted)', border: '1px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--green)' }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* --- ACTIVE INGESTION BANNER --- */}
      {(() => {
        const activeJobs = jobs.filter(j => ['pending', 'downloading', 'uploading', 'ingesting'].includes(j.status));
        if (activeJobs.length === 0) return null;
        return (
          <div className="animate-fadeIn" style={{
            marginBottom: 28, borderRadius: 16, overflow: 'hidden',
            border: '1px solid var(--accent)', position: 'relative',
            background: 'var(--bg-card)',
          }}>
            {/* Animated gradient bar at top */}
            <div style={{
              height: 3, width: '100%',
              background: 'linear-gradient(90deg, var(--accent), var(--purple), var(--blue), var(--accent))',
              backgroundSize: '300% 100%',
              animation: 'ingestionShimmer 2s ease infinite',
            }} />

            {/* Overall Summary Bar */}
            <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'linear-gradient(135deg, var(--accent), var(--purple))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'ingestionPulse 2s ease-in-out infinite',
                  boxShadow: '0 0 20px var(--accent)', flexShrink: 0,
                }}>
                  <Loader2 size={20} color="var(--accent-contrast)" className="spin" />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {activeJobs.length === 1 ? 'Ingestion in Progress' : `${activeJobs.length} Ingestions in Progress`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {activeProgress && activeProgress.queueDepth > 0
                      ? `${activeProgress.queueDepth} queued · ${activeProgress.maxConcurrent} concurrent slots`
                      : "Processing in background — feel free to navigate away"}
                  </div>
                </div>
              </div>
              {/* Overall ETA + Throughput */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                {activeProgress && activeProgress.avgRowsPerSec > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)', fontFamily: 'monospace' }}>
                      {formatNumber(activeProgress.avgRowsPerSec)}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>rows/sec</div>
                  </div>
                )}
                {activeProgress?.overallEtaSec != null && activeProgress.overallEtaSec > 0 && (
                  <div style={{
                    textAlign: 'center', padding: '8px 16px', borderRadius: 10,
                    background: 'linear-gradient(135deg, var(--accent-muted), transparent)',
                    border: '1px solid var(--accent)',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', fontFamily: 'monospace' }}>
                      {formatDuration(activeProgress.overallEtaSec)}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>total eta</div>
                  </div>
                )}
              </div>
            </div>

            {/* Per-Job Rows */}
            <div style={{ padding: '0' }}>
              {activeJobs.map((j, idx) => {
                const steps = ['pending', 'downloading', 'uploading', 'ingesting', 'complete'];
                const currentIdx = steps.indexOf(j.status);
                const fileSize = Number(j.file_size_bytes) || 0;
                const rowsIngested = Number(j.rows_ingested) || 0;
                const prog = activeProgress?.jobs.find(p => p.id === j.id);
                const rps = prog?.rowsPerSec || 0;
                const eta = prog?.etaRemainingSec;
                const elapsed = prog?.elapsedSec || 0;

                return (
                  <div key={j.id} style={{
                    padding: '14px 24px',
                    borderBottom: idx < activeJobs.length - 1 ? '1px solid var(--border)' : 'none',
                    display: 'flex', alignItems: 'center', gap: 16,
                  }}>
                    {/* File info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.file_name}</span>
                        {fileSize > 0 && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace', flexShrink: 0 }}>{formatBytes(fileSize)}</span>}
                      </div>
                      {/* Step pipeline */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {(['downloading', 'uploading', 'ingesting'] as const).map((step, i) => {
                          const stepIdx = steps.indexOf(step);
                          const isDone = currentIdx > stepIdx;
                          const isCurrent = currentIdx === stepIdx;
                          const stepLabels = { downloading: 'Download', uploading: 'Upload', ingesting: 'Ingest' };
                          const stepColor = isDone ? 'var(--green)' : isCurrent ? statusColors[step] || 'var(--yellow)' : 'var(--text-tertiary)';
                          return (
                            <React.Fragment key={step}>
                              {i > 0 && <div style={{ flex: 1, height: 2, background: isDone ? 'var(--green)' : 'var(--border)', borderRadius: 1, maxWidth: 30 }} />}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                {isDone ? <CheckCircle2 size={12} color="var(--green)" /> : isCurrent ? (
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: stepColor, animation: 'ingestionDot 1.4s ease-in-out infinite', boxShadow: `0 0 6px ${stepColor}`, display: 'inline-block' }} />
                                ) : <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--border)', display: 'inline-block' }} />}
                                <span style={{ fontSize: 10, fontWeight: isCurrent ? 700 : 400, color: stepColor }}>{stepLabels[step]}</span>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                      {/* Progress bar */}
                      {j.status === 'ingesting' && rowsIngested > 0 && (
                        <div style={{ marginTop: 6, width: '100%', height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, var(--blue), var(--accent))', backgroundSize: '200% 100%', animation: 'ingestionShimmer 1.5s ease infinite', width: '100%' }} />
                        </div>
                      )}
                    </div>

                    {/* Per-job stats — prominent right-aligned */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
                      {/* Rows */}
                      <div style={{ textAlign: 'center', minWidth: 80 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                          {rowsIngested > 0 ? formatNumber(rowsIngested) : '—'}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>rows</div>
                      </div>
                      {/* Speed */}
                      <div style={{ textAlign: 'center', minWidth: 70 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: rps > 0 ? 'var(--green)' : 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                          {rps > 0 ? formatNumber(rps) : '—'}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>rows/s</div>
                      </div>
                      {/* Elapsed */}
                      <div style={{ textAlign: 'center', minWidth: 60 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          {elapsed > 0 ? formatDuration(elapsed) : '—'}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>elapsed</div>
                      </div>
                      {/* ETA */}
                      <div style={{ textAlign: 'center', minWidth: 70, padding: '6px 12px', borderRadius: 8, background: eta != null && eta > 0 ? 'var(--accent-muted)' : 'transparent' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: eta != null && eta > 0 ? 'var(--accent)' : 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                          {eta != null && eta > 0 ? formatDuration(eta) : '—'}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>eta</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* CSS keyframes */}
            <style>{`
              @keyframes ingestionShimmer {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
              @keyframes ingestionPulse {
                0%, 100% { transform: scale(1); box-shadow: 0 0 20px var(--accent); }
                50% { transform: scale(1.05); box-shadow: 0 0 30px var(--accent), 0 0 60px var(--purple); }
              }
              @keyframes ingestionDot {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
              }
            `}</style>
          </div>
        );
      })()}

      {/* --- STATS --- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Pending Jobs" value={loading ? '...' : String(pendingCount)} sub={pendingCount > 0 ? 'In progress' : 'All clear'} icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.06} />
        <StatCard label="Total Ingested" value={loading ? '...' : formatNumber(totalRows)} sub="Rows across all jobs" icon={<CloudDownload size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Storage Used" value={loading ? '...' : formatBytes(totalBytes)} sub="on Object Storage" icon={<HardDrive size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.18} />
        <StatCard label="Last Job" value={lastJob ? timeAgo(lastJob.started_at) : 'Never'} sub={lastJob?.file_name || 'No jobs yet'} icon={<FolderSync size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.24} />
      </div>

      {/* --- VIEW TABS --- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28,
        background: 'var(--bg-card)', borderRadius: 12, padding: '4px',
        border: '1px solid var(--border)', width: 'fit-content',
      }}>
        {[
          { key: 'data', label: 'Data & Sources', icon: <HardDrive size={14} /> },
          { key: 'merge', label: 'Merge Playground', icon: <GitMerge size={14} /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key as 'data' | 'merge')}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: activeView === tab.key ? 'var(--accent)' : 'transparent',
              color: activeView === tab.key ? 'var(--accent-contrast)' : 'var(--text-tertiary)',
              fontSize: 13, fontWeight: activeView === tab.key ? 700 : 500,
              cursor: 'pointer', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* --- MERGE PLAYGROUND TAB --- */}
      {activeView === 'merge' && <MergePlayground />}

      {/* --- DATA & SOURCES TAB --- */}
      {activeView === 'data' && (<>

      {/* --- S3 SOURCES MANAGEMENT --- */}
      <SectionHeader title="Configured S3 Sources" />
      <div className="animate-fadeIn stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 36 }}>

        {sources.map(src => (
          <div
            key={src.id}
            onClick={() => { setSelectedSourceId(src.id); setPrefix(''); }}
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
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4, borderRadius: 6, transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSource(src.id); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4, borderRadius: 6, transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong>Bucket:</strong> {src.bucket} <br />
              <strong>Region:</strong> {src.region}
              {src.prefix ? <><br /><strong>Prefix:</strong> {src.prefix}</> : null}
            </div>
          </div>
        ))}

        {/* Add New Source Card */}
        <div
          onClick={() => { setEditingSource({}); setTestCredsResult(null); setShowSourceModal(true); }}
          style={{
            background: 'transparent',
            border: '2px dashed var(--border)',
            borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'all 0.2s',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: 110, gap: 10,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 22, fontWeight: 700,
          }}>+</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Add New Source</div>
        </div>
      </div>

      {/* --- SOURCE BROWSER --- */}
      <SectionHeader title="Source Browser" />
      <div className="animate-fadeIn stagger-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Path Options</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input placeholder="e.g. 2026/...  (Hit Enter to browse)" value={prefix} onChange={(v: string) => setPrefix(v)} onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && browseFiles()} />
              <Button icon={browsing ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} onClick={() => browseFiles()} disabled={browsing}>
                {browsing ? 'Loading...' : 'Browse'}
              </Button>
            </div>
          </div>
          {selectedFiles.size > 0 && (
            <Button variant="primary" icon={ingestingBulk ? <Loader2 size={14} className="spin" /> : <Layers size={14} />} onClick={() => startBulkIngestion()} disabled={ingestingBulk}>
              Ingest {selectedFiles.size} Files
            </Button>
          )}
        </div>

        {/* Breadcrumbs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 16, padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 8 }}>
          <button onClick={() => { setPrefix(''); browseFiles(''); }} style={{ background: 'none', border: 'none', color: !prefix ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: !prefix ? 600 : 400, cursor: 'pointer' }}>Root</button>
          {prefix.split('/').filter(Boolean).map((p, i, arr) => {
            const currentPath = arr.slice(0, i + 1).join('/') + '/';
            const isLast = i === arr.length - 1;
            return (
              <span key={currentPath} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>/</span>
                <button
                  onClick={() => { setPrefix(currentPath); browseFiles(currentPath); }}
                  style={{ background: 'none', border: 'none', color: isLast ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: isLast ? 600 : 400, cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg-card)'}
                  onMouseOut={e => e.currentTarget.style.background = 'none'}
                >
                  {p}
                </button>
              </span>
            );
          })}
        </div>

        {(folders.length > 0 || sourceFiles.length > 0) ? (() => {
          // Apply type filter
          let filtered = fileTypeFilter === 'all' ? sourceFiles : sourceFiles.filter(f => getFileFormat(f.key.split('/').pop() || '') === fileTypeFilter);
          // Apply ingestion status filter
          if (ingestionStatusFilter === 'ingested') filtered = filtered.filter(f => fileStatusMap[f.key]?.status === 'complete');
          else if (ingestionStatusFilter === 'uningested') filtered = filtered.filter(f => !fileStatusMap[f.key] || !['complete', 'pending', 'downloading', 'uploading', 'ingesting'].includes(fileStatusMap[f.key].status));
          else if (ingestionStatusFilter === 'in_progress') filtered = filtered.filter(f => fileStatusMap[f.key] && ['pending', 'downloading', 'uploading', 'ingesting'].includes(fileStatusMap[f.key].status));
          const sorted = [...filtered].sort((a, b) => {
            let cmp = 0;
            if (fileSortKey === 'name') cmp = (a.key.split('/').pop() || '').localeCompare(b.key.split('/').pop() || '');
            else if (fileSortKey === 'size') cmp = a.size - b.size;
            else cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
            return fileSortAsc ? cmp : -cmp;
          });
          const formatCounts = sourceFiles.reduce((acc, f) => { const fmt = getFileFormat(f.key.split('/').pop() || ''); acc[fmt] = (acc[fmt] || 0) + 1; return acc; }, {} as Record<string, number>);
          const ingestedCount = sourceFiles.filter(f => fileStatusMap[f.key]?.status === 'complete').length;
          const inProgressCount = sourceFiles.filter(f => fileStatusMap[f.key] && ['pending', 'downloading', 'uploading', 'ingesting'].includes(fileStatusMap[f.key].status)).length;
          const uningestedCount = sourceFiles.length - ingestedCount - inProgressCount;

          return (
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {/* Sort & Filter Toolbar */}
              {sourceFiles.length > 0 && (
                <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={() => {
                      const filteredKeys = filtered.map(f => f.key);
                      const allSelected = filteredKeys.every(k => selectedFiles.has(k));
                      if (allSelected) {
                        const next = new Set(selectedFiles);
                        filteredKeys.forEach(k => next.delete(k));
                        setSelectedFiles(next);
                      } else {
                        setSelectedFiles(new Set([...selectedFiles, ...filteredKeys]));
                      }
                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: filtered.length > 0 && filtered.every(f => selectedFiles.has(f.key)) ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                      {filtered.length > 0 && filtered.every(f => selectedFiles.has(f.key)) ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                      {filtered.length} file{filtered.length !== 1 ? 's' : ''}{fileTypeFilter !== 'all' ? ` (${fileTypeFilter.toUpperCase()})` : ''}{ingestionStatusFilter !== 'all' ? ` · ${ingestionStatusFilter.replace('_', ' ')}` : ''}
                      {folders.length > 0 ? ` · ${folders.length} folder${folders.length !== 1 ? 's' : ''}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Type filter */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Filter size={12} color="var(--text-tertiary)" />
                      <select value={fileTypeFilter} onChange={e => setFileTypeFilter(e.target.value as FileFormat | 'all')} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
                        color: 'var(--text-primary)', fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer',
                      }}>
                        <option value="all">All Types</option>
                        {formatCounts['csv'] && <option value="csv">CSV ({formatCounts['csv']})</option>}
                        {formatCounts['gz'] && <option value="gz">GZ ({formatCounts['gz']})</option>}
                        {formatCounts['parquet'] && <option value="parquet">Parquet ({formatCounts['parquet']})</option>}
                        {formatCounts['other'] && <option value="other">Other ({formatCounts['other']})</option>}
                      </select>
                    </div>
                    {/* Ingestion Status filter */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <select value={ingestionStatusFilter} onChange={e => setIngestionStatusFilter(e.target.value as IngestionStatusFilter)} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
                        color: 'var(--text-primary)', fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer',
                      }}>
                        <option value="all">All Status</option>
                        {ingestedCount > 0 && <option value="ingested">✓ Ingested ({ingestedCount})</option>}
                        {uningestedCount > 0 && <option value="uningested">○ Uningested ({uningestedCount})</option>}
                        {inProgressCount > 0 && <option value="in_progress">⟳ In Progress ({inProgressCount})</option>}
                      </select>
                    </div>
                    {/* Sort */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ArrowUpDown size={12} color="var(--text-tertiary)" />
                      <select value={fileSortKey} onChange={e => setFileSortKey(e.target.value as FileSortKey)} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
                        color: 'var(--text-primary)', fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer',
                      }}>
                        <option value="date">Date</option>
                        <option value="name">Name</option>
                        <option value="size">Size</option>
                      </select>
                      <button onClick={() => setFileSortAsc(!fileSortAsc)} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
                        cursor: 'pointer', padding: '3px 6px', display: 'flex', alignItems: 'center',
                        color: 'var(--text-primary)',
                      }}>
                        {fileSortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {folders.map((f) => {
                const folderName = f.endsWith('/') ? f.slice(0, -1).split('/').pop() : f.split('/').pop();
                return (
                  <div
                    key={f}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border)',
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onClick={() => { setPrefix(f); browseFiles(f); }}
                    onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseOut={e => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Folder size={16} color="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{folderName}/</div>
                    </div>
                  </div>
                )
              })}

              {(() => {
                // Group files by month
                const groups: Record<string, typeof sorted> = {};
                for (const f of sorted) {
                  const d = new Date(f.modified);
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  if (!groups[key]) groups[key] = [];
                  groups[key].push(f);
                }
                const groupKeys = Object.keys(groups).sort((a, b) => fileSortAsc ? a.localeCompare(b) : b.localeCompare(a));

                return groupKeys.map(gk => {
                  const gFiles = groups[gk];
                  const [y, m] = gk.split('-');
                  const monthLabel = new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  const gTotalSize = gFiles.reduce((s, f) => s + f.size, 0);
                  const gIngested = gFiles.filter(f => fileStatusMap[f.key]?.status === 'complete').length;

                  return (
                    <React.Fragment key={gk}>
                      {/* Month Group Header */}
                      <div style={{
                        padding: '8px 18px', background: 'var(--bg-hover)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Calendar size={13} color="var(--accent)" />
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>{monthLabel}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                            {gFiles.length} file{gFiles.length !== 1 ? 's' : ''} · {formatBytes(gTotalSize)}
                          </span>
                        </div>
                        {gIngested > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                            {gIngested}/{gFiles.length} ingested
                          </span>
                        )}
                      </div>
                      {gFiles.map((f) => {
                        const fileName = f.key.split('/').pop() || '';
                        const format = getFileFormat(fileName);
                        const isSelected = selectedFiles.has(f.key);
                        return (
                          <div
                            key={f.key}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '12px 18px', borderBottom: '1px solid var(--border)',
                              transition: 'background 0.15s', cursor: 'pointer',
                              background: isSelected ? 'var(--bg-hover)' : 'transparent'
                            }}
                            onMouseOver={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                            onMouseOut={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                            onClick={() => toggleFile(f.key)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <button onClick={(e) => { e.stopPropagation(); toggleFile(f.key); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: isSelected ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                                {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                              </button>
                              <FileText size={16} color="var(--text-tertiary)" />
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{fileName}</span>
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    padding: '2px 6px', borderRadius: 4,
                                    color: FORMAT_COLORS[format], background: FORMAT_COLORS[format] + '18',
                                  }}>{format === 'gz' ? 'GZ' : format.toUpperCase()}</span>
                                  {fileStatusMap[f.key] && (() => {
                                    const st = fileStatusMap[f.key];
                                    const cfg = st.status === 'complete'
                                      ? { label: '✓ Ingested', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' }
                                      : st.status === 'rolled_back'
                                      ? { label: '↩ Rolled Back', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
                                      : st.status === 'failed'
                                      ? { label: '✗ Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
                                      : ['pending', 'downloading', 'uploading', 'ingesting'].includes(st.status)
                                      ? { label: '⟳ In Progress', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' }
                                      : null;
                                    if (!cfg) return null;
                                    return (
                                      <span title={`${st.rowsIngested.toLocaleString()} rows`} style={{
                                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                        color: cfg.color, background: cfg.bg, letterSpacing: '0.03em',
                                      }}>{cfg.label}</span>
                                    );
                                  })()}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                  {formatBytes(f.size)} · {new Date(f.modified).toLocaleDateString()} {new Date(f.modified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {getFileFormat(fileName) !== 'other' && (
                                <Button
                                  variant="secondary"
                                  icon={previewLoading === f.key ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
                                  onClick={(e: any) => { e.stopPropagation(); handlePreview(f.key); }}
                                  disabled={previewLoading !== null}
                                  style={{ padding: '6px 10px', fontSize: 11 }}
                                >
                                  {previewLoading === f.key ? '...' : 'Preview'}
                                </Button>
                              )}
                              <Button
                                variant="secondary"
                                icon={ingesting === f.key ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                                onClick={(e: any) => { e.stopPropagation(); startIngestion(f.key); }}
                                disabled={ingesting !== null || ingestingBulk}
                              >
                                {ingesting === f.key ? 'Starting...' : 'Ingest'}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                });
              })()}
            </div>
          );
        })() : (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, background: 'var(--bg-hover)', borderRadius: 8 }}>
            {browsing ? 'Loading...' : 'Select a source and click Browse or navigate using breadcrumbs to see available data.'}
          </div>
        )}
      </div>

      {/* --- DATE-RANGE BULK INGESTION --- */}
      <SectionHeader title="Date-Range Bulk Ingestion" />
      <div className="animate-fadeIn stagger-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 36 }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
          Ingest all files from the currently selected source that were last modified within a specific date range. Useful for backfilling or re-processing historical data.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Start Date</label>
            <input type="date" value={dateRangeStart} onChange={e => setDateRangeStart(e.target.value)} style={{
              background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-primary)', fontSize: 13, padding: '8px 12px', cursor: 'pointer',
            }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>End Date</label>
            <input type="date" value={dateRangeEnd} onChange={e => setDateRangeEnd(e.target.value)} style={{
              background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-primary)', fontSize: 13, padding: '8px 12px', cursor: 'pointer',
            }} />
          </div>
          <Button
            onClick={handleDateRangeIngestion}
            disabled={dateRangeIngesting || !dateRangeStart || !dateRangeEnd || !selectedSourceId}
            icon={dateRangeIngesting ? <Loader2 size={14} className="spin" /> : <Calendar size={14} />}
          >
            {dateRangeIngesting ? 'Processing...' : 'Ingest Date Range'}
          </Button>
        </div>
        {!selectedSourceId && (
          <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>Select an S3 source above first.</p>
        )}
      </div>

      {/* --- AUTO-INGEST RULES --- */}
      <SectionHeader title={`Auto-Ingest Rules (${rules.length})`} action="+ Create Rule" onAction={() => { setEditingRule({ source_id: selectedSourceId || sources[0]?.id || '', file_types: ['csv', 'gz', 'parquet'], schedule: '0 */6 * * *', skip_duplicates: 1 } as any); setShowRuleModal(true); }} />
      <div className="animate-fadeIn stagger-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 36 }}>
        {rules.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rules.map(rule => {
              const sourceName = sources.find(s => s.id === rule.source_id)?.label || 'Unknown';
              const scheduleLabel = SCHEDULE_PRESETS.find(p => p.value === rule.schedule)?.label || rule.schedule;
              return (
                <div key={rule.id} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px',
                  background: 'var(--bg-hover)', borderRadius: 12, border: '1px solid var(--border)',
                  opacity: rule.enabled ? 1 : 0.6, transition: 'all 0.2s',
                }}>
                  {/* Toggle */}
                  <button onClick={() => handleToggleRule(rule.id, !rule.enabled)} style={{
                    width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: rule.enabled ? 'var(--green)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', background: 'var(--bg-card)', position: 'absolute', top: 2,
                      left: rule.enabled ? 18 : 2, transition: 'left 0.2s',
                    }} />
                  </button>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Zap size={14} color={rule.enabled ? 'var(--accent)' : 'var(--text-tertiary)'} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{rule.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 }}>· {sourceName}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span><Settings size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />{scheduleLabel}</span>
                      {rule.prefix_pattern && <span>📂 {rule.prefix_pattern}</span>}
                      <span>Types: {rule.file_types.map(t => t.toUpperCase()).join(', ')}</span>
                      {rule.skip_duplicates ? <span>🔄 Skip Dupes</span> : null}
                      {rule.last_run_at && (
                        <span style={{ color: rule.last_run_status === 'success' ? 'var(--green)' : rule.last_run_status === 'empty' ? 'var(--text-tertiary)' : 'var(--yellow)' }}>
                          Last: {timeAgo(rule.last_run_at)} — {rule.files_found_last_run ?? 0} found, {rule.files_ingested_last_run ?? 0} ingested
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <Button variant="secondary" icon={runningRuleId === rule.id ? <Loader2 size={12} className="spin" /> : <RotateCw size={12} />}
                      onClick={() => handleRunRule(rule.id)} disabled={runningRuleId !== null}>
                      {runningRuleId === rule.id ? 'Running...' : 'Run Now'}
                    </Button>
                    <button onClick={() => { setEditingRule(rule); setShowRuleModal(true); }} style={{
                      background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                      padding: '4px 8px', color: 'var(--text-tertiary)',
                    }}><Edit2 size={12} /></button>
                    <button onClick={() => handleDeleteRule(rule.id)} style={{
                      background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                      padding: '4px 8px', color: 'var(--red)',
                    }}><Trash2 size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            <Zap size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>No auto-ingestion rules yet</div>
            <div style={{ marginTop: 4 }}>Create a rule to automatically detect and ingest new files on a schedule.</div>
          </div>
        )}
      </div>

      {/* --- JOB HISTORY --- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Ingestion Jobs ({jobs.length})</h3>
          {/* Status counts */}
          {jobs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
              {Object.entries(
                jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {} as Record<string, number>)
              ).map(([status, count]) => (
                <span key={status} style={{
                  padding: '2px 8px', borderRadius: 6, fontWeight: 600,
                  color: statusColors[status] || 'var(--text-tertiary)',
                  background: (statusColors[status] || 'var(--text-tertiary)') + '18',
                }}>{count} {status}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {jobs.some(j => ['pending', 'downloading', 'uploading', 'ingesting'].includes(j.status)) && (
            <Button variant="danger" style={{ padding: '5px 10px', fontSize: 11 }} icon={<X size={12} />}
              onClick={async () => {
                if (!confirm('Cancel all running ingestion jobs?')) return;
                try {
                  const r = await apiCall<{ cancelled: number }>('/api/ingestion/cancel-running', { method: 'POST' });
                  alert(`Cancelled ${r.cancelled} job(s)`);
                  fetchData();
                } catch (e: any) { alert(e.message); }
              }}>Cancel Running</Button>
          )}
          {jobs.some(j => j.status === 'cancelled') && (
            <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 11 }} icon={<X size={12} />}
              onClick={async () => {
                if (!confirm(`Delete all ${jobs.filter(j => j.status === 'cancelled').length} cancelled job records?`)) return;
                try {
                  const r = await apiCall<{ deleted: number }>('/api/ingestion/clear-jobs', { method: 'POST', body: { status: 'cancelled' } });
                  alert(`Cleared ${r.deleted} cancelled job(s)`);
                  fetchData();
                } catch (e: any) { alert(e.message); }
              }}>Clear Cancelled</Button>
          )}
          {jobs.some(j => j.status === 'rolled_back') && (
            <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 11 }} icon={<Trash2 size={12} />}
              onClick={async () => {
                if (!confirm(`Delete all ${jobs.filter(j => j.status === 'rolled_back').length} rolled-back job records?`)) return;
                try {
                  const r = await apiCall<{ deleted: number }>('/api/ingestion/clear-jobs', { method: 'POST', body: { status: 'rolled_back' } });
                  alert(`Cleared ${r.deleted} rolled-back job(s)`);
                  fetchData();
                } catch (e: any) { alert(e.message); }
              }}>Clear Rolled Back</Button>
          )}
          {jobs.some(j => j.status === 'failed') && (
            <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 11 }} icon={<Trash2 size={12} />}
              onClick={async () => {
                if (!confirm(`Delete all ${jobs.filter(j => j.status === 'failed').length} failed job records?`)) return;
                try {
                  const r = await apiCall<{ deleted: number }>('/api/ingestion/clear-jobs', { method: 'POST', body: { status: 'failed' } });
                  alert(`Cleared ${r.deleted} failed job(s)`);
                  fetchData();
                } catch (e: any) { alert(e.message); }
              }}>Clear Failed</Button>
          )}
          {jobs.some(j => j.status === 'complete') && (
            <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 11 }} icon={<CheckCircle2 size={12} />}
              onClick={async () => {
                if (!confirm(`Delete all ${jobs.filter(j => j.status === 'complete').length} completed job records?`)) return;
                try {
                  const r = await apiCall<{ deleted: number }>('/api/ingestion/clear-jobs', { method: 'POST', body: { status: 'complete' } });
                  alert(`Cleared ${r.deleted} completed job(s)`);
                  fetchData();
                } catch (e: any) { alert(e.message); }
              }}>Clear Completed</Button>
          )}
          {jobs.length > 5 && (
            <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 11 }} icon={<Trash2 size={12} />}
              onClick={async () => {
                if (!confirm('Delete ALL finished/failed/cancelled job records? Running jobs are untouched.')) return;
                try {
                  const r = await apiCall<{ deleted: number }>('/api/ingestion/clear-jobs', { method: 'POST', body: { status: 'all' } });
                  alert(`Cleared ${r.deleted} job(s)`);
                  fetchData();
                } catch (e: any) { alert(e.message); }
              }}>Clear All</Button>
          )}
          <Button variant="secondary" style={{ padding: '5px 10px', fontSize: 11 }} icon={<RotateCw size={12} />} onClick={fetchData}>Refresh</Button>
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        {jobs.length > 0 ? (() => {
          const sortedJobs = [...jobs].sort((a, b) => {
            let cmp = 0;
            if (jobSortKey === 'date') cmp = new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
            else if (jobSortKey === 'file') cmp = a.file_name.localeCompare(b.file_name);
            else if (jobSortKey === 'rows') cmp = Number(a.rows_ingested || 0) - Number(b.rows_ingested || 0);
            else if (jobSortKey === 'status') cmp = a.status.localeCompare(b.status);
            return jobSortAsc ? cmp : -cmp;
          });

          const jobHeaders: { label: string; key: JobSortKey }[] = [
            { label: 'File', key: 'file' },
            { label: 'Rows', key: 'rows' },
            { label: 'Status', key: 'status' },
            { label: 'Started', key: 'date' },
          ];

          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Job ID</th>
                    {jobHeaders.map(h => (
                      <th key={h.key} onClick={() => { if (jobSortKey === h.key) setJobSortAsc(!jobSortAsc); else { setJobSortKey(h.key); setJobSortAsc(false); } }}
                        style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: jobSortKey === h.key ? 'var(--accent)' : 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', cursor: 'pointer', userSelect: 'none' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {h.label}
                          {jobSortKey === h.key && (jobSortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                        </span>
                      </th>
                    ))}
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>By</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Size</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Group jobs by month
                    const monthGroups: Record<string, typeof sortedJobs> = {};
                    for (const j of sortedJobs) {
                      const d = new Date(j.started_at);
                      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      if (!monthGroups[mk]) monthGroups[mk] = [];
                      monthGroups[mk].push(j);
                    }
                    const monthKeys = Object.keys(monthGroups).sort((a, b) => jobSortAsc ? a.localeCompare(b) : b.localeCompare(a));

                    return monthKeys.flatMap(mk => {
                      const mJobs = monthGroups[mk];
                      const [y, m] = mk.split('-');
                      const label = new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                      const totalRows = mJobs.reduce((s, j) => s + Number(j.rows_ingested || 0), 0);
                      const totalSize = mJobs.reduce((s, j) => s + Number(j.file_size_bytes || 0), 0);
                      const completeCount = mJobs.filter(j => j.status === 'complete').length;

                      return [
                        <tr key={`month-${mk}`}>
                          <td colSpan={8} style={{
                            padding: '10px 16px', background: 'var(--bg-hover)',
                            borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Calendar size={13} color="var(--accent)" />
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                  {mJobs.length} job{mJobs.length !== 1 ? 's' : ''} · {formatNumber(totalRows)} rows · {formatBytes(totalSize)}
                                </span>
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                                {completeCount}/{mJobs.length} complete
                              </span>
                            </div>
                          </td>
                        </tr>,
                        ...mJobs.map((job) => (
                    <tr key={job.id} style={{ transition: 'background 0.1s' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseOut={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 12 }}>{job.id.slice(0, 8)}...</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.file_name}</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>{formatNumber(job.rows_ingested)}</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 6, color: statusColors[job.status] || 'var(--text-secondary)', background: (statusColors[job.status] || 'var(--text-secondary)') + '18' }}>{job.status.replace('_', ' ')}</span>
                        {job.status === 'archived' && (job as any).delete_after && (
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 6 }}>expires {timeAgo((job as any).delete_after)}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)' }}>{timeAgo(job.started_at)}</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)', fontSize: 12 }}>
                        {job.performed_by_name || <span style={{ opacity: 0.4 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)' }}>{formatBytes(Number(job.file_size_bytes))}</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(job.status === 'complete' || job.status === 'archived') && (
                            <button
                              onClick={() => openJobDataViewer(job.id)}
                              style={{ padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: 'pointer', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 3 }}
                              onMouseOver={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent-contrast)'; }}
                              onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent)'; }}
                            ><Eye size={10} /> View Data</button>
                          )}
                          {(job.status === 'complete' || job.status === 'archived') && (
                            <button
                              onClick={async () => {
                                if (!confirm(`Delete ALL ${formatNumber(job.rows_ingested)} leads from "${job.file_name}"? This cannot be undone.`)) return;
                                try {
                                  const r = await apiCall<{ rowsDeleted: number }>(`/api/ingestion/${job.id}/rollback`, { method: 'POST' });
                                  setSuccess(`Rolled back: ${formatNumber(r.rowsDeleted)} rows deleted from ${job.file_name}`);
                                  fetchData();
                                  setTimeout(() => setSuccess(null), 5000);
                                } catch (e: any) { setError(e.message); }
                              }}
                              style={{ padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: 'pointer', border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', transition: 'all 0.15s' }}
                              onMouseOver={e => { e.currentTarget.style.background = 'var(--red)'; e.currentTarget.style.color = 'var(--accent-contrast)'; }}
                              onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--red)'; }}
                            >Rollback</button>
                          )}
                          {job.status === 'complete' && (
                            <button
                              onClick={async () => {
                                const daysStr = prompt('Archive and auto-delete leads after how many days?', '7');
                                if (!daysStr) return;
                                const days = Number(daysStr);
                                if (isNaN(days) || days < 1) { alert('Enter a valid number of days'); return; }
                                try {
                                  const r = await apiCall<{ deleteAfter: string }>(`/api/ingestion/${job.id}/archive`, { method: 'POST', body: { days } });
                                  setSuccess(`Archived ${job.file_name} — leads will auto-delete after ${r.deleteAfter}`);
                                  fetchData();
                                  setTimeout(() => setSuccess(null), 5000);
                                } catch (e: any) { setError(e.message); }
                              }}
                              style={{ padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: 'pointer', border: '1px solid var(--purple)', background: 'transparent', color: 'var(--purple)', transition: 'all 0.15s' }}
                              onMouseOver={e => { e.currentTarget.style.background = 'var(--purple)'; e.currentTarget.style.color = 'var(--accent-contrast)'; }}
                              onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--purple)'; }}
                            >Archive</button>
                          )}
                          {['failed', 'cancelled', 'rolled_back'].includes(job.status) && (
                            <button
                              onClick={async () => {
                                if (!confirm(`Retry ingestion of "${job.file_name}"?\n\nThis will clean any partial data from the failed attempt and re-run the same job.`)) return;
                                try {
                                  const r = await apiCall<{ ok: boolean; jobId: string; cleaned: number }>(`/api/ingestion/${job.id}/retry`, { method: 'POST' });
                                  setSuccess(`Retrying ${job.file_name}${r.cleaned > 0 ? ` (cleaned ${r.cleaned.toLocaleString()} partial rows)` : ''}`);
                                  fetchData();
                                  setTimeout(() => setSuccess(null), 5000);
                                } catch (e: any) { setError(e.message); }
                              }}
                              style={{ padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: 'pointer', border: '1px solid var(--green)', background: 'transparent', color: 'var(--green)', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 3 }}
                              onMouseOver={e => { e.currentTarget.style.background = 'var(--green)'; e.currentTarget.style.color = 'var(--accent-contrast)'; }}
                              onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--green)'; }}
                            ><RotateCw size={10} /> Retry</button>
                          )}
                        </div>
                      </td>
                    </tr>
                        ))
                      ];
                    });
                  })()}
                </tbody>
              </table>
            </div>
          );
        })() : (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <CloudDownload size={24} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>{loading ? 'Loading...' : 'No ingestion jobs yet'}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Browse S3 source files above and click Ingest to start</div>
          </div>
        )}
      </div>

      {/* --- ADD / EDIT SOURCE MODAL --- */}
      {showSourceModal && editingSource && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) { setShowSourceModal(false); setEditingSource(null); } }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
          }}
        >
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
                <Input placeholder="e.g. Partner A Data" value={editingSource.label || ''} onChange={(v: string) => setEditingSource({ ...editingSource, label: v })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Bucket</label>
                  <Input placeholder="e.g. my-bucket" value={editingSource.bucket || ''} onChange={(v: string) => setEditingSource({ ...editingSource, bucket: v })} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Region</label>
                  <Input placeholder="e.g. us-east-1" value={editingSource.region || ''} onChange={(v: string) => setEditingSource({ ...editingSource, region: v })} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Access Key ID {editingSource.id ? '(Leave blank to keep)' : ''}</label>
                <Input placeholder="AKIA..." value={editingSource.access_key || ''} onChange={(v: string) => setEditingSource({ ...editingSource, access_key: v })} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Secret Access Key {editingSource.id ? '(Leave blank to keep)' : ''}</label>
                <Input placeholder="Secret key..." value={editingSource.secret_key || ''} onChange={(v: string) => setEditingSource({ ...editingSource, secret_key: v })} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Endpoint URL <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(MinIO / Linode / S3-compatible)</span></label>
                <Input placeholder="e.g. https://us-east-1.linodeobjects.com" value={editingSource.endpoint_url || ''} onChange={(v: string) => setEditingSource({ ...editingSource, endpoint_url: v })} />
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Leave blank for standard AWS S3</p>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Default Prefix</label>
                <Input placeholder="e.g. outgoing/" value={editingSource.prefix || ''} onChange={(v: string) => setEditingSource({ ...editingSource, prefix: v })} />
              </div>
            </div>

            {testCredsResult && (
              <div style={{
                marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
                background: testCredsResult.ok ? 'var(--green-muted)' : 'var(--red-muted)',
                color: testCredsResult.ok ? 'var(--green)' : 'var(--red)', border: `1px solid ${testCredsResult.ok ? 'var(--green)' : 'var(--red)'}`
              }}>
                {testCredsResult.msg}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
              <Button variant="secondary" onClick={() => { setShowSourceModal(false); setEditingSource(null); }}>Cancel</Button>
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

      {/* --- CREATE / EDIT RULE MODAL --- */}
      {showRuleModal && editingRule && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) { setShowRuleModal(false); setEditingRule(null); } }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
          }}
        >
          <div className="animate-scaleIn" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            padding: 32, borderRadius: 20, width: '100%', maxWidth: 540,
            boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <h2 style={{ margin: '0 0 20px 0', fontSize: 20, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={20} color="var(--accent)" />
              {editingRule.id ? 'Edit Auto-Ingest Rule' : 'Create Auto-Ingest Rule'}
            </h2>

            <div style={{ display: 'grid', gap: 16 }}>
              {/* Label */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Rule Name</label>
                <Input placeholder="e.g. Daily 5x Coop Sync" value={editingRule.label || ''} onChange={(v: string) => setEditingRule({ ...editingRule, label: v })} />
              </div>

              {/* Source + Prefix */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>S3 Source</label>
                  <select value={editingRule.source_id || ''} onChange={e => setEditingRule({ ...editingRule, source_id: e.target.value })} style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
                  }}>
                    <option value="">Select source...</option>
                    {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Prefix / Folder</label>
                  <Input placeholder="e.g. outgoing/apis/" value={editingRule.prefix_pattern || ''} onChange={(v: string) => setEditingRule({ ...editingRule, prefix_pattern: v })} />
                </div>
              </div>

              {/* File Types */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>File Types</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {(['csv', 'gz', 'parquet'] as const).map(t => {
                    const types = editingRule.file_types || ['csv', 'gz', 'parquet'];
                    const checked = types.includes(t);
                    return (
                      <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          const next = checked ? types.filter(x => x !== t) : [...types, t];
                          setEditingRule({ ...editingRule, file_types: next });
                        }} style={{ accentColor: 'var(--accent)' }} />
                        {t.toUpperCase()}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Schedule */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Schedule</label>
                <select value={editingRule.schedule || '0 */6 * * *'} onChange={e => setEditingRule({ ...editingRule, schedule: e.target.value })} style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
                }}>
                  {SCHEDULE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.value})</option>)}
                </select>
              </div>

              {/* Date + Size filters */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Only Files After (optional)</label>
                  <input type="date" value={editingRule.min_date ? editingRule.min_date.split('T')[0] : ''}
                    onChange={e => setEditingRule({ ...editingRule, min_date: e.target.value || null })} style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
                      background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
                    }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Min File Size (MB)</label>
                  <Input placeholder="e.g. 1" value={(editingRule as any).min_file_size_mb?.toString() || ''}
                    onChange={(v: string) => setEditingRule({ ...editingRule, min_file_size_mb: v ? Number(v) : null } as any)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Max File Size (MB)</label>
                  <Input placeholder="e.g. 500" value={editingRule.max_file_size_mb?.toString() || ''}
                    onChange={(v: string) => setEditingRule({ ...editingRule, max_file_size_mb: v ? Number(v) : null })} />
                </div>
              </div>

              {/* Skip Duplicates */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={!!editingRule.skip_duplicates}
                    onChange={() => setEditingRule({ ...editingRule, skip_duplicates: editingRule.skip_duplicates ? 0 : 1 })}
                    style={{ accentColor: 'var(--accent)' }} />
                  Skip already-ingested files (recommended)
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 28 }}>
              <Button variant="secondary" onClick={() => { setShowRuleModal(false); setEditingRule(null); }}>Cancel</Button>
              <Button onClick={handleSaveRule} disabled={!editingRule.label || !editingRule.source_id}>Save Rule</Button>
            </div>
          </div>
        </div>
      )}

      {/* --- CSV PREVIEW MODAL --- */}
      {previewData && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewData(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
            padding: 24,
          }}
        >
          <div className="animate-scaleIn" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            borderRadius: 20, width: '100%', maxWidth: 960, maxHeight: '85vh',
            boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>File Preview</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{previewData.fileName} — {previewData.columns.length} columns, {previewData.rows.length} sample rows</p>
              </div>
              <button
                onClick={() => setPreviewData(null)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', border: 'none', color: 'var(--text-tertiary)',
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-hover)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>#</th>
                    {previewData.columns.map((col, ci) => (
                      <th key={ci} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows.map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseOut={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '8px 14px', color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: 10 }}>{ri + 1}</td>
                      {row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '8px 14px', color: 'var(--text-primary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cell}>{cell || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <Button variant="secondary" onClick={() => setPreviewData(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── JOB DATA VIEWER MODAL ── */}
      {viewingJobId && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeJobDataViewer(); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
        >
          <div className="animate-scaleIn" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            borderRadius: 20, width: '96vw', maxWidth: 1400, height: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 32px 64px rgba(0,0,0,0.5)',
          }}>
            {/* Header */}
            <div style={{
              padding: '20px 28px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
              background: 'var(--bg-card)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Table2 size={20} color="var(--accent-contrast)" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {jobData?.job.file_name || 'Loading...'}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {jobData ? `${formatNumber(jobData.total)} rows · ${jobData.columns.length} columns` : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Search */}
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={jobDataSearch}
                    onChange={e => setJobDataSearch(e.target.value)}
                    style={{
                      background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8,
                      color: 'var(--text-primary)', fontSize: 13, padding: '8px 12px 8px 32px', width: 220,
                      outline: 'none',
                    }}
                  />
                </div>
                {/* Export */}
                <button
                  onClick={() => viewingJobId && exportJobData(viewingJobId)}
                  disabled={jobDataExporting}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
                    display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                    opacity: jobDataExporting ? 0.6 : 1,
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseOut={e => { e.currentTarget.style.background = 'var(--bg-card)'; }}
                >
                  {jobDataExporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                  Export CSV
                </button>
                {/* Close */}
                <button onClick={closeJobDataViewer} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: 8, color: 'var(--text-tertiary)', transition: 'all 0.15s',
                }}><X size={16} /></button>
              </div>
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              {jobDataLoading && !jobData && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
                  <Loader2 size={24} className="spin" style={{ marginRight: 10 }} /> Loading data...
                </div>
              )}
              {jobData && jobData.rows.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', flexDirection: 'column', gap: 8 }}>
                  <Search size={28} style={{ opacity: 0.4 }} />
                  <div style={{ fontWeight: 600 }}>No matching rows</div>
                  {jobDataSearch && <div style={{ fontSize: 12 }}>Try adjusting your search</div>}
                </div>
              )}
              {jobData && jobData.rows.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-hover)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>#</th>
                      {jobData.columns.map(col => (
                        <th
                          key={col}
                          onClick={() => {
                            if (jobDataSortBy === col) {
                              setJobDataSortDir(d => d === 'asc' ? 'desc' : 'asc');
                            } else {
                              setJobDataSortBy(col);
                              setJobDataSortDir('asc');
                            }
                          }}
                          style={{
                            padding: '10px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10,
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                            color: jobDataSortBy === col ? 'var(--accent)' : 'var(--text-tertiary)',
                            borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap',
                            cursor: 'pointer', userSelect: 'none',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {col}
                            {jobDataSortBy === col && (jobDataSortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobData.rows.map((row, ri) => (
                      <tr key={ri} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseOut={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={{ padding: '7px 12px', color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: 10 }}>
                          {((jobData.page - 1) * jobData.pageSize) + ri + 1}
                        </td>
                        {jobData.columns.map(col => (
                          <td key={col} style={{
                            padding: '7px 12px', color: 'var(--text-primary)',
                            maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }} title={String(row[col] ?? '')}>
                            {row[col] != null && row[col] !== '' ? String(row[col]) : <span style={{ color: 'var(--text-tertiary)', opacity: 0.4 }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {/* Loading overlay for subsequent pages */}
              {jobDataLoading && jobData && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                  background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Loader2 size={20} className="spin" color="var(--accent)" />
                </div>
              )}
            </div>

            {/* Pagination Footer */}
            {jobData && jobData.total > 0 && (
              <div style={{
                padding: '14px 28px', borderTop: '1px solid var(--border)', display: 'flex',
                alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                background: 'var(--bg-card)', fontSize: 12,
              }}>
                <div style={{ color: 'var(--text-tertiary)' }}>
                  Showing {((jobData.page - 1) * jobData.pageSize) + 1}–{Math.min(jobData.page * jobData.pageSize, jobData.total)} of {formatNumber(jobData.total)} rows
                  <select
                    value={browsePageSize}
                    onChange={e => { setBrowsePageSize(Number(e.target.value)); setJobDataPage(1); }}
                    style={{
                      marginLeft: 8, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                    }}
                    title="Rows per page"
                  >
                    {[
                      { n: 25, label: '25' },
                      { n: 50, label: '50 ★' },
                      { n: 100, label: '100' },
                      { n: 200, label: '200' },
                      { n: 500, label: '500' },
                      { n: 1000, label: '1k' },
                    ].map(opt => (
                      <option key={opt.n} value={opt.n}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setJobDataPage(p => Math.max(1, p - 1))}
                    disabled={jobData.page <= 1}
                    style={{
                      padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
                      opacity: jobData.page <= 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <ChevronLeft size={14} /> Prev
                  </button>
                  <span style={{ padding: '0 8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Page {jobData.page} of {Math.ceil(jobData.total / jobData.pageSize)}
                  </span>
                  <button
                    onClick={() => setJobDataPage(p => p + 1)}
                    disabled={jobData.page * jobData.pageSize >= jobData.total}
                    style={{
                      padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
                      opacity: jobData.page * jobData.pageSize >= jobData.total ? 0.3 : 1, display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
    )}

      {/* AI Agent */}
      <div style={{ marginTop: 36 }}>
        <AgentCard
          slug="data_scientist"
          contextLabel={jobData ? `Analyzing: ${jobData.job.file_name} (${jobData.job.rows_ingested} rows)` : 'Data Ingestion — Column Mapping & Quality'}
          context={jobData ? { table: 'leads', source_file: jobData.job.file_name, rows_ingested: jobData.job.rows_ingested, columns: jobData.columns, sampleRows: jobData.rows?.slice(0, 3) } : undefined}
        />
      </div>
    </>
  );
}
