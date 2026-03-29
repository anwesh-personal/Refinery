import { query, insertRows, command } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';
import { createConnection } from 'net';
import { connect as tlsConnect } from 'tls';

// ═══════════════════════════════════════════════════════════════
// SMTP Server Management — Local ClickHouse storage + real
// SMTP connection testing (EHLO/AUTH). These are YOUR delivery
// servers (xsmtp.co, Postfix, any SMTP provider). Completely
// separate from the EMA (MailWizz/campaign tool).
// ═══════════════════════════════════════════════════════════════

export interface SmtpServer {
  id: string;
  label: string;
  hostname: string;
  port: number;
  protocol: string;
  username: string;
  password: string;       // masked on read
  from_email: string;
  from_name: string;
  daily_quota: number;
  is_active: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_msg: string;
  created_at: string;
}

function esc(s: string): string { return s.replace(/'/g, "\\'"); }

// ── CRUD ──

export async function listServers(): Promise<SmtpServer[]> {
  const rows = await query<any>(`SELECT * FROM smtp_servers FINAL WHERE is_active = 1 ORDER BY label`);
  return rows.map(maskServer);
}

export async function getServer(id: string): Promise<SmtpServer | null> {
  const rows = await query<any>(`SELECT * FROM smtp_servers FINAL WHERE id = '${esc(id)}' LIMIT 1`);
  return rows[0] ? toServer(rows[0]) : null;
}

export async function createServer(input: {
  label: string;
  hostname: string;
  port?: number;
  protocol?: string;
  username: string;
  password: string;
  from_email?: string;
  from_name?: string;
  daily_quota?: number;
}): Promise<string> {
  const id = genId();
  await insertRows('smtp_servers', [{
    id,
    label: input.label || input.hostname,
    hostname: input.hostname,
    port: input.port || 587,
    protocol: input.protocol || 'smtp',
    username: input.username,
    password: input.password,
    from_email: input.from_email || input.username,
    from_name: input.from_name || '',
    daily_quota: input.daily_quota || 3000,
    is_active: 1,
  }]);
  return id;
}

export async function updateServer(id: string, updates: Partial<{
  label: string;
  hostname: string;
  port: number;
  protocol: string;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  daily_quota: number;
  is_active: boolean;
}>): Promise<void> {
  const existing = await getServer(id);
  if (!existing) throw new Error(`SMTP server ${id} not found`);

  // Don't overwrite password with mask
  if (updates.password === '••••••••' || !updates.password) {
    updates.password = existing.password;
  }

  await insertRows('smtp_servers', [{
    id,
    label: updates.label ?? existing.label,
    hostname: updates.hostname ?? existing.hostname,
    port: updates.port ?? existing.port,
    protocol: updates.protocol ?? existing.protocol,
    username: updates.username ?? existing.username,
    password: updates.password,
    from_email: updates.from_email ?? existing.from_email,
    from_name: updates.from_name ?? existing.from_name,
    daily_quota: updates.daily_quota ?? existing.daily_quota,
    is_active: updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : (existing.is_active ? 1 : 0),
    created_at: existing.created_at,
  }]);
}

export async function deleteServer(id: string): Promise<void> {
  await command(`ALTER TABLE smtp_servers DELETE WHERE id = '${esc(id)}'`);
}

// ── SMTP Connection Test ──

export async function testServer(id: string): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const server = await getServer(id);
  if (!server) throw new Error(`SMTP server ${id} not found`);

  const start = Date.now();

  try {
    const result = await smtpHandshake(
      server.hostname,
      server.port,
      server.username,
      server.password,
      server.protocol,
    );

    const latency = Date.now() - start;

    // Save test result
    await insertRows('smtp_servers', [{
      ...serverToRow(server),
      last_test_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      last_test_ok: result.ok ? 1 : 0,
      last_test_msg: result.message.slice(0, 200),
    }]);

    return { ...result, latencyMs: latency };
  } catch (e: any) {
    const latency = Date.now() - start;

    await insertRows('smtp_servers', [{
      ...serverToRow(server),
      last_test_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      last_test_ok: 0,
      last_test_msg: e.message.slice(0, 200),
    }]);

    return { ok: false, message: e.message, latencyMs: latency };
  }
}

/**
 * Real SMTP handshake: connect → EHLO → STARTTLS (if needed) → AUTH LOGIN
 */
function smtpHandshake(
  host: string, port: number, user: string, pass: string, protocol: string,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket?.destroy();
      resolve({ ok: false, message: `Connection timed out after 10s` });
    }, 10000);

    let socket: any;
    let buffer = '';
    let step = 0; // 0=banner, 1=ehlo, 2=starttls, 3=auth, 4=user, 5=pass
    let tlsUpgraded = false;
    const isSSL = protocol === 'smtps' || port === 465;
    let ehloCapabilities = '';

    function send(cmd: string) {
      try { socket.write(cmd + '\r\n'); } catch {}
    }

    function handleLine(line: string) {
      const code = parseInt(line.slice(0, 3));

      switch (step) {
        case 0: // Banner
          if (code === 220) { step = 1; send(`EHLO refinery-nexus`); }
          else finish(false, `Bad banner: ${line}`);
          break;

        case 1: // EHLO response — collect capabilities
          if (line.startsWith('250-')) {
            ehloCapabilities += line + '\n';
            // Wait for final 250 line
          } else if (line.startsWith('250 ') || (code === 250 && !line.startsWith('250-'))) {
            ehloCapabilities += line + '\n';
            // EHLO done — decide next step
            if (!isSSL && !tlsUpgraded && ehloCapabilities.toUpperCase().includes('STARTTLS')) {
              // Server supports STARTTLS and we haven't upgraded yet
              step = 2; send('STARTTLS');
            } else {
              // Already on TLS (or SSL connection, or no STARTTLS support) → AUTH
              step = 3; send('AUTH LOGIN');
            }
          }
          break;

        case 2: // STARTTLS response
          if (code === 220) {
            // Remove old data listener before upgrading
            socket.removeAllListeners('data');
            const oldSocket = socket;
            const tlsSocket = tlsConnect({ socket: oldSocket, servername: host, rejectUnauthorized: false }, () => {
              socket = tlsSocket;
              tlsUpgraded = true;
              socket.on('data', onData);
              ehloCapabilities = '';
              step = 1; // re-EHLO after TLS upgrade
              send('EHLO refinery-nexus');
            });
            tlsSocket.on('error', (e: any) => finish(false, `TLS upgrade failed: ${e.message}`));
          } else {
            // STARTTLS rejected — try AUTH on plain connection (risky but functional)
            step = 3; send('AUTH LOGIN');
          }
          break;

        case 3: // AUTH LOGIN
          if (code === 334) { step = 4; send(Buffer.from(user).toString('base64')); }
          else if (code === 504 || code === 502) {
            // AUTH LOGIN not supported — try AUTH PLAIN
            const plainToken = Buffer.from(`\0${user}\0${pass}`).toString('base64');
            step = 5; // Next response will be the auth result
            send(`AUTH PLAIN ${plainToken}`);
          }
          else finish(false, `AUTH not supported: ${line}`);
          break;

        case 4: // Username sent
          if (code === 334) { step = 5; send(Buffer.from(pass).toString('base64')); }
          else finish(false, `Username rejected: ${line}`);
          break;

        case 5: // Password sent (or AUTH PLAIN result)
          if (code === 235) {
            send('QUIT');
            finish(true, `Authenticated successfully on ${host}:${port}${tlsUpgraded ? ' (STARTTLS)' : isSSL ? ' (SSL)' : ''}`);
          } else {
            finish(false, `Auth failed: ${line.slice(4)}`);
          }
          break;
      }
    }

    function finish(ok: boolean, message: string) {
      clearTimeout(timeout);
      try { socket?.destroy(); } catch {}
      resolve({ ok, message });
    }

    function onData(chunk: Buffer) {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) handleLine(line);
      }
    }

    try {
      if (isSSL) {
        // Direct SSL/TLS connection (port 465)
        socket = tlsConnect({ host, port, rejectUnauthorized: false }, () => {
          tlsUpgraded = true;
          socket.on('data', onData);
        });
      } else {
        // Plain TCP connection → will upgrade via STARTTLS if supported
        socket = createConnection({ host, port }, () => {
          socket.on('data', onData);
        });
      }

      socket.on('error', (e: any) => finish(false, `Connection failed: ${e.message}`));
    } catch (e: any) {
      clearTimeout(timeout);
      resolve({ ok: false, message: `Failed to connect: ${e.message}` });
    }
  });
}

// ── Helpers ──

function maskServer(row: any): SmtpServer {
  return { ...toServer(row), password: '••••••••' };
}

function toServer(row: any): SmtpServer {
  return {
    id: row.id,
    label: row.label || row.hostname,
    hostname: row.hostname,
    port: Number(row.port) || 587,
    protocol: row.protocol || 'smtp',
    username: row.username || '',
    password: row.password || '',
    from_email: row.from_email || '',
    from_name: row.from_name || '',
    daily_quota: Number(row.daily_quota) || 3000,
    is_active: !!Number(row.is_active),
    last_test_at: row.last_test_at || null,
    last_test_ok: row.last_test_ok != null ? !!Number(row.last_test_ok) : null,
    last_test_msg: row.last_test_msg || '',
    created_at: row.created_at || '',
  };
}

function serverToRow(s: SmtpServer): Record<string, any> {
  return {
    id: s.id,
    label: s.label,
    hostname: s.hostname,
    port: s.port,
    protocol: s.protocol,
    username: s.username,
    password: s.password,
    from_email: s.from_email,
    from_name: s.from_name,
    daily_quota: s.daily_quota,
    is_active: s.is_active ? 1 : 0,
    created_at: s.created_at,
  };
}
