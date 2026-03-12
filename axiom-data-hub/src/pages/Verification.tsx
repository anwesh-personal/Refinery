import { useState, useEffect } from 'react';
import { ShieldCheck, CheckCircle, XCircle, Clock, Upload, RefreshCw, Activity, StopCircle, Play } from 'lucide-react';
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
}

interface Batch {
  id: string;
  segment_id: string;
  total_leads: number;
  verified_count: number;
  bounced_count: number;
  unknown_count: number;
  status: string;
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
  const [config, setConfig] = useState<VerifyConfig>({ endpoint: '', apiKey: '', batchSize: '5000', concurrency: '3' });
  const [batches, setBatches] = useState<Batch[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ok: boolean; message: string} | null>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState('');
  const [startingBatch, setStartingBatch] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      // Periodically poll stats & batches if there are pending/running tasks
      fetchData(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedServerId]);

  const fetchData = async (background = false) => {
    try {
      const opts = { serverId: selectedServerId || undefined };
      const [s, c, b, segs] = await Promise.all([
        apiCall<VerifyStats>('/api/verification/stats', opts),
        !background ? apiCall<Record<string, string>>('/api/verification/config', opts) : Promise.resolve(null),
        apiCall<Batch[]>('/api/verification/batches', opts),
        !background ? apiCall<{ segments: Segment[] }>('/api/segments', opts) : Promise.resolve(null),
      ]);
      setStats(s);
      if (c) {
        setConfig({
          endpoint: c.verify550_endpoint || '',
          apiKey: c.verify550_api_key || '',
          batchSize: c.verify550_batch_size || '5000',
          concurrency: c.verify550_concurrency || '3',
        });
      }
      setBatches(b || []);
      if (segs) {
        setSegments(segs.segments || []);
        if (segs.segments && segs.segments.length > 0 && !selectedSegmentId) {
          setSelectedSegmentId(segs.segments[0].id);
        }
      }
    } catch (e) {
      if (!background) console.error('Failed to load verification data', e);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const body: any = {
        endpoint: config.endpoint,
        batchSize: config.batchSize,
        concurrency: config.concurrency,
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
        body: { segmentId: selectedSegmentId },
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
        title="Verification" 
        sub="Clean and verify lead data through Verify550 before mailing." 
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Verified" value={stats?.verified.toLocaleString() || "0"} sub="Clean leads ready" icon={<CheckCircle size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.06} />
        <StatCard label="Bounced" value={stats?.bounced.toLocaleString() || "0"} sub="Invalid emails removed" icon={<XCircle size={18} />} color="var(--red)" colorMuted="var(--red-muted)" delay={0.12} />
        <StatCard label="Pending" value={stats?.pending.toLocaleString() || "0"} sub="Awaiting verification" icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.18} />
        <StatCard label="Yield Rate" value={stats ? `${stats.yieldRate}%` : "—"} sub="Success conversion" icon={<Activity size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.24} />
      </div>

      <SectionHeader title="Verify550 API Configuration" />
      <div className="animate-fadeIn stagger-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>API Endpoint</label>
            <Input value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e })} placeholder="https://api.verify550.com/v1" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>API Key</label>
            <Input value={config.apiKey} onChange={e => setConfig({ ...config, apiKey: e })} placeholder="v550-key-(masked)" type="password" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Batch Size</label>
            <Input value={config.batchSize} onChange={e => setConfig({ ...config, batchSize: e })} placeholder="e.g. 5000" type="number" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Concurrency Limit</label>
            <Input value={config.concurrency} onChange={e => setConfig({ ...config, concurrency: e })} placeholder="e.g. 3" type="number" />
          </div>
        </div>
        
        {testResult && (
          <div style={{ marginBottom: 20, padding: 12, borderRadius: 8, background: testResult.ok ? 'var(--green-muted)' : 'var(--red-muted)', color: testResult.ok ? 'var(--green)' : 'var(--red)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {testResult.message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button onClick={handleSaveConfig} disabled={saving} icon={<Upload size={14} />}>
            {saving ? 'Saving...' : 'Save Config'}
          </Button>
          <Button variant="secondary" onClick={handleTestApi} disabled={testing} icon={<RefreshCw size={14} className={testing ? "animate-spin" : ""} />}>
            {testing ? 'Testing...' : 'Test API Connection'}
          </Button>
        </div>
      </div>

      <SectionHeader title="Verification Batches" action="Start New Batch" onAction={() => setIsModalOpen(true)} />
      <DataTable
        columns={[
          { key: 'id', label: 'Batch ID' },
          { key: 'segment', label: 'Segment' },
          { key: 'total', label: 'Total Leads' },
          { key: 'verified', label: 'Verified' },
          { key: 'bounced', label: 'Bounced' },
          { key: 'status', label: 'Status' },
          { key: 'action', label: '' },
        ]}
        rows={batches.map(b => ({
          id: <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.id.substring(0, 8)}...</span>,
          segment: segments.find(s => s.id === b.segment_id)?.name || b.segment_id,
          total: (b.total_leads || 0).toLocaleString(),
          verified: (b.verified_count || 0).toLocaleString(),
          bounced: (b.bounced_count || 0).toLocaleString(),
          status: <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {getStatusBadge(b.status)}
            {b.error_message && <span style={{ fontSize: 11, color: 'var(--red)', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.error_message}>{b.error_message}</span>}
          </div>,
          action: ['pending', 'submitting', 'processing'].includes(b.status) ? (
            <Button variant="danger" style={{ padding: '6px 12px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); handleCancel(b.id); }} icon={<StopCircle size={12} />}>Cancel</Button>
          ) : null
        }))}
        emptyIcon={<ShieldCheck size={24} />}
        emptyTitle="No verification batches"
        emptySub="Configure the Verify550 API and start a batch"
      />

      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="animate-slideInRight" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 16, width: 440, maxWidth: '100%', display: 'flex', flexDirection: 'column', padding: 24 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Start Verification Batch</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Choose a segment to verify. The system will process unverified leads incrementally. You can safely run this on the same segment multiple times without re-verifying old leads.
            </p>
            
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Target Segment</label>
              <select 
                value={selectedSegmentId} 
                onChange={e => setSelectedSegmentId(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
              >
                {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                {segments.length === 0 && <option value="" disabled>No segments found...</option>}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <Button style={{ flex: 1 }} onClick={handleStartBatch} disabled={startingBatch || !selectedSegmentId} icon={<Play size={14} />}>
                {startingBatch ? 'Starting...' : 'Start Verification'}
              </Button>
              <Button variant="secondary" onClick={() => setIsModalOpen(false)} style={{ flex: 1 }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
