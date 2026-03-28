import React, { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { Network, CheckCircle, XCircle, ShieldAlert, Zap, Database } from 'lucide-react';
import { PageHeader, SectionHeader, Button, Badge } from '../components/UI';
import { apiCall } from '../lib/api';

interface CheckConfig {
  syntax: boolean;
  typoFix: boolean;
  deduplicate: boolean;
  disposable: boolean;
  roleBased: boolean;
  freeProvider: boolean;
  mxLookup: boolean;
  smtpVerify: boolean;
  catchAll: boolean;
}

interface SeverityWeights {
  syntax_invalid: number;
  disposable: number;
  no_mx: number;
  smtp_invalid: number;
  smtp_risky: number;
  smtp_greylisted: number;
  smtp_mailbox_full: number;
  catch_all: number;
  role_based: number;
  free_provider: number;
  typo_detected: number;
  no_spf: number;
  no_dmarc: number;
  dnsbl_listed: number;
  new_domain: number;
}

interface Thresholds {
  reject: number;
  risky: number;
  uncertain: number;
}

interface SmtpConfig {
  concurrency: number;
  timeout: number;
  heloDomain: string;
  fromEmail: string;
  port: number;
  minIntervalMs: number;
  maxConcurrentPerDomain: number;
}

interface EmailCheckResult {
  email: string;
  originalEmail: string;
  classification: 'safe' | 'uncertain' | 'risky' | 'reject';
  riskScore: number;
  checks: {
    syntax: { passed: boolean; issues: string[] } | null;
    typoFixed: { corrected: boolean; original: string } | null;
    duplicate: boolean | null;
    disposable: boolean | null;
    roleBased: { detected: boolean; prefix: string | null } | null;
    freeProvider: { detected: boolean; category: string | null } | null;
    mxValid: { valid: boolean; mxCount: number; primaryMx: string | null } | null;
    smtpResult: { status: string; code: number; response: string; starttls?: boolean } | null;
    catchAll: boolean | null;
    domainAuth?: { spf: boolean; dmarc: boolean; authScore: number } | null;
    dnsbl?: { listed: boolean; listings: string[]; ip: string } | null;
    domainAge?: { ageDays: number; isNew: boolean; createdAt: string | null } | null;
  };
}

interface PipelineResult {
  id: string;
  startedAt: string;
  completedAt: string;
  totalInput: number;
  totalProcessed: number;
  duplicatesRemoved: number;
  typosFixed: number;
  safe: number;
  uncertain: number;
  risky: number;
  rejected: number;
  results: EmailCheckResult[];
}

const DEFAULT_CHECKS: CheckConfig = {
  syntax: true,
  typoFix: true,
  deduplicate: true,
  disposable: true,
  roleBased: true,
  freeProvider: true,
  mxLookup: true,
  smtpVerify: true,
  catchAll: true,
};

const DEFAULT_WEIGHTS: SeverityWeights = {
  syntax_invalid: 100,
  disposable: 90,
  no_mx: 85,
  smtp_invalid: 100,
  smtp_risky: 50,
  smtp_greylisted: 40,
  smtp_mailbox_full: 60,
  catch_all: 30,
  role_based: 20,
  free_provider: 10,
  typo_detected: 5,
  no_spf: 15,
  no_dmarc: 10,
  dnsbl_listed: 70,
  new_domain: 40,
};

const DEFAULT_THRESHOLDS: Thresholds = {
  reject: 80,
  risky: 40,
  uncertain: 15,
};

const DEFAULT_SMTP: SmtpConfig = {
  concurrency: 10,
  timeout: 15000,
  heloDomain: 'nexus.pipeline',
  fromEmail: 'verify@nexus.pipeline',
  port: 25,
  minIntervalMs: 2000,
  maxConcurrentPerDomain: 2,
};

export default function EmailVerifierPage() {
  const [emailsRaw, setEmailsRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [toast, setToast] = useState<{ type: 'error' | 'warning' | 'info'; message: string } | null>(null);

  // Auto-dismiss toast after 6s
  const showToast = (type: 'error' | 'warning' | 'info', message: string) => {
    // Strip HTML tags from error messages (e.g. nginx 502 pages)
    const clean = message.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    setToast({ type, message: clean });
    setTimeout(() => setToast(null), 6000);
  };

  const [checks, setChecks] = useState<CheckConfig>(DEFAULT_CHECKS);
  const [weights, setWeights] = useState<SeverityWeights>(DEFAULT_WEIGHTS);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [smtp, setSmtp] = useState<SmtpConfig>(DEFAULT_SMTP);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // CSV State
  const [inputType, setInputType] = useState<'text' | 'csv'>('text');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string>('');

  // Results UI State
  const [filterClass, setFilterClass] = useState<string>('all');
  const [sortCol, setSortCol] = useState<string>('email');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const rowsPerPage = 50;

  // Async job tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [jobStatus, setJobStatus] = useState<string>('');
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [pushingToDB, setPushingToDB] = useState(false);
  const [pushResult, setPushResult] = useState<{ matched: number; totalProcessed: number; updated: Record<string, number> } | null>(null);

  // Ingest modal
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [ingestClassifications, setIngestClassifications] = useState<Record<string, boolean>>({ safe: true, uncertain: true, risky: false, reject: false });
  const [ingestMaxRisk, setIngestMaxRisk] = useState<number>(100);
  const [ingestMode, setIngestMode] = useState<'unverified_only' | 'overwrite'>('unverified_only');
  const [ingestDryRunResult, setIngestDryRunResult] = useState<any>(null);
  const [ingestLoading, setIngestLoading] = useState(false);

  // Download modal
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [downloadClassifications, setDownloadClassifications] = useState<Record<string, boolean>>({ safe: true, uncertain: true, risky: true, reject: true });
  const [downloadMaxRisk, setDownloadMaxRisk] = useState<number>(100);

  // Track which job's results we're currently viewing (for header actions)
  const [loadedJobId, setLoadedJobId] = useState<string | null>(null);

  // Live pipeline stats for animated progress
  const [liveStats, setLiveStats] = useState<{
    processed: number; total: number; safe: number; uncertain: number;
    risky: number; rejected: number; deduped: number; typos: number;
    startedAt: string;
  }>({ processed: 0, total: 0, safe: 0, uncertain: 0, risky: 0, rejected: 0, deduped: 0, typos: 0, startedAt: '' });

  // Pipeline limit — fetched from server config, not hardcoded
  const [pipelineLimit, setPipelineLimit] = useState<number>(50_000); // initial fallback until API responds

  // Recent completed/failed jobs for the jobs list
  const [recentJobs, setRecentJobs] = useState<any[]>([]);

  // ── On mount: fetch config limits + recover any active job + load recent jobs ──
  React.useEffect(() => {
    // 1. Fetch configurable limits
    apiCall<{ limits?: { maxEmailsPerJob?: number } }>('/api/verify/defaults')
      .then((data) => {
        if (data.limits?.maxEmailsPerJob && data.limits.maxEmailsPerJob > 0) {
          setPipelineLimit(data.limits.maxEmailsPerJob);
        }
      })
      .catch(() => {});

    // 2. Recover active job from sessionStorage (survives page navigation)
    const savedJobId = sessionStorage.getItem('pipeline_active_job');
    if (savedJobId) {
      setActiveJobId(savedJobId);
      setLoading(true);
      setJobStatus('Reconnecting to job...');
      startPolling(savedJobId);
    }

    // 3. Fetch recent jobs list
    fetchRecentJobs();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const fetchRecentJobs = () => {
    apiCall<any[]>('/api/verify/jobs')
      .then(setRecentJobs)
      .catch(() => {});
  };

  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const job = await apiCall<any>(`/api/verify/jobs/${jobId}`);
        const total = Number(job.total_emails) || 1;
        const processed = Number(job.processed_count) || 0;
        const pct = Math.min(100, Math.round((processed / total) * 100));
        setProgress(pct);
        setLiveStats({
          processed, total,
          safe: Number(job.safe_count) || 0,
          uncertain: Number(job.uncertain_count) || 0,
          risky: Number(job.risky_count) || 0,
          rejected: Number(job.rejected_count) || 0,
          deduped: Number(job.duplicates_removed) || 0,
          typos: Number(job.typos_fixed) || 0,
          startedAt: job.started_at || '',
        });

        if (job.status === 'complete') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setProgress(100);
          setJobStatus('Complete!');
          sessionStorage.removeItem('pipeline_active_job');

          setResult({
            id: jobId,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            totalInput: Number(job.total_emails),
            totalProcessed: Number(job.processed_count),
            duplicatesRemoved: Number(job.duplicates_removed),
            typosFixed: Number(job.typos_fixed),
            safe: Number(job.safe_count),
            uncertain: Number(job.uncertain_count),
            risky: Number(job.risky_count),
            rejected: Number(job.rejected_count),
            results: job.results || [],
          } as PipelineResult);
          setLoading(false);
          setActiveJobId(null);
          fetchRecentJobs();
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          sessionStorage.removeItem('pipeline_active_job');
          const msg = job.status === 'cancelled' ? 'Pipeline cancelled' : `Pipeline failed: ${job.error_message || 'Unknown error'}`;
          showToast(job.status === 'cancelled' ? 'info' : 'error', msg);
          setLoading(false);
          setActiveJobId(null);
          fetchRecentJobs();
        } else {
          const statusText = pct < 30 ? 'Analyzing syntax & domains...' : pct < 60 ? 'Running MX & SMTP checks...' : pct < 90 ? 'Verifying remaining emails...' : 'Finalizing results...';
          setJobStatus(statusText);
        }
      } catch {
        // Polling error — don't kill job, just skip this tick
      }
    }, 2000);
  };

  const loadCompletedJob = async (jobId: string) => {
    try {
      const job = await apiCall<any>(`/api/verify/jobs/${jobId}`);
      if (job.status === 'complete' && job.results) {
        setResult({
          id: jobId,
          startedAt: job.started_at,
          completedAt: job.completed_at,
          totalInput: Number(job.total_emails),
          totalProcessed: Number(job.processed_count),
          duplicatesRemoved: Number(job.duplicates_removed),
          typosFixed: Number(job.typos_fixed),
          safe: Number(job.safe_count),
          uncertain: Number(job.uncertain_count),
          risky: Number(job.risky_count),
          rejected: Number(job.rejected_count),
          results: job.results || [],
        } as PipelineResult);
        setLoadedJobId(jobId);
      }
    } catch (err: any) {
      showToast('error', `Failed to load job: ${err.message}`);
    }
  };

  const processedResults = React.useMemo(() => {
    if (!result?.results) return [];

    let filtered = result.results;
    if (filterClass !== 'all') {
      filtered = filtered.filter(r => r.classification === filterClass);
    }

    filtered.sort((a, b) => {
      let valA: any = a[sortCol as keyof EmailCheckResult];
      let valB: any = b[sortCol as keyof EmailCheckResult];

      if (sortCol === 'mxValid') {
        valA = a.checks.mxValid?.valid ? 1 : a.checks.mxValid === null ? -1 : 0;
        valB = b.checks.mxValid?.valid ? 1 : b.checks.mxValid === null ? -1 : 0;
      } else if (sortCol === 'smtpStatus') {
        valA = a.checks.smtpResult?.status || '';
        valB = b.checks.smtpResult?.status || '';
      } else if (sortCol === 'keyTrigger') {
        valA = a.checks.syntax?.passed === false ? 'A' : a.checks.disposable ? 'B' : a.checks.roleBased?.detected ? 'C' : a.checks.catchAll ? 'D' : a.checks.smtpResult?.response ? 'E' : 'Z';
        valB = b.checks.syntax?.passed === false ? 'A' : b.checks.disposable ? 'B' : b.checks.roleBased?.detected ? 'C' : b.checks.catchAll ? 'D' : b.checks.smtpResult?.response ? 'E' : 'Z';
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [result, filterClass, sortCol, sortDir]);

  const totalPages = Math.ceil(processedResults.length / rowsPerPage) || 1;
  const paginatedResults = processedResults.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  React.useEffect(() => setPage(1), [filterClass, sortCol, sortDir]);

  // Stats for the textarea
  const lineCount = emailsRaw.split('\n').filter(l => l.trim()).length;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      preview: 5,
      complete: (results) => {
        if (results.meta.fields) {
          setCsvHeaders(results.meta.fields);
          setCsvPreview(results.data.map((r: any) => results.meta.fields!.map(f => String(r[f] || ''))));
          const emailCol = results.meta.fields.find(f => f.toLowerCase().includes('email'));
          if (emailCol) setSelectedColumn(emailCol);
        }
      }
    });
  };

  const handleRunPipeline = async () => {
    let list: string[] = [];

    if (inputType === 'text') {
      list = emailsRaw.split(/[\n,]+/).map(e => e.trim()).filter(Boolean);
    } else {
      if (!csvFile || !selectedColumn) return showToast('warning', 'Please upload a CSV and select the email column.');
      try {
        setLoading(true);
        list = await new Promise<string[]>((resolve, reject) => {
          const emails: string[] = [];
          Papa.parse(csvFile, {
            header: true,
            skipEmptyLines: true,
            worker: true,
            step: (results) => {
              const val = (results.data as any)[selectedColumn];
              if (val && typeof val === 'string') {
                emails.push(val.trim());
              }
            },
            complete: () => resolve(emails.filter(Boolean)),
            error: (err) => reject(err)
          });
        });
      } catch (err) {
        setLoading(false);
        return showToast('error', 'Failed to parse CSV file. Please check the format.');
      }
    }

    if (list.length === 0) {
      setLoading(false);
      return showToast('warning', 'No valid emails found to verify.');
    }
    if (list.length > pipelineLimit) {
      setLoading(false);
      return showToast('warning', `Maximum ${pipelineLimit.toLocaleString()} emails per request. You provided ${list.length.toLocaleString()}. This limit is configurable in Server Config.`);
    }

    setLoading(true);
    setResult(null);
    setProgress(0);
    setJobStatus('Submitting...');

    try {
      // Submit async job
      const { jobId } = await apiCall<{ jobId: string; totalEmails: number }>('/api/verify/async', {
        method: 'POST',
        body: {
          emails: list,
          checks,
          smtp,
          severityWeights: weights,
          thresholds,
        }
      });

      setActiveJobId(jobId);
      setJobStatus('Processing...');

      // Persist job ID so we can recover after navigation
      sessionStorage.setItem('pipeline_active_job', jobId);

      // Start polling for progress (reusable function handles complete/failed)
      startPolling(jobId);

    } catch (err: any) {
      showToast('error', `Failed to submit job: ${err.message}`);
      setLoading(false);
    }
  };

  const handleExportCSV = useCallback(() => {
    if (!result || !result.results) return;

    const headers = [
      'Email',
      'Classification',
      'Risk Score',
      'Original',
      'Syntax',
      'Typo Fixed',
      'Disposable',
      'Role Based',
      'Free Provider',
      'MX Valid',
      'Catch All',
      'SPF Authenticated',
      'DMARC Authenticated',
      'SMTP Status',
      'SMTP Response'
    ];

    const rows = result.results.map(r => [
      `"${r.email.replace(/"/g, '""')}"`,
      r.classification,
      r.riskScore,
      `"${r.originalEmail.replace(/"/g, '""')}"`,
      r.checks.syntax ? (r.checks.syntax.passed ? 'pass' : 'fail') : 'skipped',
      r.checks.typoFixed ? (r.checks.typoFixed.corrected ? 'yes' : 'no') : 'skipped',
      r.checks.disposable === null ? 'skipped' : (r.checks.disposable ? 'yes' : 'no'),
      r.checks.roleBased === null ? 'skipped' : (r.checks.roleBased.detected ? r.checks.roleBased.prefix : 'no'),
      r.checks.freeProvider === null ? 'skipped' : (r.checks.freeProvider.detected ? r.checks.freeProvider.category : 'no'),
      r.checks.mxValid === null ? 'skipped' : (r.checks.mxValid.valid ? 'yes' : 'no'),
      r.checks.catchAll === null ? 'skipped' : (r.checks.catchAll ? 'yes' : 'no'),
      r.checks.domainAuth === null || !r.checks.domainAuth ? 'skipped' : (r.checks.domainAuth.spf ? 'yes' : 'no'),
      r.checks.domainAuth === null || !r.checks.domainAuth ? 'skipped' : (r.checks.domainAuth.dmarc ? 'yes' : 'no'),
      !r.checks.dnsbl ? 'skipped' : (r.checks.dnsbl.listed ? r.checks.dnsbl.listings.join(';') : 'clean'),
      !r.checks.domainAge ? 'skipped' : (r.checks.domainAge.ageDays >= 0 ? String(r.checks.domainAge.ageDays) : 'unknown'),
      r.checks.smtpResult === null ? 'skipped' : r.checks.smtpResult.status,
      r.checks.smtpResult === null ? 'skipped' : `"${r.checks.smtpResult.response.replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `verification-results-${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [result]);

  const handlePushToDB = async () => {
    if (!result?.results || result.results.length === 0) return;
    if (!window.confirm(`Push ${result.results.length} verification results to ClickHouse?\n\nThis will update _verification_status for all matching emails in your database.`)) return;
    setPushingToDB(true);
    setPushResult(null);
    try {
      const resp = await apiCall<{ matched: number; totalProcessed: number; updated: Record<string, number> }>('/api/verify/push-to-db', {
        method: 'POST',
        body: { results: result.results.map(r => ({ email: r.email, classification: r.classification, riskScore: r.riskScore })) },
      });
      setPushResult(resp);
    } catch (e: any) {
      alert(`Push failed: ${e.message}`);
    } finally {
      setPushingToDB(false);
    }
  };

  const CheckToggle = ({ id, label, info, disabled = false }: { id: keyof CheckConfig; label: string; info: string; disabled?: boolean }) => (
    <div
      className="animate-fadeIn"
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '12px 16px', background: 'var(--bg-app)', borderRadius: 12,
        border: '1px solid var(--border)', transition: 'border-color 0.2s', opacity: disabled ? 0.6 : 1
      }}
    >
      <div style={{ paddingRight: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{info}</div>
      </div>
      <div
        onClick={() => !disabled && setChecks(prev => ({ ...prev, [id]: !prev[id] }))}
        style={{
          width: 40, height: 22, borderRadius: 11, flexShrink: 0,
          background: checks[id] ? 'var(--blue)' : 'var(--border)',
          cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative', transition: 'background .3s'
        }}
      >
        <div style={{
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, left: checks[id] ? 21 : 3,
          transition: 'left .3s', boxShadow: '0 1px 3px rgba(0,0,0,.2)'
        }} />
      </div>
    </div>
  );

  const getClassificationBadge = (cls: string, score: number) => {
    switch (cls) {
      case 'safe': return <Badge label={`Safe (${score})`} color="var(--green)" colorMuted="var(--green-muted)" />;
      case 'uncertain': return <Badge label={`Uncertain (${score})`} color="var(--blue)" colorMuted="var(--blue-muted)" />;
      case 'risky': return <Badge label={`Risky (${score})`} color="var(--yellow)" colorMuted="var(--yellow-muted)" />;
      case 'reject': return <Badge label={`Reject (${score})`} color="var(--red)" colorMuted="var(--red-muted)" />;
      default: return <Badge label={cls} color="var(--text-secondary)" colorMuted="var(--bg-card)" />;
    }
  };

  return (
    <>
      <PageHeader
        title="Pipeline Studio"
        sub="Upload any CSV and run it through a multi-stage verification pipeline — syntax checks, typo fixes, MX lookups, SMTP probes, and risk scoring."
        description="Drag-and-drop your CSV, map the email column, toggle individual checks (disposable filter, role-based detection, free provider flagging, catch-all detection), set custom severity weights, and hit Run. Jobs process asynchronously on the server — you can safely navigate away. Watch the progress ring fill up in real-time, then download clean results as CSV."
      />

      {/* Toast Notification */}
      {toast && (
        <div
          className="animate-fadeIn"
          style={{
            marginBottom: 20, padding: '14px 20px', borderRadius: 12,
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, fontWeight: 600,
            background: toast.type === 'error' ? 'var(--red-muted)' : toast.type === 'warning' ? 'var(--yellow-muted)' : 'var(--blue-muted)',
            border: `1px solid ${toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--blue)'}`,
            color: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--blue)',
          }}
        >
          {toast.type === 'error' ? <XCircle size={18} /> : <ShieldAlert size={18} />}
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 24, alignItems: 'flex-start' }}>

        {/* Left Column - Input and Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Input Unit */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <SectionHeader title="Target Input" />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setInputType('text')}
                  style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: inputType === 'text' ? 'var(--blue)' : 'transparent', color: inputType === 'text' ? 'var(--accent-contrast)' : 'var(--text-secondary)', transition: 'all 0.2s' }}
                >Raw Text</button>
                <button
                  onClick={() => setInputType('csv')}
                  style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: inputType === 'csv' ? 'var(--blue)' : 'transparent', color: inputType === 'csv' ? 'var(--accent-contrast)' : 'var(--text-secondary)', transition: 'all 0.2s' }}
                >CSV Upload</button>
              </div>
            </div>

            {inputType === 'text' ? (
              <div className="animate-fadeIn" style={{ position: 'relative' }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Paste one or more email addresses (newline or comma separated). Max {pipelineLimit.toLocaleString()}.
                </p>
                <textarea
                  value={emailsRaw}
                  onChange={e => setEmailsRaw(e.target.value)}
                  placeholder="bob@example.com&#10;alice@gmail.com"
                  style={{
                    width: '100%', height: 200, padding: '16px', borderRadius: 12,
                    fontSize: 13, fontFamily: 'monospace', lineHeight: 1.6,
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', resize: 'vertical',
                    outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--blue)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--blue-muted)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
                <div style={{ position: 'absolute', bottom: 16, right: 16, fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', background: 'var(--bg-card)', padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  {lineCount} records
                </div>
              </div>
            ) : (
              <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 0 }}>
                  Upload a CSV file and select the column containing email addresses. Max {pipelineLimit.toLocaleString()} rows.
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  style={{ fontSize: 13, background: 'var(--bg-input)', padding: 12, borderRadius: 8, border: '1px dashed var(--border)', color: 'var(--text-primary)', width: '100%' }}
                />

                {csvHeaders.length > 0 && (
                  <div className="animate-fadeIn">
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Select Email Column:</label>
                    <select
                      value={selectedColumn}
                      onChange={e => setSelectedColumn(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                    >
                      <option value="">-- Select the column --</option>
                      {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>

                    {csvPreview.length > 0 && selectedColumn && (
                      <div style={{ marginTop: 16, background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 11, overflowX: 'auto' }}>
                        <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Data Preview (Top 5 Rows)</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              {csvHeaders.map(h => (
                                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: h === selectedColumn ? 'var(--blue)' : 'var(--text-tertiary)' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvPreview.map((row, i) => (
                              <tr key={i} style={{ borderBottom: i === csvPreview.length - 1 ? 'none' : '1px solid var(--border)' }}>
                                {row.map((val, colIdx) => (
                                  <td key={colIdx} style={{ padding: '6px 8px', color: csvHeaders[colIdx] === selectedColumn ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                                    {val.length > 30 ? val.substring(0, 30) + '...' : val}
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
            )}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                Processing via <strong>Native Node API</strong> (no external credits used).
              </div>
              <Button
                onClick={handleRunPipeline}
                disabled={loading || (inputType === 'text' && emailsRaw.trim().length === 0) || (inputType === 'csv' && (!csvFile || !selectedColumn))}
                icon={<Zap size={16} className={loading ? 'animate-pulse' : ''} />}
              >
                {loading ? 'Running Pipeline...' : 'Run Pipeline'}
              </Button>
            </div>
          </div>

          {/* ═══ Animated Pipeline Progress ═══ */}
          {loading && activeJobId && (() => {
            const elapsed = liveStats.startedAt ? Math.floor((Date.now() - new Date(liveStats.startedAt).getTime()) / 1000) : 0;
            const elapsedMin = Math.floor(elapsed / 60);
            const elapsedSec = elapsed % 60;
            const rate = elapsed > 0 ? Math.round(liveStats.processed / (elapsed / 60)) : 0;
            const eta = rate > 0 ? Math.ceil((liveStats.total - liveStats.processed) / rate) : 0;

            const stages = [
              { key: 'syntax', label: 'Syntax & Dedup', icon: '✓', threshold: 5, color: 'var(--green)' },
              { key: 'typo', label: 'Typo Detection', icon: '✏️', threshold: 10, color: 'var(--yellow)' },
              { key: 'mx', label: 'MX Lookup', icon: '🌐', threshold: 20, color: 'var(--blue)' },
              { key: 'smtp', label: 'SMTP Verification', icon: '📡', threshold: 40, color: 'var(--purple)' },
              { key: 'classify', label: 'Classification', icon: '🏷️', threshold: 90, color: 'var(--accent)' },
            ];
            const activeStage = stages.reduce((active, stage) => progress >= stage.threshold ? stage : active, stages[0]);

            return (
              <div className="animate-fadeIn" style={{
                background: 'var(--bg-card)', borderRadius: 20, border: '1px solid var(--border)',
                padding: 0, overflow: 'hidden',
                boxShadow: '0 0 60px rgba(99,102,241,0.06), 0 4px 24px rgba(0,0,0,0.15)',
              }}>
                {/* Animated gradient bar at top */}
                <div className="pipeline-gradient-bar" style={{ height: 3, width: '100%' }} />

                <div style={{ padding: '32px 36px 28px' }}>
                  {/* Header Row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                        Email Verification Pipeline
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {activeJobId.slice(0, 12)}… {jobStatus && <span style={{ color: 'var(--text-secondary)' }}>· {jobStatus}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
                        {progress}<span style={{ fontSize: 16, color: 'var(--text-tertiary)' }}>%</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {elapsedMin}m {elapsedSec.toString().padStart(2, '0')}s{rate > 0 && ` · ~${eta}m left`}
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-elevated)', marginBottom: 24, overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      background: `linear-gradient(90deg, var(--green), var(--blue), var(--accent))`,
                      width: `${progress}%`,
                      transition: 'width 1.5s ease-out',
                      position: 'relative',
                    }}>
                      <div style={{
                        position: 'absolute', right: 0, top: -3, width: 14, height: 14, borderRadius: '50%',
                        background: 'var(--accent)', boxShadow: '0 0 12px var(--accent)',
                        animation: 'dotPulse 1.5s ease-in-out infinite',
                      }} />
                    </div>
                  </div>

                  {/* Pipeline Stage Walkthrough */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 28 }}>
                    {stages.map((stage, i) => {
                      const isActive = activeStage.key === stage.key;
                      const isDone = progress >= (stages[i + 1]?.threshold ?? 100);
                      return (
                        <div key={stage.key} style={{
                          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                          position: 'relative',
                        }}>
                          {/* Connector line */}
                          {i > 0 && (
                            <div style={{
                              position: 'absolute', top: 16, left: -2, right: '50%', height: 2,
                              background: isDone || isActive ? stage.color : 'var(--border)',
                              transition: 'background 0.5s ease',
                              overflow: 'hidden',
                            }}>
                              {isActive && (
                                <div className="pipeline-data-particle" style={{
                                  width: 16, height: '100%', background: `linear-gradient(90deg, transparent, ${stage.color}, transparent)`,
                                }} />
                              )}
                            </div>
                          )}
                          {/* Stage dot */}
                          <div className={isActive ? 'pipeline-stage-active' : ''} style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: isDone ? stage.color : isActive ? `${stage.color}30` : 'var(--bg-elevated)',
                            border: `2px solid ${isDone || isActive ? stage.color : 'var(--border)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: isDone ? 14 : 12, transition: 'all 0.4s ease',
                            color: isDone ? '#fff' : 'var(--text-tertiary)',
                          }}>
                            {isDone ? '✓' : stage.icon}
                          </div>
                          {/* Label */}
                          <div style={{
                            fontSize: 10, fontWeight: isActive ? 700 : 500,
                            color: isActive ? stage.color : isDone ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                            textAlign: 'center', transition: 'all 0.3s ease',
                          }}>
                            {stage.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live Stats Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
                    {[
                      { label: 'Processed', value: liveStats.processed, total: liveStats.total, color: 'var(--text-primary)' },
                      { label: 'Safe', value: liveStats.safe, color: 'var(--green)' },
                      { label: 'Risky', value: liveStats.risky + liveStats.uncertain, color: 'var(--yellow)' },
                      { label: 'Rejected', value: liveStats.rejected, color: 'var(--red)' },
                    ].map(stat => (
                      <div key={stat.label} className="pipeline-counter" style={{
                        padding: '12px 14px', borderRadius: 12,
                        background: `${stat.color}08`, border: `1px solid ${stat.color}20`,
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: stat.color, fontFamily: "'JetBrains Mono', monospace" }}>
                          {stat.value.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
                          {stat.label}{'total' in stat ? ` / ${(stat.total as number).toLocaleString()}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Speed + extras row */}
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 20, fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {rate > 0 && <span>⚡ {rate.toLocaleString()} emails/min</span>}
                    {liveStats.deduped > 0 && <span>🔁 {liveStats.deduped.toLocaleString()} deduped</span>}
                    {liveStats.typos > 0 && <span>✏️ {liveStats.typos.toLocaleString()} typos fixed</span>}
                  </div>

                  {/* Safe to leave + Cancel */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '10px 20px', borderRadius: 10,
                      background: 'var(--green-muted)', border: '1px solid var(--green)',
                      fontSize: 12, fontWeight: 600, color: 'var(--green)',
                    }}>
                      <CheckCircle size={14} />
                      Safe to navigate away — processing continues on server
                    </div>
                    <button onClick={async () => {
                      if (!window.confirm('Cancel this verification job?')) return;
                      try {
                        await apiCall<any>(`/api/verify/jobs/${activeJobId}/cancel`, { method: 'POST' });
                        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                        sessionStorage.removeItem('pipeline_active_job');
                        setActiveJobId(null);
                        setLoading(false);
                        setJobStatus('');
                        fetchRecentJobs();
                        showToast('info', 'Job cancelled');
                      } catch (err: any) { showToast('error', `Cancel failed: ${err.message}`); }
                    }} style={{
                      padding: '10px 16px', borderRadius: 10, border: '1px solid var(--red)',
                      background: 'var(--red-muted)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Cancel Job</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Results Unit */}
          {result && (
            <div className="animate-fadeIn stagger-2" style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 24, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionHeader title="Pipeline Results" />
                <div style={{ display: 'flex', gap: 8 }}>
                  {loadedJobId ? (
                    <>
                      <Button
                        onClick={() => { setIngestJobId(loadedJobId); setIngestDryRunResult(null); }}
                        disabled={!result.results || result.results.length === 0}
                        icon={<Database size={14} />}
                        variant="secondary"
                        style={{ background: 'var(--green)', color: '#fff', border: 'none' }}
                      >
                        Ingest to DB
                      </Button>
                      <Button
                        onClick={() => { setDownloadJobId(loadedJobId); }}
                        variant="secondary"
                      >
                        Download CSV
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={handlePushToDB}
                        disabled={pushingToDB || !result.results || result.results.length === 0}
                        icon={pushingToDB ? <ShieldAlert size={14} className="animate-pulse" /> : <Database size={14} />}
                        variant="secondary"
                        style={pushingToDB ? {} : { background: 'var(--green)', color: '#fff', border: 'none' }}
                      >
                        {pushingToDB ? 'Pushing...' : 'Push to DB'}
                      </Button>
                      <Button onClick={handleExportCSV} variant="secondary">Export CSV</Button>
                    </>
                  )}
                </div>
              </div>

              {/* Push Result Banner */}
              {pushResult && (
                <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: 'var(--green-muted)', border: '1px solid var(--green)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--green)', fontSize: 13, marginBottom: 6 }}>
                    <CheckCircle size={16} /> Pushed to Database
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {pushResult.matched.toLocaleString()} of {pushResult.totalProcessed.toLocaleString()} emails matched.
                    Updated: <strong style={{ color: 'var(--green)' }}>{pushResult.updated.valid || 0} valid</strong>,{' '}
                    <strong style={{ color: 'var(--yellow)' }}>{pushResult.updated.risky || 0} risky</strong>,{' '}
                    <strong style={{ color: 'var(--red)' }}>{pushResult.updated.invalid || 0} invalid</strong>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--green-muted)', border: '1px solid rgba(34,197,94,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--green)', letterSpacing: '0.05em', marginBottom: 4 }}>Safe</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>{result.safe.toLocaleString()}</div>
                </div>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--blue-muted)', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--blue)', letterSpacing: '0.05em', marginBottom: 4 }}>Uncertain</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--blue)' }}>{result.uncertain.toLocaleString()}</div>
                </div>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--yellow-muted)', border: '1px solid rgba(234,179,8,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--yellow)', letterSpacing: '0.05em', marginBottom: 4 }}>Risky</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--yellow)' }}>{result.risky.toLocaleString()}</div>
                </div>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--red-muted)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--red)', letterSpacing: '0.05em', marginBottom: 4 }}>Rejected</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--red)' }}>{result.rejected.toLocaleString()}</div>
                </div>
              </div>

              {/* Visual Breakdown Bar */}
              {result.totalProcessed > 0 && (
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 24, background: 'var(--bg-card)' }}>
                  {result.safe > 0 && <div style={{ width: `${(result.safe / result.totalProcessed) * 100}%`, background: 'var(--green)' }} title={`Safe: ${result.safe}`} />}
                  {result.uncertain > 0 && <div style={{ width: `${(result.uncertain / result.totalProcessed) * 100}%`, background: 'var(--blue)' }} title={`Uncertain: ${result.uncertain}`} />}
                  {result.risky > 0 && <div style={{ width: `${(result.risky / result.totalProcessed) * 100}%`, background: 'var(--yellow)' }} title={`Risky: ${result.risky}`} />}
                  {result.rejected > 0 && <div style={{ width: `${(result.rejected / result.totalProcessed) * 100}%`, background: 'var(--red)' }} title={`Rejected: ${result.rejected}`} />}
                </div>
              )}

              <div style={{ display: 'flex', gap: 24, paddingBottom: 20, borderBottom: '1px solid var(--border)', marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)' }}>
                <div>Duplicates Removed: <strong style={{ color: 'var(--text-primary)' }}>{result.duplicatesRemoved}</strong></div>
                <div>Typos Auto-fixed: <strong style={{ color: 'var(--text-primary)' }}>{result.typosFixed}</strong></div>
                <div>Total Processed: <strong style={{ color: 'var(--text-primary)' }}>{result.totalProcessed}</strong></div>
                <div>Latency: <strong style={{ color: 'var(--text-primary)' }}>{(new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime())}ms</strong></div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Filter:</span>
                  <select
                    value={filterClass}
                    onChange={e => setFilterClass(e.target.value)}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none' }}
                  >
                    <option value="all">All Classifications</option>
                    <option value="safe">Safe</option>
                    <option value="uncertain">Uncertain</option>
                    <option value="risky">Risky</option>
                    <option value="reject">Reject</option>
                  </select>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Showing {processedResults.length} result(s)
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)' }}>
                      {[
                        { id: 'email', label: 'Email Address' },
                        { id: 'classification', label: 'Classification' },
                        { id: 'mxValid', label: 'MX' },
                        { id: 'auth', label: 'Auth (SPF/DMARC)' },
                        { id: 'smtpStatus', label: 'SMTP Status' },
                        { id: 'keyTrigger', label: 'Key Trigger' }
                      ].map(col => (
                        <th
                          key={col.id}
                          onClick={() => {
                            if (sortCol === col.id) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                            else { setSortCol(col.id); setSortDir('asc'); }
                          }}
                          style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
                        >
                          {col.label} {sortCol === col.id ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 12px', fontWeight: 500 }}>
                          {r.email}
                          {r.email !== r.originalEmail && <span style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>(was: {r.originalEmail})</span>}
                        </td>
                        <td style={{ padding: '12px 12px' }}>{getClassificationBadge(r.classification, r.riskScore)}</td>
                        <td style={{ padding: '12px 12px' }}>
                          {r.checks.mxValid === null ? <span style={{ color: 'var(--text-tertiary)' }}>-</span> :
                            (r.checks.mxValid.valid ? <CheckCircle size={14} color="var(--green)" /> : <XCircle size={14} color="var(--red)" />)}
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          {r.checks.domainAuth == null ? <span style={{ color: 'var(--text-tertiary)' }}>-</span> :
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Badge label="SPF" color={r.checks.domainAuth.spf ? "var(--green)" : "var(--red)"} colorMuted={r.checks.domainAuth.spf ? "var(--green-muted)" : "var(--red-muted)"} />
                              <Badge label="DMARC" color={r.checks.domainAuth.dmarc ? "var(--green)" : "var(--red)"} colorMuted={r.checks.domainAuth.dmarc ? "var(--green-muted)" : "var(--red-muted)"} />
                            </div>
                          }
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          {r.checks.smtpResult === null ? <span style={{ color: 'var(--text-tertiary)' }}>-</span> :
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{
                                color: r.checks.smtpResult.status === 'valid' ? 'var(--green)' :
                                  r.checks.smtpResult.status === 'invalid' ? 'var(--red)' :
                                    r.checks.smtpResult.status === 'greylisted' ? 'var(--yellow)' :
                                      r.checks.smtpResult.status === 'mailbox_full' ? 'var(--yellow)' :
                                        r.checks.smtpResult.status === 'risky' ? 'var(--yellow)' : 'var(--text-secondary)'
                              }}>
                                {r.checks.smtpResult.status} ({r.checks.smtpResult.code})
                              </span>
                              {r.checks.smtpResult.starttls && <span style={{ fontSize: 9, padding: '2px 4px', background: 'var(--blue-muted)', color: 'var(--blue)', borderRadius: 4, alignSelf: 'flex-start', fontWeight: 700 }}>STARTTLS</span>}
                            </div>}
                        </td>
                        <td style={{ padding: '12px 12px', color: 'var(--text-secondary)' }}>
                          {r.checks.syntax?.passed === false ? 'Syntax Error' :
                            r.checks.disposable ? 'Disposable Domain' :
                              r.checks.dnsbl?.listed ? <span style={{ color: 'var(--red)' }} title={r.checks.dnsbl.listings.join(', ')}>DNSBL: {r.checks.dnsbl.listings[0]}</span> :
                                r.checks.domainAge?.isNew ? <span style={{ color: 'var(--yellow)' }}>New Domain ({r.checks.domainAge.ageDays}d)</span> :
                                  r.checks.roleBased?.detected ? `Role: ${r.checks.roleBased.prefix}` :
                                    r.checks.catchAll ? 'Catch-All' :
                                      r.checks.smtpResult?.response ? <span title={r.checks.smtpResult.response} style={{ cursor: 'help', borderBottom: '1px dotted var(--text-tertiary)' }}>{r.checks.smtpResult.response.substring(0, 24)}...</span> :
                                        'Clear'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 12px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, processedResults.length)} of {processedResults.length}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, cursor: page === 1 ? 'not-allowed' : 'pointer', border: '1px solid var(--border)', background: 'var(--bg-input)', color: page === 1 ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
                      >Previous</button>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, cursor: page === totalPages ? 'not-allowed' : 'pointer', border: '1px solid var(--border)', background: 'var(--bg-input)', color: page === totalPages ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
                      >Next</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Config */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Network size={18} style={{ color: 'var(--blue)' }} />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Pipeline Stages</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CheckToggle id="syntax" label="Syntax Check" info="RFC 5322 regex validation." />
              <CheckToggle id="typoFix" label="Typo Auto-fix" info="Corrects common domain typos." />
              <CheckToggle id="deduplicate" label="Deduplication" info="Removes duplicate addresses." />
              <CheckToggle id="disposable" label="Disposable Check" info="Flags known throwaway providers." />
              <CheckToggle id="roleBased" label="Role-based Check" info="Flags info@, admin@, etc." />
              <CheckToggle id="freeProvider" label="Free Provider" info="Flags Gmail, Yahoo, etc." />
              <CheckToggle id="mxLookup" label="MX Verification" info="Ensures domain can receive mail." />
              <CheckToggle id="catchAll" label="Catch-All Detection" info="Probes to identify catch-all domains." disabled={!checks.mxLookup} />
              <CheckToggle id="smtpVerify" label="SMTP Handshake" info="Full RCPT TO mailbox verification." disabled={!checks.mxLookup} />
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ShieldAlert size={18} style={{ color: 'var(--purple, #A855F7)' }} />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Scoring Rules</h3>
              </div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ background: 'transparent', border: 'none', color: 'var(--blue)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {showAdvanced ? 'Hide Edit' : 'Edit Weights'}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: showAdvanced ? 20 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>Reject Threshold</span>
                {showAdvanced ? (
                  <input type="number" min="0" max="100" value={thresholds.reject} onChange={e => setThresholds(p => ({ ...p, reject: parseInt(e.target.value) || 0 }))} style={{ width: 60, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
                ) : (
                  <span style={{ fontWeight: 800, padding: '2px 8px', background: 'var(--red-muted)', color: 'var(--red)', borderRadius: 6 }}>≥ {thresholds.reject}</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>Risky Threshold</span>
                {showAdvanced ? (
                  <input type="number" min="0" max="100" value={thresholds.risky} onChange={e => setThresholds(p => ({ ...p, risky: parseInt(e.target.value) || 0 }))} style={{ width: 60, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
                ) : (
                  <span style={{ fontWeight: 800, padding: '2px 8px', background: 'var(--yellow-muted)', color: 'var(--yellow)', borderRadius: 6 }}>≥ {thresholds.risky}</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: 'var(--blue)', fontWeight: 600 }}>Uncertain Threshold</span>
                {showAdvanced ? (
                  <input type="number" min="0" max="100" value={thresholds.uncertain} onChange={e => setThresholds(p => ({ ...p, uncertain: parseInt(e.target.value) || 0 }))} style={{ width: 60, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
                ) : (
                  <span style={{ fontWeight: 800, padding: '2px 8px', background: 'var(--blue-muted)', color: 'var(--blue)', borderRadius: 6 }}>≥ {thresholds.uncertain}</span>
                )}
              </div>
            </div>

            {showAdvanced && (
              <div className="animate-fadeIn" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Object.entries(weights).map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                    <input
                      type="number" min="0" max="100"
                      value={val}
                      onChange={e => setWeights(prev => ({ ...prev, [key]: parseInt(e.target.value) || 0 }))}
                      style={{ width: 60, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Network size={18} style={{ color: 'var(--blue)' }} />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>SMTP Configuration</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>HELO Domain</label>
                  <input type="text" value={smtp.heloDomain} onChange={e => setSmtp(p => ({ ...p, heloDomain: e.target.value }))} style={{ width: '100%', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>MAIL FROM</label>
                  <input type="text" value={smtp.fromEmail} onChange={e => setSmtp(p => ({ ...p, fromEmail: e.target.value }))} style={{ width: '100%', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Port</label>
                  <input type="number" value={smtp.port} onChange={e => setSmtp(p => ({ ...p, port: parseInt(e.target.value) || 25 }))} style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Timeout(ms)</label>
                  <input type="number" value={smtp.timeout} onChange={e => setSmtp(p => ({ ...p, timeout: parseInt(e.target.value) || 15000 }))} style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Min Invl(ms)</label>
                  <input type="number" value={smtp.minIntervalMs} onChange={e => setSmtp(p => ({ ...p, minIntervalMs: parseInt(e.target.value) || 1000 }))} style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Max / Dom</label>
                  <input type="number" value={smtp.maxConcurrentPerDomain} onChange={e => setSmtp(p => ({ ...p, maxConcurrentPerDomain: parseInt(e.target.value) || 2 }))} style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Global Max</label>
                  <input type="number" value={smtp.concurrency} onChange={e => setSmtp(p => ({ ...p, concurrency: parseInt(e.target.value) || 10 }))} style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }} />
                </div>
              </div>
            </div>
          </div>

      </div>

        </div>
      {/* ── Recent Jobs ── */}
      {recentJobs.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>Recent Pipeline Jobs</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentJobs.map((job: any) => {
              const total = Number(job.total_emails) || 0;
              const processed = Number(job.processed_count) || 0;
              const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
              const isActive = activeJobId === job.id;
              const isProcessing = job.status === 'processing';
              const isComplete = job.status === 'complete';
              const isFailed = job.status === 'failed';
              const isCancelled = job.status === 'cancelled';
              return (
                <div key={job.id} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px',
                  background: isActive ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderRadius: 10, border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: isComplete ? 'var(--green)' : (isFailed || isCancelled) ? 'var(--red)' : isProcessing ? 'var(--yellow)' : 'var(--text-tertiary)',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {total.toLocaleString()} emails
                      <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 8, fontSize: 11 }}>{job.id}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {new Date(job.started_at).toLocaleString()}
                      {isProcessing && ` — ${pct}% (${processed.toLocaleString()}/${total.toLocaleString()})`}
                      {isComplete && job.completed_at && ` — completed ${new Date(job.completed_at).toLocaleTimeString()}`}
                      {isFailed && ` — failed`}
                      {isCancelled && ` — cancelled`}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 6,
                    background: isComplete ? 'var(--green-muted)' : (isFailed || isCancelled) ? 'var(--red-muted)' : 'var(--yellow-muted)',
                    color: isComplete ? 'var(--green)' : (isFailed || isCancelled) ? 'var(--red)' : 'var(--yellow)',
                  }}>{job.status}</span>
                  {isComplete && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => loadCompletedJob(job.id)} style={{
                        padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)',
                        background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}>View Results</button>
                      <button onClick={() => setDownloadJobId(job.id)} style={{
                        padding: '6px 14px', borderRadius: 8, border: '1px solid var(--green)',
                        background: 'var(--green-muted)', color: 'var(--green)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}>Download CSV</button>
                      <button onClick={() => { setIngestJobId(job.id); setIngestDryRunResult(null); }} style={{
                        padding: '6px 14px', borderRadius: 8, border: '1px solid var(--blue)',
                        background: 'var(--blue-muted)', color: 'var(--blue)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}>Ingest to DB</button>
                    </div>
                  )}
                  {isProcessing && !isActive && (
                    <button onClick={() => { setActiveJobId(job.id); setLoading(true); sessionStorage.setItem('pipeline_active_job', job.id); startPolling(job.id); }} style={{
                      padding: '6px 14px', borderRadius: 8, border: '1px solid var(--accent)',
                      background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Reconnect</button>
                  )}
                  {(isProcessing || isActive) && (
                    <button onClick={async () => {
                      if (!window.confirm('Cancel this verification job?')) return;
                      try {
                        await apiCall<any>(`/api/verify/jobs/${job.id}/cancel`, { method: 'POST' });
                        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                        sessionStorage.removeItem('pipeline_active_job');
                        setActiveJobId(null);
                        setLoading(false);
                        setJobStatus('');
                        fetchRecentJobs();
                        showToast('info', 'Job cancelled');
                      } catch (err: any) { showToast('error', `Cancel failed: ${err.message}`); }
                    }} style={{
                      padding: '6px 14px', borderRadius: 8, border: '1px solid var(--red)',
                      background: 'var(--red-muted)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>Cancel</button>
                  )}
                  {(isFailed || isCancelled) && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={async () => {
                        try {
                          const resp = await apiCall<any>(`/api/verify/jobs/${job.id}/retry`, { method: 'POST' });
                          showToast('info', `Retry started — new job ${resp.jobId}`);
                          setActiveJobId(resp.jobId);
                          setLoading(true);
                          sessionStorage.setItem('pipeline_active_job', resp.jobId);
                          startPolling(resp.jobId);
                          fetchRecentJobs();
                        } catch (err: any) { showToast('error', `Retry failed: ${err.message}`); }
                      }} style={{
                        padding: '6px 14px', borderRadius: 8, border: '1px solid var(--accent)',
                        background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}>⟳ Retry</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ingestion Modal ── */}
      {ingestJobId && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={(e) => { if (e.target === e.currentTarget) { setIngestJobId(null); } }}>
          <div style={{
            width: 520, maxHeight: '90vh', overflow: 'auto',
            background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.4)', padding: 28,
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Ingest to Verification Engine
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 20 }}>
              Push verified results into <code>universal_person._verification_status</code>
            </p>

            {/* Classification Filters */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Classifications to Ingest
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['safe', 'uncertain', 'risky', 'reject'] as const).map(cls => {
                  const colors: Record<string, string> = { safe: 'var(--green)', uncertain: 'var(--yellow)', risky: 'var(--orange, #f59e0b)', reject: 'var(--red)' };
                  const labels: Record<string, string> = { safe: 'Safe → valid', uncertain: 'Uncertain → risky', risky: 'Risky → risky', reject: 'Rejected → invalid' };
                  return (
                    <label key={cls} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 10, border: `1px solid ${ingestClassifications[cls] ? colors[cls] : 'var(--border)'}`,
                      background: ingestClassifications[cls] ? `${colors[cls]}15` : 'var(--bg-app)',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}>
                      <input type="checkbox" checked={ingestClassifications[cls]} onChange={() => setIngestClassifications(prev => ({ ...prev, [cls]: !prev[cls] }))}
                        style={{ accentColor: colors[cls], width: 16, height: 16 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{cls.charAt(0).toUpperCase() + cls.slice(1)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{labels[cls]}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Risk Score Threshold */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Max Risk Score: <span style={{ color: 'var(--accent)', fontWeight: 800 }}>{ingestMaxRisk}</span>
              </label>
              <input type="range" min={0} max={100} value={ingestMaxRisk} onChange={e => setIngestMaxRisk(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                <span>0 (strictest)</span><span>50</span><span>100 (all)</span>
              </div>
            </div>

            {/* Overwrite Mode */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Update Mode
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['unverified_only', 'Only unverified', 'Skip records that already have a verification status'], ['overwrite', 'Overwrite all', 'Update all matching records regardless of existing status']] as const).map(([val, label, desc]) => (
                  <label key={val} style={{
                    flex: 1, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    border: ingestMode === val ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: ingestMode === val ? 'var(--accent-muted)' : 'var(--bg-app)',
                  }}>
                    <input type="radio" name="ingestMode" checked={ingestMode === val} onChange={() => setIngestMode(val as any)}
                      style={{ display: 'none' }} />
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{desc}</div>
                  </label>
                ))}
              </div>
            </div>

            {/* Dry Run Result */}
            {ingestDryRunResult && (
              <div style={{
                padding: 16, borderRadius: 12, marginBottom: 16,
                background: ingestDryRunResult.dryRun ? 'var(--blue-muted)' : 'var(--green-muted)',
                border: `1px solid ${ingestDryRunResult.dryRun ? 'var(--blue)' : 'var(--green)'}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                  {ingestDryRunResult.dryRun ? '🔍 Dry Run Preview' : '✅ Ingestion Complete'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  Total in job: <strong>{ingestDryRunResult.totalInJob?.toLocaleString()}</strong><br />
                  After filters: <strong>{ingestDryRunResult.totalAfterFilters?.toLocaleString()}</strong><br />
                  Matched in DB: <strong>{ingestDryRunResult.totalMatchedInDB?.toLocaleString()}</strong><br />
                  {ingestDryRunResult.skippedAlreadyVerified > 0 && (<>Already verified (skipped): <strong>{ingestDryRunResult.skippedAlreadyVerified?.toLocaleString()}</strong><br /></>)}
                  Will update → Valid: <strong style={{ color: 'var(--green)' }}>{ingestDryRunResult.updated?.valid || 0}</strong>,
                  Risky: <strong style={{ color: 'var(--yellow)' }}>{ingestDryRunResult.updated?.risky || 0}</strong>,
                  Invalid: <strong style={{ color: 'var(--red)' }}>{ingestDryRunResult.updated?.invalid || 0}</strong>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setIngestJobId(null)} style={{
                padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>

              <button disabled={ingestLoading || !Object.values(ingestClassifications).some(Boolean)} onClick={async () => {
                setIngestLoading(true);
                try {
                  const resp = await apiCall<any>(`/api/verify/jobs/${ingestJobId}/ingest`, {
                    method: 'POST',
                    body: {
                      classifications: Object.entries(ingestClassifications).filter(([, v]) => v).map(([k]) => k),
                      maxRiskScore: ingestMaxRisk,
                      mode: ingestMode,
                      dryRun: true,
                    },
                  });
                  setIngestDryRunResult(resp);
                } catch (err: any) { showToast('error', `Preview failed: ${err.message}`); }
                finally { setIngestLoading(false); }
              }} style={{
                padding: '10px 20px', borderRadius: 10, border: '1px solid var(--blue)',
                background: 'var(--blue-muted)', color: 'var(--blue)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: ingestLoading ? 0.6 : 1,
              }}>{ingestLoading ? 'Previewing...' : '🔍 Preview (Dry Run)'}</button>

              <button disabled={ingestLoading || !ingestDryRunResult || !Object.values(ingestClassifications).some(Boolean)} onClick={async () => {
                setIngestLoading(true);
                try {
                  const resp = await apiCall<any>(`/api/verify/jobs/${ingestJobId}/ingest`, {
                    method: 'POST',
                    body: {
                      classifications: Object.entries(ingestClassifications).filter(([, v]) => v).map(([k]) => k),
                      maxRiskScore: ingestMaxRisk,
                      mode: ingestMode,
                      dryRun: false,
                    },
                  });
                  setIngestDryRunResult(resp);
                  showToast('info', `Ingested ${resp.totalMatchedInDB} records`);
                } catch (err: any) { showToast('error', `Ingest failed: ${err.message}`); }
                finally { setIngestLoading(false); }
              }} style={{
                padding: '10px 20px', borderRadius: 10, border: 'none',
                background: 'var(--accent)', color: 'var(--accent-contrast, #fff)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: (ingestLoading || !ingestDryRunResult) ? 0.4 : 1,
              }}>⚡ Commit Ingestion</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Download CSV Modal ── */}
      {downloadJobId && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={(e) => { if (e.target === e.currentTarget) { setDownloadJobId(null); } }}>
          <div style={{
            width: 480, maxHeight: '90vh', overflow: 'auto',
            background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.4)', padding: 28,
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Download Verified Results
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 20 }}>
              Choose which classifications and risk levels to include in the CSV export.
            </p>

            {/* Classification Filters */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Include Classifications
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['safe', 'uncertain', 'risky', 'reject'] as const).map(cls => {
                  const colors: Record<string, string> = { safe: 'var(--green)', uncertain: 'var(--yellow)', risky: 'var(--orange, #f59e0b)', reject: 'var(--red)' };
                  return (
                    <label key={cls} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 10, border: `1px solid ${downloadClassifications[cls] ? colors[cls] : 'var(--border)'}`,
                      background: downloadClassifications[cls] ? `${colors[cls]}15` : 'var(--bg-app)',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}>
                      <input type="checkbox" checked={downloadClassifications[cls]} onChange={() => setDownloadClassifications(prev => ({ ...prev, [cls]: !prev[cls] }))}
                        style={{ accentColor: colors[cls], width: 16, height: 16 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{cls.charAt(0).toUpperCase() + cls.slice(1)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Risk Score Threshold */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Max Risk Score: <span style={{ color: 'var(--accent)', fontWeight: 800 }}>{downloadMaxRisk}</span>
              </label>
              <input type="range" min={0} max={100} value={downloadMaxRisk} onChange={e => setDownloadMaxRisk(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                <span>0 (strictest)</span><span>50</span><span>100 (all)</span>
              </div>
            </div>

            {/* Quick Download Shortcuts */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Quick Export
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { label: 'All Results', cls: ['safe', 'uncertain', 'risky', 'reject'] },
                  { label: 'Safe Only', cls: ['safe'] },
                  { label: 'Safe + Uncertain', cls: ['safe', 'uncertain'] },
                  { label: 'Risky + Rejected', cls: ['risky', 'reject'] },
                ].map(preset => (
                  <button key={preset.label} onClick={async () => {
                    try {
                      const blob = await apiCall<Blob>(`/api/verify/jobs/${downloadJobId}/download?classifications=${preset.cls.join(',')}${downloadMaxRisk < 100 ? `&maxRiskScore=${downloadMaxRisk}` : ''}`, { responseType: 'blob' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `verification-${downloadJobId}-${preset.cls.join('+')}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e: any) { alert(`Download failed: ${e.message}`); }
                  }} style={{
                    padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}>{preset.label}</button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDownloadJobId(null)} style={{
                padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--bg-app)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Close</button>

              <button disabled={!Object.values(downloadClassifications).some(Boolean)} onClick={async () => {
                const selected = Object.entries(downloadClassifications).filter(([, v]) => v).map(([k]) => k);
                try {
                  const blob = await apiCall<Blob>(`/api/verify/jobs/${downloadJobId}/download?classifications=${selected.join(',')}${downloadMaxRisk < 100 ? `&maxRiskScore=${downloadMaxRisk}` : ''}`, { responseType: 'blob' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `verification-${downloadJobId}-${selected.join('+')}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e: any) { alert(`Download failed: ${e.message}`); }
              }} style={{
                padding: '10px 20px', borderRadius: 10, border: 'none',
                background: 'var(--accent)', color: 'var(--accent-contrast, #fff)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: !Object.values(downloadClassifications).some(Boolean) ? 0.4 : 1,
              }}>📥 Download Custom CSV</button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
