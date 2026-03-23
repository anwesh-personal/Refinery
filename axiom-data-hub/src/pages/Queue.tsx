import { ListOrdered, Send, Clock, CheckCircle, XCircle, Play, Pause, Loader2, AlertCircle, RefreshCw, Database, Rocket, BarChart3 } from 'lucide-react';
import { PageHeader, StatCard, Button } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';
import { useToast } from '../components/Toast';
import CampaignBuilderModal from '../components/CampaignBuilderModal';

/* ── Types ── */
interface QueueJob {
  id: string;
  target_list_id: string;
  total_emails: string;
  sent_count: string;
  failed_count: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  performed_by_name: string | null;
}

interface QueueStats {
  queued: string;
  sent: string;
  failed: string;
  active: string;
}

interface MTACampaign {
  id: string;
  name: string;
  list_id: string;
  status: string;
  subject?: string;
  from_name?: string;
  from_email?: string;
  created_at?: string;
}

interface TargetList {
  id: string;
  name: string;
  email_count: string;
  status: string;
}

function formatNumber(n: string | number): string {
  return Number(n).toLocaleString();
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  queued: { color: 'var(--yellow)', bg: 'var(--yellow-muted)', label: 'Queued' },
  sending: { color: 'var(--blue)', bg: 'var(--blue-muted)', label: 'Sending' },
  paused: { color: 'var(--accent)', bg: 'var(--accent-muted)', label: 'Paused' },
  complete: { color: 'var(--green)', bg: 'var(--green-muted)', label: 'Complete' },
  failed: { color: 'var(--red)', bg: 'var(--red-muted)', label: 'Failed' },
};

