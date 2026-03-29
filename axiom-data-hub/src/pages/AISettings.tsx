import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import {
  CheckCircle, XCircle, RefreshCw, ChevronDown, GripVertical,
  Zap, TestTube, Loader2, Eye, EyeOff, AlertTriangle, Plus, Trash2
} from 'lucide-react';

// ─── Types ───

interface Provider {
  id: string;
  provider_type: string;
  label: string;
  api_key_masked: string;
  api_key_set: boolean;
  endpoint: string;
  enabled: boolean;
  validated: boolean;
  last_validated_at: string | null;
  cached_models: string[];
  models_fetched_at: string | null;
  selected_model: string;
  priority: number;
  created_at: string;
}

interface ServiceConfig {
  id: string;
  service_slug: string;
  service_name: string;
  provider_id: string | null;
  model_id: string;
  fallback_provider_id: string | null;
  fallback_model_id: string;
  provider?: { id: string; label: string; provider_type: string; selected_model: string } | null;
  fallback?: { id: string; label: string; provider_type: string; selected_model: string } | null;
}

const TYPE_ICONS: Record<string, string> = {
  anthropic: '🟣', gemini: '🔵', openai: '🟢', mistral: '🟠', private_vps: '🖥️', ollama: '🦙',
};
const TYPE_COLORS: Record<string, string> = {
  anthropic: '#d97757', gemini: '#4285f4', openai: '#10a37f', mistral: '#ff7000', private_vps: '#8b5cf6', ollama: '#a0a0a0',
};
const TYPE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic', gemini: 'Google Gemini', openai: 'OpenAI', mistral: 'Mistral', private_vps: 'Private VPS', ollama: 'Ollama',
};
const TYPES_NEED_KEY = ['anthropic', 'gemini', 'openai', 'mistral'];
const TYPES_NEED_ENDPOINT = ['private_vps', 'ollama'];

// ─── Component ───

