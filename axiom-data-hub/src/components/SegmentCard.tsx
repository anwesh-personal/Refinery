/**
 * SegmentCard — Rich card for a single segment.
 * Shows: status, lead count, last executed time, sync status, schedule badge.
 * Actions: Execute, Sync to MailWizz, Edit filter, Set schedule, Delete.
 */

import { useState } from 'react';
import {
  Play, RefreshCw, Loader2, Trash2, Pencil, CloudUpload,
  CheckCircle2, AlertCircle, Clock, CalendarClock, ExternalLink,
} from 'lucide-react';
import { apiCall } from '../lib/api';
import { timeAgo } from '../lib/timeAgo';

export interface Segment {
  id: string;
  name: string;
  niche: string | null;
  client_name: string | null;
  filter_query: string;
  lead_count: string | number;
  status: string;
  created_at: string;
  schedule_cron: string | null;
  last_executed_at: string | null;
  mailwizz_list_id: string | null;
  last_synced_at: string | null;
  sync_status: string | null;
  sync_count: string | number | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--green)',
  draft: 'var(--text-tertiary)',
  executing: 'var(--blue)',
};

const SYNC_COLORS: Record<string, string> = {
  synced: 'var(--green)',
  syncing: 'var(--blue)',
  failed: 'var(--red)',
  idle: 'var(--text-tertiary)',
};

const SCHEDULE_LABELS: Record<string, string> = {
  '0 6 * * *': 'Daily 6am',
  '0 9 * * *': 'Daily 9am',
  '0 6 * * 1': 'Weekly Mon',
  '0 6 1 * *': 'Monthly',
};



interface Props {
  seg: Segment;
  onExecute: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
  onEdit: (seg: Segment) => void;
  onRefresh: () => void;
}

