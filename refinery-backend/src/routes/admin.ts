import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as adminService from '../services/admin.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

const router = Router();

let rateLimitWindowMs = 60_000;
let rateLimitMax = 20;

// Load rate limit config from Supabase on startup (non-blocking)
(async () => {
  try {
    const { data } = await supabaseAdmin
      .from('system_config')
      .select('config_key, config_value')
      .in('config_key', ['admin_rate_limit_window_ms', 'admin_rate_limit_max']);

    if (data) {
      for (const row of data) {
        if (row.config_key === 'admin_rate_limit_window_ms') rateLimitWindowMs = Number(row.config_value) || rateLimitWindowMs;
        if (row.config_key === 'admin_rate_limit_max') rateLimitMax = Number(row.config_value) || rateLimitMax;
      }
    }
    console.log(`[Admin] Rate limit: ${rateLimitMax} req / ${rateLimitWindowMs / 1000}s window`);
  } catch {
    console.warn('[Admin] Could not load rate limit config from DB — using defaults');
  }
})();

// Use arrow functions so the limiter reads the LATEST values after async load
const adminRateLimit = rateLimit({
  windowMs: () => rateLimitWindowMs,
  max: () => rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests. Please wait before trying again.' },
} as any);

router.use(adminRateLimit);

// Use shared auth middleware — requireAuth + requireSuperadmin
router.use(requireAuth);
router.use(requireSuperadmin);

// ═══════════════════════════════════════════════════════════════
// Audit Helper
// ═══════════════════════════════════════════════════════════════
async function auditLog(actorId: string, action: string, targetId: string | null, details: Record<string, unknown>) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_id: actorId,
      action,
      target_id: targetId,
      details,
    });
  } catch (err: any) {
    console.error('[Admin Audit] Failed to write audit log:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// Endpoints
// ═══════════════════════════════════════════════════════════════

// Direct password reset
router.post('/reset-password', async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    const adminId = (req as any).userId;

    if (!userId || !newPassword) return res.status(400).json({ error: 'Missing userId or newPassword' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    await adminService.resetPassword(userId, newPassword);
    await auditLog(adminId, 'admin_password_reset', userId, { method: 'direct' });
    res.json({ message: 'Password updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Send recovery link
router.post('/send-reset-link', async (req, res) => {
  try {
    const { email } = req.body;
    const adminId = (req as any).userId;

    if (!email) return res.status(400).json({ error: 'Missing email' });

    await adminService.sendResetLink(email);
    await auditLog(adminId, 'admin_send_reset_link', null, { email });
    res.json({ message: 'Reset link dispatched' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Impersonate user
router.post('/impersonate', async (req, res) => {
  try {
    const { userId } = req.body;
    const adminId = (req as any).userId;

    if (!userId) return res.status(400).json({ error: 'Missing target userId' });
    if (userId === adminId) return res.status(400).json({ error: 'Cannot impersonate yourself' });

    const link = await adminService.generateImpersonationLink(userId);
    await auditLog(adminId, 'admin_impersonate', userId, {});
    res.json({ link });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user permanently
router.post('/delete-user', async (req, res) => {
  try {
    const { userId } = req.body;
    const adminId = (req as any).userId;

    if (!userId) return res.status(400).json({ error: 'Missing target userId' });
    if (userId === adminId) return res.status(400).json({ error: 'Cannot delete yourself' });

    await adminService.deleteAuthUser(userId);
    await auditLog(adminId, 'admin_delete_user', userId, {});
    res.json({ message: 'User deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get current rate limit config
router.get('/config', async (_req, res) => {
  res.json({
    rateLimitWindowMs,
    rateLimitMax,
  });
});

// Update rate limit config (stored in system_config)
router.post('/config', async (req, res) => {
  try {
    const { windowMs, max } = req.body;
    const adminId = (req as any).userId;

    if (windowMs) {
      await supabaseAdmin.from('system_config').upsert(
        { config_key: 'admin_rate_limit_window_ms', config_value: String(windowMs) },
        { onConflict: 'config_key' }
      );
      rateLimitWindowMs = Number(windowMs);
    }
    if (max) {
      await supabaseAdmin.from('system_config').upsert(
        { config_key: 'admin_rate_limit_max', config_value: String(max) },
        { onConflict: 'config_key' }
      );
      rateLimitMax = Number(max);
    }

    await auditLog(adminId, 'admin_config_update', null, { windowMs, max });
    res.json({ message: 'Config updated. Rate limit changes take effect on next server restart.', rateLimitWindowMs, rateLimitMax });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
