import { Router, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import * as serverService from '../services/servers.js';

const router = Router();

const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.secretKey || env.supabase.publishableKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Auth Middleware ──
// All server routes require authentication. Mutation routes require superadmin.

const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    (req as any).userId = user.id;
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

const requireSuperadmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();
    if (!profile || profile.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin required' });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// All routes require auth
router.use(requireAuth);

// ═════════════════════════════════════════════════
// READ — any authenticated user
// ═════════════════════════════════════════════════

// List all active servers (credentials stripped)
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

// Create a new server connection
router.post('/', requireSuperadmin, async (req, res) => {
  try {
    const { name, type, host, port, username, password, database_name, bucket, region, access_key, secret_key, endpoint_url, is_default } = req.body;
    if (!name || !type || !host) {
      return res.status(400).json({ error: 'name, type, and host are required' });
    }
    if (!['clickhouse', 's3', 'linode'].includes(type)) {
      return res.status(400).json({ error: 'type must be clickhouse, s3, or linode' });
    }

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

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      actor_id: (req as any).userId,
      action: 'server_created',
      target_id: server.id,
      details: { name, type, host },
    } as any);

    res.json({ server });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update a server
router.put('/:id', requireSuperadmin, async (req, res) => {
  try {
    const server = await serverService.updateServer(String(req.params.id), req.body);

    await supabaseAdmin.from('audit_log').insert({
      actor_id: (req as any).userId,
      action: 'server_updated',
      target_id: String(req.params.id),
      details: { fields: Object.keys(req.body) },
    } as any);

    res.json({ server });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a server (soft)
router.delete('/:id', requireSuperadmin, async (req, res) => {
  try {
    await serverService.deleteServer(String(req.params.id));

    await supabaseAdmin.from('audit_log').insert({
      actor_id: (req as any).userId,
      action: 'server_deleted',
      target_id: String(req.params.id),
      details: {},
    } as any);

    res.json({ message: 'Server deactivated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Set as default
router.post('/:id/set-default', requireSuperadmin, async (req, res) => {
  try {
    await serverService.setDefault(String(req.params.id));

    await supabaseAdmin.from('audit_log').insert({
      actor_id: (req as any).userId,
      action: 'server_set_default',
      target_id: String(req.params.id),
      details: {},
    } as any);

    res.json({ message: 'Default server updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test connection
router.post('/:id/test', async (req, res) => {
  try {
    const result = await serverService.testConnection(String(req.params.id));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
