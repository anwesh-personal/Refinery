import { useState, useEffect } from 'react';
import { Button } from './UI';
import { apiCall } from '../lib/api';
import { useToast } from './Toast';
import { X, Loader2, Rocket, Eye } from 'lucide-react';

interface MTAList {
  id: string;
  name: string;
  subscriber_count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
  outline: 'none', transition: 'border-color 0.2s',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--text-tertiary)', display: 'block', marginBottom: 4,
};

export default function CampaignBuilderModal({ open, onClose, onCreated }: Props) {
  const [mtaLists, setMtaLists] = useState<MTAList[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [creating, setCreating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(false);
  const { success, error: toastError } = useToast();

  const [form, setForm] = useState({
    name: '',
    list_id: '',
    subject: '',
    from_name: '',
    from_email: '',
    reply_to: '',
    html_body: '',
    plain_text: '',
  });

  useEffect(() => {
    if (open) {
      setLoadingLists(true);
      apiCall<MTAList[]>('/api/queue/mta-lists')
        .then(setMtaLists)
        .catch(() => {})
        .finally(() => setLoadingLists(false));
      setPreviewHtml(false);
    }
  }, [open]);

  if (!open) return null;

  const set = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }));

  const canSubmit = form.name && form.list_id && form.subject && form.from_name && form.from_email && form.html_body;

  const handleCreate = async () => {
    setCreating(true);
    try {
      const campaign = await apiCall<{ id: string; name: string }>('/api/queue/campaign', {
        method: 'POST', body: form,
      });
      success('Campaign Created', `"${campaign.name}" created in MTA as draft`);
      onCreated();
      onClose();
    } catch (e: any) {
      toastError('Error', e.message);
    }
    setCreating(false);
  };

  const selectedList = mtaLists.find(l => l.id === form.list_id);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 20, padding: 32, position: 'relative',
      }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16, background: 'none', border: 'none',
          color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4,
        }}><X size={18} /></button>

        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
          Create Campaign
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>
          Build a campaign in MailWizz. It will be created as a draft — you can send it from the queue.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Campaign Name */}
          <div>
            <label style={labelStyle}>Campaign Name *</label>
            <input style={inputStyle} placeholder="e.g. March B2B Outreach" 
              value={form.name} onChange={e => set('name', e.target.value)}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </div>

          {/* MTA List */}
          <div>
            <label style={labelStyle}>Subscriber List * {loadingLists && '(loading...)'}</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }}
              value={form.list_id} onChange={e => set('list_id', e.target.value)}>
              <option value="">Select a list from MailWizz...</option>
              {mtaLists.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.subscriber_count.toLocaleString()} subscribers)
                </option>
              ))}
            </select>
            {selectedList && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {selectedList.subscriber_count.toLocaleString()} subscribers will receive this campaign
              </div>
            )}
          </div>

          {/* Subject + From */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Subject *</label>
              <input style={inputStyle} placeholder="Your subject line" 
                value={form.subject} onChange={e => set('subject', e.target.value)}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={labelStyle}>Reply-To</label>
              <input style={inputStyle} placeholder="reply@example.com" 
                value={form.reply_to} onChange={e => set('reply_to', e.target.value)}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>From Name *</label>
              <input style={inputStyle} placeholder="John Smith" 
                value={form.from_name} onChange={e => set('from_name', e.target.value)}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={labelStyle}>From Email *</label>
              <input style={inputStyle} placeholder="john@company.com" 
                value={form.from_email} onChange={e => set('from_email', e.target.value)}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
            </div>
          </div>

          {/* HTML Body */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>HTML Body *</label>
              <Button variant="ghost" icon={<Eye size={12} />} onClick={() => setPreviewHtml(!previewHtml)}>
                {previewHtml ? 'Edit' : 'Preview'}
              </Button>
            </div>
            {previewHtml ? (
              <div style={{
                minHeight: 200, maxHeight: 400, overflow: 'auto', padding: 16, borderRadius: 10,
                background: '#fff', border: '1px solid var(--border)',
              }} dangerouslySetInnerHTML={{ __html: form.html_body }} />
            ) : (
              <textarea style={{ ...inputStyle, minHeight: 200, fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12, resize: 'vertical' }}
                placeholder="<html><body><p>Hi {{first_name}},</p></body></html>"
                value={form.html_body} onChange={e => set('html_body', e.target.value)}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
            )}
          </div>

          {/* Plain Text (optional) */}
          <div>
            <label style={labelStyle}>Plain Text (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
              placeholder="Plain text fallback..."
              value={form.plain_text} onChange={e => set('plain_text', e.target.value)}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            icon={creating ? <Loader2 size={14} className="spin" /> : <Rocket size={14} />}
            onClick={handleCreate}
            disabled={creating || !canSubmit}
          >
            {creating ? 'Creating...' : 'Create Campaign'}
          </Button>
        </div>
      </div>
    </div>
  );
}
