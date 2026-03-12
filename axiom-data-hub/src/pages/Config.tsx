import { useState, useEffect } from 'react';
import { PageHeader, SectionHeader, Button } from '../components/UI';
import { apiCall } from '../lib/api';
import { useServers } from '../components/ServerSelector';
import { Server, Plus, Trash2, Edit2, Play, CheckCircle, XCircle, Database, Cloud } from 'lucide-react';
import { Can } from '../auth/ProtectedRoute';

interface ServerData {
  id: string;
  name: string;
  type: 'clickhouse' | 's3' | 'linode';
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

export default function ConfigPage() {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerData | null>(null);

  // Form states
  const [formData, setFormData] = useState<Partial<ServerData>>({
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
  } as any);

  const { refresh: refreshGlobalServers } = useServers();

  useEffect(() => {
    fetchServers();
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
    if (type === 's3' || type === 'linode') return <Cloud size={16} />;
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
                    {s.is_default && <span style={{ fontSize: 10, background: 'var(--accent)', color: '#000', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>DEFAULT</span>}
                  </h3>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.type}</div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                <div><strong>Host:</strong> {s.host}:{s.port || (s.type === 'clickhouse' ? 8123 : 443)}</div>
                {s.type === 'clickhouse' && <div><strong>DB:</strong> {s.database_name}</div>}
                {(s.type === 's3' || s.type === 'linode') && (
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
                    <option value="linode">Linode Object Storage</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Name</label>
                  <input
                    required
                    value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Production US"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Host</label>
                  <input
                    required
                    value={formData.host} onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    placeholder="e.g. http://localhost or s3.us-east-1.amazonaws.com"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Port</label>
                    <input
                      type="number"
                      value={formData.port || ''} onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                      placeholder={formData.type === 'clickhouse' ? "8123" : "443"}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                    />
                  </div>
                  {formData.type === 'clickhouse' && (
                    <div style={{ flex: 2 }}>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Database</label>
                      <input
                        value={formData.database_name} onChange={(e) => setFormData({ ...formData, database_name: e.target.value })}
                        placeholder="default"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                      />
                    </div>
                  )}
                </div>

                {(formData.type === 's3' || formData.type === 'linode') && (
                  <>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <div style={{ flex: 2 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Bucket Name</label>
                        <input
                          value={formData.bucket || ''} onChange={(e) => setFormData({ ...formData, bucket: e.target.value })}
                          placeholder="data-bucket"
                          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Region</label>
                        <input
                          value={formData.region || ''} onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                          placeholder="us-east-1"
                          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Custom Endpoint URL (Optional)</label>
                      <input
                        value={formData.endpoint_url || ''} onChange={(e) => setFormData({ ...formData, endpoint_url: e.target.value })}
                        placeholder="https://us-east-1.linodeobjects.com"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
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
                        value={(formData as any).username || ''} onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        placeholder="Username (e.g. default)"
                        style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                      />
                      <input
                        type="password"
                        value={(formData as any).password || ''} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="Password"
                        style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <input
                        type="password"
                        value={(formData as any).access_key || ''} onChange={(e) => setFormData({ ...formData, access_key: e.target.value })}
                        placeholder="Access Key"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
                      />
                      <input
                        type="password"
                        value={(formData as any).secret_key || ''} onChange={(e) => setFormData({ ...formData, secret_key: e.target.value })}
                        placeholder="Secret Key"
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: '#fff', fontSize: 14 }}
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
    </>
  );
}
