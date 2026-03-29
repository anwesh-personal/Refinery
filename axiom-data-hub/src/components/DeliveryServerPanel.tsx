import { useState, useEffect, useCallback } from 'react';
import { Button } from './UI';
import { useToast } from './Toast';
import { apiCall } from '../lib/api';
import {
  Server, Plus, Trash2, Loader2,
  Zap, ChevronDown, ChevronRight, CheckCircle, XCircle, Edit2,
  Upload, Radio,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// SMTP Delivery Servers — stored locally in ClickHouse.
// Real SMTP handshake testing (EHLO/STARTTLS/AUTH LOGIN).
// NOT proxied to MailWizz — these are YOUR mail pipes.
// ═══════════════════════════════════════════════════════════════

interface SmtpServer {
  id: string;
  label: string;
  hostname: string;
  port: number;
  protocol: string;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  daily_quota: number;
  is_active: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_msg: string;
  created_at: string;
}

interface MTAProvider {
  id: string;
  name: string;
  provider_type: string;
  is_active: boolean;
  last_test_ok: boolean | null;
}

const PROTOCOLS = ['smtp', 'smtps'];

const emptyForm = {
  label: '',
  hostname: '',
  username: '',
  password: '',
  port: 587,
  protocol: 'smtp',
  from_email: '',
  from_name: '',
  daily_quota: 3000,
};

export default function DeliveryServerPanel({ onRefresh }: { onRefresh?: () => void }) {
  const [servers, setServers] = useState<SmtpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [emaProviders, setEmaProviders] = useState<MTAProvider[]>([]);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const { success, error: toastError } = useToast();

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<{ servers: SmtpServer[] }>('/api/smtp-servers');
      setServers(data.servers || []);
    } catch {
      setServers([]);
    }
    setLoading(false);
  }, []);

  const fetchEmaProviders = useCallback(async () => {
    try {
      const data = await apiCall<MTAProvider[]>('/api/mta-providers');
      setEmaProviders((data || []).filter(p => p.is_active));
    } catch { /* no providers yet */ }
  }, []);

  useEffect(() => { fetchServers(); fetchEmaProviders(); }, [fetchServers, fetchEmaProviders]);

  const handlePushToEma = async (serverId: string, serverLabel: string, providerId: string, providerName: string) => {
    setPushingId(`${serverId}-${providerId}`);
    try {
      const result = await apiCall<{ ok: boolean; provider_name: string; provider_type: string }>(
        `/api/smtp-servers/${serverId}/push-to-ema`, { method: 'POST', body: { provider_id: providerId } }
      );
      if (result.ok) {
        success('Pushed', `${serverLabel} registered on ${providerName}`);
      }
    } catch (e: any) {
      toastError('Push Failed', e.message);
    }
    setPushingId(null);
  };

  const handleSave = async () => {
    if (!form.hostname || !form.username || !form.password) {
      toastError('Validation', 'Hostname, username, and password are required');
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await apiCall(`/api/smtp-servers/${editId}`, { method: 'PUT', body: form });
        success('Updated', `${form.hostname} saved`);
      } else {
        await apiCall('/api/smtp-servers', { method: 'POST', body: form });
        success('Server Added', `${form.hostname} saved locally`);
      }
      setForm(emptyForm);
      setShowForm(false);
      setEditId(null);
      fetchServers();
      onRefresh?.();
    } catch (e: any) { toastError('Error', e.message); }
    setSaving(false);
  };

  const handleEdit = (srv: SmtpServer) => {
    setForm({
      label: srv.label,
      hostname: srv.hostname,
      username: srv.username,
      password: srv.password, // will be masked
      port: srv.port,
      protocol: srv.protocol,
      from_email: srv.from_email,
      from_name: srv.from_name,
      daily_quota: srv.daily_quota,
    });
    setEditId(srv.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string, hostname: string) => {
    if (!confirm(`Delete ${hostname}?`)) return;
    setDeletingId(id);
    try {
      await apiCall(`/api/smtp-servers/${id}`, { method: 'DELETE' });
      success('Deleted', `${hostname} removed`);
      fetchServers();
    } catch (e: any) { toastError('Error', e.message); }
    setDeletingId(null);
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await apiCall<{ ok: boolean; message: string; latencyMs: number }>(
        `/api/smtp-servers/${id}/test`, { method: 'POST' }
      );
      if (result.ok) {
        success('SMTP OK', `${result.message} (${result.latencyMs}ms)`);
      } else {
        toastError('SMTP Failed', result.message);
      }
      fetchServers();
    } catch (e: any) { toastError('Error', e.message); }
    setTestingId(null);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    background: 'var(--bg-input)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
            SMTP Delivery Servers <span style={{ fontWeight: 500, color: 'var(--text-tertiary)', fontSize: 12 }}>({servers.length})</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Your SMTP delivery infrastructure — stored locally, tested via real SMTP handshake
          </div>
        </div>
        <Button icon={<Plus size={13} />} onClick={() => { setEditId(null); setForm(emptyForm); setShowForm(v => !v); }}>Add Server</Button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--accent)', borderRadius: 12,
          padding: 20, marginBottom: 20,
        }} className="animate-fadeIn">
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 16 }}>
            {editId ? 'Edit SMTP Server' : 'New SMTP Server'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Label</label>
              <input style={inputStyle} placeholder="e.g. xSMTP Server 1" value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>SMTP Hostname *</label>
              <input style={inputStyle} placeholder="smtp.xsmtp.co" value={form.hostname}
                onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input style={inputStyle} type="number" value={form.port}
                onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Username *</label>
              <input style={inputStyle} placeholder="smtp_user" value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            </div>
            <div style={{ position: 'relative' }}>
              <label style={labelStyle}>Password *</label>
              <input style={inputStyle} type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <button onClick={() => setShowPassword(v => !v)}
                style={{ position: 'absolute', right: 10, top: 28, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 11 }}>
                {showPassword ? 'hide' : 'show'}
              </button>
            </div>
            <div>
              <label style={labelStyle}>Protocol</label>
              <select style={inputStyle} value={form.protocol}
                onChange={e => setForm(f => ({ ...f, protocol: e.target.value }))}>
                {PROTOCOLS.map(p => <option key={p} value={p}>{p.toUpperCase()} {p === 'smtp' ? '(STARTTLS)' : '(SSL)'}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Daily Quota</label>
              <input style={inputStyle} type="number" value={form.daily_quota}
                onChange={e => setForm(f => ({ ...f, daily_quota: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>From Email</label>
              <input style={inputStyle} placeholder="noreply@yourdomain.com" value={form.from_email}
                onChange={e => setForm(f => ({ ...f, from_email: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>From Name</label>
              <input style={inputStyle} placeholder="Your Brand" value={form.from_name}
                onChange={e => setForm(f => ({ ...f, from_name: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button onClick={handleSave} disabled={saving}
              icon={saving ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}>
              {saving ? 'Saving...' : (editId ? 'Update Server' : 'Save Server')}
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setForm(emptyForm); setEditId(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Server List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
          <Loader2 size={20} className="spin" style={{ marginBottom: 8 }} />
          <div>Loading SMTP servers...</div>
        </div>
      ) : servers.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 32, background: 'var(--bg-elevated)',
          borderRadius: 12, border: '1px dashed var(--border)',
        }}>
          <Server size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            No SMTP Servers
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Add your SMTP delivery servers here. They're stored locally and tested via real SMTP handshake.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {servers.map(srv => {
            const isExpanded = expandedId === srv.id;
            return (
              <div key={srv.id} style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 10, overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : srv.id)}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: srv.last_test_ok === true ? 'var(--green-muted)' : srv.last_test_ok === false ? 'var(--red-muted)' : 'var(--bg-card)',
                    color: srv.last_test_ok === true ? 'var(--green)' : srv.last_test_ok === false ? 'var(--red)' : 'var(--text-tertiary)',
                    flexShrink: 0,
                  }}>
                    <Server size={15} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{srv.label || srv.hostname}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      {srv.hostname}:{srv.port} · {srv.protocol?.toUpperCase()} · {srv.username}
                      {srv.daily_quota ? ` · ${srv.daily_quota.toLocaleString()}/day` : ''}
                    </div>
                  </div>

                  {/* Test status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {srv.last_test_ok === true && <><CheckCircle size={13} style={{ color: 'var(--green)' }} /><span style={{ color: 'var(--green)' }}>OK</span></>}
                    {srv.last_test_ok === false && <><XCircle size={13} style={{ color: 'var(--red)' }} /><span style={{ color: 'var(--red)' }}>Fail</span></>}
                    {srv.last_test_ok === null && <span style={{ color: 'var(--text-tertiary)' }}>Untested</span>}
                  </div>

                  {isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />}
                </div>
                {isExpanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
                    {srv.last_test_msg && (
                      <div style={{
                        fontSize: 12, padding: '8px 12px', borderRadius: 8, marginTop: 10, marginBottom: 6,
                        background: srv.last_test_ok ? 'var(--green-muted)' : 'var(--red-muted)',
                        color: srv.last_test_ok ? 'var(--green)' : 'var(--red)',
                        border: `1px solid ${srv.last_test_ok ? 'var(--green)' : 'var(--red)'}`,
                      }}>
                        {srv.last_test_msg}
                        {srv.last_test_at && <span style={{ opacity: 0.6, marginLeft: 8 }}>({new Date(srv.last_test_at).toLocaleString()})</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
                      <Button variant="ghost" icon={testingId === srv.id ? <Loader2 size={13} className="spin" /> : <Zap size={13} />}
                        onClick={() => handleTest(srv.id)} disabled={testingId !== null}>Test SMTP</Button>
                      <Button variant="ghost" icon={<Edit2 size={13} />}
                        onClick={() => handleEdit(srv)}>Edit</Button>
                      <Button variant="ghost" icon={deletingId === srv.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                        onClick={() => handleDelete(srv.id, srv.hostname)} disabled={deletingId !== null}>Delete</Button>
                    </div>

                    {/* Push to EMA buttons — shows all active EMA providers dynamically */}
                    {emaProviders.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                          Register on EMA
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {emaProviders.map(p => {
                            const key = `${srv.id}-${p.id}`;
                            const isPushing = pushingId === key;
                            return (
                              <Button key={p.id} variant="ghost"
                                icon={isPushing ? <Loader2 size={12} className="spin" /> : <Upload size={12} />}
                                onClick={() => handlePushToEma(srv.id, srv.label || srv.hostname, p.id, p.name)}
                                disabled={isPushing}
                                style={{ fontSize: 11, padding: '4px 10px' }}
                              >
                                <Radio size={10} style={{ marginRight: 4 }} />
                                {p.name}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10 }}>
                      <div>From: <strong>{srv.from_name || '(not set)'}</strong> &lt;{srv.from_email || srv.username}&gt;</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