export default function AISettingsPage() {
  const [toast, setToast] = useState<{ type: 'error' | 'warning' | 'info'; message: string } | null>(null);
  const showToast = (type: 'error' | 'warning' | 'info', message: string) => {
    setToast({ type, message: message.replace(/<[^>]*>/g, '').trim().slice(0, 200) });
    setTimeout(() => setToast(null), 6000);
  };

  const [providers, setProviders] = useState<Provider[]>([]);
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'providers' | 'services'>('providers');

  // Add provider form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState('anthropic');
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [adding, setAdding] = useState(false);

  // Per-provider UI state (keyed by provider id)
  const [editingKeys, setEditingKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [validationResult, setValidationResult] = useState<Record<string, { valid: boolean; message: string }>>({});
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; response?: string; error?: string; latencyMs: number }>>({});

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ─── Load ───

  const fetchAll = useCallback(async () => {
    try {
      const [provRes, svcRes] = await Promise.all([
        apiCall<{ providers: Provider[] }>('/api/ai/providers'),
        apiCall<{ services: ServiceConfig[] }>('/api/ai/services'),
      ]);
      setProviders(provRes.providers);
      setServices(svcRes.services);
    } catch (e: any) {
      showToast('error', `Failed to load: ${e.message}`);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ─── Provider Actions ───

  const addProvider = async () => {
    if (!newLabel.trim()) return showToast('warning', 'Label is required');
    setAdding(true);
    try {
      await apiCall('/api/ai/providers', { method: 'POST', body: { provider_type: newType, label: newLabel.trim(), api_key: newKey, endpoint: newEndpoint } });
      showToast('info', `Added "${newLabel}"`);
      setNewLabel(''); setNewKey(''); setNewEndpoint(''); setShowAddForm(false);
      fetchAll();
    } catch (e: any) { showToast('error', e.message); }
    finally { setAdding(false); }
  };

  const toggleProvider = async (id: string, enabled: boolean) => {
    try {
      await apiCall('/api/ai/providers/' + id, { method: 'PUT', body: { enabled } });
      setProviders(prev => prev.map(p => p.id === id ? { ...p, enabled } : p));
    } catch (e: any) { showToast('error', e.message); }
  };

  const deleteProvider = async (id: string, label: string) => {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      await apiCall('/api/ai/providers/' + id, { method: 'DELETE' });
      setProviders(prev => prev.filter(p => p.id !== id));
      showToast('info', `Deleted "${label}"`);
    } catch (e: any) { showToast('error', e.message); }
  };

  const saveKey = async (id: string) => {
    const key = editingKeys[id];
    if (!key) return;
    try {
      await apiCall('/api/ai/providers/' + id, { method: 'PUT', body: { api_key: key } });
      setEditingKeys(prev => ({ ...prev, [id]: '' }));
      showToast('info', 'API key saved');
      fetchAll();
    } catch (e: any) { showToast('error', e.message); }
  };

  const validateKeyAction = async (id: string) => {
    setValidating(prev => ({ ...prev, [id]: true }));
    setValidationResult(prev => ({ ...prev, [id]: undefined as any }));
    try {
      const resp = await apiCall<{ valid: boolean; message: string }>('/api/ai/providers/' + id + '/validate', { method: 'POST' });
      setValidationResult(prev => ({ ...prev, [id]: resp }));
      if (resp.valid) setProviders(prev => prev.map(p => p.id === id ? { ...p, validated: true } : p));
    } catch (e: any) {
      setValidationResult(prev => ({ ...prev, [id]: { valid: false, message: e.message } }));
    } finally { setValidating(prev => ({ ...prev, [id]: false })); }
  };

  const fetchModelsAction = async (id: string) => {
    setFetchingModels(prev => ({ ...prev, [id]: true }));
    try {
      const resp = await apiCall<{ models: string[] }>('/api/ai/providers/' + id + '/fetch-models', { method: 'POST' });
      setProviders(prev => prev.map(p => p.id === id ? { ...p, cached_models: resp.models } : p));
      showToast('info', `Fetched ${resp.models.length} models`);
    } catch (e: any) { showToast('error', e.message); }
    finally { setFetchingModels(prev => ({ ...prev, [id]: false })); }
  };

  const selectModel = async (id: string, model: string) => {
    try {
      await apiCall('/api/ai/providers/' + id, { method: 'PUT', body: { selected_model: model } });
      setProviders(prev => prev.map(p => p.id === id ? { ...p, selected_model: model } : p));
    } catch (e: any) { showToast('error', e.message); }
  };

  const testProviderAction = async (id: string) => {
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResult(prev => ({ ...prev, [id]: undefined as any }));
    try {
      const resp = await apiCall<any>('/api/ai/providers/' + id + '/test', { method: 'POST' });
      setTestResult(prev => ({ ...prev, [id]: resp }));
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [id]: { success: false, error: e.message, latencyMs: 0 } }));
    } finally { setTesting(prev => ({ ...prev, [id]: false })); }
  };

  // ─── Service Assignment ───

  const assignService = async (slug: string, providerId: string | null, modelId: string) => {
    try {
      await apiCall('/api/ai/services/' + slug, { method: 'PUT', body: { provider_id: providerId, model_id: modelId } });
      showToast('info', 'Service assignment saved');
      fetchAll();
    } catch (e: any) { showToast('error', e.message); }
  };

  // ─── Drag & Drop ───

  const handleDragStart = (idx: number) => { dragItem.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = async () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const reordered = [...providers];
    const [dragged] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, dragged);
    dragItem.current = null;
    dragOverItem.current = null;
    setProviders(reordered);

    try {
      await apiCall('/api/ai/priority', { method: 'PUT', body: { order: reordered.map((p, i) => ({ id: p.id, priority: i })) } });
      showToast('info', 'Priority order saved');
    } catch (e: any) { showToast('error', e.message); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Loader2 size={32} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>🤖 AI Settings</h1>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            Configure AI providers. Each saved key is an independent provider instance. Drag to set fallback priority.
          </p>
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{
          padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Plus size={14} /> Add Provider
        </button>
      </div>

      {/* Add Provider Form */}
      {showAddForm && (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--accent)',
          padding: 20, marginBottom: 24,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Add New Provider Instance</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Provider Type</label>
              <select value={newType} onChange={e => setNewType(e.target.value)} style={inputStyle}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{TYPE_ICONS[k]} {v}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Label</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Claude Production" style={inputStyle} />
            </div>
            {TYPES_NEED_KEY.includes(newType) && (
              <div>
                <label style={labelStyle}>API Key</label>
                <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="sk-..." type="password" style={{ ...inputStyle, fontFamily: 'monospace' }} />
              </div>
            )}
            {TYPES_NEED_ENDPOINT.includes(newType) && (
              <div>
                <label style={labelStyle}>Endpoint</label>
                <input value={newEndpoint} onChange={e => setNewEndpoint(e.target.value)} placeholder="http://localhost:11434" style={{ ...inputStyle, fontFamily: 'monospace' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={addProvider} disabled={adding} style={{
              padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: adding ? 0.5 : 1,
            }}>{adding ? 'Adding...' : 'Create Provider'}</button>
            <button onClick={() => setShowAddForm(false)} style={{
              padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', width: 'fit-content' }}>
        {(['providers', 'services'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: tab === t ? 'var(--accent)' : 'transparent',
            color: tab === t ? '#fff' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
          }}>{t === 'providers' ? `Providers (${providers.length})` : `Service Assignments (${services.length})`}</button>
        ))}
      </div>

      {/* ════════ PROVIDERS TAB ════════ */}
      {tab === 'providers' && (
        <>
          {/* Priority Strip */}
          {providers.length > 0 && (
            <div style={{
              background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
              padding: 16, marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                ⚡ Fallback Priority — Drag to reorder
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {providers.map((p, idx) => (
                  <div key={p.id} draggable onDragStart={() => handleDragStart(idx)} onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, cursor: 'grab',
                      border: `1px solid ${p.enabled ? TYPE_COLORS[p.provider_type] + '80' : 'var(--border)'}`,
                      background: p.enabled ? `${TYPE_COLORS[p.provider_type]}12` : 'var(--bg-app)',
                      opacity: p.enabled ? 1 : 0.35, transition: 'all 0.15s', userSelect: 'none', fontSize: 11,
                    }}>
                    <GripVertical size={12} style={{ color: 'var(--text-tertiary)' }} />
                    <span>{TYPE_ICONS[p.provider_type]}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{idx + 1}. {p.label}</span>
                    {p.enabled && p.validated && <CheckCircle size={10} style={{ color: 'var(--green)' }} />}
                    {p.enabled && !p.validated && <AlertTriangle size={10} style={{ color: 'var(--yellow)' }} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Provider Cards */}
          {providers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 14 }}>
              No providers configured. Click "Add Provider" to get started.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {providers.map(p => {
                const color = TYPE_COLORS[p.provider_type];
                const needsKey = TYPES_NEED_KEY.includes(p.provider_type);
                const needsEndpoint = TYPES_NEED_ENDPOINT.includes(p.provider_type);
                const vr = validationResult[p.id];
                const tr = testResult[p.id];
                const models = p.cached_models || [];

                return (
                  <div key={p.id} style={{
                    background: 'var(--bg-card)', borderRadius: 14,
                    border: `1px solid ${p.enabled ? color + '50' : 'var(--border)'}`,
                    overflow: 'hidden', transition: 'border-color 0.2s',
                  }}>
                    {/* Header */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '14px 18px', borderBottom: '1px solid var(--border)',
                      background: p.enabled ? `${color}06` : 'transparent',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 22 }}>{TYPE_ICONS[p.provider_type]}</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{p.label}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ background: `${color}20`, color, padding: '1px 6px', borderRadius: 4, fontWeight: 600, fontSize: 9 }}>
                              {TYPE_LABELS[p.provider_type]}
                            </span>
                            {p.api_key_set && <><span style={{ color: 'var(--green)' }}>●</span> Key set</>}
                            {p.validated && <><span style={{ margin: '0 1px' }}>·</span><span style={{ color: 'var(--green)' }}>Validated</span></>}
                            {p.selected_model && <><span style={{ margin: '0 1px' }}>·</span>{p.selected_model}</>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
                          <input type="checkbox" checked={p.enabled} onChange={e => toggleProvider(p.id, e.target.checked)}
                            style={{ opacity: 0, width: 0, height: 0 }} />
                          <span style={{
                            position: 'absolute', inset: 0, borderRadius: 11, background: p.enabled ? color : 'var(--bg-app)',
                            border: '1px solid var(--border)', transition: 'all 0.2s',
                          }}>
                            <span style={{
                              position: 'absolute', top: 2, left: p.enabled ? 20 : 2, width: 16, height: 16,
                              borderRadius: '50%', background: p.enabled ? '#fff' : 'var(--text-tertiary)', transition: 'left 0.2s',
                            }} />
                          </span>
                        </label>
                        <button onClick={() => deleteProvider(p.id, p.label)} title="Delete" style={{
                          padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent',
                          color: 'var(--text-tertiary)', cursor: 'pointer',
                        }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Body */}
                    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* API Key */}
                      {needsKey && (
                        <div>
                          <label style={labelStyle}>API Key</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <div style={{ flex: 1, position: 'relative' }}>
                              <input type={showKey[p.id] ? 'text' : 'password'}
                                value={editingKeys[p.id] || ''} placeholder={p.api_key_set ? p.api_key_masked : 'Enter API key...'}
                                onChange={e => setEditingKeys(prev => ({ ...prev, [p.id]: e.target.value }))}
                                style={{ ...inputStyle, fontFamily: 'monospace', paddingRight: 32 }} />
                              <button onClick={() => setShowKey(prev => ({ ...prev, [p.id]: !prev[p.id] }))} style={eyeBtnStyle}>
                                {showKey[p.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            </div>
                            <button onClick={() => saveKey(p.id)} disabled={!editingKeys[p.id]} style={{
                              ...btnStyle, background: editingKeys[p.id] ? color : 'var(--bg-app)',
                              color: editingKeys[p.id] ? '#fff' : 'var(--text-tertiary)', opacity: editingKeys[p.id] ? 1 : 0.5,
                            }}>Save</button>
                            <button onClick={() => validateKeyAction(p.id)} disabled={validating[p.id]} style={{
                              ...btnStyle, border: `1px solid ${color}50`, background: `${color}10`, color,
                              display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              {validating[p.id] ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={11} />}
                              Validate
                            </button>
                          </div>
                          {vr && (
                            <div style={{ marginTop: 5, fontSize: 11, fontWeight: 500, color: vr.valid ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {vr.valid ? <CheckCircle size={11} /> : <XCircle size={11} />} {vr.message}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Endpoint */}
                      {needsEndpoint && (
                        <div>
                          <label style={labelStyle}>Endpoint URL</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input type="text" value={p.endpoint} placeholder="http://localhost:11434"
                              onChange={e => {
                                const val = e.target.value;
                                setProviders(prev => prev.map(pr => pr.id === p.id ? { ...pr, endpoint: val } : pr));
                              }}
                              onBlur={e => apiCall('/api/ai/providers/' + p.id, { method: 'PUT', body: { endpoint: e.target.value } }).catch(() => {})}
                              style={{ ...inputStyle, fontFamily: 'monospace', flex: 1 }} />
                            <button onClick={() => validateKeyAction(p.id)} disabled={validating[p.id]} style={{
                              ...btnStyle, border: `1px solid ${color}50`, background: `${color}10`, color,
                              display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              {validating[p.id] ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={11} />}
                              Test Connection
                            </button>
                          </div>
                          {vr && (
                            <div style={{ marginTop: 5, fontSize: 11, fontWeight: 500, color: vr.valid ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {vr.valid ? <CheckCircle size={11} /> : <XCircle size={11} />} {vr.message}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Model Selection */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <label style={{ ...labelStyle, marginBottom: 0 }}>Model</label>
                          <button onClick={() => fetchModelsAction(p.id)} disabled={fetchingModels[p.id]} style={{
                            padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-app)',
                            color: 'var(--text-secondary)', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 3,
                          }}>
                            {fetchingModels[p.id] ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={9} />}
                            Fetch Models {models.length > 0 && `(${models.length})`}
                          </button>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <select value={p.selected_model} onChange={e => selectModel(p.id, e.target.value)} style={{
                            ...inputStyle, appearance: 'none', cursor: 'pointer', paddingRight: 28,
                          }}>
                            <option value="">{models.length > 0 ? 'Select a model...' : 'Click "Fetch Models" first'}</option>
                            {models.map(m => <option key={m} value={m}>{m}</option>)}
                            {p.selected_model && !models.includes(p.selected_model) && (
                              <option value={p.selected_model}>{p.selected_model} (current)</option>
                            )}
                          </select>
                          <ChevronDown size={13} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
                        </div>
                      </div>

                      {/* Test Button */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button onClick={() => testProviderAction(p.id)} disabled={testing[p.id] || !p.selected_model} style={{
                          ...btnStyle, background: p.selected_model ? color : 'var(--bg-app)', border: 'none',
                          color: p.selected_model ? '#fff' : 'var(--text-tertiary)',
                          display: 'flex', alignItems: 'center', gap: 5, opacity: (!p.selected_model || testing[p.id]) ? 0.5 : 1,
                        }}>
                          {testing[p.id] ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <TestTube size={13} />}
                          Test AI Response
                        </button>
                        {tr && (
                          <div style={{
                            flex: 1, padding: '7px 12px', borderRadius: 8, fontSize: 11,
                            background: tr.success ? 'var(--green-muted)' : 'var(--red-muted)',
                            border: `1px solid ${tr.success ? 'var(--green)' : 'var(--red)'}`,
                            color: tr.success ? 'var(--green)' : 'var(--red)',
                          }}>
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>
                              {tr.success ? `✅ ${tr.latencyMs}ms` : '❌ Failed'}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                              {tr.success ? tr.response : tr.error}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ════════ SERVICES TAB ════════ */}
      {tab === 'services' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {services.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 14 }}>
              No services configured. Run the migration to seed service definitions.
            </div>
          ) : services.map(svc => {
            const enabledProviders = providers.filter(p => p.enabled && p.validated && p.selected_model);
            return (
              <div key={svc.id} style={{
                background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
                padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{svc.service_name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{svc.service_slug}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {/* Primary */}
                  <div>
                    <label style={labelStyle}>Primary Provider + Model</label>
                    <select value={svc.provider_id ? `${svc.provider_id}::${svc.model_id}` : ''} onChange={e => {
                      const [pid, mid] = e.target.value.split('::');
                      assignService(svc.service_slug, pid || null, mid || '');
                    }} style={inputStyle}>
                      <option value="">Not assigned</option>
                      {enabledProviders.map(p => (
                        (p.cached_models || []).length > 0
                          ? (p.cached_models).map(m => <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>{TYPE_ICONS[p.provider_type]} {p.label} → {m}</option>)
                          : <option key={`${p.id}::${p.selected_model}`} value={`${p.id}::${p.selected_model}`}>{TYPE_ICONS[p.provider_type]} {p.label} → {p.selected_model}</option>
                      ))}
                    </select>
                  </div>
                  {/* Fallback */}
                  <div>
                    <label style={labelStyle}>Fallback Provider + Model</label>
                    <select value={svc.fallback_provider_id ? `${svc.fallback_provider_id}::${svc.fallback_model_id}` : ''} onChange={e => {
                      const [pid, mid] = e.target.value.split('::');
                      apiCall('/api/ai/services/' + svc.service_slug, { method: 'PUT', body: { fallback_provider_id: pid || null, fallback_model_id: mid || '' } })
                        .then(() => fetchAll()).catch(err => showToast('error', err.message));
                    }} style={inputStyle}>
                      <option value="">No fallback</option>
                      {enabledProviders.map(p => (
                        (p.cached_models || []).length > 0
                          ? (p.cached_models).map(m => <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>{TYPE_ICONS[p.provider_type]} {p.label} → {m}</option>)
                          : <option key={`${p.id}::${p.selected_model}`} value={`${p.id}::${p.selected_model}`}>{TYPE_ICONS[p.provider_type]} {p.label} → {p.selected_model}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {svc.provider && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                    Active: {TYPE_ICONS[svc.provider.provider_type]} {svc.provider.label} → {svc.model_id}
                    {svc.fallback && <> | Fallback: {TYPE_ICONS[svc.fallback.provider_type]} {svc.fallback.label} → {svc.fallback_model_id}</>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, maxWidth: 400,
          background: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--accent)',
          color: '#fff', fontSize: 12, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }} onClick={() => setToast(null)}>
          {toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'} {toast.message}
        </div>
      )}

      {/* Spin keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ─── Shared Styles ───

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase',
  letterSpacing: 0.5, display: 'block', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
};

const btnStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 7, border: '1px solid var(--border)',
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
};

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2,
};
