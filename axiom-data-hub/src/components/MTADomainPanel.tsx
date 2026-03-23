import { useState } from 'react';
import { Button } from './UI';
import { Plus, Trash2, ShieldCheck, Loader2, Globe, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { apiCall } from '../lib/api';
import { useToast } from './Toast';

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

interface Props {
  providerId: string;
  domains: SendingDomain[];
  onRefresh: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500,
  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
  outline: 'none',
};

function DnsIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <AlertCircle size={13} style={{ color: 'var(--text-tertiary)' }} />;
  return ok
    ? <CheckCircle size={13} style={{ color: 'var(--green)' }} />
    : <XCircle size={13} style={{ color: 'var(--red)' }} />;
}

export default function MTADomainPanel({ providerId, domains, onRefresh }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [domain, setDomain] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [adding, setAdding] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { success, error: toastError } = useToast();

  const addDomain = async () => {
    if (!domain || !fromEmail) return;
    setAdding(true);
    try {
      await apiCall(`/api/mta-providers/${providerId}/domains`, {
        method: 'POST', body: { domain, from_email: fromEmail, from_name: fromName },
      });
      success('Domain Added', `${domain} registered`);
      setDomain(''); setFromEmail(''); setFromName(''); setShowAdd(false);
      onRefresh();
    } catch (e: any) { toastError('Error', e.message); }
    setAdding(false);
  };

  const checkDns = async (domainId: string) => {
    setCheckingId(domainId);
    try {
      const res = await apiCall<{ spf: boolean; dkim: boolean; dmarc: boolean }>(
        `/api/mta-providers/domains/${domainId}/check-dns`, { method: 'POST' },
      );
      const passed = [res.spf && 'SPF', res.dkim && 'DKIM', res.dmarc && 'DMARC'].filter(Boolean);
      success('DNS Check Complete', `Passed: ${passed.join(', ') || 'None'}`);
      onRefresh();
    } catch (e: any) { toastError('DNS Error', e.message); }
    setCheckingId(null);
  };

  const deleteDomain = async (domainId: string) => {
    if (!confirm('Remove this domain?')) return;
    setDeletingId(domainId);
    try {
      await apiCall(`/api/mta-providers/domains/${domainId}`, { method: 'DELETE' });
      success('Removed', 'Domain deleted');
      onRefresh();
    } catch (e: any) { toastError('Error', e.message); }
    setDeletingId(null);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={14} /> Sending Domains ({domains.length})
        </h4>
        <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add Domain'}
        </Button>
      </div>

      {showAdd && (
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 16, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
        }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Domain</label>
            <input style={inputStyle} placeholder="example.com" value={domain} onChange={e => setDomain(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>From Email</label>
            <input style={inputStyle} placeholder="hello@example.com" value={fromEmail} onChange={e => setFromEmail(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>From Name</label>
            <input style={inputStyle} placeholder="Company" value={fromName} onChange={e => setFromName(e.target.value)} />
          </div>
          <Button onClick={addDomain} disabled={adding || !domain || !fromEmail}
            icon={adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}>
            {adding ? 'Adding...' : 'Add'}
          </Button>
        </div>
      )}

      {domains.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {domains.map(d => (
            <div key={d.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
              fontSize: 13, transition: 'border-color 0.15s',
            }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.domain}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {d.from_name ? `${d.from_name} <${d.from_email}>` : d.from_email}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600 }}>
                  <DnsIcon ok={d.spf_ok} /> SPF
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600 }}>
                  <DnsIcon ok={d.dkim_ok} /> DKIM
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600 }}>
                  <DnsIcon ok={d.dmarc_ok} /> DMARC
                </span>
              </div>

              <Button variant="ghost" icon={
                checkingId === d.id ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />
              } onClick={() => checkDns(d.id)} disabled={checkingId !== null}>
                Check
              </Button>

              <button onClick={() => deleteDomain(d.id)} disabled={deletingId === d.id}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                  padding: 4, borderRadius: 6, transition: 'color 0.15s',
                }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--red)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
              >
                {deletingId === d.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)', fontSize: 12 }}>
          No sending domains configured. Click "Add Domain" to register one.
        </div>
      )}
    </div>
  );
}
