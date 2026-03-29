import { useState, useEffect, useCallback } from 'react';
import { PageHeader, StatCard, Button } from '../components/UI';
import { apiCall } from '../lib/api';
import { useToast } from '../components/Toast';
import MTAProviderModal from '../components/MTAProviderModal';
import MTADomainPanel from '../components/MTADomainPanel';
import DeliveryServerPanel from '../components/DeliveryServerPanel';
import AgentCard from '../components/AgentCard';
import {
  Radio, Plus, Trash2, Loader2, CheckCircle, XCircle, Zap,
  RefreshCw, ChevronDown, ChevronRight, Star, Globe, Shield,
} from 'lucide-react';

interface MTAProvider {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  last_test_at: string | null;
  last_test_ok: boolean | null;
}

interface SendingDomain {
  id: string;
  provider_id: string;
  domain: string;
  from_email: string;
  from_name: string;
  spf_ok: boolean | null;
  dkim_ok: boolean | null;
  dmarc_ok: boolean | null;
  blacklisted: boolean | null;
  last_check_at: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  mailwizz: 'MailWizz (Self-Hosted)',
};

const PROVIDER_COLORS: Record<string, string> = {
  mailwizz: 'var(--blue)',
};

export default function MTAConfigPage() {
  const [providers, setProviders] = useState<MTAProvider[]>([]);
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<MTAProvider | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanIps, setScanIps] = useState('');
  const [scanning, setScanning] = useState(false);
  const [blResults, setBlResults] = useState<any[]>([]);
  const [settingUpWebhook, setSettingUpWebhook] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [refineryUrl, setRefineryUrl] = useState(typeof window !== 'undefined' ? window.location.origin : '');
  const { success, error: toastError } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([
        apiCall<MTAProvider[]>('/api/mta-providers'),
        apiCall<SendingDomain[]>('/api/mta-providers/domains'),
      ]);
      setProviders(p);
      setDomains(d);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load MTA data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async (data: any) => {
    if (editProvider) {
      await apiCall(`/api/mta-providers/${editProvider.id}`, { method: 'PUT', body: data });
      success('Updated', `${data.name} saved`);
    } else {
      await apiCall('/api/mta-providers', { method: 'POST', body: data });
      success('Provider Added', `${data.name} connected`);
    }
    setModalOpen(false);
    setEditProvider(null);
    fetchData();
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await apiCall<{ ok: boolean; message: string }>(`/api/mta-providers/${id}/test`, { method: 'POST' });
      if (res.ok) success('Connection OK', res.message);
      else toastError('Connection Failed', res.message);
      fetchData();
    } catch (e: any) { toastError('Test Error', e.message); }
    setTestingId(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete provider "${name}" and all its domains?`)) return;
    setDeletingId(id);
    try {
      await apiCall(`/api/mta-providers/${id}`, { method: 'DELETE' });
      success('Deleted', `${name} removed`);
      fetchData();
    } catch (e: any) { toastError('Error', e.message); }
    setDeletingId(null);
  };

  const activeCount = providers.filter(p => p.is_active).length;
  const totalDomains = domains.length;
  const healthyDomains = domains.filter(d => d.spf_ok && d.dkim_ok && d.dmarc_ok).length;
  const defaultProvider = providers.find(p => p.is_default);

  const runBlacklistScan = async () => {
    setScanning(true);
    try {
      const ips = scanIps.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      const domainNames = domains.map(d => d.domain);
      const results = await apiCall<any[]>('/api/mta-providers/blacklist/check-all', {
        method: 'POST',
        body: { ips, domains: domainNames },
      });
      setBlResults(results);
      const listed = results.filter(r => !r.is_clean);
      if (listed.length > 0) {
        toastError('Blacklisted!', `${listed.length} target(s) found on blacklists`);
      } else {
        success('All Clear', 'No blacklists detected');
      }
    } catch (e: any) { toastError('Scan Error', e.message); }
    setScanning(false);
  };

  const handleWebhookSetup = async () => {
    if (!refineryUrl) { toastError('Required', 'Enter your Refinery URL first'); return; }
    setSettingUpWebhook(true);
    try {
      const res = await apiCall<any>('/api/mta-providers/webhooks/setup', {
        method: 'POST',
        body: { refinery_url: refineryUrl.replace(/\/+$/, '') },
      });
      setWebhookInfo(res);
      success('Webhook URL Ready', 'Copy the URL and add it in MailWizz');
    } catch (e: any) { toastError('Error', e.message); }
    setSettingUpWebhook(false);
  };

  return (
    <>
      <PageHeader
        title="Email Infrastructure"
        sub="Manage your EMA connections and SMTP delivery servers."
        description="Connect your Email Marketing Application (MailWizz) here. SMTP delivery servers are managed separately below — add your servers, test them, then push to your EMA."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Providers" value={loading ? '...' : String(providers.length)} sub={`${activeCount} active`} icon={<Radio size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.06} />
        <StatCard label="Sending Domains" value={loading ? '...' : String(totalDomains)} sub={`${healthyDomains} DNS healthy`} icon={<Globe size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.12} />
        <StatCard label="Default Provider" value={loading ? '...' : (defaultProvider?.name || 'None')} sub={defaultProvider ? PROVIDER_LABELS[defaultProvider.provider_type] || defaultProvider.provider_type : 'Not set'} icon={<Star size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.18} />
      </div>

      {error && (
        <div style={{
          marginBottom: 20, padding: '12px 18px', borderRadius: 10, background: 'var(--red-muted)',
          border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: 'var(--red)',
        }}>
          <XCircle size={16} /> {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>EMA Connections ({providers.length})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={fetchData}>Refresh</Button>
          <Button icon={<Plus size={14} />} onClick={() => { setEditProvider(null); setModalOpen(true); }}>Add EMA</Button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 36 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
            <Loader2 size={24} className="spin" style={{ marginBottom: 12 }} />
            <div>Loading providers...</div>
          </div>
        ) : providers.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 48, color: 'var(--text-tertiary)',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16,
          }}>
            <Radio size={28} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No EMA Connected</div>
            <div style={{ fontSize: 13 }}>Click "Add EMA" to connect MailWizz or another email marketing application</div>
          </div>
        ) : (
          providers.map(provider => {
            const isExpanded = expandedId === provider.id;
            const providerDomains = domains.filter(d => d.provider_id === provider.id);
            const color = PROVIDER_COLORS[provider.provider_type] || 'var(--text-tertiary)';

            return (
              <div key={provider.id} className="animate-fadeIn" style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden',
                transition: 'border-color 0.15s',
              }}>
                {/* Header Row */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', cursor: 'pointer',
                }} onClick={() => setExpandedId(isExpanded ? null : provider.id)}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `color-mix(in srgb, ${color} 15%, transparent)`, color, flexShrink: 0,
                  }}>
                    <Radio size={18} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{provider.name}</span>
                      {provider.is_default && (
                        <span style={{
                          fontSize: 9, fontWeight: 800, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4,
                          background: 'var(--yellow-muted)', color: 'var(--yellow)', letterSpacing: '0.06em',
                        }}>DEFAULT</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {PROVIDER_LABELS[provider.provider_type] || provider.provider_type} · {providerDomains.length} domain{providerDomains.length !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Connection status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {provider.last_test_ok === true && <><CheckCircle size={13} style={{ color: 'var(--green)' }} /><span style={{ color: 'var(--green)' }}>Connected</span></>}
                    {provider.last_test_ok === false && <><XCircle size={13} style={{ color: 'var(--red)' }} /><span style={{ color: 'var(--red)' }}>Failed</span></>}
                    {provider.last_test_ok === null && <span style={{ color: 'var(--text-tertiary)' }}>Not tested</span>}
                  </div>

                  {isExpanded ? <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />}
                </div>

                {/* Expanded Panel */}
                {isExpanded && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 8, paddingTop: 14, marginBottom: 8, flexWrap: 'wrap' }}>
                      <Button variant="ghost" icon={
                        testingId === provider.id ? <Loader2 size={14} className="spin" /> : <Zap size={14} />
                      } onClick={() => handleTest(provider.id)} disabled={testingId !== null}>
                        Test Connection
                      </Button>
                      <Button variant="ghost" onClick={() => { setEditProvider(provider); setModalOpen(true); }}>
                        Edit
                      </Button>
                      <Button variant="ghost" icon={
                        deletingId === provider.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />
                      } onClick={() => handleDelete(provider.id, provider.name)} disabled={deletingId !== null}>
                        Delete
                      </Button>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                      <strong>URL:</strong> {provider.base_url} · <strong>Key:</strong> {provider.api_key}
                    </div>

                    <MTADomainPanel providerId={provider.id} domains={providerDomains} onRefresh={fetchData} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Delivery Servers */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 28,
      }}>
        <DeliveryServerPanel onRefresh={fetchData} />
      </div>

      {/* Webhook Setup */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Webhook Setup</h3>
      </div>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 28,
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Generate your Refinery webhook URL and add it to MailWizz so bounce/complaint/unsubscribe events flow back automatically.
        </p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Your Refinery URL</div>
            <input
              value={refineryUrl}
              onChange={e => setRefineryUrl(e.target.value)}
              placeholder="https://your-refinery-domain.com"
              style={{
                width: '100%', padding: '9px 14px', borderRadius: 10, fontSize: 13,
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', outline: 'none',
              }}
            />
          </div>
          <Button icon={settingUpWebhook ? <Loader2 size={14} className="spin" /> : <Shield size={14} />}
            onClick={handleWebhookSetup} disabled={settingUpWebhook}>
            {settingUpWebhook ? 'Generating...' : 'Get Webhook URL'}
          </Button>
        </div>
        {webhookInfo && (
          <div style={{ marginTop: 16 }}>
            <div style={{
              padding: '10px 16px', borderRadius: 10, background: 'var(--bg-elevated)',
              border: '1px solid var(--accent)', fontFamily: 'SF Mono, Menlo, monospace',
              fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <CheckCircle size={14} />
              {webhookInfo.webhook_url}
              <button onClick={() => { navigator.clipboard.writeText(webhookInfo.webhook_url); success('Copied!', ''); }}
                style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                Copy
              </button>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
              {webhookInfo.instructions?.map((step: string, i: number) => (
                <div key={i} style={{ marginBottom: 4 }}>{step}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Blacklist Scanner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Blacklist Monitor</h3>
      </div>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 36,
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Enter your SMTP server IPs (one per line or comma-separated). All registered sending domains will be checked automatically.
        </p>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <textarea
              value={scanIps}
              onChange={e => setScanIps(e.target.value)}
              placeholder="107.172.56.65&#10;107.172.56.66&#10;107.172.56.67"
              rows={3}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontFamily: 'SF Mono, Menlo, monospace',
                background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                outline: 'none', resize: 'vertical',
              }}
            />
          </div>
          <Button icon={scanning ? <Loader2 size={14} className="spin" /> : <Shield size={14} />}
            onClick={runBlacklistScan} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Scan'}
          </Button>
        </div>

        {blResults.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blResults.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 10,
                background: r.is_clean ? 'var(--green-muted)' : 'var(--red-muted)',
                border: `1px solid ${r.is_clean ? 'var(--green)' : 'var(--red)'}`,
              }}>
                {r.is_clean
                  ? <CheckCircle size={16} style={{ color: 'var(--green)', flexShrink: 0 }} />
                  : <XCircle size={16} style={{ color: 'var(--red)', flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                    {r.target} <span style={{ fontWeight: 500, color: 'var(--text-tertiary)', fontSize: 11 }}>({r.type})</span>
                  </div>
                  {r.is_clean ? (
                    <div style={{ fontSize: 12, color: 'var(--green)' }}>Clean — checked {r.total_checked} blacklists</div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--red)' }}>
                      Listed on: {r.listed_on.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MTAProviderModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditProvider(null); }}
        onSave={handleSave}
        initial={editProvider || undefined}
      />

      {/* AI Agent */}
      <div style={{ marginTop: 8 }}>
        <AgentCard slug="smtp_specialist" contextLabel="MTA & Infrastructure Health" context={{ providerCount: providers.length, domainCount: totalDomains, healthyDomains }} />
      </div>
    </>
  );
}
