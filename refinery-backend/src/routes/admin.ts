import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import * as adminService from '../services/admin.js';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// Supabase admin client for role verification (uses service key, bypasses RLS)
const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.secretKey || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Middleware: Verify Superadmin Role via JWT → Supabase user lookup → profiles check
// ═══════════════════════════════════════════════════════════════
const requireSuperadmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // Verify the JWT and get the user via Supabase Auth API
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    // Check role in profiles using the admin client (queries PostgreSQL, not ClickHouse)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin privileges required' });
    }

    // Attach verified user ID for downstream handlers
    (req as any).adminId = user.id;
    next();
  } catch (err: any) {
    res.status(500).json({ error: `Auth validation failed: ${err.message}` });
  }
};

router.use(requireSuperadmin);

// ═══════════════════════════════════════════════════════════════
// Endpoints
// ═══════════════════════════════════════════════════════════════

// Direct password change logic
router.post('/reset-password', async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: 'Missing userId or newPassword' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    await adminService.resetPassword(userId, newPassword);
    res.json({ message: 'Password updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate recovery link
router.post('/send-reset-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    await adminService.sendResetLink(email);
    res.json({ message: 'Reset link dispatched' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate magic link to IMPERSONATE a user
router.post('/impersonate', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing target userId' });

    const link = await adminService.generateImpersonationLink(userId);
    res.json({ link });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user permanently
router.post('/delete-user', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing target userId' });

    await adminService.deleteAuthUser(userId);
    // Profile row cascades or is handled by triggers
    res.json({ message: 'User deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
