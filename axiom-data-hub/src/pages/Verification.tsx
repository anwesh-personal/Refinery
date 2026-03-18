import { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldCheck, CheckCircle, XCircle, Clock, Upload, RefreshCw, Activity, StopCircle, Play, Download } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, DataTable, Button, Input, Badge } from '../components/UI';
import { ServerSelector, useServers } from '../components/ServerSelector';
import { apiCall } from '../lib/api';

interface VerifyStats {
  verified: number;
  bounced: number;
  unknown: number;
  pending: number;
  total: number;
  yieldRate: string;
}

interface VerifyConfig {
  endpoint: string;
  apiKey: string;
  batchSize: string;
  concurrency: string;
  builtinHeloDomain: string;
  builtinFromEmail: string;
  builtinConcurrency: string;
  builtinTimeout: string;
  builtinEnableCatchAll: string;
  builtinMinInterval: string;
  builtinPort: string;
  builtinMaxPerDomain: string;
}

interface Batch {
  id: string;
  segment_id: string;
  total_leads: number;
  verified_count: number;
  bounced_count: number;
  unknown_count: number;
  status: string;
  engine?: string;
  started_at: string;
  completed_at: string | null;
  error_message?: string;
}

interface Segment {
  id: string;
  name: string;
}

export default function VerificationPage() {
  const { selectedServerId } = useServers();
  const [stats, setStats] = useState<VerifyStats | null>(null);
  const [config, setConfig] = useState<VerifyConfig>({ 
    endpoint: '', apiKey: '', batchSize: '5000', concurrency: '3',
    builtinHeloDomain: '', builtinFromEmail: '', builtinConcurrency: '10', builtinTimeout: '15000',
    builtinEnableCatchAll: '0', builtinMinInterval: '2000', builtinPort: '25', builtinMaxPerDomain: '2'
  });
  const [batches, setBatches] = useState<Batch[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);

  // Verify550 Custom State
  const [v550Credits, setV550Credits] = useState<number | null>(null);
  const [v550Jobs, setV550Jobs] = useState<any[]>([]);
  const [singleVerifyEmail, setSingleVerifyEmail] = useState('');
  const [singleVerifyResult, setSingleVerifyResult] = useState<string | null>(null);
  const [singleVerifying, setSingleVerifying] = useState(false);
  const [uploadingCSV, setUploadingCSV] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // V550 Job Detail state
  const [v550DetailJob, setV550DetailJob] = useState<any>(null);
  const [v550DetailLoading, setV550DetailLoading] = useState(false);
  const [v550ExportCategories, setV550ExportCategories] = useState<Set<string>>(new Set());
  const [v550ExportFormat, setV550ExportFormat] = useState<'csv' | 'xlsx'>('csv');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ok: boolean; message: string} | null>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState('');
  const [startingBatch, setStartingBatch] = useState(false);
  const [engineType, setEngineType] = useState<'verify550' | 'builtin'>('builtin');

  const pollFailures = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePoll = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    // Back off: 10s → 20s → 40s → 60s max based on consecutive failures
    const delay = Math.min(10000 * Math.pow(2, pollFailures.current), 60000);
    pollTimer.current = setTimeout(() => fetchData(true), delay);
  }, [selectedServerId]);

  useEffect(() => {
    pollFailures.current = 0;
    fetchData();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [selectedServerId]);

  const fetchData = async (background = false) => {
    try {
      const opts = { serverId: selectedServerId || undefined };
      const [s, c, b, segs, credsResp, completedResp, runningResp] = await Promise.all([
        apiCall<VerifyStats>('/api/verification/stats', opts).catch(()=>null),
        !background ? apiCall<Record<string, string>>('/api/verification/config', opts).catch(()=>null) : Promise.resolve(null),
        apiCall<Batch[]>('/api/verification/batches', opts).catch(()=>[]),
        !background ? apiCall<{ segments: Segment[] }>('/api/segments', opts).catch(()=>null) : Promise.resolve(null),
        apiCall<{ credits: number }>('/api/v550/credits', opts).catch(()=>null),
        apiCall<any>('/api/v550/jobs/completed', opts).catch(()=>null),
        apiCall<any>('/api/v550/jobs/running', opts).catch(()=>null),
      ]);
      if (s) setStats(s);
      if (c) {
        setConfig({
          endpoint: c.verify550_endpoint || '',
          apiKey: c.verify550_api_key || '',
          batchSize: c.verify550_batch_size || '5000',
          concurrency: c.verify550_concurrency || '3',
          builtinHeloDomain: c.builtin_helo_domain || '',
          builtinFromEmail: c.builtin_from_email || '',
          builtinConcurrency: c.builtin_concurrency || '10',
          builtinTimeout: c.builtin_timeout || '15000',
          builtinEnableCatchAll: c.builtin_enable_catchall || '0',
          builtinMinInterval: c.builtin_min_interval || '2000',
          builtinPort: c.builtin_port || '25',
          builtinMaxPerDomain: c.builtin_max_per_domain || '2',
        });
      }
      setBatches(b || []);
      if (segs) {
        setSegments(segs.segments || []);
        if (segs.segments && segs.segments.length > 0 && !selectedSegmentId) {
          setSelectedSegmentId(segs.segments[0].id);
        }
      }
      
      if (credsResp) setV550Credits(credsResp.credits);
      
      const vjobs: any[] = [];
      const runningArr = Array.isArray(runningResp) ? runningResp : runningResp?.data || [];
      const completedArr = Array.isArray(completedResp) ? completedResp : completedResp?.data || [];
      
      vjobs.push(...runningArr.map((j: any) => ({ ...j, status: 'progress' })));
      vjobs.push(...completedArr.map((j: any) => ({ ...j, status: 'finished' })));
      
      if (vjobs.length > 0) {
         setV550Jobs(vjobs.sort((a,b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime()));
      }

      // Reset backoff on success
      pollFailures.current = 0;
    } catch (e) {
      pollFailures.current++;
      if (!background) console.error('Failed to load verification data', e);
    }
    // Schedule next poll regardless
    schedulePoll();
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const body: any = {
        endpoint: config.endpoint,
        batchSize: config.batchSize,
        concurrency: config.concurrency,
        builtinHeloDomain: config.builtinHeloDomain,
        builtinFromEmail: config.builtinFromEmail,
        builtinConcurrency: config.builtinConcurrency,
        builtinTimeout: config.builtinTimeout,
        builtinEnableCatchAll: config.builtinEnableCatchAll,
        builtinMinInterval: config.builtinMinInterval,
        builtinPort: config.builtinPort,
        builtinMaxPerDomain: config.builtinMaxPerDomain,
      };
      if (config.apiKey && !config.apiKey.includes('••••••••')) {
        body.apiKey = config.apiKey;
      }
      await apiCall('/api/verification/config', {
        method: 'POST',
        body,
        serverId: selectedServerId || undefined
      });
      alert('Configuration saved successfully');
      fetchData(false);
    } catch (err: any) {
      alert(`Failed to save configuration: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTestApi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await apiCall<{ok: boolean; message: string}>('/api/verification/test', {
        method: 'POST',
        serverId: selectedServerId || undefined
      });
      setTestResult(resp);
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleStartBatch = async () => {
    if (!selectedSegmentId) return alert('Select a segment first');
    setStartingBatch(true);
    try {
      await apiCall('/api/verification/start', {
        method: 'POST',
        body: { segmentId: selectedSegmentId, engine: engineType },
        serverId: selectedServerId || undefined
      });
      setIsModalOpen(false);
      fetchData();
    } catch (err: any) {
      alert(`Start failed: ${err.message}`);
    } finally {
      setStartingBatch(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Are you sure you want to cancel this batch?')) return;
    try {
      await apiCall(`/api/verification/cancel/${id}`, {
        method: 'POST',
        serverId: selectedServerId || undefined
      });
      fetchData();
    } catch (err: any) {
      alert(`Cancel failed: ${err.message}`);
    }
  };

  const handleExportCSV = async (batchId: string) => {
    try {
      const blob = await apiCall<Blob>(`/api/verification/batches/${batchId}/export`, {
        method: 'GET',
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `verification-${batchId.substring(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleSingleVerify = async () => {
    if (!singleVerifyEmail) return;
    setSingleVerifying(true);
    setSingleVerifyResult(null);
    try {
      const resp = await apiCall<{status: string}>(`/api/v550/verify?email=${encodeURIComponent(singleVerifyEmail)}`);
      setSingleVerifyResult(resp.status);
    } catch (e: any) {
      alert(`Verification failed: ${e.message}`);
    } finally {
      setSingleVerifying(false);
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCSV(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      await apiCall('/api/v550/upload', {
        method: 'POST',
        body: formData,
      });
      
      alert('File uploaded to Verify550 successfully!');
      fetchData(false);
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingCSV(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleV550Export = async (jobId: string) => {
    try {
      const blob = await apiCall<Blob>(`/api/v550/export/${jobId}?format=csv`, {
        method: 'GET',
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `verify550-${jobId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleV550ExportFiltered = async (jobId: string) => {
    try {
      const params = new URLSearchParams();
      params.set('format', v550ExportFormat);
      if (v550ExportCategories.size > 0) params.set('categories', Array.from(v550ExportCategories).join(','));
      const blob = await apiCall<Blob>(`/api/v550/export/${jobId}?${params.toString()}`, {
        method: 'GET',
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `verify550-${jobId}-${v550ExportFormat}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const fetchV550JobDetail = async (jobId: string) => {
    setV550DetailLoading(true);
    try {
      const data = await apiCall<any>(`/api/v550/job/${jobId}`);
      setV550DetailJob(data?.data || data);
      setV550ExportCategories(new Set());
    } catch (e: any) {
      alert(`Failed to fetch job details: ${e.message}`);
    } finally {
      setV550DetailLoading(false);
    }
  };

  // V550 Category grouping for display
  const V550_GROUPS: { label: string; color: string; bg: string; categories: string[] }[] = [
    { label: '✅ Safe', color: 'var(--green)', bg: 'rgba(34,197,94,0.1)', categories: ['ok', 'ok_for_all'] },
    { label: '⚠️ Risky', color: 'var(--yellow)', bg: 'rgba(234,179,8,0.1)', categories: ['unknown', 'antispam_system', 'soft_bounce', 'departmental', 'invalid_vendor_response'] },
    { label: '❌ Dead', color: 'var(--red)', bg: 'rgba(239,68,68,0.1)', categories: ['email_disabled', 'dead_server', 'invalid_mx', 'invalid_syntax', 'smtp_protocol', 'hard_bounces'] },
    { label: '🚫 Threats', color: '#a855f7', bg: 'rgba(168,85,247,0.1)', categories: ['complainers', 'sleeper_cell', 'seeds', 'email_bot', 'spamcops', 'spamtraps', 'threat_endings', 'threat_string', 'advisory_trap', 'blacklisted', 'disposables', 'bot_clickers', 'litigators', 'lashback'] },
  ];


  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'complete': return <Badge label="Complete" color="var(--green)" colorMuted="var(--green-muted)" />;
      case 'processing': return <Badge label="Processing" color="var(--blue)" colorMuted="var(--blue-muted)" />;
      case 'pending':
      case 'submitting': return <Badge label="Pending" color="var(--yellow)" colorMuted="var(--yellow-muted)" />;
      case 'failed':
      case 'cancelled': return <Badge label={status.charAt(0).toUpperCase() + status.slice(1)} color="var(--red)" colorMuted="var(--red-muted)" />;
      default: return <Badge label={status} color="var(--text-tertiary)" colorMuted="var(--bg-app)" />;
    }
  };

  return (
    <>
      <PageHeader 
        title="Verification Engine" 
        sub="Validate lead emails via the built-in SMTP engine or Verify550 API." 
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Verified" value={stats?.verified.toLocaleString() || "0"} sub="Clean leads ready" icon={<CheckCircle size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.06} />
        <StatCard label="Bounced" value={stats?.bounced.toLocaleString() || "0"} sub="Invalid emails removed" icon={<XCircle size={18} />} color="var(--red)" colorMuted="var(--red-muted)" delay={0.12} />
        <StatCard label="Pending" value={stats?.pending.toLocaleString() || "0"} sub="Awaiting verification" icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.18} />
        <StatCard label="Yield Rate" value={stats ? `${stats.yieldRate}%` : "—"} sub="Success conversion" icon={<Activity size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.24} />
      </div>

      <SectionHeader title="Engine Configuration" />
      
      {/* ─── Two-Column Engine Config ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24, marginBottom: 36 }} className="animate-fadeIn stagger-4">
        
        {/* ── Native SMTP Engine Card ── */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ background: 'var(--blue-muted)', color: 'var(--blue)', padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={20} />
            </div>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Native SMTP Engine</h4>
          </div>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Built-in, zero-cost verification. Connects directly to mail servers via SMTP without sending emails. Requires Port 25 outbound and valid rDNS.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>EHLO / HELO Hostname</label>
              <Input value={config.builtinHeloDomain} onChange={e => setConfig({ ...config, builtinHeloDomain: e })} placeholder="e.g. mail.your-domain.com" />
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-tertiary)' }}>Must resolve to this server's IP via A record (rDNS match).</p>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Envelope Sender (MAIL FROM)</label>
              <Input value={config.builtinFromEmail} onChange={e => setConfig({ ...config, builtinFromEmail: e })} placeholder="verify@your-domain.com" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Max Concurrent Domains</label>
              <Input value={config.builtinConcurrency} onChange={e => setConfig({ ...config, builtinConcurrency: e })} placeholder="10" type="number" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Max Sockets / Domain</label>
              <Input value={config.builtinMaxPerDomain} onChange={e => setConfig({ ...config, builtinMaxPerDomain: e })} placeholder="2" type="number" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Min Interval (ms)</label>
              <Input value={config.builtinMinInterval} onChange={e => setConfig({ ...config, builtinMinInterval: e })} placeholder="2000" type="number" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>SMTP Port</label>
              <Input value={config.builtinPort} onChange={e => setConfig({ ...config, builtinPort: e })} placeholder="25" type="number" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Socket Timeout (ms)</label>
              <Input value={config.builtinTimeout} onChange={e => setConfig({ ...config, builtinTimeout: e })} placeholder="15000" type="number" />
            </div>
          </div>
          
          {/* Catch-All Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-app)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Catch-All Detection</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Probe random addresses to detect catch-all domains.</div>
            </div>
            <div
              onClick={() => setConfig({ ...config, builtinEnableCatchAll: config.builtinEnableCatchAll === '1' ? '0' : '1' })}
              style={{ width: 40, height: 22, borderRadius: 11, background: config.builtinEnableCatchAll === '1' ? 'var(--blue)' : 'var(--border)', cursor: 'pointer', position: 'relative', transition: 'background .3s' }}
            >
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: config.builtinEnableCatchAll === '1' ? 21 : 3, transition: 'left .3s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
            </div>
          </div>

          <Button onClick={handleSaveConfig} disabled={saving} icon={<Upload size={14} />} style={{ width: '100%' }}>
            {saving ? 'Saving…' : 'Save All Configuration'}
          </Button>
        </div>

        {/* ── Verify550 API Card ── */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: 'var(--purple-muted, rgba(168,85,247,.15))', color: 'var(--purple, #a855f7)', padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={20} />
              </div>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Verify550 API</h4>
            </div>
            {v550Credits !== null && (
               <Badge label={`${v550Credits.toLocaleString()} Credits`} color="var(--purple, #a855f7)" colorMuted="var(--purple-muted, rgba(168,85,247,.15))" />
            )}
          </div>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Third-party commercial verification. Highest accuracy via dynamic IP routing. Use when your server lacks Port 25 access.
          </p>
          
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>API Endpoint</label>
              <Input value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e })} placeholder="https://api.verify550.com/v1" />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Authentication Key</label>
              <Input value={config.apiKey} onChange={e => setConfig({ ...config, apiKey: e })} placeholder="v550-key-••••" type="password" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Batch Size</label>
                <Input value={config.batchSize} onChange={e => setConfig({ ...config, batchSize: e })} placeholder="5000" type="number" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>API Concurrency</label>
                <Input value={config.concurrency} onChange={e => setConfig({ ...config, concurrency: e })} placeholder="3" type="number" />
              </div>
            </div>
          </div>
          
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
            {testResult && (
              <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: testResult.ok ? 'var(--green-muted)' : 'var(--red-muted)', color: testResult.ok ? 'var(--green)' : 'var(--red)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {testResult.message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              <Button variant="secondary" onClick={handleTestApi} disabled={testing} icon={<RefreshCw size={14} className={testing ? "animate-spin" : ""} />} style={{ flex: 1 }}>
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <SectionHeader title="Verify550 Operations" />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(400px, 2fr)', gap: 24, marginBottom: 36 }}>
         {/* Single Verification */}
         <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
           <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Quick Verification</h4>
           <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Check a single email address instantly against Verify550.</p>
           <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
             <Input placeholder="email@domain.com" value={singleVerifyEmail} onChange={(v: string) => setSingleVerifyEmail(v)} />
             <Button disabled={!singleVerifyEmail || singleVerifying} onClick={handleSingleVerify} style={{ padding: '0 16px' }}>
               {singleVerifying ? '...' : 'Verify'}
             </Button>
           </div>
           {singleVerifyResult && (
             <div style={{ padding: '12px 16px', borderRadius: 8, fontSize: 13, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Status:</span> 
                <Badge label={singleVerifyResult} color="var(--purple)" colorMuted="var(--purple-muted)" />
             </div>
           )}
         </div>

         {/* Bulk CSV Upload */}
         <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
           <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>External Bulk Verification</h4>
           <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>Upload a raw CSV file directly to Verify550 for verification without using internal segments. Bypasses local storage.</p>
           <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
             <input type="file" accept=".csv" ref={fileInputRef} onChange={handleBulkUpload} style={{ display: 'none' }} id="v550-upload" />
             <label htmlFor="v550-upload" style={{
                cursor: 'pointer', padding: '10px 20px', borderRadius: 10, background: 'var(--purple, #a855f7)', color: '#fff', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'background 0.2s',
                opacity: uploadingCSV ? 0.7 : 1, pointerEvents: uploadingCSV ? 'none' : 'auto'
             }}>
                <Upload size={16} /> {uploadingCSV ? 'Uploading to Verify550...' : 'Select & Upload CSV'}
             </label>
           </div>
         </div>
      </div>

      <SectionHeader title="Verify550 External Jobs" />
      <div style={{ marginBottom: 36 }}>
        <DataTable
          columns={[
            { key: 'jobId', label: 'Job ID' },
            { key: 'file_name', label: 'Filename' },
            { key: 'count', label: 'Total Logs' },
            { key: 'processed', label: 'Processed' },
            { key: 'uploadTime', label: 'Upload Time' },
            { key: 'status', label: 'Status' },
            { key: 'action', label: '' }
          ]}
          rows={v550Jobs.map(job => ({
            jobId: <span style={{ fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', color: 'var(--accent)' }} onClick={() => fetchV550JobDetail(job.jobId)}>{job.jobId}</span>,
            file_name: <span style={{ fontSize: 13, fontWeight: 500 }}>{job.file_name}</span>,
            count: (job.count || 0).toLocaleString(),
            processed: (job.processed || 0).toLocaleString(),
            uploadTime: new Date(job.uploadTime).toLocaleString(),
            status: <Badge label={job.status} color={job.status === 'finished' ? 'var(--green)' : 'var(--blue)'} colorMuted={job.status === 'finished' ? 'var(--green-muted)' : 'var(--blue-muted)'} />,
            action: <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="secondary" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => fetchV550JobDetail(job.jobId)} icon={v550DetailLoading ? <RefreshCw size={12} className="spin" /> : <Activity size={12} />} disabled={v550DetailLoading}>Details</Button>
              {job.status === 'finished' && (
                <Button variant="secondary" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => handleV550Export(job.jobId)} icon={<Download size={12} />}>Export</Button>
              )}
            </div>
          }))}
          emptyIcon={<Activity size={24} />}
          emptyTitle="No external Verify550 jobs"
          emptySub="Upload a CSV above to process it directly through Verify550."
        />
      </div>

      <SectionHeader title="Native Verification History" action="Start Custom Batch" onAction={() => setIsModalOpen(true)} />
      <DataTable
        columns={[
          { key: 'id', label: 'Batch ID' },
          { key: 'engine', label: 'Engine' },
          { key: 'segment', label: 'Target Segment' },
          { key: 'total', label: 'Volume' },
          { key: 'verified', label: 'Verified' },
          { key: 'bounced', label: 'Bounced' },
          { key: 'status', label: 'State' },
          { key: 'action', label: '' },
        ]}
        rows={batches.map(b => ({
          id: <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.id.substring(0, 8)}…</span>,
          engine: <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: (!b.engine || b.engine === 'verify550') ? 'var(--purple-muted, rgba(168,85,247,.15))' : 'var(--blue-muted)', color: (!b.engine || b.engine === 'verify550') ? 'var(--purple, #a855f7)' : 'var(--blue)' }}>{(!b.engine || b.engine === 'verify550') ? 'Verify550' : 'Native SMTP'}</span>,
          segment: segments.find(s => s.id === b.segment_id)?.name || b.segment_id,
          total: (b.total_leads || 0).toLocaleString(),
          verified: (b.verified_count || 0).toLocaleString(),
          bounced: (b.bounced_count || 0).toLocaleString(),
          status: <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {getStatusBadge(b.status)}
            {b.error_message && <span style={{ fontSize: 11, color: 'var(--red)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.error_message}>{b.error_message}</span>}
          </div>,
          action: ['pending', 'submitting', 'processing'].includes(b.status) ? (
            <Button variant="danger" style={{ padding: '6px 12px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); handleCancel(b.id); }} icon={<StopCircle size={12} />}>Halt</Button>
          ) : ['complete', 'cancelled'].includes(b.status) ? (
            <Button variant="secondary" style={{ padding: '6px 12px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); handleExportCSV(b.id); }} icon={<Download size={12} />}>CSV</Button>
          ) : null
        }))}
        emptyIcon={<ShieldCheck size={24} />}
        emptyTitle="No verification history"
        emptySub="Select an engine and launch a segment batch to begin."
      />

      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="animate-slideInRight" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 16, width: 480, maxWidth: '100%', display: 'flex', flexDirection: 'column', padding: 28 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Launch Verification Batch</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Choose a segment and engine. Already-verified leads are skipped — safe to re-run incrementally.
            </p>
            
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Target Segment</label>
              <select 
                value={selectedSegmentId} 
                onChange={e => setSelectedSegmentId(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
              >
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                {segments.length === 0 && <option value="" disabled>No segments available…</option>}
              </select>
            </div>
            
            <div style={{ marginBottom: 28 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 10 }}>Verification Engine</label>
              
              <div 
                onClick={() => setEngineType('builtin')}
                style={{ cursor: 'pointer', padding: '14px 16px', borderRadius: 10, border: `2px solid ${engineType === 'builtin' ? 'var(--blue)' : 'var(--border)'}`, background: engineType === 'builtin' ? 'var(--blue-muted)' : 'transparent', marginBottom: 10, transition: 'all .2s' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <ShieldCheck size={16} style={{ color: 'var(--blue)' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Native SMTP Engine</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 24 }}>Free. Direct SMTP probing. Requires unrestricted Port 25 outbound.</div>
              </div>
              
              <div 
                onClick={() => setEngineType('verify550')}
                style={{ cursor: 'pointer', padding: '14px 16px', borderRadius: 10, border: `2px solid ${engineType === 'verify550' ? 'var(--purple, #a855f7)' : 'var(--border)'}`, background: engineType === 'verify550' ? 'var(--purple-muted, rgba(168,85,247,.15))' : 'transparent', transition: 'all .2s' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Activity size={16} style={{ color: 'var(--purple, #a855f7)' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Verify550 API</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 24 }}>Paid. Dynamic IP routing. Best for tricky B2B domains or blocked ports.</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <Button style={{ flex: 1 }} onClick={handleStartBatch} disabled={startingBatch || !selectedSegmentId} icon={<Play size={14} />}>
                {startingBatch ? 'Submitting…' : 'Launch Batch'}
              </Button>
              <Button variant="secondary" onClick={() => setIsModalOpen(false)} style={{ flex: 1 }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V550 JOB DETAIL MODAL */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {v550DetailJob && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setV550DetailJob(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
            padding: 24,
          }}
        >
          <div className="animate-scaleIn" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            borderRadius: 20, width: '100%', maxWidth: 820, maxHeight: '90vh',
            boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Job Detail — {v550DetailJob.file_name}
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                  Job ID: {v550DetailJob.jobId} · Status: {v550DetailJob.status} · {(v550DetailJob.count || 0).toLocaleString()} emails
                </p>
              </div>
              <button onClick={() => setV550DetailJob(null)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: 'none', color: 'var(--text-tertiary)',
              }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>
              {/* Summary Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-hover)', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{(v550DetailJob.count || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
                </div>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-hover)', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{(v550DetailJob.processed || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Processed</div>
                </div>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-hover)', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{(v550DetailJob.duplicates || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Duplicates</div>
                </div>
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-hover)', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>
                    {v550DetailJob.suppression_results ? (
                      ((((v550DetailJob.suppression_results.ok || 0) + (v550DetailJob.suppression_results.ok_for_all || 0)) / Math.max(v550DetailJob.processed || 1, 1)) * 100).toFixed(1) + '%'
                    ) : '—'}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Safe Rate</div>
                </div>
              </div>

              {/* Suppression Results Breakdown */}
              {v550DetailJob.suppression_results && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {V550_GROUPS.map(group => {
                    const results = v550DetailJob.suppression_results as Record<string, number>;
                    const groupCats = group.categories.filter(c => (results[c] || 0) > 0);
                    const groupTotal = group.categories.reduce((sum, c) => sum + (results[c] || 0), 0);
                    if (groupTotal === 0) return null;
                    return (
                      <div key={group.label} style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
                        <div style={{ padding: '10px 16px', background: group.bg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: group.color }}>{group.label}</span>
                          <span style={{ fontWeight: 800, fontSize: 14, color: group.color }}>{groupTotal.toLocaleString()}</span>
                        </div>
                        <div style={{ padding: '8px 0' }}>
                          {groupCats.map(cat => (
                            <label key={cat} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '6px 16px', cursor: 'pointer', fontSize: 13, transition: 'background 0.15s',
                            }}
                              onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                              onMouseOut={e => (e.currentTarget.style.background = '')}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={v550ExportCategories.has(cat)}
                                  onChange={() => {
                                    const next = new Set(v550ExportCategories);
                                    next.has(cat) ? next.delete(cat) : next.add(cat);
                                    setV550ExportCategories(next);
                                  }}
                                  style={{ accentColor: group.color }}
                                />
                                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{cat.replace(/_/g, ' ')}</span>
                              </div>
                              <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                                {(results[cat] || 0).toLocaleString()}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Timing Info */}
              {v550DetailJob.uploadTime && (
                <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'var(--bg-hover)', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <span>Uploaded: {new Date(v550DetailJob.uploadTime).toLocaleString()}</span>
                  {v550DetailJob.startTime && <span>Started: {new Date(v550DetailJob.startTime).toLocaleString()}</span>}
                  {v550DetailJob.completionTime && <span>Completed: {new Date(v550DetailJob.completionTime).toLocaleString()}</span>}
                </div>
              )}
            </div>

            {/* Footer — Export controls */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Format:</span>
                <select value={v550ExportFormat} onChange={e => setV550ExportFormat(e.target.value as 'csv' | 'xlsx')} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
                  color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, padding: '4px 8px', cursor: 'pointer',
                }}>
                  <option value="csv">CSV</option>
                  <option value="xlsx">XLSX</option>
                </select>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {v550ExportCategories.size > 0 ? `${v550ExportCategories.size} categories selected` : 'All categories (no filter)'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => setV550DetailJob(null)}>Close</Button>
                <Button
                  onClick={() => handleV550ExportFiltered(v550DetailJob.jobId)}
                  icon={<Download size={14} />}
                  disabled={v550DetailJob.status !== 'finished'}
                >
                  {v550ExportCategories.size > 0 ? 'Export Selected' : 'Export All'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
