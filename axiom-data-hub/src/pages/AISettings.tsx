import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import {
  CheckCircle, XCircle, RefreshCw, ChevronDown, GripVertical,
  Zap, TestTube, Loader2, Eye, EyeOff, AlertTriangle
} from 'lucide-react';

// ─── Types ───

interface ProviderDef {
  slug: string;
  name: string;
  requiresKey: boolean;
  requiresEndpoint: boolean;
  defaultEndpoint: string;
}

interface ProviderState {
  slug: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  apiKeySet: boolean;
  endpoint?: string;
  selectedModel: string;
  validated: boolean;
  lastValidated?: string;
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '🟣',
  gemini: '🔵',
  openai: '🟢',
  mistral: '🟠',
  private_vps: '🖥️',
  ollama: '🦙',
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d97757',
  gemini: '#4285f4',
  openai: '#10a37f',
  mistral: '#ff7000',
  private_vps: '#8b5cf6',
  ollama: '#ffffff',
};

// ─── Component ───

export default function AISettingsPage() {
  const [toast, setToast] = useState<{ type: 'error' | 'warning' | 'info'; message: string } | null>(null);
  const showToast = (type: 'error' | 'warning' | 'info', message: string) => {
    const clean = message.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    setToast({ type, message: clean });
    setTimeout(() => setToast(null), 6000);
  };
  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [definitions, setDefinitions] = useState<ProviderDef[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-provider UI state
  const [editingKeys, setEditingKeys] = useState<Record<string, string>>({});
  const [editingEndpoints, setEditingEndpoints] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [validationResult, setValidationResult] = useState<Record<string, { valid: boolean; message: string }>>({});
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; response?: string; error?: string; latencyMs: number }>>({});

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ─── Load providers ───

  const fetchProviders = useCallback(async () => {
    try {
      const data = await apiCall<any>('/api/ai/providers');
      setProviders(data.providers);
      setDefinitions(data.definitions);
      setPriority(data.priority);

      // Init editing states
      const keys: Record<string, string> = {};
      const eps: Record<string, string> = {};
      for (const p of data.providers) {
        keys[p.slug] = '';
        eps[p.slug] = p.endpoint || '';
      }
      setEditingKeys(keys);
      setEditingEndpoints(eps);
    } catch (e: any) {
      showToast('error', `Failed to load AI providers: ${e.message}`);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  // ─── Actions ───

  const toggleProvider = async (slug: string, enabled: boolean) => {
    try {
      await apiCall('/api/ai/providers/' + slug, { method: 'PUT', body: { enabled } });
      setProviders(prev => prev.map(p => p.slug === slug ? { ...p, enabled } : p));
      showToast('info', `${enabled ? 'Enabled' : 'Disabled'} ${providers.find(p => p.slug === slug)?.name}`);
    } catch (e: any) { showToast('error', e.message); }
  };

  const saveKey = async (slug: string) => {
    const key = editingKeys[slug];
    if (!key) return;
    try {
      await apiCall('/api/ai/providers/' + slug, { method: 'PUT', body: { apiKey: key } });
      setProviders(prev => prev.map(p => p.slug === slug ? { ...p, apiKeySet: true, apiKey: `${key.slice(0, 8)}${'•'.repeat(Math.max(0, key.length - 12))}${key.slice(-4)}`, validated: false } : p));
      setEditingKeys(prev => ({ ...prev, [slug]: '' }));
      showToast('info', 'API key saved');
    } catch (e: any) { showToast('error', e.message); }
  };

  const saveEndpoint = async (slug: string) => {
    const ep = editingEndpoints[slug];
    try {
      await apiCall('/api/ai/providers/' + slug, { method: 'PUT', body: { endpoint: ep } });
      showToast('info', 'Endpoint saved');
    } catch (e: any) { showToast('error', e.message); }
  };

  const validateKey = async (slug: string) => {
    setValidating(prev => ({ ...prev, [slug]: true }));
    setValidationResult(prev => ({ ...prev, [slug]: undefined as any }));
    try {
      const key = editingKeys[slug] || undefined;
      const endpoint = editingEndpoints[slug] || undefined;
      const resp = await apiCall<{ valid: boolean; message: string }>('/api/ai/providers/' + slug + '/validate', { method: 'POST', body: { apiKey: key, endpoint } });
      setValidationResult(prev => ({ ...prev, [slug]: resp }));
      if (resp.valid) {
        setProviders(prev => prev.map(p => p.slug === slug ? { ...p, validated: true } : p));
      }
    } catch (e: any) {
      setValidationResult(prev => ({ ...prev, [slug]: { valid: false, message: e.message } }));
    } finally {
      setValidating(prev => ({ ...prev, [slug]: false }));
    }
  };

  const fetchModels = async (slug: string) => {
    setModelsLoading(prev => ({ ...prev, [slug]: true }));
    try {
      const resp = await apiCall<{ models: string[] }>('/api/ai/providers/' + slug + '/models');
      setAvailableModels(prev => ({ ...prev, [slug]: resp.models }));
    } catch (e: any) {
      showToast('error', `Model fetch failed: ${e.message}`);
    } finally {
      setModelsLoading(prev => ({ ...prev, [slug]: false }));
    }
  };

  const selectModel = async (slug: string, model: string) => {
    try {
      await apiCall('/api/ai/providers/' + slug, { method: 'PUT', body: { selectedModel: model } });
      setProviders(prev => prev.map(p => p.slug === slug ? { ...p, selectedModel: model } : p));
      showToast('info', `Model set: ${model}`);
    } catch (e: any) { showToast('error', e.message); }
  };

  const testProvider = async (slug: string) => {
    setTesting(prev => ({ ...prev, [slug]: true }));
    setTestResult(prev => ({ ...prev, [slug]: undefined as any }));
    try {
      const resp = await apiCall<any>('/api/ai/providers/' + slug + '/test', { method: 'POST' });
      setTestResult(prev => ({ ...prev, [slug]: resp }));
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [slug]: { success: false, error: e.message, latencyMs: 0 } }));
    } finally {
      setTesting(prev => ({ ...prev, [slug]: false }));
    }
  };

  // ─── Drag & Drop for Priority ───

  const handleDragStart = (idx: number) => { dragItem.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = async () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const newPriority = [...priority];
    const draggedItem = newPriority.splice(dragItem.current, 1)[0];
    newPriority.splice(dragOverItem.current, 0, draggedItem);
    dragItem.current = null;
    dragOverItem.current = null;
    setPriority(newPriority);

    // Save to backend
    try {
      await apiCall('/api/ai/priority', { method: 'PUT', body: { priority: newPriority } });
      showToast('info', 'Priority order saved');
    } catch (e: any) { showToast('error', e.message); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  const getDef = (slug: string) => definitions.find(d => d.slug === slug);

  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
          🤖 AI Settings
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          Configure AI providers for intelligent lead scoring, content generation, and automated analysis.
          Drag providers to set fallback priority.
        </p>
      </div>

      {/* ── Priority Strip ── */}
      <div style={{
        background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
        padding: 20, marginBottom: 24,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          ⚡ AI Priority &amp; Fallback Order
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 16 }}>
          Drag to reorder. The system tries each provider in order — if the primary fails, it falls through to the next enabled provider.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {priority.map((slug, idx) => {
            const prov = providers.find(p => p.slug === slug);
            const isEnabled = prov?.enabled;
            const isValidated = prov?.validated;
            return (
              <div
                key={slug}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={e => e.preventDefault()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 10, cursor: 'grab',
                  border: `1px solid ${isEnabled ? PROVIDER_COLORS[slug] + '80' : 'var(--border)'}`,
                  background: isEnabled ? `${PROVIDER_COLORS[slug]}15` : 'var(--bg-app)',
                  opacity: isEnabled ? 1 : 0.4,
                  transition: 'all 0.15s ease',
                  userSelect: 'none',
                }}
              >
                <GripVertical size={14} style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 16 }}>{PROVIDER_ICONS[slug]}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {idx + 1}. {prov?.name || slug}
                </span>
                {isEnabled && isValidated && <CheckCircle size={12} style={{ color: 'var(--green)' }} />}
                {isEnabled && !isValidated && <AlertTriangle size={12} style={{ color: 'var(--yellow)' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Provider Cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {providers.map(prov => {
          const def = getDef(prov.slug);
          if (!def) return null;
          const color = PROVIDER_COLORS[prov.slug];
          const vr = validationResult[prov.slug];
          const tr = testResult[prov.slug];
          const models = availableModels[prov.slug] || [];

          return (
            <div key={prov.slug} style={{
              background: 'var(--bg-card)', borderRadius: 16,
              border: `1px solid ${prov.enabled ? color + '60' : 'var(--border)'}`,
              overflow: 'hidden', transition: 'border-color 0.2s',
            }}>
              {/* Header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                background: prov.enabled ? `${color}08` : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{PROVIDER_ICONS[prov.slug]}</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{prov.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {prov.apiKeySet ? (
                        <><span style={{ color: 'var(--green)' }}>●</span> Key configured</>
                      ) : def.requiresKey ? (
                        <><span style={{ color: 'var(--red)' }}>●</span> No API key</>
                      ) : (
                        <><span style={{ color: 'var(--blue)' }}>●</span> No key required</>
                      )}
                      {prov.validated && <><span style={{ margin: '0 2px' }}>·</span><span style={{ color: 'var(--green)' }}>Validated</span></>}
                      {prov.selectedModel && <><span style={{ margin: '0 2px' }}>·</span>{prov.selectedModel}</>}
                    </div>
                  </div>
                </div>
                <label style={{
                  position: 'relative', display: 'inline-block',
                  width: 44, height: 24, cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={prov.enabled} onChange={e => toggleProvider(prov.slug, e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: 12,
                    background: prov.enabled ? color : 'var(--bg-app)',
                    border: '1px solid var(--border)',
                    transition: 'all 0.2s',
                  }}>
                    <span style={{
                      position: 'absolute', top: 2, left: prov.enabled ? 22 : 2,
                      width: 18, height: 18, borderRadius: '50%',
                      background: prov.enabled ? '#fff' : 'var(--text-tertiary)',
                      transition: 'left 0.2s',
                    }} />
                  </span>
                </label>
              </div>

              {/* Body */}
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* API Key */}
                {def.requiresKey && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
                      API Key
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1, position: 'relative' }}>
                        <input
                          type={showKey[prov.slug] ? 'text' : 'password'}
                          value={editingKeys[prov.slug] || ''}
                          placeholder={prov.apiKeySet ? prov.apiKey : 'Enter API key...'}
                          onChange={e => setEditingKeys(prev => ({ ...prev, [prov.slug]: e.target.value }))}
                          style={{
                            width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8,
                            border: '1px solid var(--border)', background: 'var(--bg-input)',
                            color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace',
                          }}
                        />
                        <button onClick={() => setShowKey(prev => ({ ...prev, [prov.slug]: !prev[prov.slug] }))}
                          style={{
                            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2,
                          }}>
                          {showKey[prov.slug] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <button onClick={() => saveKey(prov.slug)}
                        disabled={!editingKeys[prov.slug]}
                        style={{
                          padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                          background: editingKeys[prov.slug] ? color : 'var(--bg-app)',
                          color: editingKeys[prov.slug] ? '#fff' : 'var(--text-tertiary)',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          opacity: editingKeys[prov.slug] ? 1 : 0.5,
                        }}>Save</button>
                      <button onClick={() => validateKey(prov.slug)}
                        disabled={validating[prov.slug]}
                        style={{
                          padding: '8px 14px', borderRadius: 8, border: `1px solid ${color}60`,
                          background: `${color}15`, color, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                        {validating[prov.slug] ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                        Validate
                      </button>
                    </div>
                    {vr && (
                      <div style={{
                        marginTop: 6, fontSize: 11, fontWeight: 500,
                        color: vr.valid ? 'var(--green)' : 'var(--red)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {vr.valid ? <CheckCircle size={12} /> : <XCircle size={12} />}
                        {vr.message}
                      </div>
                    )}
                  </div>
                )}

                {/* Endpoint */}
                {def.requiresEndpoint && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
                      Endpoint URL
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={editingEndpoints[prov.slug] || ''}
                        placeholder={def.defaultEndpoint || 'https://your-server:port'}
                        onChange={e => setEditingEndpoints(prev => ({ ...prev, [prov.slug]: e.target.value }))}
                        style={{
                          flex: 1, padding: '8px 12px', borderRadius: 8,
                          border: '1px solid var(--border)', background: 'var(--bg-input)',
                          color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace',
                        }}
                      />
                      <button onClick={() => saveEndpoint(prov.slug)}
                        style={{
                          padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                          background: color, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}>Save</button>
                      <button onClick={() => validateKey(prov.slug)}
                        disabled={validating[prov.slug]}
                        style={{
                          padding: '8px 14px', borderRadius: 8, border: `1px solid ${color}60`,
                          background: `${color}15`, color, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                        {validating[prov.slug] ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                        Test Connection
                      </button>
                    </div>
                    {vr && (
                      <div style={{ marginTop: 6, fontSize: 11, fontWeight: 500, color: vr.valid ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {vr.valid ? <CheckCircle size={12} /> : <XCircle size={12} />} {vr.message}
                      </div>
                    )}
                  </div>
                )}

                {/* Model Selection */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Model
                    </label>
                    <button onClick={() => fetchModels(prov.slug)}
                      disabled={modelsLoading[prov.slug]}
                      style={{
                        padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)',
                        background: 'var(--bg-app)', color: 'var(--text-secondary)',
                        fontSize: 10, fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                      {modelsLoading[prov.slug] ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                      Fetch Models
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <select
                      value={prov.selectedModel}
                      onChange={e => selectModel(prov.slug, e.target.value)}
                      style={{
                        width: '100%', padding: '8px 32px 8px 12px', borderRadius: 8,
                        border: '1px solid var(--border)', background: 'var(--bg-input)',
                        color: 'var(--text-primary)', fontSize: 12, appearance: 'none', cursor: 'pointer',
                      }}
                    >
                      <option value="">{models.length > 0 ? 'Select a model...' : (prov.selectedModel || 'Click "Fetch Models" first')}</option>
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                      {prov.selectedModel && !models.includes(prov.selectedModel) && (
                        <option value={prov.selectedModel}>{prov.selectedModel} (current)</option>
                      )}
                    </select>
                    <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
                  </div>
                </div>

                {/* Test Button */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => testProvider(prov.slug)}
                    disabled={testing[prov.slug] || !prov.selectedModel}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: prov.selectedModel ? color : 'var(--bg-app)',
                      color: prov.selectedModel ? '#fff' : 'var(--text-tertiary)',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6,
                      opacity: (!prov.selectedModel || testing[prov.slug]) ? 0.5 : 1,
                    }}>
                    {testing[prov.slug] ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                    Test AI Response
                  </button>
                  {tr && (
                    <div style={{
                      flex: 1, padding: '8px 14px', borderRadius: 8, fontSize: 11,
                      background: tr.success ? 'var(--green-muted)' : 'var(--red-muted)',
                      border: `1px solid ${tr.success ? 'var(--green)' : 'var(--red)'}`,
                      color: tr.success ? 'var(--green)' : 'var(--red)',
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        {tr.success ? `✅ ${tr.latencyMs}ms` : `❌ Failed`}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
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

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, maxWidth: 400,
          background: toast.type === 'error' ? 'var(--red)' : toast.type === 'warning' ? 'var(--yellow)' : 'var(--accent)',
          color: '#fff', fontSize: 12, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.2s ease',
        }} onClick={() => setToast(null)}>
          {toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'} {toast.message}
        </div>
      )}
    </>
  );
}
