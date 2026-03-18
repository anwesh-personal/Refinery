import { Router } from 'express';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import * as serverService from '../services/servers.js';
import { logAudit } from '../services/auditLog.js';

const router = Router();

// All routes require auth
router.use(requireAuth);

// ═════════════════════════════════════════════════
// READ — any authenticated user (credentials stripped)
// ═════════════════════════════════════════════════

router.get('/', async (_req, res) => {
  try {
    const servers = await serverService.listServers();
    res.json({ servers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════
// WRITE — superadmin only
// ═════════════════════════════════════════════════

router.post('/', requireSuperadmin, async (req, res) => {
  try {
    const { name, type, host, port, username, password, database_name, bucket, region, access_key, secret_key, endpoint_url, is_default } = req.body;
    if (!name || !type || !host) {
      return res.status(400).json({ error: 'name, type, and host are required' });
    }
    if (!['clickhouse', 's3', 'minio', 'linode'].includes(type)) {
      return res.status(400).json({ error: 'type must be clickhouse, s3, or minio' });
    }

    // Explicitly construct the payload — no raw req.body passthrough
    const server = await serverService.createServer({
      name, type, host,
      port: port || (type === 'clickhouse' ? 8123 : 443),
      username: username || '',
      password: password || '',
      database_name: database_name || 'default',
      bucket: bucket || null,
      region: region || 'us-east-1',
      access_key: access_key || '',
      secret_key: secret_key || '',
      endpoint_url: endpoint_url || null,
      is_default: is_default || false,
      is_active: true,
      created_by: (req as any).userId,
    });

    await logAudit((req as any).userId, 'server_created', server.id, { name, type, host });

    // server is already ServerSafe (no credentials)
    res.status(201).json({ server });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireSuperadmin, async (req, res) => {
  try {
    const serverId = String(req.params.id);

    // Allowlisted fields only — handled by serverService.updateServer
    const server = await serverService.updateServer(serverId, req.body);

    await logAudit((req as any).userId, 'server_updated', serverId, { fields: Object.keys(req.body) });

    // server is already ServerSafe (no credentials)
    res.json({ server });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireSuperadmin, async (req, res) => {
  try {
    const serverId = String(req.params.id);
    await serverService.deleteServer(serverId);

    await logAudit((req as any).userId, 'server_deleted', serverId, {});

    res.json({ message: 'Server deactivated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/set-default', requireSuperadmin, async (req, res) => {
  try {
    const serverId = String(req.params.id);
    await serverService.setDefault(serverId);

    await logAudit((req as any).userId, 'server_set_default', serverId, {});

    res.json({ message: 'Default server updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    const result = await serverService.testConnection(String(req.params.id));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
