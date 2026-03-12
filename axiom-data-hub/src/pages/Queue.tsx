import { ListOrdered, Send, Clock, CheckCircle, XCircle, Play, Pause } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, DataTable, Button } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';

export default function QueuePage() {
  return (
    <>
      <PageHeader 
        title="Mail Queue" 
        sub="Monitor and control email dispatch jobs from verified target lists." 
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Queued" value="0" sub="Emails pending" icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.06} />
        <StatCard label="Sent" value="0" sub="Successfully delivered" icon={<CheckCircle size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Failed" value="0" sub="Delivery errors" icon={<XCircle size={18} />} color="var(--red)" colorMuted="var(--red-muted)" delay={0.18} />
        <StatCard label="Active Jobs" value="0" sub="Currently sending" icon={<Send size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.24} />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 36 }}>
        <Button icon={<Play size={14} />}>Start Queue</Button>
        <Button variant="secondary" icon={<Pause size={14} />}>Pause All</Button>
        <Button variant="danger" icon={<XCircle size={14} />}>Flush Queue</Button>
      </div>

      <SectionHeader title="Queue Jobs" action="Refresh" />
      <DataTable
        columns={[
          { key: 'id', label: 'Job ID' },
          { key: 'list', label: 'Target List' },
          { key: 'total', label: 'Total Emails' },
          { key: 'sent', label: 'Sent' },
          { key: 'failed', label: 'Failed' },
          { key: 'status', label: 'Status' },
          { key: 'started', label: 'Started' },
        ]}
        rows={[]}
        emptyIcon={<ListOrdered size={24} />}
        emptyTitle="No queue jobs"
        emptySub="Push a target list to the mailer to start queueing"
      />
    </>
  );
}
