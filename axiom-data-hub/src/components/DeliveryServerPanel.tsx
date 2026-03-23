import { useState, useEffect, useCallback } from 'react';
import { Button } from './UI';
import { useToast } from './Toast';
import { apiCall } from '../lib/api';
import {
  Server, Plus, Trash2, Loader2,
  Zap, ChevronDown, ChevronRight,
} from 'lucide-react';

interface DeliveryServer {
  server_id?: string;
  delivery_server_id?: string;
  hostname: string;
  username: string;
  port: number;
  protocol: string;
  from_email: string;
  from_name: string;
  status: string;
  quota_value?: number;
}

const PROTOCOLS = ['smtp', 'smtps', 'sendmail', 'pickup'];

const emptyForm = {
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
  const [servers, setServers] = useState<DeliveryServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const { success, error: toastError } = useToast();

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<DeliveryServer[]>('/api/mta-providers/delivery-servers');
      setServers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      // MTA not configured yet — show empty
      setServers([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const handleAdd = async () => {
    if (!form.hostname || !form.username || !form.password) {
      toastError('Validation', 'Hostname, username, and password are required');
      return;
    }
    setAdding(true);
    try {
      await apiCall('/api/mta-providers/delivery-servers', { method: 'POST', body: form });
      success('Server Added', `${form.hostname} added to MailWizz`);
      setForm(emptyForm);
      setShowForm(false);
      fetchServers();
      onRefresh?.();
    } catch (e: any) { toastError('Error', e.message); }
    setAdding(false);
  };

  const handleDelete = async (id: string, hostname: string) => {
    if (!confirm(`Remove ${hostname} from MailWizz?`)) return;
    setDeletingId(id);
    try {
      await apiCall(`/api/mta-providers/delivery-servers/${id}`, { method: 'DELETE' });
      success('Removed', `${hostname} deleted`);
      fetchServers();
    } catch (e: any) { toastError('Error', e.message); }
    setDeletingId(null);
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await apiCall<any>(`/api/mta-providers/delivery-servers/${id}/test`, { method: 'POST' });
      if (result.ok) success('Online', `${result.hostname} — status: ${result.status}`);
      else toastError('Failed', result.hostname || 'Server check failed');
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
            Delivery Servers <span style={{ fontWeight: 500, color: 'var(--text-tertiary)', fontSize: 12 }}>({servers.length})</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            SMTP servers registered in MailWizz for sending
          </div>
        </div>
        <Button icon={<Plus size={13} />} onClick={() => setShowForm(v => !v)}>Add Server</Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--accent)', borderRadius: 12,
          padding: 20, marginBottom: 20,
        }} className="animate-fadeIn">
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 16 }}>
            New Delivery Server
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>SMTP Hostname *</label>
              <input style={inputStyle} placeholder="smtp.example.com" value={form.hostname}
                onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input style={inputStyle} type="number" value={form.port}
                onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Username *</label>
              <input style={inputStyle} placeholder="smtp_user or email@domain.com" value={form.username}
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
                {PROTOCOLS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Daily Quota (emails/day)</label>
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
            <Button onClick={handleAdd} disabled={adding}
              icon={adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}>
              {adding ? 'Adding...' : 'Add to MailWizz'}
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Server List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
          <Loader2 size={20} className="spin" style={{ marginBottom: 8 }} />
          <div>Loading delivery servers...</div>
        </div>
      ) : servers.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 32, background: 'var(--bg-elevated)',
          borderRadius: 12, border: '1px dashed var(--border)',
        }}>
          <Server size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            No Delivery Servers
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Add your 5 SMTP servers here. MailWizz will rotate sending across all of them.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {servers.map((srv, i) => {
            const id = String(srv.server_id || srv.delivery_server_id || i);
            const isExpanded = expandedId === id;
            const isActive = srv.status === 'active';
            return (
              <div key={id} style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 10, overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : id)}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isActive ? 'var(--green-muted)' : 'var(--bg-card)',
                    color: isActive ? 'var(--green)' : 'var(--text-tertiary)', flexShrink: 0,
                  }}>
                    <Server size={15} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{srv.hostname}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      {srv.username} · Port {srv.port} · {srv.protocol?.toUpperCase()}
                      {srv.quota_value ? ` · ${srv.quota_value.toLocaleString()}/day` : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5,
                    background: isActive ? 'var(--green-muted)' : 'var(--bg-card)',
                    color: isActive ? 'var(--green)' : 'var(--text-tertiary)',
                  }}>{srv.status || 'active'}</span>
                  {isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />}
                </div>
                {isExpanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 8, paddingTop: 12 }}>
                      <Button variant="ghost" icon={testingId === id ? <Loader2 size={13} className="spin" /> : <Zap size={13} />}
                        onClick={() => handleTest(id)} disabled={testingId !== null}>Test</Button>
                      <Button variant="ghost" icon={deletingId === id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                        onClick={() => handleDelete(id, srv.hostname)} disabled={deletingId !== null}>Remove</Button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10 }}>
                      <div>From: <strong>{srv.from_name}</strong> &lt;{srv.from_email}&gt;</div>
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
