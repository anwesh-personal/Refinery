import { useState, useEffect } from 'react';
import { Button } from './UI';
import { X, Loader2 } from 'lucide-react';

interface ProviderFormData {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  is_default: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: ProviderFormData) => Promise<void>;
  initial?: Partial<ProviderFormData> & { id?: string };
}

const PROVIDER_TYPES = [
  { value: 'mailwizz', label: 'MailWizz' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'ses', label: 'Amazon SES' },
  { value: 'mailgun', label: 'Mailgun' },
  { value: 'sparkpost', label: 'SparkPost' },
  { value: 'postmark', label: 'Postmark' },
  { value: 'smtp', label: 'Generic SMTP' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
  outline: 'none', transition: 'border-color 0.2s',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--text-tertiary)', display: 'block', marginBottom: 6,
};

export default function MTAProviderModal({ open, onClose, onSave, initial }: Props) {
  const [form, setForm] = useState<ProviderFormData>({
    name: '', provider_type: 'mailwizz', base_url: '', api_key: '', is_default: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name || '',
        provider_type: initial.provider_type || 'mailwizz',
        base_url: initial.base_url || '',
        api_key: initial.api_key || '',
        is_default: initial.is_default || false,
      });
    } else {
      setForm({ name: '', provider_type: 'mailwizz', base_url: '', api_key: '', is_default: false });
    }
  }, [initial, open]);

  if (!open) return null;

  const isEdit = !!initial?.id;

  const handleSubmit = async () => {
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const set = (key: keyof ProviderFormData, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 520, background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 20, padding: 32, position: 'relative',
        animation: 'fadeIn 0.2s ease',
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16, background: 'none', border: 'none',
          color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4,
        }}><X size={18} /></button>

        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 24, color: 'var(--text-primary)' }}>
          {isEdit ? 'Edit Provider' : 'Add MTA Provider'}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle}>Provider Name</label>
            <input style={inputStyle} placeholder="e.g. MailWizz Production"
              value={form.name} onChange={e => set('name', e.target.value)}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </div>

          <div>
            <label style={labelStyle}>Provider Type</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }}
              value={form.provider_type} onChange={e => set('provider_type', e.target.value)}>
              {PROVIDER_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>API Base URL</label>
            <input style={inputStyle} placeholder="https://mail.example.com/api"
              value={form.base_url} onChange={e => set('base_url', e.target.value)}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </div>

          <div>
            <label style={labelStyle}>API Key</label>
            <input style={inputStyle} type="password" placeholder={isEdit ? '••••••••' : 'Enter API key'}
              value={form.api_key} onChange={e => set('api_key', e.target.value)}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={form.is_default}
              onChange={e => set('is_default', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
            />
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Set as default provider</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !form.name || !form.base_url || !form.api_key}
            icon={saving ? <Loader2 size={14} className="spin" /> : undefined}>
            {saving ? 'Saving...' : isEdit ? 'Update Provider' : 'Add Provider'}
          </Button>
        </div>
      </div>
    </div>
  );
}
