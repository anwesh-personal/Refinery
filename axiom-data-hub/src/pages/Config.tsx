import { Save, RefreshCw } from 'lucide-react';
import { PageHeader, SectionHeader, ConfigRow, Input, Button } from '../components/UI';

export default function ConfigPage() {
  return (
    <>
      <PageHeader title="Server Config" sub="Manage your Linode server connections, ClickHouse, and daemon settings." />

      <SectionHeader title="Linode Server" />
      <div
        className="animate-fadeIn"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: 32 }}
      >
        <ConfigRow label="Server IP" description="The public IP address of your Linode instance">
          <Input placeholder="e.g. 172.105.xx.xx" />
        </ConfigRow>
        <ConfigRow label="SSH Port" description="Port for SSH daemon management access">
          <Input placeholder="22" />
        </ConfigRow>
        <ConfigRow label="SSH Key Path" description="Path to your private SSH key for authentication">
          <Input placeholder="/home/user/.ssh/id_rsa" />
        </ConfigRow>
      </div>

      <SectionHeader title="ClickHouse Connection" />
      <div
        className="animate-fadeIn stagger-1"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: 32 }}
      >
        <ConfigRow label="Host" description="ClickHouse server hostname or IP">
          <Input placeholder="localhost" />
        </ConfigRow>
        <ConfigRow label="Port" description="HTTP interface port (default: 8123)">
          <Input placeholder="8123" />
        </ConfigRow>
        <ConfigRow label="Database" description="Default database to query">
          <Input placeholder="refinery_leads" />
        </ConfigRow>
        <ConfigRow label="Username" description="ClickHouse authentication user">
          <Input placeholder="default" />
        </ConfigRow>
        <ConfigRow label="Password" description="ClickHouse authentication password">
          <Input placeholder="••••••••" type="password" />
        </ConfigRow>
      </div>

      <SectionHeader title="Linode Object Storage" />
      <div
        className="animate-fadeIn stagger-2"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: 32 }}
      >
        <ConfigRow label="Endpoint" description="Linode S3-compatible endpoint URL">
          <Input placeholder="https://us-east-1.linodeobjects.com" />
        </ConfigRow>
        <ConfigRow label="Access Key" description="Linode Object Storage access key">
          <Input placeholder="LKXXXXXX" type="password" />
        </ConfigRow>
        <ConfigRow label="Secret Key" description="Linode Object Storage secret key">
          <Input placeholder="••••••••" type="password" />
        </ConfigRow>
        <ConfigRow label="Bucket Name" description="Target bucket for storing ingested files">
          <Input placeholder="refinery-data" />
        </ConfigRow>
      </div>

      <SectionHeader title="Mailer Configuration" />
      <div
        className="animate-fadeIn stagger-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', marginBottom: 32 }}
      >
        <ConfigRow label="SMTP Host" description="Outgoing mail server hostname">
          <Input placeholder="smtp.yourdomain.com" />
        </ConfigRow>
        <ConfigRow label="SMTP Port" description="Mail server port (587 for TLS)">
          <Input placeholder="587" />
        </ConfigRow>
        <ConfigRow label="From Email" description="Sender email address">
          <Input placeholder="noreply@yourdomain.com" />
        </ConfigRow>
        <ConfigRow label="SMTP Password" description="Sender authentication password">
          <Input placeholder="••••••••" type="password" />
        </ConfigRow>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 48 }}>
        <Button icon={<Save size={14} />}>Save All Configuration</Button>
        <Button variant="secondary" icon={<RefreshCw size={14} />}>Test All Connections</Button>
      </div>
    </>
  );
}
