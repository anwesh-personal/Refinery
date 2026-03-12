import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../services/supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════════
// Auth Middleware — shared by all route files
// ═══════════════════════════════════════════════════════════════

/** Validates JWT and attaches userId to req */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
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

/** Checks that the authenticated user has superadmin role. Must run AFTER requireAuth. */
export const requireSuperadmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

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
