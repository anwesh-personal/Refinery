import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import {
  CheckCircle, XCircle, RefreshCw, ChevronDown, GripVertical,
  Zap, TestTube, Loader2, Eye, EyeOff, AlertTriangle, Plus, Trash2, Sparkles, Settings, ArrowRight
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
  anthropic: '#d97757', gemini: 'var(--blue)', openai: 'var(--green)', mistral: '#ff7000', private_vps: 'var(--purple)', ollama: '#a0a0a0',
};
const TYPE_GRADIENTS: Record<string, string> = {
  anthropic: 'linear-gradient(135deg, #d97757 0%, #b85d3a 100%)',
  gemini: 'linear-gradient(135deg, var(--blue) 0%, color-mix(in srgb, var(--blue) 70%, #000) 100%)',
  openai: 'linear-gradient(135deg, var(--green) 0%, color-mix(in srgb, var(--green) 70%, #000) 100%)',
  mistral: 'linear-gradient(135deg, #ff7000 0%, #cc5a00 100%)',
  private_vps: 'linear-gradient(135deg, var(--purple) 0%, color-mix(in srgb, var(--purple) 70%, #000) 100%)',
  ollama: 'linear-gradient(135deg, #666 0%, #444 100%)',
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

  // Per-provider UI state
  const [editingKeys, setEditingKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [validationResult, setValidationResult] = useState<Record<string, { valid: boolean; message: string }>>({});
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; response?: string; error?: string; latencyMs: number }>>({});
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

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
    dragItem.current = null; dragOverItem.current = null;
    setProviders(reordered);
    try {
      await apiCall('/api/ai/priority', { method: 'PUT', body: { order: reordered.map((p, i) => ({ id: p.id, priority: i })) } });
    } catch (e: any) { showToast('error', e.message); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 16, background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={24} style={{ color: 'var(--accent)', animation: 'pulse 2s ease-in-out infinite' }} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>Loading AI Providers...</div>
      </div>
    );
  }

  const enabledCount = providers.filter(p => p.enabled).length;
  const validatedCount = providers.filter(p => p.validated).length;

  return (
    <>
      {/* ── Hero Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-sidebar) 100%)',
        borderRadius: 20, border: '1px solid var(--border)', padding: '28px 32px',
        marginBottom: 24, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'var(--accent)', opacity: 0.04 }} />
        <div style={{ position: 'absolute', bottom: -60, right: 80, width: 160, height: 160, borderRadius: '50%', background: 'var(--accent)', opacity: 0.03 }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>AI Configuration</h1>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', maxWidth: 500, lineHeight: 1.6, marginTop: 4 }}>
                Each saved key is an independent provider instance. Drag to set fallback priority. Assign providers per feature.
              </p>
            </div>
            <button onClick={() => setShowAddForm(!showAddForm)} style={{
              padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'var(--accent)', color: 'var(--accent-contrast, #fff)', fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 6, transition: 'transform 0.15s, box-shadow 0.15s',
              boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)'; }}
            >
              <Plus size={15} /> Add Provider
            </button>
          </div>

          {/* Stats strip */}
          <div style={{ display: 'flex', gap: 20, marginTop: 18 }}>
            {[
              { label: 'Total', value: providers.length, color: 'var(--text-primary)' },
              { label: 'Enabled', value: enabledCount, color: 'var(--green)' },
              { label: 'Validated', value: validatedCount, color: 'var(--accent)' },
              { label: 'Services', value: services.filter(s => s.provider_id).length + '/' + services.length, color: 'var(--yellow)' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Add Provider Panel ── */}
      {showAddForm && (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--accent)',
          padding: 24, marginBottom: 24, boxShadow: '0 0 30px rgba(var(--accent-rgb, 0,0,0), 0.08)',
          animation: 'slideDown 0.2s ease-out',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Plus size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>New Provider Instance</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Provider Type</label>
              <div style={{ position: 'relative' }}>
                <select value={newType} onChange={e => setNewType(e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer' }}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{TYPE_ICONS[k]} {v}</option>)}
                </select>
                <ChevronDown size={12} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
              </div>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={addProvider} disabled={adding || !newLabel.trim()} style={{
              padding: '9px 22px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-contrast, #fff)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: (adding || !newLabel.trim()) ? 0.5 : 1,
            }}>{adding ? 'Creating...' : 'Create Provider'}</button>
            <button onClick={() => setShowAddForm(false)} style={{
              padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 12, padding: 4, border: '1px solid var(--border)', width: 'fit-content' }}>
        {([
          { key: 'providers' as const, label: `Providers (${providers.length})`, icon: <Sparkles size={13} /> },
          { key: 'services' as const, label: `Service Assignments`, icon: <Settings size={13} /> },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: tab === t.key ? 'var(--accent)' : 'transparent',
            color: tab === t.key ? '#fff' : 'var(--text-tertiary)',
            fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
            transition: 'all 0.15s ease',
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* ════════ PROVIDERS TAB ════════ */}
      {tab === 'providers' && (
        <>
          {/* Priority Strip */}
          {providers.length > 0 && (
            <div style={{
              background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
              padding: '14px 18px', marginBottom: 20,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                <GripVertical size={11} /> Fallback Priority — Drag to reorder
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {providers.map((p, idx) => (
                  <div key={p.id} draggable onDragStart={() => handleDragStart(idx)} onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, cursor: 'grab',
                      background: p.enabled ? `${TYPE_COLORS[p.provider_type]}12` : 'var(--bg-app)',
                      border: `1px solid ${p.enabled ? TYPE_COLORS[p.provider_type] + '40' : 'var(--border)'}`,
                      opacity: p.enabled ? 1 : 0.3, transition: 'all 0.15s', userSelect: 'none',
                    }}>
                    <GripVertical size={10} style={{ color: 'var(--text-tertiary)' }} />
                    <span style={{ fontSize: 13 }}>{TYPE_ICONS[p.provider_type]}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{idx + 1}.</span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                    {p.enabled && p.validated && <CheckCircle size={10} style={{ color: 'var(--green)' }} />}
                    {p.enabled && !p.validated && <AlertTriangle size={10} style={{ color: 'var(--yellow)' }} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Provider Cards — Grid */}
          {providers.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 20,
              border: '1px dashed var(--border)',
            }}>
              <Sparkles size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontSize: 14, color: 'var(--text-tertiary)', fontWeight: 500 }}>No providers configured</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', opacity: 0.6, marginTop: 4 }}>Click "Add Provider" to get started</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
              {providers.map(p => {
                const color = TYPE_COLORS[p.provider_type];
                const gradient = TYPE_GRADIENTS[p.provider_type];
                const needsKey = TYPES_NEED_KEY.includes(p.provider_type);
                const needsEndpoint = TYPES_NEED_ENDPOINT.includes(p.provider_type);
                const vr = validationResult[p.id];
                const tr = testResult[p.id];
                const models = p.cached_models || [];
                const expanded = expandedCards[p.id] ?? true;

                return (
                  <div key={p.id} style={{
                    borderRadius: 16, overflow: 'hidden', transition: 'transform 0.2s, box-shadow 0.2s',
                    border: `1px solid ${p.enabled ? color + '40' : 'var(--border)'}`,
                    background: 'var(--bg-card)',
                    boxShadow: p.enabled ? `0 4px 20px ${color}10` : 'none',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 30px ${color}18`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = p.enabled ? `0 4px 20px ${color}10` : 'none'; }}
                  >
                    {/* Gradient Header */}
                    <div style={{
                      background: gradient, padding: '14px 18px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      opacity: p.enabled ? 1 : 0.5, transition: 'opacity 0.2s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 22, filter: 'brightness(1.2)' }}>{TYPE_ICONS[p.provider_type]}</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-contrast, #fff)' }}>{p.label}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {TYPE_LABELS[p.provider_type]}
                            {p.validated && <><span style={{ margin: '0 2px' }}>·</span><CheckCircle size={9} style={{ color: '#90EE90' }} /> Verified</>}
                            {p.selected_model && <><span style={{ margin: '0 2px' }}>·</span>{p.selected_model}</>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* Toggle */}
                        <label style={{ position: 'relative', display: 'inline-block', width: 38, height: 20, cursor: 'pointer' }}>
                          <input type="checkbox" checked={p.enabled} onChange={e => toggleProvider(p.id, e.target.checked)}
                            style={{ opacity: 0, width: 0, height: 0 }} />
                          <span style={{
                            position: 'absolute', inset: 0, borderRadius: 10,
                            background: p.enabled ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)',
                            transition: 'all 0.2s',
                          }}>
                            <span style={{
                              position: 'absolute', top: 2, left: p.enabled ? 20 : 2, width: 16, height: 16,
                              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                            }} />
                          </span>
                        </label>
                        {/* Expand/collapse */}
                        <button onClick={() => setExpandedCards(prev => ({ ...prev, [p.id]: !expanded }))} style={{
                          background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', color: 'var(--accent-contrast, #fff)',
                          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s',
                        }}>
                          <ChevronDown size={14} />
                        </button>
                        {/* Delete */}
                        <button onClick={() => deleteProvider(p.id, p.label)} style={{
                          background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', color: 'rgba(255,255,255,0.6)',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,80,80,0.3)'; e.currentTarget.style.color = '#fff'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Body — collapsible */}
                    {expanded && (
                      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {/* API Key */}
                        {needsKey && (
                          <div>
                            <label style={labelStyle}>API Key</label>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <div style={{ flex: 1, position: 'relative' }}>
                                <input type={showKey[p.id] ? 'text' : 'password'} value={editingKeys[p.id] || ''}
                                  placeholder={p.api_key_set ? p.api_key_masked : 'Paste your API key here...'}
                                  onChange={e => setEditingKeys(prev => ({ ...prev, [p.id]: e.target.value }))}
                                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, paddingRight: 30 }} />
                                <button onClick={() => setShowKey(prev => ({ ...prev, [p.id]: !prev[p.id] }))} style={{
                                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2,
                                }}>
                                  {showKey[p.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                                </button>
                              </div>
                              <button onClick={() => saveKey(p.id)} disabled={!editingKeys[p.id]} style={{
                                ...miniBtn, background: editingKeys[p.id] ? color : 'var(--bg-app)',
                                color: editingKeys[p.id] ? '#fff' : 'var(--text-tertiary)', border: `1px solid ${editingKeys[p.id] ? color : 'var(--border)'}`,
                              }}>Save</button>
                              <button onClick={() => validateKeyAction(p.id)} disabled={validating[p.id]} style={{
                                ...miniBtn, background: `${color}10`, color, border: `1px solid ${color}30`,
                                display: 'flex', alignItems: 'center', gap: 3,
                              }}>
                                {validating[p.id] ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={10} />}
                                Validate
                              </button>
                            </div>
                            {vr && (
                              <div style={{ marginTop: 5, fontSize: 10, fontWeight: 600, color: vr.valid ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                {vr.valid ? <CheckCircle size={10} /> : <XCircle size={10} />} {vr.message}
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
                                onChange={e => { const v = e.target.value; setProviders(prev => prev.map(pr => pr.id === p.id ? { ...pr, endpoint: v } : pr)); }}
                                onBlur={e => apiCall('/api/ai/providers/' + p.id, { method: 'PUT', body: { endpoint: e.target.value } }).catch(() => {})}
                                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, flex: 1 }} />
                              <button onClick={() => validateKeyAction(p.id)} disabled={validating[p.id]} style={{
                                ...miniBtn, background: `${color}10`, color, border: `1px solid ${color}30`,
                                display: 'flex', alignItems: 'center', gap: 3,
                              }}>
                                {validating[p.id] ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={10} />}
                                Test
                              </button>
                            </div>
                            {vr && (
                              <div style={{ marginTop: 5, fontSize: 10, fontWeight: 600, color: vr.valid ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                {vr.valid ? <CheckCircle size={10} /> : <XCircle size={10} />} {vr.message}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Model */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <label style={{ ...labelStyle, marginBottom: 0 }}>Model</label>
                            <button onClick={() => fetchModelsAction(p.id)} disabled={fetchingModels[p.id]} style={{
                              padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-app)',
                              color: 'var(--text-tertiary)', fontSize: 9, fontWeight: 600, cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 3,
                            }}>
                              {fetchingModels[p.id] ? <Loader2 size={8} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={8} />}
                              Fetch {models.length > 0 ? `(${models.length})` : ''}
                            </button>
                          </div>
                          <div style={{ position: 'relative' }}>
                            <select value={p.selected_model} onChange={e => selectModel(p.id, e.target.value)} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer', fontSize: 11 }}>
                              <option value="">{models.length > 0 ? 'Select a model...' : 'Fetch models first'}</option>
                              {models.map(m => <option key={m} value={m}>{m}</option>)}
                              {p.selected_model && !models.includes(p.selected_model) && <option value={p.selected_model}>{p.selected_model} (current)</option>}
                            </select>
                            <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
                          </div>
                        </div>

                        {/* Test */}
                        <div>
                          <button onClick={() => testProviderAction(p.id)} disabled={testing[p.id] || !p.selected_model} style={{
                            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                            background: p.selected_model ? gradient : 'var(--bg-app)', color: p.selected_model ? '#fff' : 'var(--text-tertiary)',
                            fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5,
                            opacity: (!p.selected_model || testing[p.id]) ? 0.4 : 1, width: '100%', justifyContent: 'center',
                            boxShadow: p.selected_model ? `0 3px 12px ${color}25` : 'none',
                            transition: 'all 0.15s',
                          }}>
                            {testing[p.id] ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <TestTube size={13} />}
                            Test AI Response
                          </button>
                          {tr && (
                            <div style={{
                              marginTop: 8, padding: '10px 14px', borderRadius: 10, fontSize: 11,
                              background: tr.success ? 'var(--green-muted)' : 'var(--red-muted)',
                              border: `1px solid ${tr.success ? 'var(--green)30' : 'var(--red)30'}`,
                            }}>
                              <div style={{ fontWeight: 700, color: tr.success ? 'var(--green)' : 'var(--red)', marginBottom: 3 }}>
                                {tr.success ? `✅ Response in ${tr.latencyMs}ms` : '❌ Failed'}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-word', lineHeight: 1.5 }}>
                                {tr.success ? tr.response : tr.error}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ════════ SERVICES TAB ════════ */}
      {tab === 'services' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
          {services.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 14, background: 'var(--bg-card)', borderRadius: 16, border: '1px dashed var(--border)' }}>
              Run the migration to seed service definitions.
            </div>
          ) : services.map(svc => {
            const enabledProviders = providers.filter(p => p.enabled && p.validated && p.selected_model);
            const assigned = !!svc.provider_id;
            return (
              <div key={svc.id} style={{
                background: 'var(--bg-card)', borderRadius: 14, border: `1px solid ${assigned ? 'var(--green)30' : 'var(--border)'}`,
                overflow: 'hidden', transition: 'border-color 0.2s',
              }}>
                <div style={{
                  padding: '12px 16px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: assigned ? 'rgba(16,163,127,0.04)' : 'transparent',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{svc.service_name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{svc.service_slug}</div>
                  </div>
                  <div style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                    background: assigned ? 'var(--green-muted)' : 'var(--bg-app)',
                    color: assigned ? 'var(--green)' : 'var(--text-tertiary)',
                    border: `1px solid ${assigned ? 'var(--green)' : 'var(--border)'}`,
                  }}>
                    {assigned ? 'Assigned' : 'Not Set'}
                  </div>
                </div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Primary Provider + Model</label>
                    <div style={{ position: 'relative' }}>
                      <select value={svc.provider_id ? `${svc.provider_id}::${svc.model_id}` : ''} onChange={e => {
                        const [pid, mid] = e.target.value.split('::');
                        assignService(svc.service_slug, pid || null, mid || '');
                      }} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer', fontSize: 11 }}>
                        <option value="">Not assigned</option>
                        {enabledProviders.map(p =>
                          (p.cached_models?.length > 0 ? p.cached_models : [p.selected_model]).map(m =>
                            <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>{TYPE_ICONS[p.provider_type]} {p.label} → {m}</option>
                          )
                        )}
                      </select>
                      <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Fallback</label>
                    <div style={{ position: 'relative' }}>
                      <select value={svc.fallback_provider_id ? `${svc.fallback_provider_id}::${svc.fallback_model_id}` : ''} onChange={e => {
                        const [pid, mid] = e.target.value.split('::');
                        apiCall('/api/ai/services/' + svc.service_slug, { method: 'PUT', body: { fallback_provider_id: pid || null, fallback_model_id: mid || '' } })
                          .then(() => fetchAll()).catch(err => showToast('error', err.message));
                      }} style={{ ...inputStyle, appearance: 'none', paddingRight: 28, cursor: 'pointer', fontSize: 11 }}>
                        <option value="">No fallback</option>
                        {enabledProviders.map(p =>
                          (p.cached_models?.length > 0 ? p.cached_models : [p.selected_model]).map(m =>
                            <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>{TYPE_ICONS[p.provider_type]} {p.label} → {m}</option>
                          )
                        )}
                      </select>
                      <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} />
                    </div>
                  </div>
                  {svc.provider && (
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ArrowRight size={9} /> {TYPE_ICONS[svc.provider.provider_type]} {svc.provider.label} → {svc.model_id}
                      {svc.fallback && <> · Fallback: {TYPE_ICONS[svc.fallback.provider_type]} {svc.fallback.label}</>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '14px 22px', borderRadius: 12, maxWidth: 420,
          background: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--accent)',
          color: 'var(--accent-contrast, #fff)', fontSize: 12, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          animation: 'slideUp 0.25s ease-out',
          cursor: 'pointer', backdropFilter: 'blur(8px)',
        }} onClick={() => setToast(null)}>
          {toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'} {toast.message}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </>
  );
}

// ─── Shared Styles ───
const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase',
  letterSpacing: 0.8, display: 'block', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
  transition: 'border-color 0.15s',
};
const miniBtn: React.CSSProperties = {
  padding: '6px 11px', borderRadius: 7, fontSize: 10, fontWeight: 600, cursor: 'pointer',
  whiteSpace: 'nowrap',
};