export default function QueuePage() {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [targetLists, setTargetLists] = useState<TargetList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<MTACampaign[]>([]);
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);
  const [pausingCampaignId, setPausingCampaignId] = useState<string | null>(null);

  const [selectedListId, setSelectedListId] = useState('');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [jobsData, statsData, listsData] = await Promise.all([
        apiCall<QueueJob[]>('/api/queue/jobs'),
        apiCall<QueueStats>('/api/queue/stats'),
        apiCall<TargetList[]>('/api/targets'),
      ]);
      setJobs(jobsData);
      setStats(statsData);
      // Only show target lists that are ready or pushed
      setTargetLists(listsData.filter(l => l.status === 'ready' || l.status === 'pushed'));
      // Also fetch remote campaigns
      try {
        const campaignsData = await apiCall<MTACampaign[]>('/api/queue/campaigns');
        setCampaigns(campaignsData);
      } catch { /* MTA not configured yet */ }
    } catch {
      // ignore
    }
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    // Poll every 5 seconds for live progress
    const interval = setInterval(() => fetchData(true), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchData(true);
    setTimeout(() => setRefreshing(false), 500);
  };

  const { success: toastSuccess, error: toastError } = useToast();

  const startJob = async () => {
    if (!selectedListId) { setError('Please select a target list'); return; }
    setStarting(true);
    setError(null);
    try {
      await apiCall('/api/queue/start', {
        method: 'POST',
        body: { targetListId: selectedListId },
      });
      setSuccess('Mail job queued successfully');
      toastSuccess('Job Dispatched', 'Mail queue job has been started');
      setSelectedListId('');
      fetchData(true);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
      toastError('Queue Error', e.message);
    }
    setStarting(false);
  };

  const pauseJob = async (id: string) => {
    setActioningId(id);
    try {
      await apiCall(`/api/queue/${id}/pause`, { method: 'POST' });
      fetchData(true);
    } catch (e: any) {
      setError(e.message);
    }
    setActioningId(null);
  };

  const resumeJob = async (id: string) => {
    setActioningId(id);
    try {
      await apiCall(`/api/queue/${id}/resume`, { method: 'POST' });
      fetchData(true);
    } catch (e: any) {
      setError(e.message);
    }
    setActioningId(null);
  };

  const sendCampaign = async (id: string) => {
    setSendingCampaignId(id);
    try {
      const result = await apiCall<{ sent: boolean; message: string }>(`/api/queue/campaign/${id}/send`, { method: 'POST' });
      if (result.sent) {
        toastSuccess('Campaign Launched', result.message);
      } else {
        toastError('Send Failed', result.message);
      }
      fetchData(true);
    } catch (e: any) { toastError('Error', e.message); }
    setSendingCampaignId(null);
  };

  const pauseCampaign = async (id: string) => {
    setPausingCampaignId(id);
    try {
      await apiCall(`/api/queue/campaign/${id}/pause`, { method: 'POST' });
      toastSuccess('Paused', 'Campaign paused');
      fetchData(true);
    } catch (e: any) { toastError('Error', e.message); }
    setPausingCampaignId(null);
  };

  const viewStats = async (id: string) => {
    try {
      const stats = await apiCall<Record<string, any>>(`/api/queue/campaign/${id}/stats`);
      const msg = `Sent: ${stats.sent} | Opens: ${stats.unique_opens} (${((stats.open_rate||0)*100).toFixed(1)}%) | Clicks: ${stats.unique_clicks} | Bounces: ${stats.bounces}`;
      toastSuccess('Campaign Stats', msg);
    } catch (e: any) { toastError('Stats Error', e.message); }
  };



  return (
    <>
      <PageHeader
        title="Mail Queue"
        sub="Monitor and control email dispatch jobs from verified target lists."
        description="Select a prepared target list and start a mail job. The queue engine automatically handles batching, rate limiting (based on your environment configuration), and tracks live sending progress. You can pause and resume active jobs at any time."
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Queued" value={loading ? '...' : formatNumber(stats?.queued || '0')} sub="Jobs pending/paused" icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.06} />
        <StatCard label="Sent" value={loading ? '...' : formatNumber(stats?.sent || '0')} sub="Successfully delivered" icon={<CheckCircle size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Failed" value={loading ? '...' : formatNumber(stats?.failed || '0')} sub="Delivery errors" icon={<XCircle size={18} />} color="var(--red)" colorMuted="var(--red-muted)" delay={0.18} />
        <StatCard label="Active Jobs" value={loading ? '...' : formatNumber(stats?.active || '0')} sub="Currently sending" icon={<Send size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.24} />
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'var(--red-muted)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--red)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'var(--green-muted)', border: '1px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--green)' }}>
          <CheckCircle size={16} /> {success}
        </div>
      )}

      {/* Start Queue Block */}
      <div className="animate-fadeIn stagger-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
              Target List
            </label>
            <select
              value={selectedListId}
              onChange={e => setSelectedListId(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 12, fontSize: 13, fontWeight: 500,
                background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                outline: 'none', transition: 'border-color 0.2s', cursor: 'pointer',
                appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <option value="">Select a ready target list...</option>
              {targetLists.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} ({formatNumber(l.email_count)} emails)
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={starting ? <Loader2 size={14} className="spin" /> : <Play size={14} />} onClick={startJob} disabled={starting || !selectedListId}>
            {starting ? 'Queueing...' : 'Dispatch to Old Queue'}
          </Button>
          <Button icon={<Rocket size={14} />} onClick={() => setCampaignModalOpen(true)}>
            Create MTA Campaign
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Queue Jobs ({jobs.length})</h3>
        <Button variant="ghost" icon={<RefreshCw size={14} className={refreshing ? 'spin' : ''} />} onClick={handleManualRefresh}>
          Refresh
        </Button>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        {jobs.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Target List', 'Progress', 'Sent', 'Failed', 'Status', 'Started', 'By', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left', fontWeight: 700,
                      fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => {
                  const targetList = targetLists.find(t => t.id === job.target_list_id) || { name: job.target_list_id };
                  const st = statusConfig[job.status] || { color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)', label: job.status };
                  const total = Number(job.total_emails);
                  const processed = Number(job.sent_count) + Number(job.failed_count);
                  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

                  return (
                    <tr
                      key={job.id}
                      style={{ transition: 'background 0.1s' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseOut={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Database size={14} style={{ color: 'var(--text-tertiary)' }} />
                          <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {targetList.name}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, fontWeight: 500 }}>
                          ID: {job.id.substring(0, 8)}...
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: st.color, transition: 'width 0.5s' }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                          {formatNumber(processed)} / {formatNumber(total)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--green)', fontWeight: 600 }}>
                        {formatNumber(job.sent_count)}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--red)', fontWeight: 600 }}>
                        {formatNumber(job.failed_count)}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                          padding: '4px 10px', borderRadius: 6,
                          color: st.color, background: st.bg,
                        }}>
                          {job.status === 'sending' && <Loader2 size={10} className="spin" />}
                          {job.status === 'paused' && <Pause size={10} />}
                          {st.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                        {relativeTime(job.started_at)}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-tertiary)', fontSize: 12 }}>
                        {job.performed_by_name || '—'}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {job.status === 'sending' || job.status === 'queued' ? (
                            <Button
                              variant="ghost"
                              icon={actioningId === job.id ? <Loader2 size={14} className="spin" /> : <Pause size={14} />}
                              onClick={() => pauseJob(job.id)}
                              disabled={actioningId !== null}
                            >
                              Pause
                            </Button>
                          ) : job.status === 'paused' ? (
                            <Button
                              variant="ghost"
                              icon={actioningId === job.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                              onClick={() => resumeJob(job.id)}
                              disabled={actioningId !== null}
                            >
                              Resume
                            </Button>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <ListOrdered size={24} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>{loading ? 'Loading...' : 'No queue jobs'}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Select a target list above to start dispatching</div>
          </div>
        )}
      </div>

      {/* ── Remote Campaigns (from MTA) ── */}
      {campaigns.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, marginTop: 36 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>MTA Campaigns ({campaigns.length})</h3>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Campaign', 'Subject', 'From', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{
                        padding: '12px 16px', textAlign: 'left', fontWeight: 700,
                        fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
                        color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map(c => {
                    const cStatus = statusConfig[c.status] || { color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)', label: c.status };
                    return (
                      <tr key={c.id}
                        style={{ transition: 'background 0.1s' }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseOut={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                          {c.name}
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>ID: {c.id}</div>
                        </td>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                          {c.subject || '—'}
                        </td>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 12 }}>
                          {c.from_name} &lt;{c.from_email}&gt;
                        </td>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                            padding: '4px 10px', borderRadius: 6,
                            color: cStatus.color, background: cStatus.bg,
                          }}>{cStatus.label}</span>
                        </td>
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {(c.status === 'draft' || c.status === 'paused') && (
                              <Button variant="ghost"
                                icon={sendingCampaignId === c.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                                onClick={() => sendCampaign(c.id)} disabled={sendingCampaignId !== null}>
                                Send
                              </Button>
                            )}
                            {c.status === 'sending' && (
                              <Button variant="ghost"
                                icon={pausingCampaignId === c.id ? <Loader2 size={14} className="spin" /> : <Pause size={14} />}
                                onClick={() => pauseCampaign(c.id)} disabled={pausingCampaignId !== null}>
                                Pause
                              </Button>
                            )}
                            <Button variant="ghost" icon={<BarChart3 size={14} />} onClick={() => viewStats(c.id)}>
                              Stats
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <CampaignBuilderModal
        open={campaignModalOpen}
        onClose={() => setCampaignModalOpen(false)}
        onCreated={() => fetchData(true)}
      />
    </>
  );
}