export default function SegmentCard({ seg, onExecute, onDelete, onEdit, onRefresh }: Props) {
  const [executing, setExecuting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; listId: string; listUrl: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const execute = async () => {
    setExecuting(true);
    await onExecute(seg.id);
    setExecuting(false);
  };

  const syncMailwizz = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const r = await apiCall<{ ok: boolean; synced: number; listId: string; listUrl: string }>(
        `/api/segments/${seg.id}/sync-mailwizz`,
        { method: 'POST' }
      );
      setSyncResult(r);
      onRefresh();
    } catch (e: any) {
      setSyncError(e.message);
    }
    setSyncing(false);
  };

  const setSchedule = async (cron: string | null) => {
    setSavingSchedule(true);
    try {
      await apiCall(`/api/segments/${seg.id}/schedule`, { method: 'PUT', body: { scheduleCron: cron } });
      onRefresh();
      setScheduleOpen(false);
    } catch { /* ignore */ }
    setSavingSchedule(false);
  };

  const syncStatus = (seg.sync_status as string) || 'idle';
  const syncColor = SYNC_COLORS[syncStatus] || 'var(--text-tertiary)';
  const count = Number(seg.lead_count || 0);
  const syncCount = Number(seg.sync_count || 0);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      {/* Top bar */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: STATUS_COLORS[seg.status] || 'var(--text-tertiary)',
          boxShadow: seg.status === 'active' ? '0 0 0 3px var(--green-muted)' : 'none',
        }} />

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{seg.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {seg.niche && <span style={{ marginRight: 8 }}>#{seg.niche}</span>}
            {seg.client_name && <span>· {seg.client_name}</span>}
          </div>
        </div>

        {/* Schedule badge */}
        {seg.schedule_cron && (
          <div style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
            background: 'var(--accent-muted)', color: 'var(--accent)',
            border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <CalendarClock size={10} />
            {SCHEDULE_LABELS[seg.schedule_cron] || seg.schedule_cron}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div style={{ padding: '12px 20px', display: 'flex', gap: 24, borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
            {count > 0 ? count.toLocaleString() : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Leads</div>
        </div>

        <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.2 }}>
            {timeAgo(seg.last_executed_at)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last Run</div>
        </div>

        {syncCount > 0 && (
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: syncColor, lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 4 }}>
              {syncStatus === 'synced' && <CheckCircle2 size={11} />}
              {syncStatus === 'failed' && <AlertCircle size={11} />}
              {syncStatus === 'syncing' && <Loader2 size={11} className="spin" />}
              {syncCount.toLocaleString()} in MailWizz
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {timeAgo(seg.last_synced_at)}
            </div>
          </div>
        )}
      </div>

      {/* Feedback banners */}
      {syncResult && (
        <div style={{ padding: '8px 20px', background: 'var(--green-muted)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={13} />
          Synced {syncResult.synced.toLocaleString()} subscribers
          {syncResult.listUrl && (
            <a href={syncResult.listUrl} target="_blank" rel="noreferrer"
              style={{ marginLeft: 'auto', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open in MailWizz <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
      {syncError && (
        <div style={{ padding: '8px 20px', background: 'var(--red-muted)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--red)' }}>
          <AlertCircle size={12} style={{ display: 'inline', marginRight: 6 }} />
          {syncError}
        </div>
      )}

      {/* Schedule picker */}
      {scheduleOpen && (
        <div style={{ padding: '12px 20px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Auto-refresh schedule</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'Off', value: null },
              { label: 'Daily 6am', value: '0 6 * * *' },
              { label: 'Daily 9am', value: '0 9 * * *' },
              { label: 'Weekly Mon', value: '0 6 * * 1' },
              { label: 'Monthly', value: '0 6 1 * *' },
            ].map(opt => (
              <button key={String(opt.value)} onClick={() => setSchedule(opt.value)} disabled={savingSchedule}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${seg.schedule_cron === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: seg.schedule_cron === opt.value ? 'var(--accent-muted)' : 'var(--bg-input)',
                  color: seg.schedule_cron === opt.value ? 'var(--accent)' : 'var(--text-secondary)',
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions row */}
      <div style={{ padding: '12px 20px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={execute} disabled={executing}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7,
            fontSize: 12, fontWeight: 600, cursor: executing ? 'not-allowed' : 'pointer', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-contrast, #fff)', opacity: executing ? 0.6 : 1,
          }}>
          {executing ? <Loader2 size={12} className="spin" /> : (count > 0 ? <RefreshCw size={12} /> : <Play size={12} />)}
          {executing ? 'Running...' : count > 0 ? 'Re-run' : 'Execute'}
        </button>

        <button onClick={syncMailwizz} disabled={syncing || !count}
          title={!count ? 'Execute segment first' : 'Push leads to MailWizz'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7,
            fontSize: 12, fontWeight: 600, cursor: (syncing || !count) ? 'not-allowed' : 'pointer', border: 'none',
            background: 'var(--purple-muted)', color: 'var(--purple)', opacity: (syncing || !count) ? 0.5 : 1,
          }}>
          {syncing ? <Loader2 size={12} className="spin" /> : <CloudUpload size={12} />}
          {syncing ? 'Syncing...' : seg.mailwizz_list_id ? 'Re-sync' : 'Sync to MailWizz'}
        </button>

        <button onClick={() => setScheduleOpen(s => !s)}
          title="Set auto-refresh schedule"
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: scheduleOpen ? 'var(--accent-muted)' : 'var(--bg-input)',
            color: scheduleOpen ? 'var(--accent)' : 'var(--text-secondary)',
            border: `1px solid ${scheduleOpen ? 'var(--accent)' : 'var(--border)'}`,
          }}>
          <Clock size={12} />
          {seg.schedule_cron ? SCHEDULE_LABELS[seg.schedule_cron] || 'Scheduled' : 'Schedule'}
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => onEdit(seg)}
            style={{
              padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'var(--bg-input)', color: 'var(--text-secondary)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600,
            }}>
            <Pencil size={12} /> Edit
          </button>
          <button onClick={() => onDelete(seg.id)}
            style={{
              padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'var(--bg-input)', color: 'var(--text-tertiary)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
