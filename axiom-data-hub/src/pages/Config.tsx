import { useState, useEffect } from 'react';
import { PageHeader, SectionHeader, Button } from '../components/UI';
import { apiCall } from '../lib/api';
import { useServers } from '../components/ServerSelector';
import { Server, Plus, Trash2, Edit2, Play, CheckCircle, XCircle, Database, Cloud, Settings, Save, Info } from 'lucide-react';
import { Can } from '../auth/ProtectedRoute';
import AgentCard from '../components/AgentCard';

interface ServerData {
  id: string;
  name: string;
  type: 'clickhouse' | 's3' | 'minio';
  host: string;
  port: number;
  database_name: string;
  bucket: string | null;
  region: string;
  endpoint_url: string | null;
  is_default: boolean;
  is_active: boolean;
  last_ping_at: string | null;
  last_ping_ok: boolean | null;
  
  username?: string;
  password?: string;
  access_key?: string;
  secret_key?: string;
}

export type ServerFormData = Partial<ServerData> & { 
  type: 'clickhouse' | 's3' | 'minio';
};

export default function ConfigPage() {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerData | null>(null);

  // Form states
  const [formData, setFormData] = useState<ServerFormData>({
    type: 'clickhouse',
    name: '',
    host: '',
    port: 8123,
    database_name: 'default',
    username: '',
    password: '',
    bucket: '',
    region: 'us-east-1',
    access_key: '',
    secret_key: '',
    endpoint_url: '',
    is_default: false,
  });

  const { refresh: refreshGlobalServers } = useServers();

  // ── System Config (key-value settings from ClickHouse system_config) ──
  const [sysConfig, setSysConfig] = useState<Record<string, string>>({});
  const [sysConfigDraft, setSysConfigDraft] = useState<Record<string, string>>({});
  const [sysConfigLoading, setSysConfigLoading] = useState(true);
  const [sysConfigSaving, setSysConfigSaving] = useState(false);
  const [sysConfigMsg, setSysConfigMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [newConfigKey, setNewConfigKey] = useState('');
  const [newConfigValue, setNewConfigValue] = useState('');

  // Known config keys with human-readable labels and descriptions (shown as tooltip on hover)
  const KNOWN_CONFIGS: { key: string; label: string; description: string; tooltip: string; type: 'number' | 'string' | 'secret'; unit?: string; requiresRestart?: boolean }[] = [
    // ── Ingestion Tuning ──
    { key: 'ingestion.max_concurrent', label: 'Ingestion Concurrency', description: 'Max parallel ingestion pipelines',
      tooltip: 'How many files can be ingested simultaneously. Higher values = faster bulk ingestion but more RAM and ClickHouse write pressure. For 500-file bulk ingests, 3–5 is optimal. Increase to 8–10 only if ClickHouse has 64GB+ RAM.',
      type: 'number' },
    { key: 'ingestion.batch_size', label: 'Ingestion Batch Size', description: 'Rows per ClickHouse insert batch',
      tooltip: 'Number of rows sent to ClickHouse in a single INSERT. Lower = less memory per batch but more round-trips (slower). 10,000 is optimal for most files. Reduce to 5,000 for very wide tables (100+ columns) to prevent OOM.',
      type: 'number' },
    { key: 'ingestion.max_auto_retries', label: 'Auto-Retry Limit', description: 'Max automatic recovery attempts per job',
      tooltip: 'When the server restarts during ingestion (PM2 restart, crash, deploy), interrupted jobs auto-retry. This caps how many times a single job can be automatically re-enqueued. After this limit, the job is marked as permanently failed (retryable manually). Set to 0 to disable auto-recovery.',
      type: 'number' },
    { key: 'ingestion.insert_timeout_sec', label: 'Insert Timeout', description: 'Per-batch ClickHouse insert timeout',
      tooltip: 'Maximum seconds a single batch insert can take before timing out. Under heavy concurrent ingestion, ClickHouse may take longer to merge data. 300s (5 min) handles worst-case merge contention. Reduce only if you want faster failure detection.',
      type: 'number', unit: 'sec' },
    { key: 'ingestion.recovery_delay_sec', label: 'Recovery Delay', description: 'Delay before re-enqueuing recovered jobs',
      tooltip: 'Seconds to wait after server boot before auto-retrying interrupted jobs. Allows the event loop, config, and database connections to stabilize. 5s is safe for most setups. Increase if you observe recovery failures due to DB not being ready.',
      type: 'number', unit: 'sec' },
    { key: 'node.heap_size_mb', label: 'Node.js Heap Size', description: 'V8 max heap — requires PM2 restart',
      tooltip: 'Maximum memory (MB) the Node.js V8 engine can allocate. 12,288 (12GB) is recommended for ingesting large Parquet files. If you see "JavaScript heap out of memory" errors during ingestion, increase this. Change requires PM2 restart to take effect.',
      type: 'number', unit: 'MB', requiresRestart: true },
    // ── Pipeline Settings ──
    { key: 'pipeline.max_emails_per_job', label: 'Pipeline Max Emails', description: 'Max emails per Pipeline Studio job',
      tooltip: 'Hard limit on how many emails can be submitted in a single Pipeline Studio (email verification) job. Prevents accidental mega-jobs that overwhelm the SMTP probing infrastructure. Default 200K handles most use cases.',
      type: 'number' },
    { key: 'pipeline.smtp_concurrency', label: 'Pipeline SMTP Concurrency', description: 'Concurrent SMTP connections',
      tooltip: 'Number of simultaneous SMTP connections during email verification. Higher = faster verification but more aggressive on receiving servers. 10 is safe. Above 20 risks getting IP-blocked by major providers (Gmail, Microsoft).',
      type: 'number' },
    { key: 'segment.export_limit', label: 'Segment Export Limit', description: 'Max leads when exporting a segment',
      tooltip: 'Maximum number of leads returned when exporting a segment to CSV. The Data Explorer export (streaming) has no limit — this only affects segment exports which are JSON-based and buffered in memory.',
      type: 'number' },
    { key: 'clickhouse.max_query_size', label: 'ClickHouse Max Query Size', description: 'Max size for a single query string',
      tooltip: 'Maximum size (MB) for a single ClickHouse query string. Increase if you see "Max query size exceeded" errors when working with very large segment filters or bulk operations. 512MB is generous for most workloads.',
      type: 'number', unit: 'MB' },
    // ── Third-Party Integrations ──
    { key: 'semrush_api_key', label: 'SEMRush API Key', description: 'Powers Oracle\u2019s keyword/domain analytics',
      tooltip: 'API key for SEMRush integration. Powers the Oracle agent\u2019s keyword research, domain analytics, and competitor analysis features. Get your key from semrush.com/api. Leave empty to disable SEMRush-powered insights.',
      type: 'secret' },
  ];

  const fetchSysConfig = async () => {
    setSysConfigLoading(true);
    try {
      const data = await apiCall<Record<string, string>>('/api/config');
      setSysConfig(data);
      // Merge known keys with defaults if not present
      const CONFIG_DEFAULTS: Record<string, string> = {
        'ingestion.max_concurrent': '5',
        'ingestion.batch_size': '10000',
        'ingestion.max_auto_retries': '3',
        'ingestion.insert_timeout_sec': '300',
        'ingestion.recovery_delay_sec': '5',
        'node.heap_size_mb': '12288',
        'pipeline.max_emails_per_job': '200000',
        'pipeline.smtp_concurrency': '10',
        'segment.export_limit': '200000',
        'clickhouse.max_query_size': '512',
      };
      const draft: Record<string, string> = { ...data };
      for (const kc of KNOWN_CONFIGS) {
        if (!(kc.key in draft)) {
          draft[kc.key] = CONFIG_DEFAULTS[kc.key] ?? '';
        }
      }
      setSysConfigDraft(draft);
    } catch { /* ignore */ } finally {
      setSysConfigLoading(false);
    }
  };

  const handleSaveSysConfig = async () => {
    setSysConfigSaving(true);
    setSysConfigMsg(null);
    try {
      const entries = Object.entries(sysConfigDraft)
        .filter(([k, v]) => v !== sysConfig[k]) // only changed values
        .map(([key, value]) => {
          const knownCfg = KNOWN_CONFIGS.find(kc => kc.key === key);
          return { key, value, isSecret: knownCfg?.type === 'secret' || false };
        });
      if (entries.length === 0) {
        setSysConfigMsg({ type: 'ok', text: 'No changes to save.' });
        setSysConfigSaving(false);
        return;
      }
      await apiCall('/api/config', { method: 'POST', body: { entries } });
      setSysConfigMsg({ type: 'ok', text: `Saved ${entries.length} setting(s). Changes take effect immediately.` });
      await fetchSysConfig();
    } catch (err: any) {
      setSysConfigMsg({ type: 'err', text: err.message });
    } finally {
      setSysConfigSaving(false);
    }
  };

  const handleAddCustomConfig = async () => {
    if (!newConfigKey.trim() || !newConfigValue.trim()) return;
    setSysConfigDraft(prev => ({ ...prev, [newConfigKey.trim()]: newConfigValue.trim() }));
    setNewConfigKey('');
    setNewConfigValue('');
  };

  useEffect(() => {
    fetchServers();
    fetchSysConfig();
  }, []);

  const fetchServers = async () => {
    setLoading(true);
    try {
      const data = await apiCall<{ servers: ServerData[] }>('/api/servers');
      setServers(data.servers);
    } catch (err: any) {
      setErrorMSG(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (id: string) => {
    try {
      const res = await apiCall<{ ok: boolean; latencyMs: number }>(`/api/servers/${id}/test`, { method: 'POST' });
      alert(res.ok ? `Connection successful! (${res.latencyMs}ms)` : 'Connection failed. Check your credentials.');
      fetchServers();
      refreshGlobalServers();
    } catch (err: any) {
      alert(`Test failed: ${err.message}`);
    }
  };

  const handleSetDefault = async (id: string) => {
    if (!window.confirm('Set as default server for this type?')) return;
    try {
      await apiCall(`/api/servers/${id}/set-default`, { method: 'POST' });
      fetchServers();
      refreshGlobalServers();
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Deactivate this server connection?')) return;
    try {
      await apiCall(`/api/servers/${id}`, { method: 'DELETE' });
      fetchServers();
      refreshGlobalServers();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingServer) {
        await apiCall(`/api/servers/${editingServer.id}`, { method: 'PUT', body: formData });
      } else {
        await apiCall('/api/servers', { method: 'POST', body: formData });
      }
      setIsModalOpen(false);
      fetchServers();
      refreshGlobalServers();
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    }
  };

  const openNewModal = () => {
    setEditingServer(null);
    setFormData({
      type: 'clickhouse',
      name: '',
      host: '',
      port: 8123,
      database_name: 'default',
      is_default: false,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (server: ServerData) => {
    setEditingServer(server);
    setFormData({
      name: server.name,
      type: server.type,
      host: server.host,
      port: server.port,
      database_name: server.database_name,
      bucket: server.bucket || '',
      region: server.region || 'us-east-1',
      endpoint_url: server.endpoint_url || '',
      is_default: server.is_default,
    });
    setIsModalOpen(true);
  };

  const renderIcon = (type: string) => {
    if (type === 'clickhouse') return <Database size={16} />;
    if (type === 's3' || type === 'minio') return <Cloud size={16} />;
    return <Server size={16} />;
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <PageHeader title="Server Config" sub="Manage Data Storage and Analytics Servers" />
        <Can do="canEditConfig">
          <Button onClick={openNewModal} icon={<Plus size={16} />}>Add Server</Button>
        </Can>
      </div>

      {errorMSG && <div style={{ color: 'var(--red)', background: 'var(--red-muted)', padding: 12, borderRadius: 8, marginBottom: 24 }}>{errorMSG}</div>}

      <SectionHeader title="Connected Servers" />

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading servers...</div>
      ) : servers.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 12, border: '1px dashed var(--border)' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>No database or storage servers configured.</p>
          <Can do="canEditConfig">
            <Button onClick={openNewModal}>Add Your First Server</Button>
          </Can>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', marginBottom: 48 }}>
          {servers.map(s => (
            <div key={s.id} className="animate-fadeIn" style={{
              background: 'var(--bg-card)', border: s.is_default ? '1px solid var(--accent)' : '1px solid var(--border)', 
              borderRadius: 12, padding: 20, position: 'relative'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{
                  background: s.type === 'clickhouse' ? 'var(--blue-muted)' : 'var(--green-muted)',
                  color: s.type === 'clickhouse' ? 'var(--blue)' : 'var(--green)',
                  width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {renderIcon(s.type)}
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {s.name}
                    {s.is_default && <span style={{ fontSize: 10, background: 'var(--accent)', color: 'var(--accent-contrast)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>DEFAULT</span>}
                  </h3>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.type}</div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                <div><strong>Host:</strong> {s.host}:{s.port || (s.type === 'clickhouse' ? 8123 : 443)}</div>
                {s.type === 'clickhouse' && <div><strong>DB:</strong> {s.database_name}</div>}
                {(s.type === 's3' || s.type === 'minio') && (
                  <>
                    <div><strong>Bucket:</strong> {s.bucket || '(none)'}</div>
                    {s.endpoint_url && <div><strong>Endpoint:</strong> {s.endpoint_url}</div>}
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <strong>Status:</strong>
                  {s.last_ping_ok === true ? <span style={{ color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> OK</span>
                  : s.last_ping_ok === false ? <span style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={14} /> Offline</span>
                  : <span>Unknown</span>}
                  {s.last_ping_at && <span style={{ color: 'var(--text-tertiary)', fontSize: 11, marginLeft: 'auto' }}>
                    {new Date(s.last_ping_at).toLocaleTimeString()}
                  </span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <Button onClick={() => handleTestConnection(s.id)} variant="secondary" icon={<Play size={14} />} style={{ flex: 1 }}>Test</Button>
                
                <Can do="canEditConfig">
                  <Button onClick={() => openEditModal(s)} variant="secondary" icon={<Edit2 size={14} />} style={{ padding: '8px 12px' }} />
                  {!s.is_default && <Button onClick={() => handleSetDefault(s.id)} variant="secondary" style={{ padding: '8px 12px' }}>Make Default</Button>}
                  <Button onClick={() => handleDelete(s.id)} variant="danger" icon={<Trash2 size={14} />} style={{ padding: '8px 12px' }} />
                </Can>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, paddingBottom: 100
        }}>
          <div className="animate-slideInRight" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 16, width: 500, maxWidth: '100%',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ padding: 24, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingServer ? 'Edit Server' : 'Add Server'}</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}>✕</button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ padding: 24, overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Server Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    disabled={!!editingServer}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
                      background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14,
                    }}
                  >
                    <option value="clickhouse">ClickHouse DB</option>
                    <option value="s3">AWS Object Storage (S3)</option>
                    <option value="minio">MinIO / S3-Compatible</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Name</label>
                  <input
                    required
                    value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Production US"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Host</label>
                  <input
                    required
                    value={formData.host} onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    placeholder="e.g. http://localhost or s3.us-east-1.amazonaws.com"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Port</label>
                    <input
                      type="number"
                      value={formData.port || ''} onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                      placeholder={formData.type === 'clickhouse' ? "8123" : "443"}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                    />
                  </div>
                  {formData.type === 'clickhouse' && (
                    <div style={{ flex: 2 }}>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Database</label>
                      <input
                        value={formData.database_name} onChange={(e) => setFormData({ ...formData, database_name: e.target.value })}
                        placeholder="default"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                      />
                    </div>
                  )}
                </div>

                {(formData.type === 's3' || formData.type === 'minio') && (
                  <>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <div style={{ flex: 2 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Bucket Name</label>
                        <input
                          value={formData.bucket || ''} onChange={(e) => setFormData({ ...formData, bucket: e.target.value })}
                          placeholder="data-bucket"
                          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Region</label>
                        <input
                          value={formData.region || ''} onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                          placeholder="us-east-1"
                          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Custom Endpoint URL (Optional)</label>
                      <input
                        value={formData.endpoint_url || ''} onChange={(e) => setFormData({ ...formData, endpoint_url: e.target.value })}
                        placeholder="http://localhost:9000"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                      />
                    </div>
                  </>
                )}

                {/* Authentication - only show when updating/creating to avoid sending passwords back to frontend empty */}
                <div style={{ padding: 16, background: 'var(--bg-sidebar)', borderRadius: 8, border: '1px solid var(--border)', marginTop: 16 }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: 14 }}>Authentication</h4>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                    {editingServer ? 'Leave blank to keep existing credentials.' : 'Required for new connections.'}
                  </p>
                  
                  {formData.type === 'clickhouse' ? (
                    <div style={{ display: 'flex', gap: 16 }}>
                      <input
                        value={formData.username || ''} onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        placeholder="Username (e.g. default)"
                        style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                      />
                      <input
                        type="password"
                        value={formData.password || ''} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="Password"
                        style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <input
                        type="password"
                        value={formData.access_key || ''} onChange={(e) => setFormData({ ...formData, access_key: e.target.value })}
                        placeholder="Access Key"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                      />
                      <input
                        type="password"
                        value={formData.secret_key || ''} onChange={(e) => setFormData({ ...formData, secret_key: e.target.value })}
                        placeholder="Secret Key"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={formData.is_default}
                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="isDefault" style={{ fontSize: 14, cursor: 'pointer', userSelect: 'none' }}>Set as default server for this type</label>
                </div>

              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
                <Button type="submit" style={{ flex: 1 }}>{editingServer ? 'Save Changes' : 'Add Server'}</Button>
                <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)} style={{ flex: 1 }}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* System Settings — key-value config from ClickHouse system_config */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <div style={{ marginTop: 48 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SectionHeader title="System Settings" />
          <Can do="canEditConfig">
            <Button
              onClick={handleSaveSysConfig}
              disabled={sysConfigSaving}
              icon={sysConfigSaving ? <Settings size={14} className="animate-pulse" /> : <Save size={14} />}
            >
              {sysConfigSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </Can>
        </div>

        {sysConfigMsg && (
          <div style={{
            padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
            background: sysConfigMsg.type === 'ok' ? 'var(--green-muted)' : 'var(--red-muted)',
            color: sysConfigMsg.type === 'ok' ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${sysConfigMsg.type === 'ok' ? 'var(--green)' : 'var(--red)'}`,
          }}>
            {sysConfigMsg.type === 'ok' ? <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: 8 }} /> : <XCircle size={14} style={{ verticalAlign: 'middle', marginRight: 8 }} />}
            {sysConfigMsg.text}
          </div>
        )}

        {sysConfigLoading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading settings...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Known config keys with labels + tooltips */}
            {KNOWN_CONFIGS.map(kc => (
              <div key={kc.key} style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
                background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {kc.label}
                    <span style={{ position: 'relative', display: 'inline-flex' }} className="config-tooltip-trigger">
                      <Info size={13} style={{ color: 'var(--text-tertiary)', cursor: 'help', opacity: 0.6, flexShrink: 0 }} />
                      <span className="config-tooltip" style={{
                        position: 'absolute', left: '50%', bottom: 'calc(100% + 8px)', transform: 'translateX(-50%)',
                        background: 'var(--bg-app)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5,
                        padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.25)', width: 320, maxWidth: '80vw',
                        pointerEvents: 'none', opacity: 0, transition: 'opacity 0.15s ease',
                        zIndex: 100, whiteSpace: 'normal',
                      }}>{kc.tooltip}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{kc.description}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace", marginTop: 4, opacity: 0.7 }}>{kc.key}</div>
                </div>
                <Can do="canEditConfig">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type={kc.type === 'number' ? 'number' : kc.type === 'secret' ? 'password' : 'text'}
                      value={sysConfigDraft[kc.key] ?? ''}
                      onChange={e => setSysConfigDraft(prev => ({ ...prev, [kc.key]: e.target.value }))}
                      placeholder={kc.type === 'secret' ? '••••••••' : ''}
                      style={{
                        width: kc.type === 'secret' ? 220 : 160, padding: '10px 14px', borderRadius: 8,
                        border: (sysConfigDraft[kc.key] ?? '') !== (sysConfig[kc.key] ?? '') ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: 'var(--bg-input)', color: 'var(--text-primary)',
                        fontSize: 14, fontFamily: "'JetBrains Mono', monospace", textAlign: 'right',
                      }}
                    />
                    {kc.unit && <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, minWidth: 24 }}>{kc.unit}</span>}
                    {kc.requiresRestart && <span style={{ fontSize: 10, background: 'rgba(255,180,0,0.15)', color: '#f0a000', padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>Restart Required</span>}
                  </div>
                </Can>
              </div>
            ))}

            {/* Other config keys (not in KNOWN_CONFIGS) */}
            {Object.entries(sysConfigDraft)
              .filter(([k]) => !KNOWN_CONFIGS.some(kc => kc.key === k))
              .map(([key, value]) => (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px',
                  background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{key}</div>
                  </div>
                  <Can do="canEditConfig">
                    <input
                      type={value === '••••••••' ? 'password' : 'text'}
                      value={sysConfigDraft[key] ?? ''}
                      onChange={e => setSysConfigDraft(prev => ({ ...prev, [key]: e.target.value }))}
                      style={{
                        width: 220, padding: '8px 12px', borderRadius: 8,
                        border: (sysConfigDraft[key] ?? '') !== (sysConfig[key] ?? '') ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: 'var(--bg-input)', color: 'var(--text-primary)',
                        fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </Can>
                </div>
              ))}

            {/* Add custom config */}
            <Can do="canEditConfig">
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                background: 'var(--bg-app)', borderRadius: 12, border: '1px dashed var(--border)',
              }}>
                <input
                  value={newConfigKey}
                  onChange={e => setNewConfigKey(e.target.value)}
                  placeholder="config.key"
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
                <input
                  value={newConfigValue}
                  onChange={e => setNewConfigValue(e.target.value)}
                  placeholder="value"
                  style={{
                    width: 200, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
                <Button variant="secondary" onClick={handleAddCustomConfig} icon={<Plus size={14} />}>Add</Button>
              </div>
            </Can>
          </div>
        )}
      </div>
      {/* Sentinel AI Agent — Infrastructure Analysis */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <AgentCard
          slug="smtp_specialist"
          contextLabel="Infrastructure Health — Server Config"
          context={{
            servers: servers.map(s => ({
              name: s.name, type: s.type, host: s.host, port: s.port,
              isDefault: s.is_default, isActive: s.is_active,
              lastPingOk: s.last_ping_ok, lastPingAt: s.last_ping_at,
            })),
            systemConfig: sysConfig,
          }}
        />
      </div>
    </>
  );
}
